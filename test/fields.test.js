import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planeSweep, axisGradient, noise3d, spherePulse,
  FIELD_IDS, isVolumetricName, packVolumetrics, evalPacked,
} from '../src/engine/fields.js';
import { REGISTRY, getEntry, defaultParams, volumetricNames, labelOf, generatorNames } from '../src/engine/shaders/manifest.js';

const near = (got, want, eps = 1e-9) =>
  assert.ok(Math.abs(got - want) < eps, `${got} !~ ${want}`);
const nearRGBA = (got, want, eps = 1e-9) => {
  assert.equal(got.length, 4);
  got.forEach((v, i) => near(v, want[i], eps));
};

// --- planeSweep --------------------------------------------------------------

test('planeSweep: full intensity on the plane, zero outside the band', () => {
  const P = { axis: 2, pos: 0.5, thickness: 0.2, softness: 0, color: [1, 0, 0] };
  nearRGBA(planeSweep([0.1, 0.9, 0.5], P), [1, 0, 0, 1]);        // exactly on the plane
  nearRGBA(planeSweep([0.1, 0.9, 0.65], P), [0, 0, 0, 0]);       // past the half-thickness
  nearRGBA(planeSweep([0.1, 0.9, 0.35], P), [0, 0, 0, 0]);       // symmetric on the other side
});

test('planeSweep: softness feathers the edge (pinned midpoint)', () => {
  // d = 0.1, half = 0.2, softness 1 → smoothstep(0, 0.2, 0.1) = 0.5.
  nearRGBA(planeSweep([0.5, 0.5, 0.4], { axis: 2, pos: 0.5, thickness: 0.4, softness: 1, color: [1, 0.5, 0] }),
    [0.5, 0.25, 0, 0.5], 1e-6);
});

test('planeSweep: axis selects x / y / z', () => {
  const P = { pos: 0.25, thickness: 0.1, softness: 0, color: [1, 1, 1] };
  near(planeSweep([0.25, 0, 0], { ...P, axis: 0 })[3], 1);
  near(planeSweep([0, 0.25, 0], { ...P, axis: 1 })[3], 1);
  near(planeSweep([0, 0, 0.25], { ...P, axis: 2 })[3], 1);
  near(planeSweep([0.25, 0, 0], { ...P, axis: 2 })[3], 0);   // z of this point is 0
});

// --- axisGradient ------------------------------------------------------------

test('axisGradient: endpoints hit colorA / near-colorB, alpha 1', () => {
  const P = { axis: 0, colorA: [0, 0, 0], colorB: [1, 1, 1], scroll: 0 };
  nearRGBA(axisGradient([0, 0.5, 0], P), [0, 0, 0, 1]);
  nearRGBA(axisGradient([0.999, 0.5, 0], P), [0.999, 0.999, 0.999, 1], 1e-6);
  nearRGBA(axisGradient([0.5, 0.5, 0], P), [0.5, 0.5, 0.5, 1]);
});

test('axisGradient: scroll wraps via fract', () => {
  const P = { axis: 2, colorA: [0, 0, 0], colorB: [1, 1, 1] };
  near(axisGradient([0, 0, 0.3], { ...P, scroll: 0.1 })[0], 0.2, 1e-9);
  // wrap: coord 0.3 − scroll 0.5 = −0.2 → fract = 0.8
  near(axisGradient([0, 0, 0.3], { ...P, scroll: 0.5 })[0], 0.8, 1e-9);
});

// --- noise3d -------------------------------------------------------------

test('noise3d: deterministic pinned values, premultiplied by colour', () => {
  const P = { scale: 3, speed: 0.3, color: [1, 1, 1] };
  nearRGBA(noise3d([0.2, 0.4, 0.1], 1.5, P), Array(4).fill(0.35013648885883053), 1e-12);
  nearRGBA(noise3d([0.7, 0.1, 0.6], 0, P), Array(4).fill(0.5138662882062016), 1e-12);
  const tinted = noise3d([0.2, 0.4, 0.1], 1.5, { ...P, color: [0.5, 1, 0] });
  near(tinted[0], 0.35013648885883053 * 0.5, 1e-12);
  near(tinted[3], 0.35013648885883053, 1e-12);
});

test('noise3d: varies along z (the point of a 3D field)', () => {
  const P = { scale: 3, speed: 0.3, color: [1, 1, 1] };
  near(noise3d([0.2, 0.4, 0.0], 1.5, P)[3], 0.34099657327604, 1e-12);
  assert.notEqual(noise3d([0.2, 0.4, 0.0], 1.5, P)[3], noise3d([0.2, 0.4, 0.1], 1.5, P)[3]);
});

test('noise3d: output stays in 0..1 over a sweep', () => {
  for (let i = 0; i < 50; i++) {
    const v = noise3d([i * 0.13, i * 0.07, i * 0.05], i * 0.3, { scale: 5, speed: 1, color: [1, 1, 1] })[3];
    assert.ok(v >= 0 && v <= 1, `v=${v}`);
  }
});

// --- spherePulse ---------------------------------------------------------

test('spherePulse: full on the shell, zero far away, pinned soft edge', () => {
  const P = { center: [0.5, 0.5, 0], radius: 0.3, thickness: 0.2, softness: 1, color: [1, 1, 1] };
  nearRGBA(spherePulse([0.8, 0.5, 0], P), [1, 1, 1, 1]);          // exactly on the shell
  nearRGBA(spherePulse([0.5, 0.5, 0], P), [0, 0, 0, 0]);          // centre: d = radius > half-thickness
  // d = 0.05 off the shell, half = 0.1, softness 1 → smoothstep(0, 0.1, 0.05) = 0.5.
  near(spherePulse([0.85, 0.5, 0], P)[3], 0.5, 1e-6);
});

test('spherePulse: z counts in the distance', () => {
  const P = { center: [0.5, 0.5, 0], radius: 0.3, thickness: 0.1, softness: 0, color: [1, 1, 1] };
  near(spherePulse([0.5, 0.5, 0.3], P)[3], 1);                    // straight up the z axis
});

// --- manifest entries ----------------------------------------------------

test('manifest: the 4 volumetric generators exist with pinned defaults', () => {
  assert.deepEqual(volumetricNames(), ['planesweep', 'axisgradient', 'noise3d', 'spherepulse']);
  for (const n of volumetricNames()) {
    const e = getEntry(n);
    assert.equal(e.type, 'generator');
    assert.equal(e.volumetric, true);
    assert.ok(typeof e.src === 'string' && e.src.includes('#version 300 es'), `${n} has a thumbnail shader`);
    assert.ok(generatorNames().includes(n), `${n} listed as a generator`);
    assert.ok(n in FIELD_IDS, `${n} has a field id`);
    assert.ok(isVolumetricName(n));
  }
  assert.deepEqual(defaultParams('planesweep'),
    { axis: 2, pos: 0.5, thickness: 0.25, softness: 0.5, color: '#ffffff' });
  assert.deepEqual(defaultParams('axisgradient'),
    { axis: 2, scroll: 0, colorA: '#000000', colorB: '#ffffff' });
  assert.deepEqual(defaultParams('noise3d'), { scale: 3, speed: 0.3, color: '#ffffff' });
  assert.deepEqual(defaultParams('spherepulse'),
    { centerX: 0.5, centerY: 0.5, centerZ: 0, radius: 0.35, thickness: 0.15, softness: 0.5, speed: 1, color: '#ffffff' });
  assert.equal(REGISTRY.spherepulse.triggerable, true);
  assert.equal(labelOf('planesweep'), 'Plane Sweep');
  assert.equal(labelOf('noise3d'), 'Noise 3D');
});

test('manifest: non-volumetric entries are untouched by the flag', () => {
  for (const n of ['line', 'solid', 'noise', 'pulse']) assert.equal(!!getEntry(n).volumetric, false);
});

// --- packVolumetrics / evalPacked -----------------------------------------

test('packVolumetrics: resolves namespaced params, blends, colours; caps at 4', () => {
  const clips = [
    { generator: 'planesweep', params: { 'planesweep.pos': 0.8, 'planesweep.color': '#ff0000' }, blend: 'alpha', opacity: 0.5 },
    { generator: 'axisgradient', params: {}, blend: 'add', opacity: 1 },
    { generator: 'noise3d', params: { 'noise3d.scale': 7 }, blend: 'screen', opacity: 1 },
    { generator: 'spherepulse', params: { 'spherepulse.centerZ': 0.4 }, blend: 'multiply', opacity: 1 },
    { generator: 'planesweep', params: {}, blend: 'add', opacity: 1 },   // 5th → dropped
  ];
  const p = packVolumetrics(clips);
  assert.equal(p.count, 4);
  // clip 0: planesweep — meta (id, blend alpha=0, opacity), A = (axis, pos, th, soft)
  assert.deepEqual([...p.meta.slice(0, 4)], [0, 0, 0.5, 0]);
  assert.deepEqual([...p.a.slice(0, 4)], [2, Math.fround(0.8), 0.25, 0.5]);
  assert.deepEqual([...p.colA.slice(0, 3)], [1, 0, 0]);
  // clip 1: axisgradient — defaults, colB white
  assert.deepEqual([...p.meta.slice(4, 8)], [1, 1, 1, 0]);
  assert.deepEqual([...p.colB.slice(3, 6)], [1, 1, 1]);
  // clip 2: noise3d — scale override, screen=2
  assert.deepEqual([...p.meta.slice(8, 12)], [2, 2, 1, 0]);
  assert.equal(p.a[8], 7);
  // clip 3: spherepulse — A = (cx, cy, cz, radius), B = (th, soft, speed, 0)
  assert.deepEqual([...p.meta.slice(12, 16)], [3, 3, 1, 0]);
  assert.deepEqual([...p.a.slice(12, 16)], [0.5, 0.5, Math.fround(0.4), Math.fround(0.35)]);
  assert.deepEqual([...p.b.slice(12, 16)], [Math.fround(0.15), 0.5, 1, 0]);
});

test('packVolumetrics: unknown blend falls back to add (compositor parity)', () => {
  const p = packVolumetrics([{ generator: 'planesweep', params: {}, blend: undefined, opacity: 1 }]);
  assert.equal(p.meta[1], 1);
});

test('evalPacked matches the direct field functions', () => {
  const p = packVolumetrics([
    { generator: 'planesweep', params: { 'planesweep.pos': 0.4, 'planesweep.softness': 0 }, blend: 'add', opacity: 1 },
    { generator: 'noise3d', params: {}, blend: 'add', opacity: 1 },
    { generator: 'spherepulse', params: {}, blend: 'add', opacity: 1 },
  ]);
  const pt = [0.3, 0.6, 0.4];
  nearRGBA(evalPacked(p, 0, pt, 0),
    planeSweep(pt, { axis: 2, pos: 0.4, thickness: 0.25, softness: 0, color: [1, 1, 1] }), 1e-6);
  nearRGBA(evalPacked(p, 1, pt, 2.5),
    noise3d(pt, 2.5, { scale: 3, speed: 0.3, color: [1, 1, 1] }), 1e-6);
  // spherepulse with a trigger: an expanding shell (radius = age·speed) stacks
  // with the static shell — brightest wins.
  const still = evalPacked(p, 2, pt, 0);
  const trig = evalPacked(p, 2, pt, 0, [Math.hypot(0.2, 0.1, 0.4)]);   // shell exactly at this LED
  assert.ok(trig[3] >= still[3]);
  near(trig[3], 1, 1e-6);
});
