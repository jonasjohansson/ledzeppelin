import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplePoints, samplePoints3D } from '../src/model/sampling.js';

test('samplePoints interpolates N points along a 2-point line', () => {
  const pts = samplePoints([[0,0],[0,1]], 3);
  assert.deepEqual(pts, [[0,0],[0,0.5],[0,1]]);
});
test('handles multi-segment polylines by arc length', () => {
  const pts = samplePoints([[0,0],[1,0],[1,1]], 3);
  assert.deepEqual(pts[0], [0,0]);
  assert.deepEqual(pts[1], [1,0]);
  assert.deepEqual(pts[2], [1,1]);
});

test('samplePoints: empty / single-point input does not throw', () => {
  assert.deepEqual(samplePoints([], 10), []);
  assert.deepEqual(samplePoints(undefined, 5), []);
  assert.deepEqual(samplePoints([[0.2, 0.3]], 4), [[0.2, 0.3]]);   // single point → that point
});

test('samplePoints3D: N points evenly spaced by 3D arc length', () => {
  const pts = samplePoints3D([[0,0,0],[0,0,2]], 3);
  assert.deepEqual(pts, [[0,0,0],[0,0,1],[0,0,2]]);
});
test('samplePoints3D: right-angle path splits by true 3D length', () => {
  const pts = samplePoints3D([[0,0,0],[0,0,2],[0,2,2]], 5); // total length 4 → step 1
  assert.deepEqual(pts[2], [0,0,2]); // midpoint sits at the corner
});
