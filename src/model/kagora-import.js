import { emptyShow } from './show.js';

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
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const s = instById.get(cur);
        if (!s || s.kind !== 'strip') break;
        offsetByStrip.set(cur, cursor);
        deviceIdByStrip.set(cur, controllerId);
        cursor += stripPixelCount(s);
        const next = outgoingByStrip.get(cur);
        cur = next ? next.to.instId : null;
      }
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

  show.fixtures = strips
    .filter((s) => deviceIdByStrip.has(s.id))
    .map((s) => {
      const pixelCount = stripPixelCount(s);
      return {
        id: s.id,
        name: s.name ?? s.id,
        pixelCount,
        colorOrder: stripColorOrder(s),
        output: {
          deviceId: deviceIdByStrip.get(s.id),
          pixelOffset: offsetByStrip.get(s.id) ?? 0,
          pixelCount,
        },
        input: {
          points: normalizedPoints(s),
          samples: pixelCount,
        },
      };
    });

  return show;
}
