import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animPhase, animatedValue, resolveParams, makeAnim, makeAudioAnim } from '../src/model/anim.js';

test('animPhase forward wraps 0..1 over the duration', () => {
  assert.equal(animPhase(0, 4000, 'forward'), 0);
  assert.ok(Math.abs(animPhase(1, 4000, 'forward') - 0.25) < 1e-9);
  assert.ok(Math.abs(animPhase(2, 4000, 'forward') - 0.5) < 1e-9);
  assert.equal(animPhase(4, 4000, 'forward'), 0); // wrapped
});

test('animPhase backward is the forward complement', () => {
  assert.ok(Math.abs(animPhase(1, 4000, 'backward') - 0.75) < 1e-9);
  assert.equal(animPhase(0, 4000, 'backward'), 1);
});

test('animPhase mirror is a triangle (0→1→0)', () => {
  assert.ok(Math.abs(animPhase(0, 4000, 'mirror') - 0) < 1e-9);
  assert.ok(Math.abs(animPhase(2, 4000, 'mirror') - 1) < 1e-9);  // half-way → peak
  assert.ok(Math.abs(animPhase(4, 4000, 'mirror') - 0) < 1e-9);  // full → back to start
});

test('animPhase with zero duration is static 0', () => {
  assert.equal(animPhase(3, 0, 'forward'), 0);
});

test('animatedValue lerps from..to by phase', () => {
  const spec = makeAnim(10, 20, 4000, 'forward');
  assert.equal(animatedValue(spec, 0), 10);
  assert.ok(Math.abs(animatedValue(spec, 2) - 15) < 1e-9);  // phase 0.5
});

test('resolveParams overrides only animated keys, passes the rest through', () => {
  const params = { 'line.pos': 0.5, 'line.width': 0.08 };
  const anim = { 'line.pos': makeAnim(0, 1, 4000, 'forward') };
  const out = resolveParams(params, anim, 2); // phase 0.5 → pos 0.5
  assert.ok(Math.abs(out['line.pos'] - 0.5) < 1e-9);
  assert.equal(out['line.width'], 0.08);       // untouched
  assert.notEqual(out, params);                // new object
});

test('resolveParams returns the same reference when there are no animations', () => {
  const params = { a: 1 };
  assert.equal(resolveParams(params, undefined, 0), params);
  assert.equal(resolveParams(params, {}, 0), params);
});

test('audio anim maps a band (×gain, clamped) onto from..to', () => {
  const spec = makeAudioAnim(0, 10, 'bass', 2);
  assert.equal(animatedValue(spec, 0, { bass: 0 }), 0);
  assert.equal(animatedValue(spec, 0, { bass: 0.25 }), 5);   // 0.25*2 = 0.5 → 5
  assert.equal(animatedValue(spec, 0, { bass: 0.9 }), 10);   // 1.8 clamps to 1 → 10
  assert.equal(animatedValue(spec, 0, {}), 0);               // missing band → 0
});

test('resolveParams handles audio specs', () => {
  const params = { 'hue.shift': 0 };
  const anim = { 'hue.shift': makeAudioAnim(0, 1, 'level', 1) };
  const out = resolveParams(params, anim, 0, { level: 0.4 });
  assert.ok(Math.abs(out['hue.shift'] - 0.4) < 1e-9);
});

// --- retimeAnim: direction/duration edits continue from the current value ---
import { retimeAnim } from '../src/model/anim.js';

const valAt = (spec, t) => animatedValue(spec, t, {});

test('retimeAnim keeps the value continuous when reversing direction', () => {
  const spec = makeAnim(0, 10, 4000, 'forward');
  const t = 1.3;                                     // mid-sweep
  const before = valAt(spec, t);
  const next = retimeAnim(spec, { ...spec, direction: 'backward' }, t);
  assert.ok(Math.abs(valAt(next, t) - before) < 1e-9);
  // and it now travels DOWN from there
  assert.ok(valAt(next, t + 0.01) < before);
});

test('retimeAnim keeps the value continuous switching to mirror, preserving travel', () => {
  const spec = makeAnim(0, 10, 4000, 'forward');
  const t = 0.9;
  const before = valAt(spec, t);
  const next = retimeAnim(spec, { ...spec, direction: 'mirror' }, t);
  assert.ok(Math.abs(valAt(next, t) - before) < 1e-9);
  assert.ok(valAt(next, t + 0.01) > before);         // forward was rising → still rising
});

test('retimeAnim keeps the value continuous on a duration change', () => {
  const spec = makeAnim(0, 10, 4000, 'forward');
  const t = 2.5;
  const before = valAt(spec, t);
  const next = retimeAnim(spec, { ...spec, durationMs: 12000 }, t);
  assert.ok(Math.abs(valAt(next, t) - before) < 1e-9);
});

test('retimeAnim passes non-timeline specs through', () => {
  const a = makeAudioAnim(0, 1, 'bass', 1);
  assert.equal(retimeAnim(a, a, 5), a);
});
