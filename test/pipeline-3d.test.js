import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture } from '../src/model/show.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';
import { samplePoints } from '../src/model/sampling.js';
import { perspectiveCamera, flatCamera } from '../src/model/project3d.js';

// REGRESSION (critical): a normal 2D show (no composition.view3d) must produce
// UVs byte-identical to today — i.e. exactly samplePoints(input.points, samples)
// for each fixture, in device+pixelOffset order.
test('2D show UVs are unchanged (equal to raw samplePoints)', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  const aPts = [[0, 0], [0, 0.5], [0, 1]];
  const bPts = [[1, 0], [0.5, 0.5], [0, 1]];
  s = addFixture(s, { id: 'a', name: 'a', pixelCount: 3, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 3 },
    input: { mode: 'polyline', points: aPts, samples: 3 } });
  s = addFixture(s, { id: 'b', name: 'b', pixelCount: 4, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 3, pixelCount: 4 },
    input: { mode: 'polyline', points: bPts, samples: 4 } });

  const { sampleUVs, spans } = buildPipelineInputs(s);

  for (const [id, pts, samples] of [['a', aPts, 3], ['b', bPts, 4]]) {
    const sp = spans.find((x) => x.id === id);
    const slice = Array.from(sampleUVs.slice(sp.start * 2, (sp.start + sp.count) * 2));
    // The pipeline stores UVs in a Float32Array, so compare against the raw
    // double-precision sample points cast through Float32 the same way — this is
    // exactly today's output (no 3D path taken), i.e. byte-identical.
    const expect = Array.from(Float32Array.from(samplePoints(pts, samples).flat()));
    assert.equal(slice.length, expect.length);
    slice.forEach((v, i) => assert.equal(v, expect[i], `${id} uv[${i}]`));
  }
});

// BACKWARD-COMPAT: an EXPLICIT 3D view whose camera frames the z=0 plane 1:1
// must reproduce the 2D result exactly. The simplest such camera is the flat
// camera (project drops z, returns [x,y] unchanged). So a show in `mode:'3d'`
// with `projectionCamera: flatCamera()` and all points at z=0 produces UVs
// byte-identical to the same show WITHOUT any view3d (the pure 2D path). This
// proves "3D mode collapses to 2D at z=0" and that view3d survives into the
// pipeline (it isn't stripped before cameraFromView3d sees it).
test('3D mode with a flat camera at z=0 equals the 2D show exactly', () => {
  const aPts = [[0, 0, 0], [0, 0.5, 0], [0, 1, 0]];
  const bPts = [[1, 0, 0], [0.5, 0.5, 0], [0, 1, 0]];
  let base = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  base = addFixture(base, { id: 'a', name: 'a', pixelCount: 3, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 3 },
    input: { mode: 'polyline', points: aPts, samples: 3 } });
  base = addFixture(base, { id: 'b', name: 'b', pixelCount: 4, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 3, pixelCount: 4 },
    input: { mode: 'polyline', points: bPts, samples: 4 } });

  // 2D show (no view3d) — the reference.
  const twoD = buildPipelineInputs(base);

  // Same show, but with an explicit 3D view using the flat camera.
  const threeD = structuredClone(base);
  threeD.composition.view3d = { mode: '3d', projectionCamera: flatCamera() };
  const projected = buildPipelineInputs(threeD);

  assert.equal(projected.sampleUVs.length, twoD.sampleUVs.length);
  for (let i = 0; i < twoD.sampleUVs.length; i++) {
    assert.equal(projected.sampleUVs[i], twoD.sampleUVs[i], `uv[${i}] must match the 2D result exactly`);
  }
});

// FORESHORTENING: a strip tracing a semicircle in the X–Z plane, bulging toward
// −z away from the camera. The physically-even samples DON'T project to even
// screen spacing: where the arc curves INTO depth (its ends, tangent along ±z)
// it foreshortens to almost nothing on screen, while at the apex (tangent across
// screen, along x) it projects at full width. That end-vs-apex spacing contrast
// is the perspective signature — the flat 2D path gives uniform spacing.
test('3D perspective projection foreshortens an arc bending away in depth', () => {
  // Semicircle in X–Z plane: y fixed at 0.5, x sweeps 0→1, z dips to −0.5 at apex.
  // Parametrize by angle so points are physically even along the arc.
  const N = 41;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const ang = Math.PI * (k / (N - 1)); // 0..π
    const x = 0.5 - 0.5 * Math.cos(ang); // 0..1
    const z = -0.5 * Math.sin(ang);      // 0 → -0.5 (apex) → 0
    pts.push([x, 0.5, z]);
  }

  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  s = addFixture(s, { id: 'arc', name: 'arc', pixelCount: N, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: N },
    input: { mode: 'polyline', points: pts, samples: N } });
  s.composition = s.composition || {};
  s.composition.view3d = {
    mode: '3d',
    projectionCamera: perspectiveCamera({ pos: [0.5, 0.5, 1.5], target: [0.5, 0.5, 0], fov: 90, aspect: 1 }),
  };

  const { sampleUVs, spans } = buildPipelineInputs(s);
  const sp = spans.find((x) => x.id === 'arc');
  const uv = [];
  for (let i = sp.start; i < sp.start + sp.count; i++) uv.push([sampleUVs[i * 2], sampleUVs[i * 2 + 1]]);

  // All projected points must be finite (none behind the camera).
  for (const [u, v] of uv) assert.ok(Number.isFinite(u) && Number.isFinite(v));

  const spacing = (i) => Math.hypot(uv[i + 1][0] - uv[i][0], uv[i + 1][1] - uv[i][1]);
  // End spacing (first segment — the arc plunging into depth) vs apex spacing
  // (middle — running across the screen). Real perspective foreshortening ⇒ the
  // end is MEANINGFULLY compressed relative to the apex. The flat 2D path gives
  // uniform spacing (ratio ≈ 1), so a clear drop proves depth is being projected.
  const endSpacing = spacing(0);
  const mid = Math.floor((N - 1) / 2);
  const apexSpacing = spacing(mid);
  assert.ok(endSpacing / apexSpacing < 0.9,
    `end/apex spacing ratio ${endSpacing / apexSpacing} should be well below 1 (foreshortened into depth)`);

  // Sanity: the same fixture WITHOUT the 3D view (flat path) samples uniformly —
  // proving the contrast above comes from projection, not the arc geometry alone.
  const flat = structuredClone(s);
  delete flat.composition.view3d;
  const fr = buildPipelineInputs(flat);
  const fsp = fr.spans.find((x) => x.id === 'arc');
  const fuv = [];
  for (let i = fsp.start; i < fsp.start + fsp.count; i++) fuv.push([fr.sampleUVs[i * 2], fr.sampleUVs[i * 2 + 1]]);
  const fSpacing = (i) => Math.hypot(fuv[i + 1][0] - fuv[i][0], fuv[i + 1][1] - fuv[i][1]);
  assert.ok(fSpacing(0) / fSpacing(mid) > 0.98,
    'flat 2D path should sample the arc with near-uniform spacing');
});

// --- bezier fixtures (Phase 4): the EVALUATED curve is the sampled centreline ---
import { validate } from '../src/model/show.js';
import { bezierToPoints } from '../src/model/bezier.js';
import { samplePoints3D } from '../src/model/sampling.js';
import { project } from '../src/model/project3d.js';

const bezierShow = (c, view3d) => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  s = addFixture(s, { id: 'arc', name: 'arc', pixelCount: 30, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 30 },
    input: { mode: 'bezier', points: [[0.2, 0.5, 0], [0.8, 0.5, 0]], bezier: { c }, samples: 30 } });
  if (view3d) s.composition.view3d = view3d;
  return s;
};
const uvsOf = (r, id) => {
  const sp = r.spans.find((x) => x.id === id);
  const out = [];
  for (let i = sp.start; i < sp.start + sp.count; i++) out.push([r.sampleUVs[i * 2], r.sampleUVs[i * 2 + 1]]);
  return out;
};

test('validate() accepts a bezier fixture (2 end points)', () => {
  const s = bezierShow([0.5, 0.5, 0.5]);
  assert.deepEqual(validate(s), { ok: true, errors: [] });
});

test('bezier UVs = the projected 3D-arc-length resample of the EVALUATED curve', () => {
  const cam = perspectiveCamera({ pos: [0.5, 0.5, -0.5], target: [0.5, 0.5, 0], up: [0, -1, 0], fov: 90, aspect: 1 });
  const s = bezierShow([0.5, 0.5, 0.5], { mode: '3d', projectionCamera: cam });
  const got = uvsOf(buildPipelineInputs(s), 'arc');
  const expect = samplePoints3D(bezierToPoints(s.fixtures[0].input), 30)
    .map((p) => { const uv = project(p, cam); return Number.isFinite(uv[0]) ? uv : [-1, -1]; })
    .map(([u, v]) => [Math.fround(u), Math.fround(v)]);   // pipeline stores Float32
  assert.equal(got.length, expect.length);
  got.forEach(([u, v], i) => { assert.equal(u, expect[i][0], `u[${i}]`); assert.equal(v, expect[i][1], `v[${i}]`); });
});

test('a mid-lift arch under the FLAT camera keeps a symmetric UV distribution about the apex', () => {
  // 2D mode (no view3d): the flat path samples the evaluated curve — a
  // symmetric standing arch must sample symmetrically about its apex (x = 0.5).
  const s = bezierShow([0.5, 0.5, 0.5]);
  const uv = uvsOf(buildPipelineInputs(s), 'arc');
  const n = uv.length;
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs((uv[k][0] - 0.5) + (uv[n - 1 - k][0] - 0.5)) < 1e-6, `u mirrors at k=${k}`);
    assert.ok(Math.abs(uv[k][1] - uv[n - 1 - k][1]) < 1e-6, `v mirrors at k=${k}`);
  }
});

// --- projection presets (Phase 5): 3D placement finally SHAPES the sampling ---
import { projectionPreset } from '../src/model/project3d.js';

// THE PAYOFF — the user's original ask: "a line travels through an arc
// differently". A standing arch's physically-even LEDs must NOT sample evenly
// once a real projection camera is placed:
//  • Front (ORTHO): the 3D arc-length resample projects DENSER near the ENDS
//    (where the arch climbs steeply in z, x barely advances) — while every
//    z = 0 fixture keeps sampling exactly where it did in 2D.
//  • Front wide (PERSPECTIVE): the apex is FARTHER from the camera, so on top
//    of the resample the whole crown compresses — UVs near the apex end up
//    DENSER than the same arc under Flat.
test('an arched bezier under Front wide samples DENSER near the apex than under Flat', () => {
  const flat = buildPipelineInputs(bezierShow([0.5, 0.5, 0.5]));
  const wide = buildPipelineInputs(bezierShow([0.5, 0.5, 0.5],
    { mode: '3d', projectionCamera: projectionPreset('frontwide') }));
  const spacingAt = (r, i) => {
    const uv = uvsOf(r, 'arc');
    return Math.hypot(uv[i + 1][0] - uv[i][0], uv[i + 1][1] - uv[i][1]);
  };
  const mid = Math.floor(29 / 2);            // 30 samples → apex ≈ segment 14
  const apexFlat = spacingAt(flat, mid);
  const apexWide = spacingAt(wide, mid);
  assert.ok(apexWide / apexFlat < 0.95,
    `apex spacing wide/flat = ${apexWide / apexFlat} — must be meaningfully denser`);
});

test('an arched bezier under Front (ortho) bunches toward the ENDS (physical resample)', () => {
  const front = buildPipelineInputs(bezierShow([0.5, 0.5, 0.5],
    { mode: '3d', projectionCamera: projectionPreset('front') }));
  const uv = uvsOf(front, 'arc');
  const sp = (i) => Math.hypot(uv[i + 1][0] - uv[i][0], uv[i + 1][1] - uv[i][1]);
  const mid = Math.floor(29 / 2);
  assert.ok(sp(0) / sp(mid) < 0.9,
    `end/apex spacing ${sp(0) / sp(mid)} — the steep ends must compress on screen`);
  // …and it differs from the flat sampling (UVs actually CHANGED).
  const flatUv = uvsOf(buildPipelineInputs(bezierShow([0.5, 0.5, 0.5])), 'arc');
  assert.ok(uv.some(([u], i) => Math.abs(u - flatUv[i][0]) > 1e-4));
});

test('all-z=0 fixtures under Front (ortho) sample where 2D put them (identity at the plane)', () => {
  const mk = (view3d) => {
    let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
    s = addFixture(s, { id: 'flat', name: 'flat', pixelCount: 8, colorOrder: 'GRB',
      output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 8 },
      input: { mode: 'polyline', points: [[0.1, 0.2, 0], [0.6, 0.4, 0], [0.9, 0.9, 0]], samples: 8 } });
    if (view3d) s.composition.view3d = view3d;
    return buildPipelineInputs(s);
  };
  const twoD = mk(null);
  const front = mk({ mode: '3d', projectionCamera: projectionPreset('front') });
  for (let i = 0; i < twoD.sampleUVs.length; i++) {
    assert.ok(Math.abs(front.sampleUVs[i] - twoD.sampleUVs[i]) < 1e-6, `uv[${i}]`);
  }
});

// BEHIND-CAMERA LEDs must go BLACK: projectFramed returns [NaN, NaN] for a point
// at/behind the camera plane; the pipeline substitutes the out-of-range sentinel
// [-1, -1], which the GPU sampler's bounds check already reads as "outside the
// canvas → black". Other LEDs on the same fixture stay normal.
test('a point behind the camera yields the [-1,-1] sentinel; others project normally', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  // Two-point strip: first ON the canvas plane (in front of the camera at z=1),
  // second at z=2 (BEHIND the camera). samples=2 ⇒ the LEDs are exactly the ends.
  s = addFixture(s, { id: 'f', name: 'f', pixelCount: 2, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 2 },
    input: { mode: 'polyline', points: [[0.5, 0.5, 0], [0.5, 0.5, 2]], samples: 2 } });
  s.composition.view3d = {
    mode: '3d',
    projectionCamera: perspectiveCamera({ pos: [0.5, 0.5, 1], target: [0.5, 0.5, 0], fov: 90, aspect: 1 }),
  };
  const { sampleUVs, spans } = buildPipelineInputs(s);
  const sp = spans.find((x) => x.id === 'f');
  const led0 = [sampleUVs[sp.start * 2], sampleUVs[sp.start * 2 + 1]];
  const led1 = [sampleUVs[(sp.start + 1) * 2], sampleUVs[(sp.start + 1) * 2 + 1]];
  assert.ok(Math.abs(led0[0] - 0.5) < 1e-6 && Math.abs(led0[1] - 0.5) < 1e-6);  // on-axis → centre
  assert.deepEqual(led1, [-1, -1]);   // behind the camera → the sampler blackens it
  for (const v of sampleUVs) assert.ok(Number.isFinite(v), 'no NaN may reach the sampler');
});
