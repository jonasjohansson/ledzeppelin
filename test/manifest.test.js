import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, defaultParams, generatorNames, effectNames, hexToRgb } from '../src/engine/shaders/manifest.js';

test('hexToRgb parses #rrggbb / #rgb to normalized rgb, falls back to white', () => {
  assert.deepEqual(hexToRgb('#ffffff'), [1, 1, 1]);
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]);
  assert.deepEqual(hexToRgb('#0f0'), [0, 1, 0]);          // short form expands
  assert.deepEqual(hexToRgb('garbage'), [1, 1, 1]);       // invalid → white
  assert.deepEqual(hexToRgb(undefined), [1, 1, 1]);
});

test('color params expose hex-string defaults', () => {
  assert.equal(defaultParams('solid').color, '#ffffff');
  assert.deepEqual([defaultParams('gradient').colorA, defaultParams('gradient').colorB], ['#000000', '#ffffff']);
  assert.deepEqual([defaultParams('colorize').lowColor, defaultParams('colorize').highColor], ['#000000', '#ffffff']);
});

test('every white-only generator has a color tint param defaulting to white (C4)', () => {
  for (const name of ['line', 'sine', 'checkers', 'grid', 'pulse', 'radial']) {
    const p = REGISTRY[name].params.find((x) => x.key === 'color');
    assert.ok(p, `${name} missing color param`);
    assert.equal(p.type, 'color');
    assert.equal(p.default, '#ffffff');                      // white ⇒ identical to the old look
    assert.match(REGISTRY[name].src, /uniform vec3 color;/); // shader actually consumes it
  }
});

test('defaultParams(line) returns the expected defaults', () => {
  assert.deepEqual(defaultParams('line'), { pos: 0.5, width: 0.08, angle: 90, speed: 1, amp: 0.5, numLines: 1, color: '#ffffff' });
});

test('defaultParams of an unknown name is empty', () => {
  assert.deepEqual(defaultParams('nope'), {});
});

test('registry contains the expected generators and effects', () => {
  assert.deepEqual(generatorNames().sort(), ['axisgradient', 'bodywave', 'checkers', 'domainwarp', 'gradient', 'grid', 'line', 'metaballs', 'noise', 'noise3d', 'planepulse', 'planesweep', 'plasma', 'pulse', 'radial', 'sine', 'solid', 'spectrum', 'spherepulse', 'tunnel']);
  assert.deepEqual(effectNames().sort(),
    ['basswarp', 'cascade', 'color', 'colorize', 'displace', 'feedback', 'hue', 'invert', 'repeat', 'rgb', 'segmenter', 'shockwave', 'strobe', 'threshold', 'trails']);
  for (const name of ['line', 'gradient', 'solid', 'checkers', 'grid', 'pulse', 'displace', 'repeat', 'strobe', 'segmenter', 'hue', 'colorize', 'trails', 'feedback']) {
    const e = REGISTRY[name];
    assert.ok(e, `${name} missing`);
    assert.match(e.src, /^#version 300 es/, `${name} src must start with #version 300 es`);
    assert.ok(Array.isArray(e.params), `${name} params must be an array`);
  }
});
