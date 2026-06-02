import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, defaultParams, generatorNames, effectNames } from '../src/engine/shaders/manifest.js';

test('defaultParams(line) returns the expected defaults', () => {
  assert.deepEqual(defaultParams('line'), { pos: 0.5, width: 0.08, angle: 90, speed: 1, amp: 0.45 });
});

test('defaultParams of an unknown name is empty', () => {
  assert.deepEqual(defaultParams('nope'), {});
});

test('registry contains the expected generators and effects', () => {
  assert.deepEqual(generatorNames().sort(), ['checkers', 'gradient', 'grid', 'line', 'pulse', 'solid']);
  assert.deepEqual(effectNames().sort(), ['displace', 'hue', 'repeat', 'segmenter', 'strobe']);
  for (const name of ['line', 'gradient', 'solid', 'checkers', 'grid', 'pulse', 'displace', 'repeat', 'strobe', 'segmenter', 'hue']) {
    const e = REGISTRY[name];
    assert.ok(e, `${name} missing`);
    assert.match(e.src, /^#version 300 es/, `${name} src must start with #version 300 es`);
    assert.ok(Array.isArray(e.params), `${name} params must be an array`);
  }
});
