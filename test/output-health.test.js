import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSendError, getDeviceOutputHealth } from '../server/output.js';

// recordSendError is the per-ip record hook that udpSend's error callback funnels
// through; getDeviceOutputHealth is what /api/health exposes. Drive them with an
// explicit `now` so the assertions are deterministic (no wall-clock flakiness).

test('per-ip tracking: distinct IPs accumulate independently', () => {
  recordSendError('10.0.0.1', 'EHOSTUNREACH', 1000);
  recordSendError('10.0.0.1', 'EHOSTUNREACH', 1100);
  recordSendError('10.0.0.2', 'ENETUNREACH', 1200);

  const h = getDeviceOutputHealth();
  assert.equal(h['10.0.0.1'].sendErrors, 2);
  assert.equal(h['10.0.0.1'].lastError, 'EHOSTUNREACH');
  assert.equal(h['10.0.0.2'].sendErrors, 1);
  assert.equal(h['10.0.0.2'].lastError, 'ENETUNREACH');
  // An IP that never failed is absent from the sparse map.
  assert.equal(h['10.0.0.9'], undefined);
});

test('log throttle is PER IP (2s window), not global', () => {
  // First error on a fresh ip → log window open.
  assert.equal(recordSendError('10.0.1.1', 'x', 5000), true);
  // Same ip 1s later → still throttled.
  assert.equal(recordSendError('10.0.1.1', 'x', 6000), false);
  // Same ip >2s later → window reopens.
  assert.equal(recordSendError('10.0.1.1', 'x', 7100), true);

  // A DIFFERENT ip failing in the same window is NOT masked — it logs its own line.
  // (This is the whole point: the old single global throttle hid this second device.)
  assert.equal(recordSendError('10.0.1.2', 'y', 6100), true);
});

test('lastErrorMsAgo is derived from now at read time and lastMsg is the newest', () => {
  recordSendError('10.0.2.1', 'first', 1000);
  recordSendError('10.0.2.1', 'latest', 2000);
  const h = getDeviceOutputHealth();
  assert.equal(h['10.0.2.1'].lastError, 'latest');
  // lastAt was 2000; lastErrorMsAgo = Date.now() - 2000, so it's large and positive.
  assert.ok(h['10.0.2.1'].lastErrorMsAgo > 0);
});
