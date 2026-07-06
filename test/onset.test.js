import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOnsetDetector } from '../src/model/onset.js';

// Feed a value stream at 60fps (dt≈16.7ms). Count fires.
function run(det, values, dtMs = 1000 / 60) {
  let fires = 0, tMs = 0;
  for (const v of values) { if (det.push(v, tMs)) fires++; tMs += dtMs; }
  return fires;
}

test('fires once on a rising spike above the running average', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  const vals = [...Array(30).fill(0.1), 0.9, ...Array(30).fill(0.1)];
  assert.equal(run(det, vals), 1);
});

test('refractory window suppresses a second fire that is too soon', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 200, floor: 0.05 });
  const vals = [...Array(30).fill(0.1), 0.9, 0.1, 0.1, 0.9, ...Array(30).fill(0.1)];
  assert.equal(run(det, vals), 1);
});

test('two spikes spaced beyond the refractory both fire', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  const gap = Array(30).fill(0.1);
  const vals = [...gap, 0.9, ...gap, 0.9, ...gap];
  assert.equal(run(det, vals), 2);
});

test('steady loud signal does not keep firing (only the initial rise)', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  const vals = [...Array(10).fill(0.1), ...Array(40).fill(0.8)];
  assert.equal(run(det, vals), 1);
});

test('signal below the noise floor never fires', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.2 });
  const vals = [...Array(20).fill(0.02), 0.15, ...Array(20).fill(0.02)];
  assert.equal(run(det, vals), 0);
});

test('reset() clears the EMA and refractory state', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  run(det, [...Array(30).fill(0.1), 0.9]);
  det.reset();
  assert.equal(run(det, [...Array(30).fill(0.1), 0.9]), 1);
});

test('non-finite input never fires and does not corrupt the EMA', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  // Settle quiet, interleave NaN/undefined garbage, then a real spike must still fire once.
  const vals = [...Array(30).fill(0.1), NaN, undefined, NaN, 0.1, undefined, 0.9, ...Array(30).fill(0.1)];
  assert.equal(run(det, vals), 1);
});

test('out-of-range opts are clamped (floor→1 means a 0.9 spike never fires)', () => {
  const det = createOnsetDetector({ sensitivity: 99, refractoryMs: -5, floor: 2, attack: 5 });
  const vals = [...Array(30).fill(0.1), 0.9, ...Array(30).fill(0.1)];
  assert.equal(run(det, vals), 0);
});
