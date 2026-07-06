import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseObj } from '../src/model/obj-import.js';

test('parses vertices grouped by object, ordered by declaration when no l-lines', () => {
  const obj = `
o RunA
v 0 0 0
v 1 0 0
v 2 0 0
o RunB
v 0 1 0
v 0 2 0
`;
  const r = parseObj(obj);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, 'RunA');
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
  assert.equal(r[1].name, 'RunB');
  assert.deepEqual(r[1].points, [[0, 1, 0], [0, 2, 0]]);
});

test('orders points by l (line) elements when present, incl. negative indices', () => {
  // vertices declared out of path order; the l-line gives the true order.
  const obj = `o Bend
v 0 0 0
v 1 1 0
v 2 0 0
l 1 2 3`;
  const r = parseObj(obj);
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 1, 0], [2, 0, 0]]);

  const rel = parseObj(`o R
v 5 0 0
v 6 0 0
l -2 -1`);
  assert.deepEqual(rel[0].points, [[5, 0, 0], [6, 0, 0]]);
});

test('geometry before any o/g goes into a default object; f/vn/vt ignored', () => {
  const r = parseObj(`v 0 0 0\nv 1 0 0\nvn 0 0 1\nf 1 2 1\n`);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 0, 0]]);
});
