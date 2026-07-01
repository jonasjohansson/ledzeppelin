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
