import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLut, isIdentity, applyLut } from '../server/calibrate.js';

test('isIdentity is true only for gamma 1 + brightness 1 (and unset)', () => {
  assert.equal(isIdentity(1, 1), true);
  assert.equal(isIdentity(undefined, undefined), true);
  assert.equal(isIdentity(2.2, 1), false);
  assert.equal(isIdentity(1, 0.5), false);
});

test('buildLut: identity gamma/brightness maps each byte to itself', () => {
  const lut = buildLut(1, 1);
  assert.equal(lut[0], 0);
  assert.equal(lut[128], 128);
  assert.equal(lut[255], 255);
});

test('buildLut: a max-brightness cap scales the top end', () => {
  const lut = buildLut(1, 0.5);
  assert.equal(lut[255], 128);          // round(255*0.5) = 128
  assert.equal(lut[0], 0);
});

test('buildLut: gamma > 1 pulls the mid-range DOWN (smoother low-end fades)', () => {
  const lut = buildLut(2.2, 1);
  assert.equal(lut[0], 0);
  assert.equal(lut[255], 255);
  assert.ok(lut[128] < 128, `mid ${lut[128]} should be below linear`);
});

test('applyLut maps every byte through the table', () => {
  const lut = buildLut(1, 0.5);
  const out = applyLut(Buffer.from([0, 100, 200, 255]), lut);
  assert.deepEqual([...out], [0, 50, 100, 128]);
});
