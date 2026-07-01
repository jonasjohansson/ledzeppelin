import { samplePoints, samplePoints3D } from './sampling.js';
import { chainOffset } from './chains.js';
import { gridPoints, isGridFixture } from './grid.js';
import { isDmxFixture, dmxChannelsOf } from './dmx.js';
import { fixtureCentreUV } from './fixture-transform.js';
import { project, cameraFromView3d } from './project3d.js';

// True when a fixture's polyline carries 3D points (any point has a defined
// third component) — the signal to resample by 3D arc length and project.
function pointsAre3D(points) {
  return Array.isArray(points) && points.some((p) => p && p[2] !== undefined);
}

// The normalized sample UVs for one fixture, in LED-index order. A matrix (grid)
// fixture samples a cols×rows block in its wiring order; a strip resamples its
// polyline evenly. `reversed` flips which physical end is pixel 0 for both.
//
// `cam` is the composition's projection camera. In 2D mode it's the flat camera
// (mode === 'flat') and the strip path is byte-identical with today. In 3D mode,
// when the fixture's points are 3D, resample by TRUE 3D arc length and project
// each sample through the camera to get its 2D UV (perspective foreshortening).
function fixtureSampleUVs(f, canvas, cam) {
  if (isGridFixture(f)) {
    const pts = gridPoints(f.input?.transform, f.cols, f.rows, f.distribution, canvas);
    return f.input?.reversed ? pts.reverse() : pts;
  }
  const basePts = f.input.reversed ? [...f.input.points].reverse() : f.input.points;
  if (cam && cam.mode !== 'flat' && pointsAre3D(f.input.points)) {
    return samplePoints3D(basePts, f.input.samples).map((p) => project(p, cam));
  }
  return samplePoints(basePts, f.input.samples);
}

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
  const canvas = show.composition?.canvas;
  // Projection camera for this composition: flat in 2D (no-op), the view's
  // camera in 3D. Derived once and threaded into every strip sample.
  const cam = cameraFromView3d(show.composition?.view3d);
  let cursor = 0; // running GLOBAL pixel position into the flat buffer

  for (const d of show.devices) {
    const mine = show.fixtures.filter((f) => f.output?.deviceId === d.id);
    const fs = mine.filter((f) => !isDmxFixture(f))
      .sort((a, b) => (a.output?.pixelOffset ?? 0) - (b.output?.pixelOffset ?? 0));
    const dmxFs = mine.filter(isDmxFixture);
    if (!fs.length && !dmxFs.length) continue;

    const globalBase = cursor;
    const segments = [];     // device-local pixel ranges, each with its colorOrder
    let devLocal = 0;
    for (const f of fs) {
      // FLIP = reverse pixel direction (which physical end is pixel 0). Applied
      // at sample time so the canonical input.points stay put (no double-reverse).
      const pts = fixtureSampleUVs(f, canvas, cam);
      // Chain stagger: shift this fixture's sample position by its chain offset so
      // a travelling source cascades across the run (no-op when not chained).
      const [ox, oy] = chainOffset(show, f.id);
      spans.push({ id: f.id, start: cursor, count: pts.length, hidden: !!f.hidden });
      fixtureOrder.push(f);
      for (const [u, v] of pts) { uvs.push(u + ox, v + oy); }
      // Colour format per segment: a fixture's own colorFormat WINS when set (so an
      // RGBW strip can sit on the same controller as RGB ones); otherwise inherit
      // the controller's colour order (the common case — its strips are wired alike).
      // 'NONE' is a channels-only (par) format with no pixel colour order — treat it
      // as "inherit" here so a par toggled to pixel output still gets a valid order.
      const fmt = f.colorFormat && f.colorFormat !== 'NONE' ? f.colorFormat : null;
      segments.push({ start: devLocal, count: pts.length, colorOrder: fmt || d.colorOrder || f.colorOrder });
      devLocal += pts.length;
      cursor += pts.length;
    }
    const pixelEnd = cursor;   // the pixel slice ends here; DMX sample points come after

    // DMX fixtures: each samples ONE canvas point (its centre); the daemon turns that
    // colour + the profile into channel bytes at the fixture's universe/address.
    const dmx = [];
    for (const f of dmxFs) {
      const [u, v] = fixtureCentreUV(f, canvas);
      const [ox, oy] = chainOffset(show, f.id);
      spans.push({ id: f.id, start: cursor, count: 1, hidden: !!f.hidden });
      fixtureOrder.push(f);
      uvs.push(u + ox, v + oy);
      const cfg = f.input.dmx;
      // `fixed` is COPIED (not referenced) so a per-frame layer-binding update can
      // mutate the route's overrides without touching the saved show. `bind` maps a
      // channel index → layerId; the editor resolves it live from layer opacity.
      dmx.push({ id: f.id, colourIndex: cursor, universe: cfg.universe ?? 0, address: cfg.address ?? 1, channels: dmxChannelsOf(cfg), fixed: { ...(cfg.fixed || {}) }, bind: cfg.bind || null });
      cursor += 1;
    }

    route.push({
      ip: d.ip,
      port: d.port ?? (d.protocol === 'artnet' ? 6454 : 4048),
      // Output protocol per device: DDP (default) or Art-Net from a base universe.
      protocol: d.protocol === 'artnet' ? 'artnet' : 'ddp',
      universe: d.universe ?? 0,
      artnetSync: !!d.artnetSync,   // OpSync after each frame's ArtDmx (tear-free)
      colorOrder: d.colorOrder,
      byteStart: globalBase * 3,
      byteEnd: pixelEnd * 3,
      segments,
      ...(dmx.length ? { dmx } : {}),
      // Output calibration applied daemon-side, BEFORE the LEDs (not the preview):
      // perceptual gamma + a max-brightness cap. Defaults are no-ops.
      gamma: d.gamma ?? 1,
      brightness: d.brightness ?? 1,
      // Per-device output delay (ms) — holds this controller's packets back to
      // time-align it with the rest of the rig. 0 = immediate.
      delayMs: d.syncDelayMs ?? 0,
    });
  }

  // Also SAMPLE fixtures with no device (or a device that no longer exists) so they
  // light up in the preview — prototyping shouldn't require wiring to a controller
  // first. They're appended after all routed pixels and are NOT added to `route`,
  // so nothing is sent for them; they just pick up colour from the composite.
  const deviceIds = new Set(show.devices.map((d) => d.id));
  for (const f of show.fixtures) {
    if (deviceIds.has(f.output?.deviceId)) continue;   // already routed above
    const pts = fixtureSampleUVs(f, canvas, cam);
    const [ox, oy] = chainOffset(show, f.id);
    spans.push({ id: f.id, start: cursor, count: pts.length, hidden: !!f.hidden });
    fixtureOrder.push(f);
    for (const [u, v] of pts) { uvs.push(u + ox, v + oy); }
    cursor += pts.length;
  }

  return { sampleUVs: new Float32Array(uvs), route, fixtureOrder, spans };
}
