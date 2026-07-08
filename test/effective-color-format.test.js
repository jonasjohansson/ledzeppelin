import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveColorFormat } from '../src/model/show.js';

test('fixture colorFormat wins over device + type', () => {
  assert.equal(effectiveColorFormat('RGBW', 'GRB', 'RGB'), 'RGBW');
});

test("empty fixture format falls through to device colour order", () => {
  assert.equal(effectiveColorFormat('', 'GRBW', 'RGB'), 'GRBW');
  assert.equal(effectiveColorFormat(undefined, 'BGR', 'RGB'), 'BGR');
  assert.equal(effectiveColorFormat(null, 'BGR', 'RGB'), 'BGR');
});

test("'NONE' (channels-only) falls through to device colour order", () => {
  assert.equal(effectiveColorFormat('NONE', 'GRB', 'RGB'), 'GRB');
});

test('device falls through to type colour order when no device order', () => {
  assert.equal(effectiveColorFormat('', '', 'GBR'), 'GBR');
  assert.equal(effectiveColorFormat('', undefined, 'GBR'), 'GBR');
  assert.equal(effectiveColorFormat('NONE', null, 'GBR'), 'GBR');
});

test('final RGB fallback when nothing is set', () => {
  assert.equal(effectiveColorFormat('', '', ''), 'RGB');
  assert.equal(effectiveColorFormat(undefined, undefined, undefined), 'RGB');
  assert.equal(effectiveColorFormat('NONE', null, null), 'RGB');
});
