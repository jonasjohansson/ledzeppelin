import { samplePoints, samplePoints3D } from './sampling.js';
import { chainOffset } from './chains.js';
import { gridPoints, isGridFixture } from './grid.js';
import { isDmxFixture, dmxChannelsOf } from './dmx.js';
import { fixtureCentreUV } from './fixture-transform.js';
import { isBezierFixture, bezierToPoints } from './bezier.js';
import { project, cameraFromView3d } from './project3d.js';
import { effectiveColorFormat } from './show.js';
import { fixtureBandIndex } from './audio-bands.js';

// True when a fixture's polyline carries 3D points (any point has a defined
// third component) — the signal to resample by 3D arc length and project.
function pointsAre3D(points) {
  return Array.isArray(points) && points.some((p) => p && p[2] !== undefined);
}

// Lift 2D sample points to world positions on the canvas plane (z = 0).
const flatPositions = (pts) => pts.map(([x, y]) => [x, y, 0]);

// The normalized sample UVs — AND world positions — for one fixture, in
// LED-index order. A matrix (grid) fixture samples a cols×rows block in its
// wiring order; a strip resamples its polyline evenly. `reversed` flips which
// physical end is pixel 0 for both.
//
// `cam` is the composition's projection camera. In 2D mode it's the flat camera
// (mode === 'flat') and the strip path is byte-identical with today. In 3D mode,
// when the fixture's points are 3D, resample by TRUE 3D arc length and project
// each sample through the camera to get its 2D UV (perspective foreshortening).
//
// Returns { uvs, pos }: uvs = [u, v] canvas sample points, pos = [x, y, z]
// WORLD positions per LED (same order) — the volumetric field pass evaluates at
// pos. Only the 3D strip path carries real z (the samplePoints3D output BEFORE
// projection); every 2D/flat path is the 2D points on the canvas plane (z = 0),
// matching the design's "2D mode evaluates fields on the z = 0 plane".
function fixtureSamples(f, canvas, cam) {
  if (isGridFixture(f)) {
    const pts = gridPoints(f.input?.transform, f.cols, f.rows, f.distribution, canvas);
    const uvs = f.input?.reversed ? pts.reverse() : pts;
    return { uvs, pos: flatPositions(uvs) };
  }
  // A bezier's sampled centreline is its EVALUATED curve, not the control
  // triangle — after evaluation it flows through the same resample/project
  // path as a polyline (the evaluated points carry z when the arch is lifted).
  const geomPts = isBezierFixture(f.input) ? bezierToPoints(f.input) : f.input.points;
  const basePts = f.input.reversed ? [...geomPts].reverse() : geomPts;
  if (cam && cam.mode !== 'flat' && pointsAre3D(geomPts)) {
    const pos = samplePoints3D(basePts, f.input.samples);
    const uvs = pos.map((p) => {
      const uv = project(p, cam);
      // A point at/behind the camera projects to [NaN, NaN] (see projectFramed).
      // Substitute the out-of-range sentinel: the GPU sampler's bounds check
      // reads it as "outside the canvas" → that LED goes black (per-LED, no
      // NaNs ever reach the sampler texture).
      return Number.isFinite(uv[0]) && Number.isFinite(uv[1]) ? uv : [-1, -1];
    });
    return { uvs, pos };
  }
  const uvs = samplePoints(basePts, f.input.samples);
  return { uvs, pos: flatPositions(uvs) };
}

// Pure: derive the flat sampler UVs + daemon route from a show.
//
// The bridge sends ONE flat RGB buffer = the concatenation of every fixture's
// sampled pixels. The daemon slices each device's bytes via byteStart/byteEnd.
// Fixture pixel offsets (output.pixelOffset) are OUTPUT-LOCAL: they reset to 0
// per (device, port) — each output's chain addresses from 0. So byteStart CANNOT
// come from the local offset; we assign each device a GLOBAL base into the flat
// buffer by walking devices in array order with a running global pixel cursor,
// and within a device we concatenate PORTS in ascending order (then offset order
// inside a port) — which reproduces the exact wire bytes the old device-local
// stacking produced.
//
// Layout: device order (show.devices) → within each device, fixtures ordered by
// (port, pixelOffset) → append samplePoints(input.points, input.samples).
// validate() enforces per-output contiguity-from-0.
//
// The per-device DDP offset stays 0-based and is handled by buildPackets in
// server/output.js: each device's slice is sent starting at DDP offset 0,
// regardless of byteStart. server/output.js needs no change.
export function buildPipelineInputs(show) {
  const uvs = [];
  // World xyz per LED, same order as the uv pairs (3 floats per LED). Fields
  // (volumetric sources) evaluate here. NOTE: chain stagger shifts the SAMPLE
  // UV (a time-delay trick) but never the world position — fields see the
  // fixture where it physically stands.
  const poss = [];
  // Per-LED audio band index (0=bass, 1=mid, 2=high), same order + length as the
  // LEDs — feeds the "Audio Bars" volumetric source (each fixture pulses on its
  // band). Derived from the fixture's name (or its audioBand override).
  const bands = [];
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
      .sort((a, b) => ((a.output?.port ?? 0) - (b.output?.port ?? 0)) || ((a.output?.pixelOffset ?? 0) - (b.output?.pixelOffset ?? 0)));
    const dmxFs = mine.filter(isDmxFixture);
    if (!fs.length && !dmxFs.length) continue;

    const globalBase = cursor;
    const segments = [];     // device-local pixel ranges, each with its colorOrder
    let devLocal = 0;
    for (const f of fs) {
      // FLIP = reverse pixel direction (which physical end is pixel 0). Applied
      // at sample time so the canonical input.points stay put (no double-reverse).
      const { uvs: pts, pos } = fixtureSamples(f, canvas, cam);
      // Chain stagger: shift this fixture's sample position by its chain offset so
      // a travelling source cascades across the run (no-op when not chained).
      const [ox, oy] = chainOffset(show, f.id);
      spans.push({ id: f.id, start: cursor, count: pts.length, hidden: !!f.hidden });
      fixtureOrder.push(f);
      for (const [u, v] of pts) { uvs.push(u + ox, v + oy); }
      for (const [x, y, z] of pos) { poss.push(x, y, z); }
      { const bi = fixtureBandIndex(f.name, f.audioBand); for (let k = 0; k < pts.length; k++) bands.push(bi); }
      // Colour format per segment: a fixture's own colorFormat WINS when set (so an
      // RGBW strip can sit on the same controller as RGB ones); otherwise inherit
      // the controller's colour order (the common case — its strips are wired alike).
      // 'NONE' is a channels-only (par) format with no pixel colour order — treat it
      // as "inherit" here so a par toggled to pixel output still gets a valid order.
      segments.push({ start: devLocal, count: pts.length, colorOrder: effectiveColorFormat(f.colorFormat, d.colorOrder, f.colorOrder) });
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
      poss.push(u, v, 0);   // DMX fixture: its centre, on the canvas plane
      bands.push(fixtureBandIndex(f.name, f.audioBand));
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
    const { uvs: pts, pos } = fixtureSamples(f, canvas, cam);
    const [ox, oy] = chainOffset(show, f.id);
    spans.push({ id: f.id, start: cursor, count: pts.length, hidden: !!f.hidden });
    fixtureOrder.push(f);
    for (const [u, v] of pts) { uvs.push(u + ox, v + oy); }
    for (const [x, y, z] of pos) { poss.push(x, y, z); }
    { const bi = fixtureBandIndex(f.name, f.audioBand); for (let k = 0; k < pts.length; k++) bands.push(bi); }
    cursor += pts.length;
  }

  // Volumetric "volume height" fits the rig: normalize each LED's z so the HIGHEST
  // fixture point sits at z = 1. Import normalizes z by the y-span (so a tall-but-narrow
  // rig like Kagora only reaches z ≈ 0.38), which left a z-axis field (Plane Pulse / Axis
  // Gradient / drift) sweeping mostly empty space above the arches. Rescaling to the real
  // z-extent makes those effects span the whole rig. Flat rigs (all z ≈ 0) are untouched,
  // so the 2D field pass stays byte-identical.
  let zMax = 0;
  for (let i = 2; i < poss.length; i += 3) { const a = Math.abs(poss[i]); if (a > zMax) zMax = a; }
  if (zMax > 1e-4) for (let i = 2; i < poss.length; i += 3) poss[i] /= zMax;

  return { sampleUVs: new Float32Array(uvs), samplePositions: new Float32Array(poss), sampleBands: new Float32Array(bands), route, fixtureOrder, spans };
}
