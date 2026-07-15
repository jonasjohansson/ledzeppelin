// Fixture CHAINS are DERIVED, not stored. A chain is the set of fixtures sharing
// a controller OUTPUT — same (deviceId, output port) — taken in WIRING order:
// their order in show.fixtures IS the daisy-chain order (output→input). That same
// order drives pixel packing (repackOffsets), so a chain literally IS the physical
// run on the wire — pixel 0 of member i+1 follows the last pixel of member i.
//
// A run of ≥2 fixtures can carry a STAGGER so a travelling source (e.g. Pulse)
// cascades across it instead of hitting every member at once: each member m at
// run index i samples the canvas shifted by `i * stagger` along the chain axis
// (baked into the sampler map — see pipeline.js). Stagger/axis live PER RUN in
// `show.chainSettings`, keyed by `${deviceId}:${port}`.

const settingsOf = (show) => (show && typeof show.chainSettings === 'object' && show.chainSettings) || {};
export const runKey = (f) => `${f?.output?.deviceId || ''}:${f?.output?.port ?? 0}`;
export const runLabel = (deviceId, port) => `${deviceId || 'unassigned'} · port ${Number(port) + 1}`;   // 1-based label; port is a 0-based WLED bus index

// All runs: [{ key, deviceId, port, members:[fixtureId… in wiring order], stagger, axis }].
export function runsOf(show) {
  const map = new Map();
  for (const f of show?.fixtures || []) {
    const key = runKey(f);
    if (!map.has(key)) map.set(key, { key, deviceId: f.output?.deviceId || '', port: f.output?.port ?? 0, members: [] });
    map.get(key).members.push(f.id);
  }
  const cs = settingsOf(show);
  for (const r of map.values()) { const s = cs[r.key] || {}; r.stagger = Number(s.stagger) || 0; r.axis = s.axis === 'y' ? 'y' : 'x'; }
  return [...map.values()];
}

// "#rrggbb" → [h 0..360, s 0..100, l 0..100] (null when unparseable). Used to
// derive per-output lightness tints from a device's ASSIGNED colour below.
function hexToHsl(hex) {
  if (typeof hex !== 'string') return null;
  let h6 = hex.replace('#', '').trim();
  if (h6.length === 3) h6 = h6[0] + h6[0] + h6[1] + h6[1] + h6[2] + h6[2];
  const n = parseInt(h6, 16);
  if (h6.length !== 6 || Number.isNaN(n)) return null;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s * 100, l * 100];
}

// Colour identity by CONTROLLER: a device's ASSIGNED `color` (see DEVICE_COLORS /
// nextDeviceColor in show.js) when set, else a generated base hue (golden-angle
// over its devices, sorted for stability). Each OUTPUT on that device is a
// lightness TINT of that hue. So fixtures read as "this controller" by hue and
// "which output" by shade. Shared by the canvas overlay + the placement list.
export function controllerColorMap(show) {
  const fixtures = show?.fixtures || [];
  const assigned = new Map((show?.devices || []).filter((d) => d.color).map((d) => [d.id, d.color]));
  const devIds = [...new Set(fixtures.map((f) => f.output?.deviceId || ''))].sort();
  const hue = new Map(devIds.map((id, i) => [id, (i * 137.508) % 360]));
  const ports = new Map();   // deviceId -> Set of distinct ports in use
  for (const f of fixtures) {
    const d = f.output?.deviceId || '', p = f.output?.port ?? 0;
    if (!ports.has(d)) ports.set(d, new Set());
    ports.get(d).add(p);
  }
  const portList = (d) => [...(ports.get(d) || [])].sort((a, b) => a - b);
  // Vivid enough to read at a glance: a saturation FLOOR (an assigned pastel still
  // reads as its controller; a generated hue pops instead of washing out) plus a
  // wide lightness ramp so which OUTPUT a fixture is on is obvious.
  const SAT_FLOOR = 62;
  const runColor = (deviceId, port) => {
    const a = hexToHsl(assigned.get(deviceId));
    const [h, s0, baseL] = a || [hue.get(deviceId) ?? 210, SAT_FLOOR, 56];
    const s = Math.max(s0, SAT_FLOOR);
    const ps = portList(deviceId), n = ps.length || 1, i = Math.max(0, ps.indexOf(port));
    const l = n > 1 ? 40 + i * (38 / (n - 1)) : baseL;   // ramp 40%..78% across the device's outputs
    return `hsl(${h.toFixed(1)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
  };
  // An ASSIGNED colour is the user's pick — return it verbatim. Only the GENERATED
  // fallback gets the saturation floor (it was a washed-out 30%).
  const deviceColor = (deviceId) =>
    assigned.get(deviceId) || `hsl(${(hue.get(deviceId) ?? 210).toFixed(1)}, ${SAT_FLOOR}%, 58%)`;
  return { hue, runColor, deviceColor };
}

// The run a fixture belongs to — but only when it's an actual CHAIN (≥2 members);
// else null ("not chained"). Carries the fixture's index within the run.
export function chainOf(show, fixtureId) {
  const f = (show?.fixtures || []).find((x) => x.id === fixtureId);
  if (!f) return null;
  const key = runKey(f);
  const members = (show.fixtures || []).filter((x) => runKey(x) === key).map((x) => x.id);
  if (members.length < 2) return null;
  const cs = settingsOf(show)[key] || {};
  return {
    key, deviceId: f.output?.deviceId || '', port: f.output?.port ?? 0, members,
    index: members.indexOf(fixtureId), stagger: Number(cs.stagger) || 0, axis: cs.axis === 'y' ? 'y' : 'x',
    name: runLabel(f.output?.deviceId, f.output?.port ?? 0),
  };
}

// Sample offset [dx,dy] for a fixture = index_in_run * stagger along the run axis,
// or [0,0] when it isn't a chain / has no stagger.
export function chainOffset(show, fixtureId) {
  const ch = chainOf(show, fixtureId);
  if (!ch || !ch.stagger) return [0, 0];
  const s = ch.stagger * ch.index;
  return ch.axis === 'y' ? [0, s] : [s, 0];
}

// All fixtures' chain offsets in ONE O(n) pass — Map<fixtureId, [dx,dy]>. chainOf()
// re-filters the whole fixture array per call, so calling chainOffset per fixture is
// O(n²): at Kagora scale (120 fixtures) that's ~14k runKey string builds per preview
// frame / pipeline rebuild. Callers that walk every fixture use this map instead.
const ZERO_OFFSET = [0, 0];
export function chainOffsetMap(show) {
  const map = new Map();
  const runs = new Map();   // runKey → fixture ids in wiring (array) order
  for (const f of show?.fixtures || []) {
    const key = runKey(f);
    let ids = runs.get(key);
    if (!ids) { ids = []; runs.set(key, ids); }
    ids.push(f.id);
  }
  const cs = settingsOf(show);
  for (const [key, ids] of runs) {
    const stagger = Number(cs[key]?.stagger) || 0;
    const axisY = cs[key]?.axis === 'y';
    for (let i = 0; i < ids.length; i++) {
      // Same rule as chainOffset: shifting needs a real chain (≥2 members) AND a stagger.
      map.set(ids[i], (ids.length < 2 || !stagger) ? ZERO_OFFSET : (axisY ? [0, stagger * i] : [stagger * i, 0]));
    }
  }
  return map;
}

// Set a run's stagger / axis (keyed by device:port). Returns a new show.
export function setRunStagger(show, key, stagger) {
  const cs = settingsOf(show);
  return { ...show, chainSettings: { ...cs, [key]: { ...(cs[key] || {}), stagger: Number(stagger) || 0 } } };
}
export function setRunAxis(show, key, axis) {
  const cs = settingsOf(show);
  return { ...show, chainSettings: { ...cs, [key]: { ...(cs[key] || {}), axis: axis === 'y' ? 'y' : 'x' } } };
}

// Reorder a fixture within its run (dir -1 earlier / +1 later) by swapping it in
// show.fixtures with the adjacent fixture in the SAME run. Order = wiring order =
// pixel order (after repack). Returns a new show.
export function moveFixtureInRun(show, fixtureId, dir) {
  const fixtures = [...(show.fixtures || [])];
  const i = fixtures.findIndex((f) => f.id === fixtureId);
  if (i < 0) return show;
  const key = runKey(fixtures[i]);
  let j = i + dir;
  while (j >= 0 && j < fixtures.length && runKey(fixtures[j]) !== key) j += dir;  // skip fixtures on other runs
  if (j < 0 || j >= fixtures.length) return show;
  [fixtures[i], fixtures[j]] = [fixtures[j], fixtures[i]];
  return { ...show, fixtures };
}

// WIRE fixtureId's input to afterFxId's output: move it onto afterFxId's
// (device, output) and place it immediately AFTER it in wiring order. This is the
// "from = afterFxId" node-graph edge. Returns a new show.
export function wireAfter(show, fixtureId, afterFxId) {
  if (!fixtureId || !afterFxId || fixtureId === afterFxId) return show;
  const fixtures = [...(show.fixtures || [])];
  const ai = fixtures.findIndex((f) => f.id === afterFxId);
  const fi = fixtures.findIndex((f) => f.id === fixtureId);
  if (ai < 0 || fi < 0) return show;
  const after = fixtures[ai];
  const moved = { ...fixtures[fi], output: { ...fixtures[fi].output, deviceId: after.output?.deviceId, port: after.output?.port ?? 0 } };
  fixtures.splice(fi, 1);
  fixtures.splice(fixtures.findIndex((f) => f.id === afterFxId) + 1, 0, moved);   // re-find after the splice
  return { ...show, fixtures };
}

// Make fixtureId the FIRST on its output (its input comes straight from the
// controller — no predecessor). Returns a new show.
export function wireFirst(show, fixtureId) {
  const fixtures = [...(show.fixtures || [])];
  const fi = fixtures.findIndex((f) => f.id === fixtureId);
  if (fi < 0) return show;
  const f = fixtures[fi];
  const key = runKey(f);
  fixtures.splice(fi, 1);
  const firstIdx = fixtures.findIndex((x) => runKey(x) === key);
  fixtures.splice(firstIdx < 0 ? Math.min(fi, fixtures.length) : firstIdx, 0, f);
  return { ...show, fixtures };
}

// The next free port number on a device (for "chain these onto their own output").
export function freePort(show, deviceId) {
  const used = new Set((show?.fixtures || []).filter((f) => (f.output?.deviceId || '') === deviceId).map((f) => f.output?.port ?? 0));
  let p = 0; while (used.has(p)) p++; return p;   // 0-based (WLED bus index) — matches scan/import
}

// Compat: drop the legacy stored `show.chains` list (chains are derived now) +
// any chainSettings whose run no longer exists. Safe to call repeatedly.
export function pruneChains(show) {
  if (!show) return show;
  const live = new Set(runsOf(show).map((r) => r.key));
  const cs = settingsOf(show);
  const cleaned = {};
  for (const k of Object.keys(cs)) if (live.has(k)) cleaned[k] = cs[k];
  const { chains, ...rest } = show;   // strip legacy field
  return { ...rest, chainSettings: cleaned };
}
