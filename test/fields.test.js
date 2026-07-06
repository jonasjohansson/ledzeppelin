import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planeSweep, axisGradient, noise3d, spherePulse, bodyWave, flowfield,
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

test('noise3d: drift 0 (the default) is byte-identical to the pre-drift field', () => {
  // The pinned values above were captured BEFORE drift existed; an explicit
  // drift: 0 (any axis) must reproduce them exactly — including at t ≠ 0,
  // where the diagonal time-evolution term is live.
  for (const axis of [0, 1, 2]) {
    const P = { scale: 3, speed: 0.3, axis, drift: 0, color: [1, 1, 1] };
    assert.equal(noise3d([0.2, 0.4, 0.1], 1.5, P)[3], 0.35013648885883053);
    assert.equal(noise3d([0.7, 0.1, 0.6], 0, P)[3], 0.5138662882062016);
  }
});

test('noise3d: drift shifts the pattern along the chosen axis (same value at p + axisVec·t·drift)', () => {
  const t = 1.25, drift = 0.8, base = { scale: 3, speed: 0.3, color: [1, 1, 1] };
  const p = [0.3, 0.55, 0.2];
  for (const axis of [0, 1, 2]) {
    // Sampling WITH drift at p + axisVec·(t·drift) lands exactly where the
    // undrifted field reads at p — the whole volume translated along the axis.
    const shifted = [...p];
    shifted[axis] = p[axis] + t * drift;
    const got = noise3d(shifted, t, { ...base, axis, drift });
    const want = noise3d(p, t, { ...base, axis, drift: 0 });
    got.forEach((v, i) => near(v, want[i], 1e-12));
    // …and at the unshifted point the drifted field actually CHANGED.
    assert.notEqual(noise3d(p, t, { ...base, axis, drift })[3], want[3]);
  }
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

// --- flowfield ---------------------------------------------------------------

test('flowfield: id registered and distinct', () => {
  assert.equal(FIELD_IDS.flowfield, 6);
});

test('flowfield: output is premultiplied and in range', () => {
  const c = flowfield([0.4, 0.6, 0.3], 1.2, { color: [1, 0.5, 0.25] });
  assert.equal(c.length, 4);
  const [r, g, b, a] = c;
  for (const v of c) assert.ok(v >= 0 && v <= 1, `${v} out of range`);
  near(r, 1 * a, 1e-9); near(g, 0.5 * a, 1e-9); near(b, 0.25 * a, 1e-9);
});

test('flowfield: zero wind is static in time (no motion term)', () => {
  const P = { windX: 0, windY: 0, windZ: 0, speed: 1 };
  const a0 = flowfield([0.3, 0.7, 0.2], 0, P);
  const a5 = flowfield([0.3, 0.7, 0.2], 5, P);
  nearRGBA(a5, a0, 1e-9);
});

test('flowfield: seed decorrelates the pattern', () => {
  const base = { windX: 0.3, seed: 0 };
  const a = flowfield([0.5, 0.5, 0.5], 0, base)[3];
  const b = flowfield([0.5, 0.5, 0.5], 0, { ...base, seed: 0.7 })[3];
  assert.notEqual(a, b);
});

test('flowfield: thicker filaments cover at least as much as thin ones', () => {
  const avg = (thickness) => {
    let s = 0, n = 0;
    for (let x = 0; x < 1; x += 0.2) for (let y = 0; y < 1; y += 0.2) for (let z = 0; z < 1; z += 0.2) {
      s += flowfield([x, y, z], 0, { thickness, seed: 0.1 })[3]; n++;
    }
    return s / n;
  };
  assert.ok(avg(0.9) >= avg(0.1), 'thick should cover >= thin');
});

// --- manifest entries ----------------------------------------------------

test('manifest: the volumetric generators exist with pinned defaults', () => {
  assert.deepEqual(volumetricNames(), ['planesweep', 'axisgradient', 'noise3d', 'spherepulse', 'bodywave', 'planepulse']);
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
    { axis: 2, pos: 0.5, thickness: 0.25, softness: 0.5, color: '#ffffff', fromCanvas: false });
  assert.deepEqual(defaultParams('axisgradient'),
    { axis: 2, scroll: 0, colorA: '#000000', colorB: '#ffffff' });
  assert.deepEqual(defaultParams('noise3d'), { scale: 3, speed: 0.3, axis: 2, drift: 0, color: '#ffffff', fromCanvas: false });
  assert.deepEqual(defaultParams('spherepulse'),
    { centerX: 0.5, centerY: 0.5, centerZ: 0, radius: 0.35, thickness: 0.15, softness: 0.5, speed: 1, color: '#ffffff', fromCanvas: false });
  assert.deepEqual(defaultParams('bodywave'),
    { axis: 2, wavelength: 0.5, amplitude: 0.1, offset: 0, speed: 1, color: '#ffffff', fromCanvas: false });
  assert.deepEqual(defaultParams('planepulse'), { axis: 2, thickness: 0.15, softness: 0.5, speed: 1, color: '#ffffff', fromCanvas: false });
  assert.equal(REGISTRY.bodywave.volumetric, true);
  assert.equal(labelOf('bodywave'), 'Body Wave');
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
  // clip 2: noise3d — scale override, screen=2; A = (scale, speed, axis, drift)
  assert.deepEqual([...p.meta.slice(8, 12)], [2, 2, 1, 0]);
  assert.deepEqual([...p.a.slice(8, 12)], [7, Math.fround(0.3), 2, 0]);
  // clip 3: spherepulse — A = (cx, cy, cz, radius), B = (th, soft, speed, 0)
  assert.deepEqual([...p.meta.slice(12, 16)], [3, 3, 1, 0]);
  assert.deepEqual([...p.a.slice(12, 16)], [0.5, 0.5, Math.fround(0.4), Math.fround(0.35)]);
  assert.deepEqual([...p.b.slice(12, 16)], [Math.fround(0.15), 0.5, 1, 0]);
});

test('packVolumetrics packs the fromCanvas flag into meta.w', () => {
  const on = packVolumetrics([{ generator: 'planepulse', params: { 'planepulse.fromCanvas': true }, blend: 'add', opacity: 1 }]);
  assert.equal(on.meta[3], 1);
  const off = packVolumetrics([{ generator: 'planepulse', params: {}, blend: 'add', opacity: 1 }]);
  assert.equal(off.meta[3], 0);
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
  // A drifting noise3d packs axis+drift into A slots 2/3 and round-trips
  // through evalPacked (float32 params → small tolerance).
  const pd = packVolumetrics([{ generator: 'noise3d',
    params: { 'noise3d.speed': 0, 'noise3d.axis': 0, 'noise3d.drift': 1.5 }, blend: 'add', opacity: 1 }]);
  assert.deepEqual([...pd.a.slice(0, 4)], [3, 0, 0, 1.5]);
  nearRGBA(evalPacked(pd, 0, pt, 2),
    noise3d(pt, 2, { scale: 3, speed: 0, axis: 0, drift: 1.5, color: [1, 1, 1] }), 1e-6);
  // spherepulse with a trigger: an expanding shell (radius = age·speed) stacks
  // with the static shell — brightest wins.
  const still = evalPacked(p, 2, pt, 0);
  const trig = evalPacked(p, 2, pt, 0, [Math.hypot(0.2, 0.1, 0.4)]);   // shell exactly at this LED
  assert.ok(trig[3] >= still[3]);
  near(trig[3], 1, 1e-6);
  // bodywave: A = (axis, wavelength, amplitude, offset), B = (speed, 0, 0, 0);
  // the packed clip round-trips to the direct bodyWave field at p/t.
  const pw = packVolumetrics([{ generator: 'bodywave',
    params: { 'bodywave.wavelength': 0.7, 'bodywave.speed': 2 }, blend: 'add', opacity: 1 }]);
  assert.deepEqual([...pw.a.slice(0, 4)], [2, Math.fround(0.7), Math.fround(0.1), 0]);
  assert.deepEqual([...pw.b.slice(0, 4)], [2, 0, 0, 0]);
  nearRGBA(evalPacked(pw, 0, pt, 1.3),
    bodyWave(pt, 1.3, { axis: 2, wavelength: Math.fround(0.7), amplitude: Math.fround(0.1), offset: 0, speed: 2, color: [1, 1, 1] }), 1e-6);
  // planepulse: A = (axis, thickness, softness, 0), B = (speed, 0, 0, 0); a plane
  // sweeps per trigger at pos = age·speed — the packed clip round-trips to planeSweep.
  const pp = packVolumetrics([{ generator: 'planepulse',
    params: { 'planepulse.speed': 2, 'planepulse.softness': 0 }, blend: 'add', opacity: 1 }]);
  assert.deepEqual([...pp.a.slice(0, 4)], [2, Math.fround(0.15), 0, 0]);
  assert.deepEqual([...pp.b.slice(0, 4)], [2, 0, 0, 0]);
  nearRGBA(evalPacked(pp, 0, pt, 0, [0.3]),
    planeSweep(pt, { axis: 2, pos: 0.3 * 2, thickness: Math.fround(0.15), softness: 0, color: [1, 1, 1] }), 1e-6);
  // no trigger → dark.
  nearRGBA(evalPacked(pp, 0, pt, 0), [0, 0, 0, 0], 1e-6);
});

test('flowfield: packs A/B/colB and round-trips through evalPacked', () => {
  const p = packVolumetrics([{ generator: 'flowfield',
    params: { 'flowfield.windX': 0.5, 'flowfield.windY': -0.2, 'flowfield.scale': 3,
              'flowfield.turbulence': 0.6, 'flowfield.thickness': 0.3, 'flowfield.trail': 0.8,
              'flowfield.seed': 0.4, 'flowfield.speed': 1.2, 'flowfield.color': '#ff8040' },
    blend: 'add', opacity: 1 }]);
  assert.deepEqual([...p.a.slice(0, 4)], [Math.fround(0.5), Math.fround(-0.2), 0, 3]);
  assert.deepEqual([...p.b.slice(0, 4)], [Math.fround(0.6), Math.fround(0.3), Math.fround(0.8), Math.fround(0.4)]);
  near(p.colB[0], Math.fround(1.2), 1e-6);
  const pt = [0.3, 0.6, 0.4];
  nearRGBA(evalPacked(p, 0, pt, 1.5),
    flowfield(pt, 1.5, { windX: Math.fround(0.5), windY: Math.fround(-0.2), windZ: 0, scale: 3,
      turbulence: Math.fround(0.6), thickness: Math.fround(0.3), trail: Math.fround(0.8),
      seed: Math.fround(0.4), speed: Math.fround(1.2),
      color: [Math.fround(1), Math.fround(0x80 / 255), Math.fround(0x40 / 255)] }), 1e-6);
});
