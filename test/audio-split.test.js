import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUDIO_BAND_SPLIT } from '../src/model/audio.js';

test('AUDIO_BAND_SPLIT matches the historical bass/mid/high boundaries', () => {
  assert.deepEqual(AUDIO_BAND_SPLIT.bass, [0, 0.10]);
  assert.deepEqual(AUDIO_BAND_SPLIT.mid, [0.10, 0.40]);
  assert.deepEqual(AUDIO_BAND_SPLIT.high, [0.40, 1]);
});

test('computeBands derives its ranges from AUDIO_BAND_SPLIT (no stray hard-coded 0.40)', () => {
  const src = readFileSync(new URL('../src/model/audio.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function computeBands'), src.indexOf('function computeBands') + 600);
  assert.match(body, /AUDIO_BAND_SPLIT/);           // uses the constant
  assert.doesNotMatch(body, /0\.40|0\.10/);          // no leftover magic boundaries
});
