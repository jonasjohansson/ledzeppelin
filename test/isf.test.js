import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseISF, isfParams, wrapISF } from '../src/engine/shaders/isf.js';

const SAMPLE = `/*{
  "DESCRIPTION": "Test shader",
  "CREDIT": "me",
  "INPUTS": [
    { "NAME": "level", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 1 },
    { "NAME": "on", "TYPE": "bool", "DEFAULT": true },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1, 0, 0, 1] },
    { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["a", "b", "c"], "DEFAULT": 1 },
    { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.5, 0.5] },
    { "NAME": "inputImage", "TYPE": "image" }
  ]
}*/
void main() { gl_FragColor = vec4(level); }`;

test('parseISF splits the JSON header from the GLSL body', () => {
  const r = parseISF(SAMPLE);
  assert.equal(r.ok, true);
  assert.equal(r.inputs.length, 6);
  assert.match(r.glsl, /void main\(\)/);
  assert.doesNotMatch(r.glsl, /DESCRIPTION/);   // header stripped
  assert.equal(r.type, 'effect');               // has an inputImage
});

test('parseISF fails cleanly on a missing/bad header', () => {
  assert.equal(parseISF('void main(){}').ok, false);
  assert.equal(parseISF('/*{ not json }*/ void main(){}').ok, false);
});

test('isfParams maps ISF input types to our param schema (image skipped)', () => {
  const p = isfParams(parseISF(SAMPLE).inputs);
  assert.deepEqual(p.map((x) => x.key), ['level', 'on', 'tint', 'mode', 'center']);   // image dropped
  assert.deepEqual(p[0], { key: 'level', label: 'level', type: 'float', min: 0, max: 2, default: 1 });
  assert.equal(p[1].type, 'bool'); assert.equal(p[1].default, true);
  assert.equal(p[2].type, 'color'); assert.equal(p[2].default, '#ff0000');
  assert.equal(p[3].type, 'long'); assert.equal(p[3].step, 1); assert.deepEqual(p[3].values, [0, 1, 2]);
  assert.equal(p[4].type, 'point2D'); assert.deepEqual(p[4].default, { x: 0.5, y: 0.5 });
});

test('wrapISF builds a WebGL2 shader with the ISF shims + input uniforms', () => {
  const { glsl, inputs } = parseISF(SAMPLE);
  const out = wrapISF(glsl, inputs);
  assert.match(out, /#version 300 es/);
  assert.match(out, /#define gl_FragColor isf_outColor/);
  assert.match(out, /#define texture2D texture/);
  assert.match(out, /uniform float level;/);
  assert.match(out, /uniform bool on;/);
  assert.match(out, /uniform vec4 tint;/);
  assert.match(out, /uniform int mode;/);
  assert.match(out, /uniform vec2 center;/);
  assert.match(out, /uniform sampler2D inputImage;/);
  assert.match(out, /uniform vec2 RENDERSIZE;/);
  // exactly ONE main() (the shader body's — we don't append our own)
  assert.equal((out.match(/void main\(/g) || []).length, 1);
});
