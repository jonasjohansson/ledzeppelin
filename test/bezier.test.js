import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalQuadratic, bezierToPoints, isBezierFixture } from '../src/model/bezier.js';

test('evalQuadratic: endpoints are exact (no float drift at t=0/1)', () => {
  const pts = evalQuadratic([0.1, 0.5], [0.5, 0.1], [0.9, 0.5], 8);
  assert.equal(pts.length, 9);                       // n segments → n+1 points
  assert.deepEqual(pts[0], [0.1, 0.5]);
  assert.deepEqual(pts[8], [0.9, 0.5]);
});

test('evalQuadratic: midpoint equals the quadratic at t = 0.5', () => {
  const p0 = [0, 0], c = [1, 2], p1 = [2, 0];
  const pts = evalQuadratic(p0, c, p1, 8);
  // B(0.5) = 0.25·p0 + 0.5·c + 0.25·p1
  assert.ok(Math.abs(pts[4][0] - 1) < 1e-12);
  assert.ok(Math.abs(pts[4][1] - 1) < 1e-12);
});

test('evalQuadratic: symmetric control → a symmetric arch (3D mid-lift)', () => {
  // Ends flat on the plane, the control pulled straight up between them: the
  // arch must mirror about its apex, in x AND z.
  const pts = evalQuadratic([0.2, 0.5, 0], [0.5, 0.5, 0.6], [0.8, 0.5, 0], 10);
  for (let k = 0; k <= 10; k++) {
    const a = pts[k], b = pts[10 - k];
    assert.ok(Math.abs((a[0] - 0.5) + (b[0] - 0.5)) < 1e-12, `x mirrors at k=${k}`);
    assert.ok(Math.abs(a[2] - b[2]) < 1e-12, `z mirrors at k=${k}`);
  }
  assert.equal(pts[5][2], 0.3);                      // apex z = c.z / 2 for a flat-ended arch
});

test('evalQuadratic: all-2D input stays 2-tuples; any z promotes to 3-tuples', () => {
  for (const p of evalQuadratic([0, 0], [1, 1], [2, 0], 4)) assert.equal(p.length, 2);
  // z only on the CONTROL still lifts the curve (ends stay planted).
  const pts = evalQuadratic([0, 0], [1, 0, 0.4], [2, 0], 4);
  for (const p of pts) assert.equal(p.length, 3);
  assert.equal(pts[0][2], 0);
  assert.ok(pts[2][2] > 0);
});

test('bezierToPoints: evaluates ends = points[0]/[last] through input.bezier.c', () => {
  const input = { mode: 'bezier', points: [[0.1, 0.5], [0.9, 0.5]], bezier: { c: [0.5, 0.1] } };
  const pts = bezierToPoints(input, 4);
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0], [0.1, 0.5]);
  assert.deepEqual(pts[4], [0.9, 0.5]);
  assert.ok(pts[2][1] < 0.5);                        // pulled toward the control
  assert.equal(bezierToPoints(input).length, 25);    // default 24 segments
});

test('bezierToPoints: a missing control falls back to the chord midpoint (≈ straight)', () => {
  const input = { mode: 'bezier', points: [[0, 0], [1, 1]] };
  const pts = bezierToPoints(input, 4);
  assert.ok(Math.abs(pts[2][0] - 0.5) < 1e-12 && Math.abs(pts[2][1] - 0.5) < 1e-12);
});

test('isBezierFixture: mode flag + ≥2 points', () => {
  assert.equal(isBezierFixture({ mode: 'bezier', points: [[0, 0], [1, 1]], bezier: { c: [0.5, 0] } }), true);
  assert.equal(isBezierFixture({ mode: 'bezier', points: [[0, 0]] }), false);
  assert.equal(isBezierFixture({ mode: 'polyline', points: [[0, 0], [1, 1]] }), false);
  assert.equal(isBezierFixture(undefined), false);
});
