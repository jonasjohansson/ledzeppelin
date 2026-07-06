import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutputs } from '../server/wled.js';

// A WLED `hw.led.ins` sample: an RGB bus (GRB), an RGBW bus (SK6812 type 30, GRB
// order → GRBW), and an UNUSED slot (len 0). parseOutputs reports all buses in
// order (the UI filters len-0 out at import time).
const INS = [
  { start: 0, len: 204, pin: [0], order: 0, type: 22 },   // WS2812 RGB, GRB
  { start: 204, len: 42, pin: [3], order: 1, type: 30 },  // SK6812 RGBW, RGB order
  { start: 246, len: 0, pin: [15], order: 0, type: 22 },  // unused slot
];

test('parseOutputs maps len / order / rgbw / index / pin per bus', () => {
  const outs = parseOutputs(INS, false);
  assert.equal(outs.length, 3);
  assert.deepEqual(outs[0], { index: 0, len: 204, order: 'GRB', rgbw: false, pin: [0] });
  assert.deepEqual(outs[1], { index: 1, len: 42, order: 'RGB', rgbw: true, pin: [3] });   // type 30 → RGBW
  assert.equal(outs[2].len, 0);   // unused slot preserved (index 2, len 0)
  assert.equal(outs[2].index, 2);
});

test('filtering len>0 drops the unused slot (what the importer does)', () => {
  const used = parseOutputs(INS, false).filter((o) => o.len > 0);
  assert.equal(used.length, 2);
  assert.deepEqual(used.map((o) => o.index), [0, 1]);
});

test('GRB + RGBW → GRBW colour format (order + W)', () => {
  const out = parseOutputs([{ len: 60, order: 0, type: 30 }], false)[0];
  assert.equal(out.rgbw && out.order + 'W', 'GRBW');
});

test('device-level rgbw is the fallback when a bus omits its type', () => {
  assert.equal(parseOutputs([{ len: 60, order: 0 }], true)[0].rgbw, true);    // no type → device flag
  assert.equal(parseOutputs([{ len: 60, order: 0 }], false)[0].rgbw, false);
});

test('unknown order code falls back to GRB; missing len → 0', () => {
  const outs = parseOutputs([{ order: 99 }], false);
  assert.equal(outs[0].order, 'GRB');
  assert.equal(outs[0].len, 0);
});

test('throws on no buses', () => {
  assert.throws(() => parseOutputs([], false), /no LED outputs/);
  assert.throws(() => parseOutputs(undefined, false), /no LED outputs/);
});
