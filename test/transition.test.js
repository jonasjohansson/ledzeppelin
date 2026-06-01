import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitionProgress } from '../src/engine/compositor.js';

// transitionProgress(timeSec, startT, transitionMs) → clamped [0,1].
// transitionMs is in MILLISECONDS; time args are in SECONDS.

test('transitionMs <= 0 is instant (progress 1)', () => {
  assert.equal(transitionProgress(0, 0, 0), 1);
  assert.equal(transitionProgress(5, 5, -100), 1);
});

test('progress is 0 at start, ramps linearly, clamps at 1', () => {
  // 500ms = 0.5s window starting at t=10.
  assert.equal(transitionProgress(10, 10, 500), 0);     // start
  assert.equal(transitionProgress(10.25, 10, 500), 0.5); // halfway
  assert.equal(transitionProgress(10.5, 10, 500), 1);    // end
  assert.equal(transitionProgress(20, 10, 500), 1);      // past end clamps
});

test('progress clamps to 0 if time precedes start', () => {
  assert.equal(transitionProgress(9, 10, 500), 0);
});
