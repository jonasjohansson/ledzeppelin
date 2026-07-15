import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChannelBands } from '../server/audio-capture.js';

// Interleaved f32le buffer: `gen(ch, i) → sample` over `frames` frames × `channels`.
function pcm(channels, frames, gen) {
  const buf = Buffer.alloc(frames * channels * 4);
  for (let f = 0; f < frames; f++) for (let c = 0; c < channels; c++) buf.writeFloatLE(gen(c, f), (f * channels + c) * 4);
  return buf;
}

test('a 100Hz tone on channel 3 registers as BASS on channel 3 only', () => {
  const dsp = createChannelBands(10, 48000, 1024);
  const sine = (f) => 0.5 * Math.sin(2 * Math.PI * 100 * f / 48000);
  for (let k = 0; k < 8; k++) dsp.push(pcm(10, 1024, (c, f) => (c === 2 ? sine(k * 1024 + f) : 0)));
  assert.ok(dsp.bands[2].bass > 0.2, `ch3 bass ${dsp.bands[2].bass}`);
  assert.ok(dsp.bands[2].level > 0.2, `ch3 level ${dsp.bands[2].level}`);
  assert.ok(dsp.bands[2].bass > dsp.bands[2].high * 3, 'bass dominates a 100Hz tone');
  for (const c of [0, 1, 3, 9]) assert.ok(dsp.bands[c].level < 0.02, `ch${c + 1} stays silent`);
});

test('an 8kHz tone reads as HIGH, not bass', () => {
  const dsp = createChannelBands(2, 48000, 1024);
  const sine = (f) => 0.5 * Math.sin(2 * Math.PI * 8000 * f / 48000);
  for (let k = 0; k < 8; k++) dsp.push(pcm(2, 1024, (c, f) => (c === 0 ? sine(k * 1024 + f) : 0)));
  assert.ok(dsp.bands[0].high > 0.2, `high ${dsp.bands[0].high}`);
  assert.ok(dsp.bands[0].high > dsp.bands[0].bass * 3, 'high dominates an 8kHz tone');
});

test('chunk boundaries that split a frame do not corrupt channels', () => {
  const dsp = createChannelBands(4, 48000, 256);
  const whole = pcm(4, 1024, (c, f) => (c === 1 ? 0.5 * Math.sin(2 * Math.PI * 440 * f / 48000) : 0));
  // push in awkward 37-byte slices (frames are 16 bytes — every push misaligns)
  for (let off = 0; off < whole.length; off += 37) dsp.push(whole.subarray(off, Math.min(off + 37, whole.length)));
  assert.ok(dsp.bands[1].level > 0.2, 'signal lands on ch2');
  assert.ok(dsp.bands[0].level < 0.02 && dsp.bands[2].level < 0.02, 'no bleed to neighbours');
});
