import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setBlackout, getBlackout, blackoutGain, BLACKOUT_FADE_MS,
  setBrightnessOverride, getBrightnessOverrides,
} from '../server/output.js';

test('blackout defaults OFF with full gain (existing users unaffected)', () => {
  assert.equal(getBlackout(), false);
  assert.equal(blackoutGain(Date.now()), 1);
});

test('blackout fades 1→0 over BLACKOUT_FADE_MS and back up when cleared', () => {
  const t0 = Date.now();
  assert.equal(setBlackout(true), true);
  assert.equal(getBlackout(), true);
  // Mid-fade (~half) — the toggle timestamped ≈ t0, so probe relative to it.
  const mid = blackoutGain(t0 + BLACKOUT_FADE_MS / 2);
  assert.ok(mid > 0.2 && mid < 0.8, `mid-fade gain ${mid}`);
  assert.equal(blackoutGain(t0 + BLACKOUT_FADE_MS + 50), 0);   // fully dark
  assert.equal(setBlackout(false), false);
  const t1 = Date.now();
  const back = blackoutGain(t1 + BLACKOUT_FADE_MS / 2);
  assert.ok(back > 0.2, `fade-back gain ${back}`);
  assert.equal(blackoutGain(t1 + BLACKOUT_FADE_MS + 50), 1);   // fully restored
});

test('setBlackout is idempotent (re-asserting does not restart the fade)', () => {
  const t0 = Date.now();
  setBlackout(true);
  setBlackout(true);   // no-op — must not reset blackoutAt
  assert.equal(blackoutGain(t0 + BLACKOUT_FADE_MS + 50), 0);
  setBlackout(false);
});

test('brightness override: clamped 0..1, null clears, listed per ip', () => {
  assert.deepEqual(getBrightnessOverrides(), {});
  assert.equal(setBrightnessOverride('10.0.0.21', 0.4), 0.4);
  assert.equal(setBrightnessOverride('10.0.0.22', 7), 1);      // clamp
  assert.equal(setBrightnessOverride('10.0.0.23', -1), 0);     // clamp
  assert.deepEqual(getBrightnessOverrides(), { '10.0.0.21': 0.4, '10.0.0.22': 1, '10.0.0.23': 0 });
  assert.equal(setBrightnessOverride('10.0.0.21', null), null);
  assert.equal(getBrightnessOverrides()['10.0.0.21'], undefined);
  setBrightnessOverride('10.0.0.22', null);
  setBrightnessOverride('10.0.0.23', null);
});
