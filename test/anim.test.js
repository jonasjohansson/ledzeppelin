import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animPhase, animatedValue, resolveParams, makeAnim, makeAudioAnim, makeDashboardAnim, specDurationMs } from '../src/model/anim.js';

test('dashboard anim maps a link value 0..1 into from..to, with invert', () => {
  const a = makeDashboardAnim(10, 20, 'd1');
  assert.equal(animatedValue(a, 0, { 'dash:d1': 0 }), 10);
  assert.equal(animatedValue(a, 0, { 'dash:d1': 1 }), 20);
  assert.equal(animatedValue(a, 0, { 'dash:d1': 0.5 }), 15);
  const inv = makeDashboardAnim(10, 20, 'd1', true);
  assert.equal(animatedValue(inv, 0, { 'dash:d1': 1 }), 10);   // inverted → 0 → from
  assert.equal(animatedValue(a, 0, {}), 10);                   // missing link → 0 → from
});

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

test('noise shape: deterministic, smooth, in-range coherent drift', () => {
  const mk = (o) => ({ mode: 'timeline', from: 0, to: 1, durationMs: 1000, shape: 'noise', seed: 42, octaves: 1, ...o });
  const a = mk();
  for (let t = 0; t < 20; t += 0.37) { const v = animatedValue(a, t, {}); assert.ok(v >= 0 && v <= 1, `in range @${t}: ${v}`); }
  assert.equal(animatedValue(a, 3.3, {}), animatedValue(a, 3.3, {}));            // deterministic
  const v1 = animatedValue(a, 5.0, {}), v2 = animatedValue(a, 5.02, {});
  assert.ok(Math.abs(v1 - v2) < 0.1, `smooth (no kinks): ${v1} vs ${v2}`);       // coherent, not steppy
  assert.notEqual(animatedValue(mk({ seed: 1 }), 4, {}), animatedValue(mk({ seed: 2 }), 4, {})); // seeds drift independently
  const fwd = animatedValue(mk(), 6.1, {}), revd = animatedValue(mk({ reverse: true }), 6.1, {});
  assert.ok(Math.abs((fwd + revd) - 1) < 1e-9, `reverse flips: ${fwd}+${revd}`);
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

test('makeAnim with beats marks the spec beat-synced; specDurationMs derives from bpm', () => {
  const a = makeAnim(0, 1, 1000, 'forward', 4);    // 4 beats
  assert.equal(a.beats, 4);
  assert.equal(specDurationMs(a, 120), 2000);      // 4 beats @ 120bpm = 2000ms
  assert.equal(specDurationMs(a, 60), 4000);       // tempo halves → loop doubles
  const plain = makeAnim(0, 1, 1500);              // no beats → fixed duration
  assert.equal(plain.beats, undefined);
  assert.equal(specDurationMs(plain, 120), 1500);
});

test('beat-synced timeline phase tracks bpm via signals.__bpm', () => {
  const a = makeAnim(0, 10, 1000, 'forward', 2);   // 2-beat loop
  // @120bpm a 2-beat loop = 1000ms; at t=0.5s that is half way → value 5.
  assert.ok(Math.abs(animatedValue(a, 0.5, { __bpm: 120 }) - 5) < 1e-6);
  // @60bpm a 2-beat loop = 2000ms; at t=0.5s that is a quarter → value 2.5.
  assert.ok(Math.abs(animatedValue(a, 0.5, { __bpm: 60 }) - 2.5) < 1e-6);
});

test('makeAudioAnim carries a source (default external)', () => {
  assert.equal(makeAudioAnim(0, 1).source, 'external');
  assert.equal(makeAudioAnim(0, 1, 'bass', 1, 'composition').source, 'composition');
  assert.equal(makeAudioAnim(0, 1, 'bass', 1, 'bogus').source, 'external');   // unknown → external
});

test('audio anim reads its namespaced per-source band', () => {
  const ext = makeAudioAnim(0, 10, 'bass', 1, 'external');
  const comp = makeAudioAnim(0, 10, 'bass', 1, 'composition');
  const signals = { 'external:bass': 0.2, 'composition:bass': 0.7, bass: 0.2 };
  assert.equal(animatedValue(ext, 0, signals), 2);    // external:bass = 0.2 → 2
  assert.equal(animatedValue(comp, 0, signals), 7);   // composition:bass = 0.7 → 7
});

test('audio anim falls back to the plain band when no namespaced key', () => {
  const spec = makeAudioAnim(0, 10, 'level', 1, 'composition');
  assert.equal(animatedValue(spec, 0, { level: 0.5 }), 5);   // only plain band present
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
