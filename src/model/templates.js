// Stamp helpers: turn a Library TEMPLATE (a fixture type / device model) into a
// STANDALONE instance. The template's spec is INLINED onto a fresh instance with
// a new id, so editing the template later can never alter the instance (sync.js
// reads every spec field from the instance first; the `?? type.X` fallback never
// fires once a field is inlined). The instance still carries `typeId = template.id`
// so it resolves to the AUTHORED library entry — this keeps typeInstanceCount /
// deviceTypeInstanceCount (Inventory popout + delete-guard) accurate and avoids the
// orphan branch in sync, which would otherwise mint spurious catalog types.
//
// Both functions are pure: they never mutate the template, and the returned
// instance shares no nested-object references with it (output/input/dmx are fresh
// literals; spec values are primitives). The returned instance is "valid enough"
// for the app's sync/repack to finish (repackOffsets re-derives pixelOffset; the
// add-menu UI places/patches it) — we do NOT normalize here.

import { pointsFromTransform } from './fixture-transform.js';
import { isDmxType, fixtureTypeChannels } from './dmx.js';

const DEFAULT_CANVAS = { w: 1280, h: 720 };

// A fixture TYPE → a standalone fixture instance, dropped centred on the canvas.
// Mirrors the add-fixture scaffold in app.js: a strip is a thin upright bar; a
// matrix (rows > 1) is a rectangle sampled in `grid` mode; a DMX-profile type is a
// channel-block fixture (input.mode 'dmx'). `output.pixelCount` equals `pixelCount`
// and `input.points` has ≥2 entries, so validate() passes once the instance is
// placed (even while unassigned).
export function stampFixture(template, id) {
  const t = template || {};
  const pixelCount = Math.max(1, Math.round(Number(t.pixelCount) || 1));
  const cols = Math.max(1, Math.round(Number(t.cols ?? pixelCount) || 1));
  const rows = Math.max(1, Math.round(Number(t.rows) || 1));
  const distribution = Math.max(0, Math.round(Number(t.distribution) || 0));
  const isGrid = rows > 1;
  const cv = DEFAULT_CANVAS;
  // A strip stamps HORIZONTAL (length = width, auto thickness) — matching the
  // Library's model, where LEDs/m × Length set a strip's WIDTH. It used to stamp
  // upright (w:10 × h:px), so a template that read "wider than long" in the
  // Library landed "longer than wide" on the canvas.
  const transform = isGrid
    ? { x: cv.w / 2, y: cv.h / 2, w: cols * 16, h: rows * 16, rotation: 0 }
    : { x: cv.w / 2, y: cv.h / 2, w: pixelCount, h: 10, rotation: 0 };
  const points = pointsFromTransform(transform, cv, isGrid);
  const fx = {
    id,
    typeId: t.id,                      // resolves to the authored library entry
    // Inlined spec (primitives — independent copies).
    ledsPerMeter: t.ledsPerMeter ?? 0,
    meters: t.meters ?? 0,
    pixelCount,
    colorOrder: t.colorOrder ?? 'GRB',
    cols,
    rows,
    distribution,
    colorFormat: t.colorFormat ?? '',
    // Fresh patch + placement (unassigned until the UI wires it).
    output: { deviceId: '', port: 0, pixelOffset: 0, pixelCount },
    input: { mode: isGrid ? 'grid' : 'bar', transform, points, samples: pixelCount },
  };
  // A DMX-profile type → a channel-block fixture: inline its params/channels and
  // switch the input to a DMX block (universe/address/fixed + the expanded channel
  // list). Geometry default is kept so the fixture still has a canvas footprint and
  // ≥2 input points (validate()). Output stays unassigned (deviceId '').
  if (isDmxType(t)) {
    if (Array.isArray(t.params)) fx.params = structuredClone(t.params);
    if (Array.isArray(t.channels)) fx.channels = structuredClone(t.channels);
    fx.input = { ...fx.input, mode: 'dmx', dmx: { universe: 0, address: 1, fixed: {}, channels: fixtureTypeChannels(t) } };
  }
  return fx;
}

// A device MODEL → a standalone device instance. Inlines the model's output spec
// and carries `typeId = template.id` so it resolves to the authored model (no
// minting in syncDeviceTypes). Defaults to a DDP target on port 4048. `artnetSync`
// is carried only when the template defines it (so the field stays absent otherwise).
export function stampDevice(template, id) {
  const t = template || {};
  const outputs = Math.max(1, Math.round(Number(t.outputs) || 1));
  const maxPerOutput = Math.max(0, Math.round(Number(t.maxPerOutput) || 0));
  const dev = {
    id,
    name: t.name || t.id || id,
    typeId: t.id,
    outputs,
    maxPerOutput,
    protocol: 'ddp',
    port: 4048,
    ip: '',
    colorOrder: 'GRB',
  };
  if (t.artnetSync != null) dev.artnetSync = !!t.artnetSync;
  return dev;
}
