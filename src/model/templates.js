// Stamp helpers: turn a Library TEMPLATE (a fixture type / device model) into a
// STANDALONE instance. The template's spec is INLINED onto a fresh instance with
// a new id — there is NO live link back. A `fromTemplate` tag records provenance
// only; editing the template later must not touch the instance (the model layer
// reads spec from the instance first, so an inlined instance is fully independent).
//
// Both functions are pure: they never mutate the template, and the returned
// instance shares no nested-object references with it (output/input are fresh
// literals; spec values are primitives). The returned instance is "valid enough"
// for the app's sync/repack to finish (repackOffsets re-derives pixelOffset; the
// add-menu UI places/patches it) — we do NOT normalize here.

import { pointsFromTransform } from './fixture-transform.js';

const DEFAULT_CANVAS = { w: 1280, h: 720 };

// A fixture TYPE → a standalone fixture instance, dropped centred on the canvas.
// Mirrors the add-fixture scaffold in app.js: a strip is a thin upright bar; a
// matrix (rows > 1) is a rectangle sampled in `grid` mode. `output.pixelCount`
// equals `pixelCount` and `input.points` has ≥2 entries, so validate() passes
// once the instance is placed.
export function stampFixture(template, id) {
  const t = template || {};
  const pixelCount = Math.max(1, Math.round(Number(t.pixelCount) || 1));
  const cols = Math.max(1, Math.round(Number(t.cols ?? pixelCount) || 1));
  const rows = Math.max(1, Math.round(Number(t.rows) || 1));
  const distribution = Math.max(0, Math.round(Number(t.distribution) || 0));
  const isGrid = rows > 1;
  const cv = DEFAULT_CANVAS;
  const transform = isGrid
    ? { x: cv.w / 2, y: cv.h / 2, w: cols * 16, h: rows * 16, rotation: 0 }
    : { x: cv.w / 2, y: cv.h / 2, w: 10, h: pixelCount, rotation: 0 };
  const points = pointsFromTransform(transform, cv, isGrid);
  return {
    id,
    fromTemplate: t.id,
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
    output: { deviceId: '', port: 1, pixelOffset: 0, pixelCount },
    input: { mode: isGrid ? 'grid' : 'bar', transform, points, samples: pixelCount },
  };
}

// A device MODEL → a standalone device instance. Inlines the model's output
// spec; defaults to a DDP target on port 4048. `artnetSync` is carried only when
// the template defines it (so the field stays absent otherwise).
export function stampDevice(template, id) {
  const t = template || {};
  const outputs = Math.max(1, Math.round(Number(t.outputs) || 1));
  const maxPerOutput = Math.max(0, Math.round(Number(t.maxPerOutput) || 0));
  const dev = {
    id,
    name: t.name || t.id || id,
    fromTemplate: t.id,
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
