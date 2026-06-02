import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointsFromTransform, transformFromPoints, syncFixtureGeometry,
  syncShowFixtures, setFixtureTransform,
} from '../src/model/fixture-transform.js';

const CANVAS = { w: 1000, h: 500 };

test('pointsFromTransform: horizontal strip centred', () => {
  const pts = pointsFromTransform({ x: 500, y: 250, w: 800, h: 8, rotation: 0 }, CANVAS);
  // centre (0.5,0.5); ends at ±400px → x 100..900 → u 0.1..0.9
  assert.deepEqual(pts[0], [0.1, 0.5]);
  assert.deepEqual(pts[1], [0.9, 0.5]);
});

test('pointsFromTransform: 90° rotation runs vertically', () => {
  const pts = pointsFromTransform({ x: 500, y: 250, w: 250, h: 8, rotation: 90 }, CANVAS);
  // dy = ±125px → v 0.5 ± 0.25 ; u stays 0.5
  assert.ok(Math.abs(pts[0][0] - 0.5) < 1e-9 && Math.abs(pts[1][0] - 0.5) < 1e-9);
  assert.ok(Math.abs(pts[0][1] - 0.25) < 1e-9);
  assert.ok(Math.abs(pts[1][1] - 0.75) < 1e-9);
});

test('transformFromPoints round-trips a horizontal strip', () => {
  const t = transformFromPoints([[0.1, 0.5], [0.9, 0.5]], CANVAS);
  assert.equal(t.x, 500);
  assert.equal(t.y, 250);
  assert.equal(t.w, 800);
  assert.equal(t.rotation, 0);
});

test('syncFixtureGeometry migrates a points-only fixture to a transform + cache', () => {
  const f = { id: 'f1', input: { points: [[0.1, 0.5], [0.9, 0.5]], samples: 10 } };
  const out = syncFixtureGeometry(f, CANVAS);
  assert.ok(out.input.transform);
  assert.equal(out.input.transform.w, 800);
  assert.equal(out.input.samples, 10);          // unrelated fields preserved
  assert.deepEqual(out.input.points[0], [0.1, 0.5]);
});

test('syncFixtureGeometry is idempotent', () => {
  const f = { id: 'f1', input: { points: [[0.2, 0.4], [0.8, 0.6]], samples: 5 } };
  const once = syncFixtureGeometry(f, CANVAS);
  const twice = syncFixtureGeometry(once, CANVAS);
  assert.deepEqual(twice, once);
});

test('setFixtureTransform patches one fixture and recomputes its points', () => {
  let show = {
    composition: { canvas: CANVAS },
    fixtures: [
      { id: 'f1', input: { points: [[0.1, 0.5], [0.9, 0.5]], samples: 4 } },
      { id: 'f2', input: { points: [[0.1, 0.2], [0.9, 0.2]], samples: 4 } },
    ],
  };
  show = syncShowFixtures(show);
  const next = setFixtureTransform(show, 'f1', { rotation: 90, w: 250, x: 500, y: 250 });
  // f1 became vertical
  const p = next.fixtures[0].input.points;
  assert.ok(Math.abs(p[0][0] - 0.5) < 1e-9 && Math.abs(p[1][0] - 0.5) < 1e-9);
  // f2 untouched
  assert.deepEqual(next.fixtures[1].input.points, show.fixtures[1].input.points);
});

test('syncShowFixtures recomputes points when the canvas changes', () => {
  let show = {
    composition: { canvas: CANVAS },
    fixtures: [{ id: 'f1', input: { points: [[0.1, 0.5], [0.9, 0.5]], samples: 4 } }],
  };
  show = syncShowFixtures(show);          // transform.x=500 at 1000-wide canvas
  const wide = { ...show, composition: { canvas: { w: 2000, h: 500 } } };
  const out = syncShowFixtures(wide);
  // same pixel centre (500) on a 2000-wide canvas → u 0.25
  assert.ok(Math.abs(out.fixtures[0].input.points[0][0] - (500 - 400) / 2000) < 1e-9);
});
