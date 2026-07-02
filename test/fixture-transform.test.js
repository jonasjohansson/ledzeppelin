import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointsFromTransform, transformFromPoints, syncFixtureGeometry,
  syncShowFixtures, setFixtureTransform, isPolylineFixture,
  setFixtureVertex, addFixtureVertex, removeFixtureVertex,
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

test('pointsFromTransform: a matrix (grid) does NOT aspect-flip when h > w', () => {
  // A strip taller than wide flips vertical (+90); a grid must NOT — its rotation is
  // explicit, so a near-square matrix doesn't jump ±90 while rotating (issue #3).
  const strip = pointsFromTransform({ x: 500, y: 250, w: 200, h: 400, rotation: 0 }, CANVAS);
  assert.ok(Math.abs(strip[0][0] - 0.5) < 1e-9, 'strip flips vertical');   // runs vertically
  const grid = pointsFromTransform({ x: 500, y: 250, w: 200, h: 400, rotation: 0 }, CANVAS, true);
  // grid: centreline runs along WIDTH (horizontal) at rotation 0 — v stays 0.5
  assert.ok(Math.abs(grid[0][1] - 0.5) < 1e-9 && Math.abs(grid[1][1] - 0.5) < 1e-9, 'grid stays horizontal');
  // and honours rotation directly (no +90): 90° → vertical, centred on x
  const rot = pointsFromTransform({ x: 500, y: 250, w: 200, h: 400, rotation: 90 }, CANVAS, true);
  assert.ok(Math.abs(rot[0][0] - 0.5) < 1e-9 && Math.abs(rot[1][0] - 0.5) < 1e-9);
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

// --- polyline (bendable, multi-segment) fixtures ---
test('syncFixtureGeometry preserves a polyline (>2 points) instead of collapsing to a bar', () => {
  const bent = [[0.1, 0.5], [0.5, 0.2], [0.9, 0.5]];
  const f = { id: 'f1', input: { points: bent, samples: 30 } };
  const out = syncFixtureGeometry(f, CANVAS);
  assert.equal(out.input.mode, 'polyline');
  assert.equal(out.input.transform, undefined);          // polyline is canonical — no transform
  assert.deepEqual(out.input.points, bent);              // all bends kept
  assert.equal(out.input.samples, 30);
  assert.ok(isPolylineFixture(out.input));
});

test('syncFixtureGeometry on a polyline is idempotent', () => {
  const f = { id: 'f1', input: { mode: 'polyline', points: [[0.1, 0.5], [0.5, 0.2], [0.9, 0.5]], samples: 9 } };
  const once = syncFixtureGeometry(f, CANVAS);
  const twice = syncFixtureGeometry(once, CANVAS);
  assert.deepEqual(twice, once);
});

test('addFixtureVertex turns a bar into a 3-point polyline (a bend)', () => {
  let show = { composition: { canvas: CANVAS }, fixtures: [{ id: 'f1', input: { points: [[0.1, 0.5], [0.9, 0.5]], samples: 4 } }] };
  show = syncShowFixtures(show);                          // f1 starts as a bar
  const next = addFixtureVertex(show, 'f1', 0, [0.5, 0.1]);
  const inp = next.fixtures[0].input;
  assert.equal(inp.mode, 'polyline');
  assert.equal(inp.points.length, 3);
  assert.deepEqual(inp.points[1], [0.5, 0.1]);           // inserted mid-vertex
});

test('setFixtureVertex moves one vertex (unclamped — may go off-canvas)', () => {
  const show = { composition: { canvas: CANVAS }, fixtures: [{ id: 'f1', input: { mode: 'polyline', points: [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]], samples: 6 } }] };
  const next = setFixtureVertex(show, 'f1', 1, 0.4, 1.7);
  assert.deepEqual(next.fixtures[0].input.points[1], [0.4, 1.7]); // off-canvas allowed (samples black)
});

test('removeFixtureVertex drops a bend; at two points it reverts to a bar', () => {
  let show = { composition: { canvas: CANVAS }, fixtures: [{ id: 'f1', input: { mode: 'polyline', points: [[0.1, 0.5], [0.5, 0.2], [0.9, 0.5]], samples: 6 } }] };
  const next = removeFixtureVertex(show, 'f1', 1);
  assert.equal(next.fixtures[0].input.points.length, 2);
  assert.equal(next.fixtures[0].input.mode, 'bar');
  assert.ok(next.fixtures[0].input.transform);           // bar transform restored
});

// --- 3D mapping: preserve a z coordinate on 3-tuple points ---
test('syncFixtureGeometry preserves z on a 3-tuple polyline (does not drop to 2D)', () => {
  const bent3d = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
  const f = { id: 'f1', input: { mode: 'polyline', points: bent3d, samples: 20 } };
  const out = syncFixtureGeometry(f, CANVAS);
  assert.equal(out.input.mode, 'polyline');
  assert.deepEqual(out.input.points, bent3d);            // z intact through the sync path
});

test('syncFixtureGeometry leaves a 2-tuple fixture untouched (no spurious z)', () => {
  const f = { id: 'f1', input: { mode: 'polyline', points: [[0.1, 0.5], [0.5, 0.2], [0.9, 0.5]], samples: 9 } };
  const out = syncFixtureGeometry(f, CANVAS);
  assert.deepEqual(out.input.points, [[0.1, 0.5], [0.5, 0.2], [0.9, 0.5]]);
  for (const p of out.input.points) assert.equal(p.length, 2);  // still 2-tuples
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

test('normPts promotes the WHOLE polyline to 3-tuples once any vertex has z', () => {
  // Mixed dimensionality (a 2D midpoint inserted into a 3D run) must normalize to
  // consistent 3-tuples (missing z → 0), not a per-point 2/3 split.
  const mixed = [[0.1, 0.5], [0.5, 0.2, 0.3], [0.9, 0.5]];
  const f = { id: 'f1', input: { mode: 'polyline', points: mixed, samples: 9 } };
  const out = syncFixtureGeometry(f, CANVAS);
  assert.deepEqual(out.input.points, [[0.1, 0.5, 0], [0.5, 0.2, 0.3], [0.9, 0.5, 0]]);
  for (const p of out.input.points) assert.equal(p.length, 3);
});
