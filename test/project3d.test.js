import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatCamera, project } from '../src/model/project3d.js';

test('flat-front camera: (x,y,z) → (x,y), z ignored (2D is a special case)', () => {
  const cam = flatCamera();
  assert.deepEqual(project([0.1, 0.5, 0], cam), [0.1, 0.5]);
  assert.deepEqual(project([0.9, 0.5, 0.7], cam), [0.9, 0.5]); // depth ignored when flat
});
