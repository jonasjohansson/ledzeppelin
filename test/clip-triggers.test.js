import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipTriggers } from '../src/model/clip-triggers.js';

// A band sampler that returns a spike for a chosen band at chosen frames.
function bands(map) { return (name) => map[name] ?? 0; }

test('two clips on different bands fire independently', () => {
  const ct = createClipTriggers();
  const clips = [
    { id: 'a', audioTrigger: { enabled: true, band: 'bass', sensitivity: 0.5, refractoryMs: 100 } },
    { id: 'b', audioTrigger: { enabled: true, band: 'high', sensitivity: 0.5, refractoryMs: 100 } },
  ];
  let ms = 0, sec = 0;
  const step = (bassV, highV) => { const f = ct.poll(clips, bands({ bass: bassV, high: highV }), ms, sec); ms += 16.7; sec += 0.0167; return f; };
  for (let i = 0; i < 30; i++) step(0.1, 0.1);       // settle both EMAs
  const f1 = step(0.9, 0.1);                          // bass spike → only 'a'
  assert.deepEqual(f1, ['a']);
  for (let i = 0; i < 30; i++) step(0.1, 0.1);
  const f2 = step(0.1, 0.9);                          // high spike → only 'b'
  assert.deepEqual(f2, ['b']);
  assert.equal(ct.trigsFor('a').length, 1);
  assert.equal(ct.trigsFor('b').length, 1);
});

test('enabled:false never fires; missing audioTrigger never fires', () => {
  const ct = createClipTriggers();
  const clips = [{ id: 'a', audioTrigger: { enabled: false, band: 'bass' } }, { id: 'b' }];
  let ms = 0;
  for (let i = 0; i < 40; i++) { assert.deepEqual(ct.poll(clips, bands({ bass: 0.9 }), ms, ms / 1000), []); ms += 16.7; }
  assert.equal(ct.trigsFor('a').length, 0);
});

test('fire() pushes a manual trigger onto the clip bus (cap 8)', () => {
  const ct = createClipTriggers();
  for (let i = 0; i < 10; i++) ct.fire('a', i);
  const b = ct.trigsFor('a');
  assert.equal(b.length, 8);
  assert.deepEqual(b, [2, 3, 4, 5, 6, 7, 8, 9]);      // newest 8, oldest dropped
});

test('changing a clip tuning rebuilds its detector without touching other clips', () => {
  const ct = createClipTriggers();
  ct.fire('other', 1);                                // give 'other' a bus entry
  const clips = [{ id: 'a', audioTrigger: { enabled: true, band: 'bass', sensitivity: 0.5, refractoryMs: 100 } }];
  let ms = 0; const step = (v) => { const f = ct.poll(clips, bands({ bass: v }), ms, ms / 1000); ms += 16.7; return f; };
  for (let i = 0; i < 30; i++) step(0.1);
  clips[0].audioTrigger.sensitivity = 2;              // retune → detector rebuilds, EMA cold
  step(0.1);
  assert.equal(ct.trigsFor('other').length, 1);       // unrelated bus intact
});

test('a level-mode clip fires via the gate, independent of an onset clip', () => {
  const ct = createClipTriggers();
  const clips = [{ id: 'lv', audioTrigger: { enabled: true, band: 'bass', mode: 'level', threshold: 0.5, refractoryMs: 0 } }];
  let ms = 0;
  const step = (v) => { const f = ct.poll(clips, bands({ bass: v }), ms, ms / 1000); ms += 16.7; return f; };
  assert.deepEqual(step(0.2), []);      // below threshold
  assert.deepEqual(step(0.7), ['lv']);  // crosses → fire
  assert.deepEqual(step(0.8), []);      // held above → no re-fire
  assert.deepEqual(step(0.1), []);      // drop (re-arm, no fire on a fall)
  assert.deepEqual(step(0.7), ['lv']);  // next cross fires
});

test('prune drops buses + detectors for dead clips', () => {
  const ct = createClipTriggers();
  ct.fire('a', 1); ct.fire('b', 1);
  ct.prune(['a']);
  assert.equal(ct.trigsFor('a').length, 1);
  assert.equal(ct.trigsFor('b').length, 0);
});
