import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDeviceOrder } from '../server/colororder.js';
test('GRB reorders R,G,B → G,R,B per pixel', () => {
  const rgb = Buffer.from([10,20,30, 40,50,60]);
  assert.deepEqual([...toDeviceOrder(rgb, 'GRB')], [20,10,30, 50,40,60]);
});
test('RGB is identity', () => {
  const rgb = Buffer.from([1,2,3]);
  assert.deepEqual([...toDeviceOrder(rgb, 'RGB')], [1,2,3]);
});
