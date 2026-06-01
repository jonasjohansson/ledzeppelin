import { samplePoints } from './sampling.js';

// Pure: derive the flat sampler UVs + daemon route from a show.
//
// The bridge sends ONE flat RGB buffer = the concatenation of every fixture's
// sampled pixels. The daemon slices each device's bytes via byteStart/byteEnd.
// Fixture pixel offsets (output.pixelOffset) are DEVICE-LOCAL: they reset to 0
// per controller. So byteStart CANNOT come from the local offset — two devices
// would both start at 0 and read overlapping slices. Instead we assign each
// device a GLOBAL base into the flat buffer by walking devices in array order
// and maintaining a running global pixel cursor.
//
// Layout: device order (show.devices) → within each device, fixtures ordered by
// output.pixelOffset ascending → append samplePoints(input.points, input.samples).
// validate() enforces per-device contiguity-from-0, so within a device the local
// offsets are 0..total; the GLOBAL base is what we add on top.
//
// The per-device DDP offset stays 0-based and is handled by buildPackets in
// server/output.js: each device's slice is sent starting at DDP offset 0,
// regardless of byteStart. server/output.js needs no change.
export function buildPipelineInputs(show) {
  const uvs = [];
  const spans = [];
  const fixtureOrder = [];
  const route = [];
  let cursor = 0; // running GLOBAL pixel position into the flat buffer

  for (const d of show.devices) {
    const fs = show.fixtures
      .filter((f) => f.output?.deviceId === d.id)
      .sort((a, b) => (a.output?.pixelOffset ?? 0) - (b.output?.pixelOffset ?? 0));
    if (!fs.length) continue;

    const globalBase = cursor;
    for (const f of fs) {
      const pts = samplePoints(f.input.points, f.input.samples);
      spans.push({ id: f.id, start: cursor, count: pts.length });
      fixtureOrder.push(f);
      for (const [u, v] of pts) { uvs.push(u, v); }
      cursor += pts.length;
    }

    route.push({
      ip: d.ip,
      port: d.port ?? 4048,
      colorOrder: d.colorOrder,
      byteStart: globalBase * 3,
      byteEnd: cursor * 3,
    });
  }

  return { sampleUVs: new Float32Array(uvs), route, fixtureOrder, spans };
}
