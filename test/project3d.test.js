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

test('cameraBasis returns unit right/up/forward for pan gestures', () => {
  const { r, u, f } = cameraBasis(orbitCamera({ az: -30, el: 20, dist: 1.6 }, 1));
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  for (const a of [r, u, f]) assert.ok(Math.abs(len(a) - 1) < 1e-9);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(r, f)) < 1e-9 && Math.abs(dot(u, f)) < 1e-9 && Math.abs(dot(r, u)) < 1e-9);
});
