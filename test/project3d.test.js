import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatCamera, project, perspectiveCamera, orthoCamera } from '../src/model/project3d.js';

test('flat-front camera: (x,y,z) → (x,y), z ignored (2D is a special case)', () => {
  const cam = flatCamera();
  assert.deepEqual(project([0.1, 0.5, 0], cam), [0.1, 0.5]);
  assert.deepEqual(project([0.9, 0.5, 0.7], cam), [0.9, 0.5]); // depth ignored when flat
});

test('perspective: a point on the camera axis lands at centre UV', () => {
  const cam = perspectiveCamera({ pos: [0.5, 0.5, 1], target: [0.5, 0.5, 0], fov: 90, aspect: 1 });
  const [u, v] = project([0.5, 0.5, 0], cam);
  assert.ok(Math.abs(u - 0.5) < 1e-9 && Math.abs(v - 0.5) < 1e-9);
});

test('perspective: equal offsets at greater depth project closer to centre (foreshortening)', () => {
  const cam = perspectiveCamera({ pos: [0.5, 0.5, 1], target: [0.5, 0.5, 0], fov: 90, aspect: 1 });
  const near = project([0.7, 0.5, 0], cam);   // depth 1 from camera
  const far  = project([0.7, 0.5, -1], cam);  // depth 2 from camera
  assert.ok(Math.abs(far[0] - 0.5) < Math.abs(near[0] - 0.5)); // farther → nearer centre
});

test('ortho: a point on the camera axis lands at centre UV', () => {
  const cam = orthoCamera({ pos: [0.5, 0.5, 1], target: [0.5, 0.5, 0], orthoHeight: 1, aspect: 1 });
  const [u, v] = project([0.5, 0.5, 0], cam);
  assert.ok(Math.abs(u - 0.5) < 1e-9 && Math.abs(v - 0.5) < 1e-9);
});

test('perspective aspect 2: horizontal offsets halve, vertical unchanged', () => {
  // A wide (aspect 2) frame fits TWICE the world width for the same fov, so an
  // x offset lands half as far from centre; the vertical scale is untouched.
  const wide = perspectiveCamera({ pos: [0.5, 0.5, 1], target: [0.5, 0.5, 0], fov: 90, aspect: 2 });
  const sq = perspectiveCamera({ pos: [0.5, 0.5, 1], target: [0.5, 0.5, 0], fov: 90, aspect: 1 });
  const [uw] = project([1.0, 0.5, 0], wide);   // +0.5 world x at depth 1
  const [us] = project([1.0, 0.5, 0], sq);
  assert.ok(Math.abs((uw - 0.5) - (us - 0.5) / 2) < 1e-9);   // half the offset
  const [, vw] = project([0.5, 0.0, 0], wide); // −0.5 world y at depth 1
  const [, vs] = project([0.5, 0.0, 0], sq);
  assert.ok(Math.abs(vw - vs) < 1e-9);         // vertical scale identical
});

// --- the 2D/3D mode toggle (pure state helper behind the top-bar button) ----
import { toggleView3d, DEFAULT_ORBIT } from '../src/model/project3d.js';

test('toggleView3d: first entry initializes a FLAT projection camera + default orbit', () => {
  const show = { composition: { canvas: { w: 100, h: 100 } } };
  const next = toggleView3d(show);
  const v = next.composition.view3d;
  assert.equal(v.mode, '3d');
  // Phase 2 is a VIEWPORT: the projection camera stays FLAT so the sampled
  // output is identical in both modes (camera placement UI is Phase 5).
  assert.equal(v.projectionCamera.mode, 'flat');
  assert.deepEqual(v.orbit, DEFAULT_ORBIT);
  assert.notEqual(next, show);                      // pure — new object
  assert.equal(show.composition.view3d, undefined); // input untouched
});

test('toggleView3d: leaving 3D sets mode 2d but keeps camera + orbit for re-entry', () => {
  const orbit = { az: 45, el: 30, dist: 2.2, target: [0.5, 0.5, 0] };
  const in3d = { composition: { view3d: { mode: '3d', projectionCamera: flatCamera(), orbit } } };
  const back = toggleView3d(in3d);
  assert.equal(back.composition.view3d.mode, '2d');
  assert.deepEqual(back.composition.view3d.orbit, orbit);   // orbit survives
  const again = toggleView3d(back);
  assert.equal(again.composition.view3d.mode, '3d');
  assert.deepEqual(again.composition.view3d.orbit, orbit);  // re-entry restores the view
});

// --- orbit camera (the VIEW-ONLY inspect camera of the 3D viewport) ----------
import { orbitCamera, cameraBasis } from '../src/model/project3d.js';

test('orbitCamera: the target projects to centre UV from any az/el/dist', () => {
  for (const o of [{ az: -30, el: 20, dist: 1.6 }, { az: 120, el: 60, dist: 3 }, { az: 0, el: 5, dist: 0.7 }]) {
    const cam = orbitCamera(o, 1);
    const [u, v] = project([0.5, 0.5, 0], cam);
    assert.ok(Math.abs(u - 0.5) < 1e-9 && Math.abs(v - 0.5) < 1e-9, JSON.stringify(o));
  }
});

test('orbitCamera: world z is UP on screen; +x is right at az 0', () => {
  const cam = orbitCamera({ az: 0, el: 20, dist: 1.6 }, 1);
  const [, vLift] = project([0.5, 0.5, 0.3], cam);
  assert.ok(vLift < 0.5, 'a lifted point rises on screen (v shrinks)');
  const [uRight] = project([0.8, 0.5, 0], cam);
  assert.ok(uRight > 0.5, '+x projects right of centre');
});

test('orbitCamera clamps elevation and distance to the orbit limits', () => {
  const steep = orbitCamera({ az: 0, el: 89.9, dist: 1 }, 1);   // el clamps to 85 — no up-vector degeneracy
  const [u, v] = project([0.5, 0.5, 0], steep);
  assert.ok(Number.isFinite(u) && Number.isFinite(v));
  const near = orbitCamera({ az: 0, el: 20, dist: 0.01 }, 1);   // dist clamps to 0.5
  assert.ok(Math.hypot(near.pos[0] - 0.5, near.pos[1] - 0.5, near.pos[2]) > 0.49);
});

// --- unproject + rayPlaneZ (Phase 3: dragging vertices in the 3D viewport) ----
import { unproject, rayPlaneZ } from '../src/model/project3d.js';

test('unproject round-trips project through the orbit camera (perspective)', () => {
  // Project a known world point, unproject the resulting UV, and intersect the
  // ray with the horizontal plane at the point's z → recovers the point.
  const cam = orbitCamera({ az: -30, el: 20, dist: 1.6 }, 1);
  for (const P of [[0.3, 0.7, 0.25], [0.5, 0.5, 0], [0.9, 0.1, 0.6]]) {
    const [u, v] = project(P, cam);
    const ray = unproject(u, v, cam);
    const hit = rayPlaneZ(ray, P[2]);
    assert.ok(hit, `plane hit exists for ${JSON.stringify(P)}`);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(hit[i] - P[i]) < 1e-6, `${JSON.stringify(P)}[${i}] → ${hit[i]}`);
  }
});

test('unproject round-trips through an ortho camera too', () => {
  const cam = orthoCamera({ pos: [0.5, 0.5, -1], target: [0.5, 0.5, 0], up: [0, -1, 0], orthoHeight: 1, aspect: 1 });
  const P = [0.2, 0.8, 0.3];
  const [u, v] = project(P, cam);
  const hit = rayPlaneZ(unproject(u, v, cam), P[2]);
  assert.ok(hit);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(hit[i] - P[i]) < 1e-6);
});

test('unproject respects aspect (non-square viewport)', () => {
  const cam = orbitCamera({ az: 40, el: 35, dist: 2 }, 16 / 9);
  const P = [0.6, 0.4, 0.15];
  const [u, v] = project(P, cam);
  const hit = rayPlaneZ(unproject(u, v, cam), P[2]);
  assert.ok(hit);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(hit[i] - P[i]) < 1e-6);
});

test('rayPlaneZ: parallel ray → null; hit behind the origin → null', () => {
  // Parallel: a ray running horizontally never meets a z-plane above/below it.
  assert.equal(rayPlaneZ({ origin: [0, 0, 0.5], dir: [1, 0, 0] }, 0), null);
  // Behind: the orbit camera looks DOWN at the plane; a plane far above the
  // camera is behind the ray (t < 0).
  const cam = orbitCamera({ az: 0, el: 30, dist: 1.6 }, 1);
  const ray = unproject(0.5, 0.5, cam);
  assert.equal(rayPlaneZ(ray, 10), null);
});

test('unproject of the flat camera is null (2D mode has no viewport ray)', () => {
  assert.equal(unproject(0.5, 0.5, flatCamera()), null);
});

test('cameraBasis returns unit right/up/forward for pan gestures', () => {
  const { r, u, f } = cameraBasis(orbitCamera({ az: -30, el: 20, dist: 1.6 }, 1));
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  for (const a of [r, u, f]) assert.ok(Math.abs(len(a) - 1) < 1e-9);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(r, f)) < 1e-9 && Math.abs(dot(u, f)) < 1e-9 && Math.abs(dot(r, u)) < 1e-9);
});

// --- projection presets (Phase 5: the placeable projection camera) ----------
import { projectionPreset, setProjectionPreset, PROJECTION_PRESETS } from '../src/model/project3d.js';

test('projectionPreset front (ORTHO): z=0 projects EXACTLY to identity; z is dropped', () => {
  const cam = projectionPreset('front');
  assert.equal(cam.mode, 'ortho');
  assert.equal(cam.preset, 'front');
  for (const [x, y] of [[0, 0], [1, 1], [0.2265625, 0.5555555555555556], [0.5, 0.5]]) {
    const [u, v] = project([x, y, 0], cam);
    assert.ok(Math.abs(u - x) < 1e-12 && Math.abs(v - y) < 1e-12, `(${x},${y})`);
    // Ortho: a LIFTED point keeps its x/y too — only the arc-length resampling
    // (not the per-point projection) changes for z ≠ 0.
    const [u2, v2] = project([x, y, 0.4], cam);
    assert.ok(Math.abs(u2 - x) < 1e-12 && Math.abs(v2 - y) < 1e-12);
  }
});

test('projectionPreset frontwide (PERSPECTIVE): z=0 ≈ identity; lifted points pull toward centre', () => {
  const cam = projectionPreset('frontwide');
  assert.equal(cam.mode, 'perspective');
  for (const [x, y] of [[0, 0], [1, 1], [0.25, 0.75]]) {
    const [u, v] = project([x, y, 0], cam);
    assert.ok(Math.abs(u - x) < 1e-3 && Math.abs(v - y) < 1e-3, `(${x},${y})`);   // frames the canvas exactly
  }
  // The camera sits on the −z side, so +z (lifted toward the audience/orbit
  // viewer) is FARTHER from it → offsets shrink toward the canvas centre.
  const [uFlat] = project([0.9, 0.5, 0], cam);
  const [uLift] = project([0.9, 0.5, 0.5], cam);
  assert.ok(Math.abs(uLift - 0.5) < Math.abs(uFlat - 0.5));
});

test('projectionPreset flat + unknown fall back to the flat camera', () => {
  assert.equal(projectionPreset('flat').mode, 'flat');
  assert.equal(projectionPreset('bogus').mode, 'flat');
  assert.deepEqual(PROJECTION_PRESETS.map((p) => p.id), ['flat', 'front', 'frontwide']);
});

test('setProjectionPreset writes view3d.projectionCamera (pure, 3D mode only)', () => {
  const in3d = toggleView3d({ composition: {} });
  const next = setProjectionPreset(in3d, 'front');
  assert.equal(next.composition.view3d.projectionCamera.preset, 'front');
  assert.equal(next.composition.view3d.mode, '3d');           // rest of view3d kept
  assert.equal(in3d.composition.view3d.projectionCamera.mode, 'flat');   // input untouched
  const in2d = { composition: { view3d: { mode: '2d' } } };
  assert.equal(setProjectionPreset(in2d, 'front'), in2d);     // no-op outside 3D
});
