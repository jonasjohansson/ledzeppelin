import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipTriggers } from '../src/model/clip-triggers.js';

const bpmClip = (division = 1) => ({ id: 'c1', audioTrigger: { enabled: true, mode: 'bpm', division } });

test('bpm trigger fires on the beat grid (120bpm, div=1 → ~every 0.5s), no fire on arm', () => {
  const ct = createClipTriggers();
  const band = () => 0;
  const poll = (sec) => ct.poll([bpmClip(1)], band, sec * 1000, sec, 120);
  assert.deepEqual(poll(0), [], 'arms silently on first poll');
  assert.deepEqual(poll(0.4), [], 'within the first beat: no fire');
  assert.deepEqual(poll(0.6), ['c1'], 'crossing beat 1 fires');
  assert.deepEqual(poll(0.9), [], 'still beat 1: no fire');
  assert.deepEqual(poll(1.1), ['c1'], 'crossing beat 2 fires');
});

test('bpm division scales the grid (div=2 → every 2 beats = 1s at 120bpm)', () => {
  const ct = createClipTriggers();
  const poll = (sec) => ct.poll([bpmClip(2)], () => 0, sec * 1000, sec, 120);
  poll(0);
  assert.deepEqual(poll(0.6), [], 'half a bar in: no fire yet');
  assert.deepEqual(poll(1.1), ['c1'], 'after 2 beats: fires');
});

test('disabled or non-bpm clips are unaffected by the bpm path', () => {
  const ct = createClipTriggers();
  const off = { id: 'x', audioTrigger: { enabled: false, mode: 'bpm', division: 1 } };
  assert.deepEqual(ct.poll([off], () => 0, 1000, 1, 120), []);
});
