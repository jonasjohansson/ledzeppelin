import { fixtureTypeChannels, DMX_CHANNEL_KINDS, paramKinds, paramsToChannels, channelsToParams, isDmxType } from './dmx.js';

export function emptyShow() {
  return { version: 1, deviceTypes: [], devices: [], fixtureTypes: [], fixtures: [],
    composition: { canvas: { w: 1280, h: 720 }, layers: [] } };
}
const clone = (s) => structuredClone(s);
export function addDevice(show, d) { const s = clone(show); s.devices.push({ port: 4048, ...d }); return s; }
export function addFixture(show, f) { const s = clone(show); s.fixtures.push(f); return s; }

// --- Controller TYPES (device models) ----------------------------------------
// A device TYPE is a controller MODEL — its physical output count + per-output
// pixel budget (e.g. a QuinLED DigQuad = 4 outputs). A device is an INSTANCE
// that references a model by `typeId` and carries only name/ip/colorOrder. Each
// instance caches its model's spec (outputs/maxPerOutput) so chains/validate/UI
// keep reading `device.outputs` unchanged — refreshed on every rebuild (see
// syncDeviceTypes). QuinLED models are seeded into the Library on first sync.
//
// maxPerOutput is NOT a fixed board spec — the QuinLED outputs have no pixel cap;
// the limit is WLED/ESP framerate + RAM. ~830 px/output ≈ 40 fps for WS281x-family
// (1 / (40 · ~30µs/px)); editable per model. Same per data-line across boards.
const PX_PER_OUTPUT_40FPS = 830;
export const QUINLED_PRESETS = [
  { id: 'diguno', name: 'DigUno', outputs: 2, maxPerOutput: PX_PER_OUTPUT_40FPS },
  { id: 'digquad', name: 'DigQuad', outputs: 4, maxPerOutput: PX_PER_OUTPUT_40FPS },
  { id: 'digocta', name: 'DigOcta', outputs: 8, maxPerOutput: PX_PER_OUTPUT_40FPS },
];
export function makeDeviceType(name, outputs = 4, maxPerOutput = PX_PER_OUTPUT_40FPS, id) {
  const o = Math.max(1, Math.round(Number(outputs) || 1));
  return { id, name: name || `${o}-output`, outputs: o, maxPerOutput: Math.max(0, Math.round(Number(maxPerOutput) || 0)) };
}

// Ensure show.deviceTypes exists (seed QuinLED on first run) and every device
// references a model, caching outputs/maxPerOutput from it (live template). Pure.
export function syncDeviceTypes(show) {
  let types = (show.deviceTypes || []).map((t) => ({ ...t }));
  if (!types.length) types = QUINLED_PRESETS.map((t) => ({ ...t }));
  // Always keep a permanent generic controller model in the catalog.
  if (!types.some((t) => t.id === 'generic')) types.push(makeDeviceType('Generic', 4, PX_PER_OUTPUT_40FPS, 'generic'));
  const byId = new Map(types.map((t) => [t.id, t]));
  const devices = (show.devices || []).map((d) => {
    let t = d.typeId ? byId.get(d.typeId) : null;
    if (!t) {
      // Legacy / imported device with a raw `outputs` count → match a model by
      // output count, else mint a generic model so the device still has one.
      const outs = Math.max(1, Math.round(d.outputs ?? 4));
      t = types.find((x) => x.outputs === outs)
        || (() => { const nt = makeDeviceType(`${outs}-output`, outs, d.maxPerOutput ?? 0, `dt${types.length + 1}`); types.push(nt); byId.set(nt.id, nt); return nt; })();
    }
    // Output protocol: 'ddp' (default — absent/unknown collapses to it, so saved
    // shows from before the field exist unchanged) or 'artnet' with a base
    // universe (int ≥ 0; the device spans consecutive universes from it).
    const protocol = d.protocol === 'artnet' ? 'artnet' : 'ddp';
    const universe = Math.max(0, Math.round(Number(d.universe) || 0));
    // ArtSync: send an OpSync after each frame's ArtDmx so the node latches all its
    // universes together (tear-free multi-universe). Now a MODEL-level capability
    // (set in the Inventory controller editor); legacy per-device value still honoured.
    const artnetSync = !!(t.artnetSync ?? d.artnetSync);
    // Per-device output delay (ms) — time-aligns this controller against the rig.
    const syncDelayMs = Math.max(0, Math.min(1000, Math.round(Number(d.syncDelayMs) || 0)));
    return { ...d, typeId: t.id, outputs: t.outputs, maxPerOutput: t.maxPerOutput, protocol, universe, artnetSync, syncDelayMs };
  });
  return { ...show, deviceTypes: types, devices };
}

// Count of device instances referencing a given model.
export function deviceTypeInstanceCount(show, typeId) {
  return (show.devices || []).filter((d) => d.typeId === typeId).length;
}

// --- Fixture TYPES (definitions) ---------------------------------------------
// A fixture TYPE is a reusable physical strip definition (density × length →
// pixel count, colour order). A fixture is an INSTANCE that references a type by
// `typeId` and carries only placement + patch (geometry, device, offset). Each
// instance caches its type's spec (pixelCount/colorOrder/…) so pipeline.js,
// validate(), and the preview keep reading `fixture.pixelCount` unchanged — the
// cache is refreshed from the type on every rebuild (see syncFixtureTypes).
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export function makeFixtureType(ledsPerMeter, meters, colorOrder = 'GRB', id, name) {
  const lpm = Math.max(0, Number(ledsPerMeter) || 0);
  const m = Math.max(0, Number(meters) || 0);
  const pixelCount = Math.max(1, Math.round(lpm * m));
  // Resolume-style identity: length · pixel count (the two facts you check
  // against the real strip). Density stays an editable field, not in the name.
  // A strip is the rows=1 case of the unified grid model (cols = pixelCount).
  return { id, name: name || 'Strip', ledsPerMeter: lpm, meters: m, pixelCount, colorOrder, cols: pixelCount, rows: 1, distribution: 0 };
}

// A 2-D matrix/panel definition: cols×rows pixels wired in `distribution` order.
// ledsPerMeter/meters are 0 (no physical-strip scale); pixelCount = cols·rows.
export function makeGridType(cols, rows, colorOrder = 'GRB', id, name, distribution = 0) {
  const c = Math.max(1, Math.round(Number(cols) || 1));
  const r = Math.max(1, Math.round(Number(rows) || 1));
  const pixelCount = c * r;
  return { id, name: name || 'Matrix', ledsPerMeter: 0, meters: 0, pixelCount, colorOrder, cols: c, rows: r, distribution: Math.max(0, Math.round(Number(distribution) || 0)) };
}

// Normalize a type's grid fields: legacy strip types (no cols/rows) become
// cols=pixelCount, rows=1; pixelCount is always cols·rows so the two never drift.
// colorFormat is optional ('' = inherit the controller's colour order) — when set
// (e.g. 'RGBW') it overrides per-fixture, so RGB and RGBW strips can share a
// controller.
// Extra DMX channels appended after a fixture's pixels (Resolume "parameters"):
// dimmer/strobe/pan/etc. Each is { name, kind, value(0..255 default) }. `kind` is a
// channel kind (see src/model/dmx.js); anything unknown falls back to 'fixed'.
const clamp8 = (v) => { const n = Math.round(Number(v) || 0); return n < 0 ? 0 : n > 255 ? 255 : n; };
function normFixtureParams(params) {
  // A param can sit BEFORE the pixel/colour block (e.g. a master Dimmer or Strobe
  // ahead of the RGBWA channels) or after it (the default). Channel ORDER is what
  // DMX addressing depends on, so this is preserved exactly.
  return (Array.isArray(params) ? params : []).map((p, i) => ({
    name: String(p?.name ?? `Param ${i + 1}`),
    kind: DMX_CHANNEL_KINDS.includes(p?.kind) ? p.kind : 'fixed',
    value: clamp8(p?.value),
    before: !!p?.before,
  }));
}
// A DMX-profile fixture's PARAMETERS: each a NAME + a channel COUNT. The name decides
// behaviour (a colour name → a colour block; a function name → a 1-ch control; else
// `count` manual channels). An old `format` field migrates to the equivalent name.
function normDmxParams(params) {
  return (Array.isArray(params) ? params : []).map((p) => {
    let name = p?.name;
    if (p?.format && ['RGB', 'RGBW', 'RGBWA', 'RGBA'].includes(p.format)) name = p.format;   // old colour-format param → name = format
    else if (p?.format && name == null) name = p.format;
    name = String(name ?? 'Param');
    return { name, count: paramKinds(name, p?.count).length, value: clamp8(p?.value) };
  });
}
function normFixtureType(t) {
  const rows = Math.max(1, Math.round(Number(t.rows) || 1));
  const cols = Math.max(1, Math.round(Number(t.cols) || t.pixelCount || 1));
  const distribution = Math.max(0, Math.round(Number(t.distribution) || 0));
  const base = { ...t, cols, rows, distribution, colorFormat: t.colorFormat || '', pixelCount: cols * rows };
  // A DMX type is a list of name+count params; its flat `channels` is the expansion.
  // Migrate a legacy flat channel list (kind-per-channel) into params on the way in.
  const hasDmxParams = Array.isArray(t.params) && t.params.some((p) => p && (p.count != null || p.format));
  const dmxParams = hasDmxParams ? t.params
    : (Array.isArray(t.channels) && t.channels.length ? channelsToParams(t.channels) : null);
  if (dmxParams) {
    base.params = normDmxParams(dmxParams);
    base.channels = paramsToChannels(base.params);
    // The channel count is a list badge now, NOT part of the name — drop any legacy
    // auto "(Nch)" suffix so old shows clean up to just the user's name.
    if (typeof base.name === 'string') base.name = base.name.replace(/\s*\(\d+\s*ch\)\s*$/i, '').trim() || base.name;
  } else {
    base.params = normFixtureParams(t.params);   // pixel / legacy (before-after) params
    delete base.channels;
  }
  return base;
}

// Ensure show.fixtureTypes exists and every fixture references one (migrating
// legacy fixtures — which stored spec inline — into deduped types), then copy
// each type's spec onto its instances as a denormalized cache. Pure.
export function syncFixtureTypes(show) {
  const types = (show.fixtureTypes || []).map((t) => normFixtureType(t));
  // Always keep a permanent generic fixture definition in the catalog.
  if (!types.some((t) => t.id === 'generic')) types.push(makeFixtureType(60, 1, 'GRB', 'generic', 'Generic'));
  const byId = new Map(types.map((t) => [t.id, t]));
  const fixtures = (show.fixtures || []).map((f) => {
    let typeId = f.typeId;
    const hadType = !!typeId && byId.has(typeId);   // a real, user-defined type (not orphan)
    if (!hadType) {
      // Legacy / orphan instance → match an existing type by spec, else create one.
      const lpm = f.ledsPerMeter ?? 60, m = f.meters ?? 1, co = f.colorOrder ?? 'GRB';
      let t = types.find((x) => x.ledsPerMeter === lpm && x.meters === m && x.colorOrder === co);
      if (!t) { t = makeFixtureType(lpm, m, co, `t${types.length + 1}`); types.push(t); byId.set(t.id, t); }
      typeId = t.id;
    }
    const t = byId.get(typeId);
    const out = {
      ...f, typeId,
      ledsPerMeter: t.ledsPerMeter, meters: t.meters, pixelCount: t.pixelCount, colorOrder: t.colorOrder,
      // Grid (matrix) spec + per-fixture colour format cached onto the instance so
      // pipeline.js / preview / grid.js read them directly (rows=1 ⇒ a plain strip;
      // colorFormat '' ⇒ inherit the controller's colour order).
      cols: t.cols, rows: t.rows, distribution: t.distribution, colorFormat: t.colorFormat || '',
      output: { ...f.output, pixelCount: t.pixelCount },
      input: { ...f.input, samples: t.pixelCount },
    };
    // OUTPUT KIND FOLLOWS THE TYPE. A DMX type → the instance is a DMX fixture (channel
    // layout owned by the type, so editing the definition propagates in bulk); a pixel
    // type (strip/matrix) → the instance streams pixels and is NEVER a DMX fixture. This
    // is what stops an LED strip from becoming a DMX fixture. Legacy/orphan instances
    // (no real type) keep whatever inline DMX channels they carry.
    if (hadType) {
      if (isDmxType(t)) {
        const prev = out.input?.dmx || {};
        const dev = (show.devices || []).find((d) => d.id === f.output?.deviceId && d.protocol === 'artnet')
          || (show.devices || []).find((d) => d.protocol === 'artnet');
        out.input = { ...out.input, mode: 'dmx',
          dmx: { universe: prev.universe ?? dev?.universe ?? 0, address: prev.address ?? 1, fixed: prev.fixed || {}, ...(prev.bind ? { bind: prev.bind } : {}), channels: fixtureTypeChannels(t) } };
        if (!out.output?.deviceId && dev) out.output = { ...out.output, deviceId: dev.id };
      } else if (out.input?.dmx) {
        // Type became (or is) a pixel layout → drop the DMX config; back to a strip/matrix.
        const { dmx, ...restInput } = out.input;
        out.input = { ...restInput, mode: t.rows > 1 ? 'grid' : 'bar', samples: t.pixelCount };
        out.output = { ...out.output, pixelOffset: out.output?.pixelOffset ?? 0, pixelCount: t.pixelCount };
      }
    }
    return out;
  });
  return { ...show, fixtureTypes: types, fixtures };
}

// Count of placed instances referencing a given type.
export const typeInstanceCount = (show, typeId) =>
  (show.fixtures || []).filter((f) => f.typeId === typeId).length;

// Reassign every fixture's device-local pixelOffset to pack contiguously from 0,
// in fixture-array order, per device — and mirror output.pixelCount to pixelCount.
// pixelOffset is therefore NEVER hand-authored: it's a pure function of (device,
// order), which is exactly what validate() above requires. Call this whenever a
// fixture's device, count, or membership changes (the rebuild() chokepoint does).
export function repackOffsets(show) {
  const fixtures = show.fixtures || [];
  // Within each DEVICE, order fixtures by (port, array index) and assign
  // contiguous device-local offsets. So each OUTPUT/PORT's run is contiguous and
  // ports pack in ascending order — matching how a multi-output controller (e.g.
  // a QuinLED DigQuad) maps its ports into one pixel array. Fixtures on the same
  // (device,port) ARE a daisy-chain; array order within the port = the wiring
  // order (output→input). pixelOffset is derived, never authored.
  const order = {};                       // deviceId → [fixture array index, …]
  fixtures.forEach((f, i) => { (order[f.output?.deviceId || ''] ||= []).push(i); });
  const offsetByIndex = {};
  for (const dev in order) {
    order[dev].sort((a, b) => ((fixtures[a].output?.port ?? 1) - (fixtures[b].output?.port ?? 1)) || (a - b));
    let cursor = 0;
    for (const i of order[dev]) { offsetByIndex[i] = cursor; cursor += fixtures[i].pixelCount || 0; }
  }
  return {
    ...show,
    fixtures: fixtures.map((f, i) => ({
      ...f,
      output: { ...f.output, port: f.output?.port ?? 1, pixelOffset: offsetByIndex[i] ?? 0, pixelCount: f.pixelCount || 0 },
    })),
  };
}

export function validate(show) {
  const errors = [];
  const ids = new Set(show.devices.map((d) => d.id));
  for (const f of show.fixtures) {
    // An empty deviceId is a valid UNASSIGNED fixture (prototyping); only flag a
    // deviceId that's set but points at a device that no longer exists.
    if (f.output?.deviceId && !ids.has(f.output.deviceId)) errors.push(`fixture ${f.id}: unknown device ${f.output?.deviceId}`);
    if (f.output?.pixelCount !== f.pixelCount) errors.push(`fixture ${f.id}: output pixelCount mismatch`);
    if ((f.input?.points?.length ?? 0) < 2) errors.push(`fixture ${f.id}: input needs ≥2 points`);
  }

  // Per-device pixel ranges must start at 0 and be contiguous (no gaps/overlaps),
  // since the flat sampler buffer is dense 0-based (see pipeline.js INVARIANT).
  for (const d of show.devices) {
    const fs = show.fixtures
      .filter((f) => f.output?.deviceId === d.id)
      .sort((a, b) => (a.output?.pixelOffset ?? 0) - (b.output?.pixelOffset ?? 0));
    if (!fs.length) continue;
    let expected = 0;
    for (const f of fs) {
      if ((f.output?.pixelOffset ?? 0) !== expected) {
        errors.push(`device ${d.id}: fixture pixel offsets must start at 0 and be contiguous`);
        break;
      }
      expected += f.output?.pixelCount ?? 0;
    }
  }

  return { ok: errors.length === 0, errors };
}
