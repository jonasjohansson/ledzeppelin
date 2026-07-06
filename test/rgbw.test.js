import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeviceBytes, formatStride } from '../server/output.js';
import { buildArtnetPackets } from '../server/artnet.js';
import { COLOR_ORDERS } from '../src/ui/fixtures.js';

const px = (slice, d) => [...buildDeviceBytes(Buffer.from(slice), d)];

test('controller colour orders offer the 4-channel RGBW variants', () => {
  // A GRBW/SK6812 controller must be selectable so a fixture with no explicit
  // colorFormat still emits its white byte (pipeline falls back to device order).
  for (const o of ['RGBW', 'GRBW', 'BGRW', 'RBGW', 'WRGB', 'WGRB']) {
    assert.ok(COLOR_ORDERS.includes(o), `COLOR_ORDERS missing ${o}`);
  }
});

test('formatStride: RGB=3, RGBW=4, RGBWA=5', () => {
  assert.equal(formatStride('GRB'), 3);
  assert.equal(formatStride('RGBW'), 4);
  assert.equal(formatStride('RGBWA'), 5);
});

test('RGB orders still pack 3 bytes/px (no regression)', () => {
  // GRB swaps R,G; two pixels.
  assert.deepEqual(px([10, 20, 30, 40, 50, 60], { colorOrder: 'GRB' }), [20, 10, 30, 50, 40, 60]);
});

test('RGBW extracts W = min(R,G,B) and subtracts it from RGB', () => {
  // px1 (10,20,30): w=10 → (0,10,20,10).  px2 (60,50,40): w=40 → (20,10,0,40).
  assert.deepEqual(px([10, 20, 30, 60, 50, 40], { colorOrder: 'RGBW' }), [0, 10, 20, 10, 20, 10, 0, 40]);
});

test('pure white extracts to the W channel only (RGB go dark)', () => {
  assert.deepEqual(px([255, 255, 255], { colorOrder: 'RGBW' }), [0, 0, 0, 255]);
});

test('pure red has no white to extract (RGB kept, W=0)', () => {
  assert.deepEqual(px([255, 0, 0], { colorOrder: 'RGBW' }), [255, 0, 0, 0]);
});

test('GRBW reorders the extracted RGB residual and appends white', () => {
  // (10,20,30): w=10 → residual (0,10,20); GRBW order → (10,0,20,10).
  assert.deepEqual(px([10, 20, 30], { colorOrder: 'GRBW' }), [10, 0, 20, 10]);
});

test('WRGB puts white first, RGB residual after', () => {
  // (10,20,30): w=10 → residual (0,10,20); WRGB → (10,0,10,20).
  assert.deepEqual(px([10, 20, 30], { colorOrder: 'WRGB' }), [10, 0, 10, 20]);
});

test('Art-Net chunks RGBW on whole-pixel universe boundaries (128 px = 512 B)', () => {
  // 130 RGBW pixels = 520 bytes → universe 0 holds 512 (128 px), universe 1 holds 8.
  const bytes = Buffer.alloc(130 * 4);
  const pkts = buildArtnetPackets(bytes, { startUniverse: 0, stride: 4 });
  assert.equal(pkts.length, 2);
  assert.equal(pkts[0][1].length, 512);   // 128 whole RGBW pixels
  assert.equal(pkts[1][1].length, 8);     // remaining 2 pixels
});

test('Art-Net RGB chunking unchanged (170 px = 510 B)', () => {
  const bytes = Buffer.alloc(172 * 3);    // 516 B → 170 px + 2 px (even tail, no pad)
  const pkts = buildArtnetPackets(bytes, { startUniverse: 0, stride: 3 });
  assert.equal(pkts[0][1].length, 510);   // 170 px
  assert.equal(pkts[1][1].length, 6);     // 2 px
});
