import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tentFixture, tentShow, CREST_Y, FEET_Y } from '../scripts/tent-remap.mjs';

test('a 2-point bar becomes a ∩ tent: feet on the floor, crest at top-centre', () => {
  const f = { pixelCount: 60, rows: 1, input: { mode: 'bar', samples: 60, transform: { x: 1 }, points: [[0.2, 0.5], [0.8, 0.5]] } };
  assert.equal(tentFixture(f), true);
  assert.equal(f.input.mode, 'polyline');
  assert.equal(f.input.samples, 60);                 // pixel count preserved
  assert.equal('transform' in f.input, false);       // bar transform dropped (polyline is canonical)
  assert.deepEqual(f.input.points, [[0.2, FEET_Y], [0.5, CREST_Y], [0.8, FEET_Y]]);
});

test('a plain bar (rows:1, cols:1) is NOT treated as a grid', () => {
  // regression: the guard once skipped on cols&&rows, which are 1 on every bar.
  const bar = { rows: 1, cols: 1, input: { points: [[0, 0.5], [1, 0.5]], samples: 2 } };
  assert.equal(tentFixture(bar), true);
});

test('grids and degenerate fixtures are skipped, unchanged', () => {
  const grid = { rows: 8, cols: 8, input: { mode: 'grid' } };
  assert.equal(tentFixture(grid), false);
  assert.equal(grid.input.mode, 'grid');
  assert.equal(tentFixture({ input: { points: [[0.5, 0.5]] } }), false);   // <2 points
  assert.equal(tentFixture({ input: {} }), false);                          // no points
  assert.equal(tentFixture({}), false);                                     // no input
});

test('a curved polyline tents by arc-length, keeping each point’s X', () => {
  const f = { pixelCount: 30, input: { mode: 'polyline', samples: 30, points: [[0.1, 0.4], [0.5, 0.5], [0.9, 0.4]] } };
  tentFixture(f);
  assert.deepEqual(f.input.points.map((p) => p[0]), [0.1, 0.5, 0.9]);   // X preserved
  assert.ok(Math.abs(f.input.points[0][1] - FEET_Y) < 1e-9);           // foot
  assert.ok(Math.abs(f.input.points[1][1] - CREST_Y) < 1e-9);          // crest at the middle
  assert.ok(Math.abs(f.input.points[2][1] - FEET_Y) < 1e-9);           // foot
});

test('a zero-length strip is skipped (no divide-by-zero)', () => {
  const f = { input: { points: [[0.5, 0.5], [0.5, 0.5]] } };
  assert.equal(tentFixture(f), false);
});

test('tentShow reports how many fixtures changed', () => {
  const show = { fixtures: [
    { rows: 1, input: { points: [[0, 0.5], [1, 0.5]], samples: 2 } },   // → tented
    { rows: 8, input: { mode: 'grid' } },                               // skipped (grid)
    { input: { points: [[0.5, 0.5]] } },                               // skipped (degenerate)
  ] };
  assert.deepEqual(tentShow(show), { changed: 1, total: 3 });
});
