import { samplePoints } from './sampling.js';
import { deviceByteRange } from './show.js';

// Pure: derive the flat sampler UVs + daemon route from a show.
// Fixtures are ordered by output.pixelOffset ascending so the sampler's RGBA
// readback order matches the daemon's per-device byte layout. Single-device
// correct (M2 target); multi-device byte layout is an M4 concern.
//
// INVARIANT: the flat sampler buffer is dense and 0-based — readback pixel `i`
// equals daemon pixel `i`. This only holds when, per device, each fixture's
// [pixelOffset, pixelOffset+pixelCount) ranges start at 0 and are contiguous
// (no gaps/overlaps). route[].byteStart comes from deviceByteRange() which
// likewise assumes a device's fixtures start at offset 0. A nonzero start or a
// gap would mis-route every pixel by that amount. validate() in show.js enforces
// this; multi-device global-base handling is deferred to M4.
export function buildPipelineInputs(show) {
  const fixtureOrder = [...show.fixtures].sort(
    (a, b) => a.output.pixelOffset - b.output.pixelOffset
  );

  const uvs = [];
  const spans = [];
  let offset = 0;
  for (const f of fixtureOrder) {
    const pts = samplePoints(f.input.points, f.input.samples);
    spans.push({ id: f.id, start: offset, count: pts.length });
    for (const [u, v] of pts) { uvs.push(u, v); }
    offset += pts.length;
  }

  const route = show.devices
    .map((d) => {
      const r = deviceByteRange(show, d.id);
      return r ? { ip: d.ip, port: d.port ?? 4048, colorOrder: d.colorOrder, ...r } : null;
    })
    .filter(Boolean);

  return { sampleUVs: new Float32Array(uvs), route, fixtureOrder, spans };
}
