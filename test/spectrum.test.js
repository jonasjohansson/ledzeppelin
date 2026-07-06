import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandRegions, barHeights, thresholdY, yToThreshold } from '../src/ui/spectrum.js';

const SPLIT = { bass: [0, 0.10], mid: [0.10, 0.40], high: [0.40, 1] };

test('bandRegions maps the split to ordered, gapless pixel spans covering the width', () => {
  const r = bandRegions(SPLIT, 200);
  assert.deepEqual(r.map((x) => x.band), ['bass', 'mid', 'high']);
  assert.equal(r[0].x0, 0);
  assert.equal(r[2].x1, 200);
  for (let i = 1; i < r.length; i++) assert.equal(r[i].x0, r[i - 1].x1);   // gapless
  assert.deepEqual([r[0].x1, r[1].x1], [20, 80]);                          // 10% / 40% of 200
});

test('barHeights maps 0..255 bins to 0..height, length n', () => {
  const fft = new Uint8Array([0, 255, 128, 64]);
  const h = barHeights(fft, 4, 100);
  assert.equal(h.length, 4);
  assert.equal(h[0], 0);
  assert.equal(h[1], 100);
  assert.ok(Math.abs(h[2] - 50.2) < 1);      // 128/255*100
});

test('thresholdY / yToThreshold are inverse maps over the canvas height', () => {
  assert.equal(thresholdY(1, 48), 0);        // full → top
  assert.equal(thresholdY(0, 48), 48);       // zero → bottom
  assert.equal(thresholdY(0.5, 48), 24);
  assert.ok(Math.abs(yToThreshold(24, 48) - 0.5) < 1e-9);
  assert.equal(yToThreshold(-10, 48), 1);    // clamped 0..1
  assert.equal(yToThreshold(100, 48), 0);
});
