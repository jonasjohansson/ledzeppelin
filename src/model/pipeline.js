import { samplePoints } from './sampling.js';
import { chainOffset } from './chains.js';

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
    const segments = [];     // device-local pixel ranges, each with its colorOrder
    let devLocal = 0;
    for (const f of fs) {
      // FLIP = reverse pixel direction (which physical end is pixel 0). Applied
      // at sample time so the canonical input.points stay put (no double-reverse).
      const basePts = f.input.reversed ? [...f.input.points].reverse() : f.input.points;
      const pts = samplePoints(basePts, f.input.samples);
      // Chain stagger: shift this fixture's sample position by its chain offset so
      // a travelling source cascades across the run (no-op when not chained).
      const [ox, oy] = chainOffset(show, f.id);
      spans.push({ id: f.id, start: cursor, count: pts.length, hidden: !!f.hidden });
      fixtureOrder.push(f);
      for (const [u, v] of pts) { uvs.push(u + ox, v + oy); }
      // Colour order is a CONTROLLER setting (how its strips are wired), so the
      // DEVICE's order wins; a fixture's own order is only a fallback for a device
      // that somehow has none. (Edit it in the Devices tab.)
      segments.push({ start: devLocal, count: pts.length, colorOrder: d.colorOrder || f.colorOrder });
      devLocal += pts.length;
      cursor += pts.length;
    }

    route.push({
      ip: d.ip,
      port: d.port ?? (d.protocol === 'artnet' ? 6454 : 4048),
      // Output protocol per device: DDP (default) or Art-Net from a base universe.
      protocol: d.protocol === 'artnet' ? 'artnet' : 'ddp',
      universe: d.universe ?? 0,
      colorOrder: d.colorOrder,
      byteStart: globalBase * 3,
      byteEnd: cursor * 3,
      segments,
      // Output calibration applied daemon-side, BEFORE the LEDs (not the preview):
      // perceptual gamma + a max-brightness cap. Defaults are no-ops.
      gamma: d.gamma ?? 1,
      brightness: d.brightness ?? 1,
    });
  }

  return { sampleUVs: new Float32Array(uvs), route, fixtureOrder, spans };
}
