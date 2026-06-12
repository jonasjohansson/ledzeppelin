import { emptyShow, makeFixtureType } from './show.js';
import { normalizeComposition } from './layers.js';
import { fitCanvasToFixtures } from './fixture-transform.js';

// Import a Kagora preset into a ledzeppelin show.
//
// Kagora shapes (confirmed against the real preset):
//  - types: { kind:'stripType', id, pixelCount, colorOrder, ... } and
//           { kind:'controllerType', id, outputs, ports, ... }
//  - instances: each { kind, id, typeId }. Strips also carry a `points`
//    polyline of {x,y} objects. Controllers carry output ports.
//  - edges: { from, to, channel, ... }. Data/signal edges have channel:'signal'.
//    from/to each carry an `instId` and a port `id`. A controller output edge
//    goes from a controller port `data-out-N` to a strip's `data-in`. Strips
//    daisy-chain via the strip's `data-out` → next strip's `data-in`.
//
// Each strip has exactly one incoming data edge (its data-in), so we can follow
// the chain back to the controller output it hangs off, and forward to order the
// daisy chain. Device-local pixel offsets reset to 0 per controller output's
// chain head; Part A's pipeline handles the cross-device global layout.
//
// IP is left BLANK — assigned later in the import/assign-IP UI.
export function importKagora(preset) {
  const DEFAULT_PORT = 4048;
  const DEFAULT_COLOR_ORDER = 'GRB';

  const typeById = new Map((preset.types ?? []).map((t) => [t.id, t]));
  const instById = new Map((preset.instances ?? []).map((i) => [i.id, i]));

  const controllers = (preset.instances ?? []).filter((i) => i.kind === 'controller');
  const strips = (preset.instances ?? []).filter((i) => i.kind === 'strip');

  // Signal (data) edges only.
  const dataEdges = (preset.edges ?? []).filter((e) => e.channel === 'signal');

  // Map: strip id -> the single edge feeding its data-in.
  const incomingByStrip = new Map();
  for (const e of dataEdges) {
    if (e.to?.id === 'data-in') incomingByStrip.set(e.to.instId, e);
  }
  // Map: source strip id -> edge leaving its data-out (next strip in chain).
  const outgoingByStrip = new Map();
  for (const e of dataEdges) {
    if (e.from?.id === 'data-out' && instById.get(e.from.instId)?.kind === 'strip') {
      outgoingByStrip.set(e.from.instId, e);
    }
  }

  const stripType = (s) => typeById.get(s.typeId);
  const stripPixelCount = (s) => {
    const t = stripType(s);
    if (!t) {
      // Missing stripType → 0-pixel fixture. Surface the data loss instead of
      // silently dropping pixels; still produce the fixture (don't throw).
      console.warn(`importKagora: strip "${s.id}" has missing stripType (typeId="${s.typeId}"); producing 0-pixel fixture`);
      return 0;
    }
    return t.pixelCount ?? 0;
  };
  const stripColorOrder = (s) => stripType(s)?.colorOrder ?? DEFAULT_COLOR_ORDER;

  // Chain heads: strips whose incoming edge comes directly from a controller.
  // Each head defines a daisy chain (controller output → head → next → ...).
  // Record the controller + output port so we can order chains within a device.
  const chainHeads = [];
  for (const s of strips) {
    const e = incomingByStrip.get(s.id);
    if (e?.from && instById.get(e.from?.instId)?.kind === 'controller') {
      chainHeads.push({ stripId: s.id, controllerId: e.from.instId, port: e.from.id });
    }
  }

  // For every strip, record its DEVICE-LOCAL pixel offset and its controller.
  //
  // A controller can drive MULTIPLE output chains (data-out-1..N). Per-device
  // offsets must be contiguous-from-0 across the WHOLE device (validate() in
  // show.js enforces this), so we accumulate across all of a device's chains,
  // ordered by controller output port, and within each chain by daisy order.
  // The first chain on a device therefore yields offsets 0 / firstPixelCount;
  // later chains continue from the running device cursor.
  const offsetByStrip = new Map();
  const deviceIdByStrip = new Map();

  // Group heads by device, then order by output port for a stable layout.
  const headsByDevice = new Map();
  for (const h of chainHeads) {
    if (!headsByDevice.has(h.controllerId)) headsByDevice.set(h.controllerId, []);
    headsByDevice.get(h.controllerId).push(h);
  }
  // Each daisy chain (head → … → tail) in data-flow order, for auto-chaining.
  const daisyRuns = [];
  for (const [controllerId, heads] of headsByDevice) {
    // Order by the NUMERIC trailing index of the port id (e.g. data-out-2 before
    // data-out-10). Parse defensively: fall back to string compare if no number.
    const portIndex = (p) => {
      const m = String(p ?? '').match(/(\d+)\s*$/);
      return m ? Number(m[1]) : null;
    };
    heads.sort((a, b) => {
      const ia = portIndex(a.port), ib = portIndex(b.port);
      if (ia === null || ib === null) return String(a.port).localeCompare(String(b.port));
      return ia - ib;
    });
    let cursor = 0;
    for (const head of heads) {
      let cur = head.stripId;
      const seen = new Set();
      const run = [];
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const s = instById.get(cur);
        if (!s || s.kind !== 'strip') break;
        offsetByStrip.set(cur, cursor);
        deviceIdByStrip.set(cur, controllerId);
        cursor += stripPixelCount(s);
        run.push(cur);
        const next = outgoingByStrip.get(cur);
        cur = next ? next.to.instId : null;
      }
      if (run.length >= 2) daisyRuns.push(run);   // a multi-strip run → a chain
    }
  }

  // Per-controller default colorOrder: first strip's colorOrder on that device.
  const colorOrderByDevice = new Map();
  for (const s of strips) {
    const dev = deviceIdByStrip.get(s.id);
    if (dev && !colorOrderByDevice.has(dev)) {
      colorOrderByDevice.set(dev, stripColorOrder(s));
    }
  }

  // Compute a shared bbox over ALL strip points to normalize into 0..1.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strips) {
    for (const p of s.points ?? []) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const norm = (p) => [(p.x - minX) / spanX, (p.y - minY) / spanY];

  // UNIFORM pixel scale (long axis ≈ 1280). Used both for the canvas size AND for
  // each straight strip's TRANSFORM, so the layout is locked in pixel space and
  // never squishes if the canvas is later resized to a different aspect (a bar
  // fixture's transform is the source of truth; deriving it from per-axis 0..1
  // points instead would distort on a non-rig-aspect canvas).
  const scl = 1280 / Math.max(spanX, spanY);
  const toPx = (p) => [(p.x - minX) * scl, (p.y - minY) * scl];
  function barTransform(s) {
    const pts = s.points ?? [];
    if (pts.length < 2) return { x: 0, y: 0, w: 10, h: 0, rotation: 0 };
    const [ax, ay] = toPx(pts[0]);
    const [bx, by] = toPx(pts[pts.length - 1]);
    return { x: (ax + bx) / 2, y: (ay + by) / 2, w: Math.hypot(bx - ax, by - ay), h: 0,
      rotation: Math.atan2(by - ay, bx - ax) * 180 / Math.PI };
  }

  function normalizedPoints(s) {
    const pts = s.points ?? [];
    if (pts.length >= 2) return pts.map(norm);
    // Synthesize a short default segment if the strip has no usable polyline.
    if (pts.length === 1) return [norm(pts[0]), norm(pts[0])];
    return [[0, 0], [0.1, 0]];
  }

  const show = emptyShow();

  show.devices = controllers
    .filter((c) => strips.some((s) => deviceIdByStrip.get(s.id) === c.id))
    .map((c) => ({
      id: c.id,
      name: c.name ?? c.typeId,
      ip: '',
      port: DEFAULT_PORT,
      colorOrder: colorOrderByDevice.get(c.id) ?? DEFAULT_COLOR_ORDER,
    }));

  // Each daisy-run = one controller OUTPUT (port). Assign a per-device port to
  // every strip in a run, and record its position in the run (= wiring order).
  // Chains are now DERIVED from (device, port) + array order — no explicit list.
  const portByStrip = new Map(), runIndexByStrip = new Map(), portCounter = new Map();
  daisyRuns.forEach((run) => {
    const devId = deviceIdByStrip.get(run[0]);
    const p = (portCounter.get(devId) || 0) + 1; portCounter.set(devId, p);
    run.forEach((sid, idx) => { portByStrip.set(sid, p); runIndexByStrip.set(sid, idx); });
  });

  // Fixture TYPES — one per Kagora stripType in use, so imported strips appear in
  // the Inventory AND keep their real pixel counts. Without a typeId, syncFixtureTypes
  // would coerce every fixture to its 60px default; here pixelCount is authoritative
  // from Kagora (meters = px/lpm so makeFixtureType reproduces it exactly).
  const fixtureTypeByStrip = new Map();
  const fixtureTypes = [];
  const seenStripType = new Map();   // stripType id → fixtureType id (dedupe)
  for (const s of strips) {
    if (!deviceIdByStrip.has(s.id)) continue;
    const tid = s.typeId;
    if (tid == null) continue;
    if (!seenStripType.has(tid)) {
      const t = typeById.get(tid);
      const px = Math.max(1, Math.round(stripPixelCount(s)));
      const lpm = Math.max(1, Number(t?.ledsPerMeter) || 60);
      const co = stripColorOrder(s);
      const ft = makeFixtureType(lpm, px / lpm, co, `kf_${tid}`, t?.name || `${px}px`);
      ft.pixelCount = px;             // pin to Kagora's exact value (guard rounding)
      fixtureTypes.push(ft);
      seenStripType.set(tid, ft.id);
    }
    fixtureTypeByStrip.set(s.id, seenStripType.get(tid));
  }
  show.fixtureTypes = fixtureTypes;

  show.fixtures = strips
    .filter((s) => deviceIdByStrip.has(s.id))
    .map((s) => {
      const pixelCount = stripPixelCount(s);
      return {
        id: s.id,
        name: s.name ?? s.id,
        typeId: fixtureTypeByStrip.get(s.id),
        pixelCount,
        colorOrder: stripColorOrder(s),
        output: {
          deviceId: deviceIdByStrip.get(s.id),
          port: portByStrip.get(s.id) ?? 1,
          pixelOffset: offsetByStrip.get(s.id) ?? 0,
          pixelCount,
        },
        input: (() => {
          const np = normalizedPoints(s);
          // A bent run (>2 points) stays a polyline (normalized points are canonical);
          // a straight strip becomes a BAR with an explicit uniform-pixel transform.
          if (np.length > 2) return { mode: 'polyline', points: np, samples: pixelCount };
          return { mode: 'bar', transform: barTransform(s), points: np, samples: pixelCount };
        })(),
      };
    });

  // Order fixtures so that within each (device, port) they follow the run's
  // data-flow order — that array order IS the daisy-chain order (output→input),
  // which repackOffsets turns into contiguous pixel ranges.
  const ord = (s) => (runIndexByStrip.has(s.id) ? runIndexByStrip.get(s.id) : 1e6);
  show.fixtures.sort((a, b) =>
    (a.output.deviceId < b.output.deviceId ? -1 : a.output.deviceId > b.output.deviceId ? 1 : 0)
    || (a.output.port - b.output.port) || (ord(a) - ord(b)));

  // Guarantee a new-shape (clip schema) composition. The import only sets
  // devices/fixtures; normalizeComposition just ensures canvas + an (empty)
  // clip-shape layers array so downstream code never sees the old shape.
  const out = normalizeComposition(show);
  // Seed the RIG's bounding aspect (same `scl` the transforms use) so the strips'
  // normalized points map back to proportional pixels …
  out.composition.canvas = { w: Math.max(2, Math.round(spanX * scl)), h: Math.max(2, Math.round(spanY * scl)) };
  // … then run Fit-to-fixtures so the canvas hugs the strips' full OUTER footprint
  // (includes bar thickness + a small margin), exactly as the menu action would.
  return fitCanvasToFixtures(out);
}
