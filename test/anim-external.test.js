import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animatedValue, resolveParams, makeExternalAnim } from '../src/model/anim.js';

test('external anim maps a channel (×gain, clamped) onto from..to', () => {
  const spec = makeExternalAnim(0, 10, '/fader1', 2);
  assert.equal(animatedValue(spec, 0, { '/fader1': 0 }), 0);
  assert.equal(animatedValue(spec, 0, { '/fader1': 0.25 }), 5);   // 0.25*2 = 0.5 → 5
  assert.equal(animatedValue(spec, 0, { '/fader1': 0.9 }), 10);   // 1.8 clamps to 1 → 10
  assert.equal(animatedValue(spec, 0, { '/fader1': -0.5 }), 0);   // clamps below 0
  assert.equal(animatedValue(spec, 0, {}), 0);                    // channel never seen → from
  assert.equal(animatedValue(spec, 0, undefined), 0);             // no signals at all
});

test('external anim works on an inverted range (from > to)', () => {
  const spec = makeExternalAnim(10, 0, 'sensor/1', 1);
  assert.equal(animatedValue(spec, 0, { 'sensor/1': 0.5 }), 5);
  assert.equal(animatedValue(spec, 0, { 'sensor/1': 1 }), 0);
});

test('resolveParams handles external specs against the merged signals map', () => {
  const params = { 'hue.shift': 0, 'line.width': 0.08 };
  const anim = { 'hue.shift': makeExternalAnim(0, 1, '/test/fader', 1) };
  // Signals merge audio bands + external channels; external reads its channel.
  const out = resolveParams(params, anim, 0, { level: 0.9, '/test/fader': 0.66 });
  assert.ok(Math.abs(out['hue.shift'] - 0.66) < 1e-9);
  assert.equal(out['line.width'], 0.08);   // untouched
});
