import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISTRIBUTIONS, DEFAULT_DISTRIBUTION, resolveDistribution,
  gridCellOrder, gridPoints, isGridFixture,
} from '../src/model/grid.js';

test('there are exactly 16 distributions, index 0 = TL row-major snake', () => {
  assert.equal(DISTRIBUTIONS.length, 16);
  const d0 = DISTRIBUTIONS[DEFAULT_DISTRIBUTION];
  assert.deepEqual([d0.startCorner, d0.axis, d0.serpentine], ['TL', 'row', true]);
});

test('resolveDistribution clamps bad input and passes objects through', () => {
  assert.equal(resolveDistribution(-5).index, 0);
  assert.equal(resolveDistribution(999).index, 15);
  const obj = { startCorner: 'BR', axis: 'col', serpentine: false };
  assert.equal(resolveDistribution(obj), obj);
});

test('TL row-major snake reverses every other row', () => {
  // 3 cols × 2 rows: row 0 L→R, row 1 R→L.
  const order = gridCellOrder(3, 2, { startCorner: 'TL', axis: 'row', serpentine: true });
  assert.deepEqual(order, [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]]);
});

test('TL row-major progressive keeps every row L→R', () => {
  const order = gridCellOrder(3, 2, { startCorner: 'TL', axis: 'row', serpentine: false });
  assert.deepEqual(order, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]);
});

test('TL column-major snake walks columns, reversing alternate columns', () => {
  // 2 cols × 3 rows: col 0 top→bottom, col 1 bottom→top.
  const order = gridCellOrder(2, 3, { startCorner: 'TL', axis: 'col', serpentine: true });
  assert.deepEqual(order, [[0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [1, 0]]);
});

test('BR start corner flips both the row and column directions', () => {
  // 3 cols × 2 rows, row-major snake from bottom-right:
  // outer rows bottom→top => row 1 then row 0; inner cols right→left first.
  const order = gridCellOrder(3, 2, { startCorner: 'BR', axis: 'row', serpentine: true });
  assert.deepEqual(order, [[2, 1], [1, 1], [0, 1], [0, 0], [1, 0], [2, 0]]);
});

test('a 16x16 matrix yields 256 unique cells', () => {
  const order = gridCellOrder(16, 16, DEFAULT_DISTRIBUTION);
  assert.equal(order.length, 256);
  assert.equal(new Set(order.map(([c, r]) => `${c},${r}`)).size, 256);
});

test('gridPoints maps a centered 2x2 grid to quadrant centres', () => {
  const tf = { x: 640, y: 360, w: 1280, h: 720, rotation: 0 };
  // index 1 = TL row-major line: order [0,0],[1,0],[0,1],[1,1]
  const pts = gridPoints(tf, 2, 2, 1, { w: 1280, h: 720 });
  const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  const expect = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  pts.forEach((p, i) => { approx(p[0], expect[i][0]); approx(p[1], expect[i][1]); });
});

test('gridPoints respects rotation (90° swaps the local axes)', () => {
  const tf = { x: 640, y: 360, w: 1280, h: 720, rotation: 90 };
  const pts = gridPoints(tf, 2, 2, 1, { w: 1280, h: 720 });
  // First cell local (-320,-180) rotated 90°: (x',y') = (x cos - y sin, x sin + y cos)
  // = (-(-180), -320) = (180, -320) → centre + → (820, 40) → (0.640625, 0.0555…)
  const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  approx(pts[0][0], (640 + 180) / 1280);
  approx(pts[0][1], (360 - 320) / 720);
});

test('isGridFixture detects rows>1 and grid mode', () => {
  assert.equal(isGridFixture({ rows: 16 }), true);
  assert.equal(isGridFixture({ rows: 1 }), false);
  assert.equal(isGridFixture({ input: { mode: 'grid' } }), true);
  assert.equal(isGridFixture({}), false);
});
