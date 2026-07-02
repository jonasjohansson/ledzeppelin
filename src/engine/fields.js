// Volumetric field kit — JS REFERENCE implementations (design:
// docs/plans/2026-07-02-volumetric-sources-design.md).
//
// A field is f(p, t, params) → [r, g, b, a] evaluated at an LED's WORLD position
// p = [x, y, z] (project3d convention: x, y ∈ 0..1 across the canvas, z in the
// same scale, z = 0 = the canvas plane). The returned colour is PREMULTIPLIED
// (rgb already × a) so the sampler can blend it over/add/multiply onto the
// canvas sample exactly like the compositor blends layers.
//
// These functions are the unit-tested source of truth; src/engine/sampler.js
// carries GLSL twins (same formulas, float32). The analytic fields (plane,
// gradient, sphere) match to float precision; noise3d's sin-based hash differs
// numerically between float64 (here) and the GPU's float32 — structurally
// identical, visually equivalent, but NOT byte-pinned across the pair.
//
// Zero deps; pure math only (colours are [r, g, b] arrays in 0..1 — hex
// parsing/param resolution happens in packVolumetrics below).

import { defaultParams, hexToRgb } from './shaders/manifest.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fract = (x) => x - Math.floor(x);

// GLSL-style smoothstep, well-defined even when the edges collide (a clamped
// hard step) — the GLSL twin uses the same explicit form, not smoothstep(),
// so softness = 0 can't hit GLSL's undefined e0 >= e1 case.
function sstep(e0, e1, x) {
  const t = clamp01((x - e0) / Math.max(e1 - e0, 1e-5));
  return t * t * (3 - 2 * t);
}

// Shared band profile: 1 inside the core, smoothstep falloff to 0 at the band
// edge. `thickness` is the FULL width of the band; `softness` 0..1 feathers the
// inner edge (0 = hard slab, 1 = falloff across the whole half-width).
function band(d, thickness, softness) {
  const half = Math.max(1e-4, thickness) * 0.5;
  const inner = half * (1 - clamp01(softness));
  return 1 - sstep(inner, half, Math.abs(d));
}

// Pick the axis coordinate: 0 = x, 1 = y, 2 = z (matches the GLSL twin's
// branch thresholds 0.5 / 1.5 so a float-typed param resolves identically).
const axisCoord = (p, axis) => (axis < 0.5 ? p[0] : axis < 1.5 ? p[1] : p[2]);

// --- The four fields ---------------------------------------------------------

// Plane sweep — a coloured band around a plane ⊥ `axis` at `pos`. The
// motivating field: animate `pos` on axis z and the band climbs a lifted arch.
export function planeSweep(p, { axis = 2, pos = 0.5, thickness = 0.25, softness = 0.5, color = [1, 1, 1] } = {}) {
  const v = band(axisCoord(p, axis) - pos, thickness, softness);
  return [color[0] * v, color[1] * v, color[2] * v, v];
}

// Axis gradient — a colorA→colorB ramp along `axis`, scrolled by `scroll`
// (fract wrap, so scroll 0→1 loops the ramp once). Full coverage (a = 1).
export function axisGradient(p, { axis = 2, colorA = [0, 0, 0], colorB = [1, 1, 1], scroll = 0 } = {}) {
  const g = fract(axisCoord(p, axis) - scroll);
  return [
    colorA[0] + (colorB[0] - colorA[0]) * g,
    colorA[1] + (colorB[1] - colorA[1]) * g,
    colorA[2] + (colorB[2] - colorA[2]) * g,
    1,
  ];
}

// 3D value noise + fbm — the 2D vnoise from manifest.js lifted to 3D (same
// sin-dot hash with a third basis component, trilinear blend, 4 octaves).
function hash3(x, y, z) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
}
function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const mix = (a, b, t) => a + (b - a) * t;
  const n = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  const x00 = mix(n(0, 0, 0), n(1, 0, 0), fx);
  const x10 = mix(n(0, 1, 0), n(1, 1, 0), fx);
  const x01 = mix(n(0, 0, 1), n(1, 0, 1), fx);
  const x11 = mix(n(0, 1, 1), n(1, 1, 1), fx);
  return mix(mix(x00, x10, fy), mix(x01, x11, fy), fz);
}
function fbm3(x, y, z) {
  let n = 0, amp = 0.5, fr = 1;
  for (let i = 0; i < 4; i++) { n += amp * vnoise3(x * fr, y * fr, z * fr); fr *= 2; amp *= 0.5; }
  return n;
}

// Noise 3D — fbm value noise in space, evolving along the diagonal with time
// (q = p·scale + t·speed, matching the 2D Noise generator's uPhase offset),
// plus an optional DIRECTIONAL drift: the whole field flows along one axis
// (`axis` 0/1/2, plane-sweep convention) at `drift` world-units/sec — the
// noise is sampled at p − axisVec·(t·drift), so drift along z makes organic
// light climb a standing arch. `drift` defaults to 0, which subtracts an
// exact 0 from p and leaves the field byte-identical to the pre-drift form
// (the diagonal time term above is untouched).
export function noise3d(p, t, { scale = 3, speed = 0.3, axis = 2, drift = 0, color = [1, 1, 1] } = {}) {
  const o = t * speed;
  const dv = t * drift;
  const x = p[0] - (axis < 0.5 ? dv : 0);
  const y = p[1] - (axis >= 0.5 && axis < 1.5 ? dv : 0);
  const z = p[2] - (axis >= 1.5 ? dv : 0);
  const v = clamp01(fbm3(x * scale + o, y * scale + o, z * scale + o));
  return [color[0] * v, color[1] * v, color[2] * v, v];
}

// Sphere pulse — a radial band (shell) at `radius` from `center`. Triggerable:
// the sampler re-evaluates this same field with radius = trigAge·speed per
// recent trigger (expanding shells, brightest wins) — see sampler.js.
export function spherePulse(p, { center = [0.5, 0.5, 0], radius = 0.35, thickness = 0.15, softness = 0.5, color = [1, 1, 1] } = {}) {
  const dx = p[0] - center[0], dy = p[1] - center[1], dz = p[2] - center[2];
  const v = band(Math.hypot(dx, dy, dz) - radius, thickness, softness);
  return [color[0] * v, color[1] * v, color[2] * v, v];
}

// --- Sampler packing ---------------------------------------------------------

// Stable field ids — the GLSL dispatcher in sampler.js switches on these.
export const FIELD_IDS = { planesweep: 0, axisgradient: 1, noise3d: 2, spherepulse: 3 };

export const isVolumetricName = (name) => name in FIELD_IDS;

// Blend-mode indices for the sampler shader. Mirrors compositor setBlend():
// an unknown/absent mode falls back to 'add' there, so it does here too.
const BLEND_INDEX = { alpha: 0, add: 1, screen: 2, multiply: 3 };
const blendIndex = (mode) => BLEND_INDEX[mode] ?? 1;

// Resolve one param for a volumetric generator from a clip's (already
// animation-resolved) params map, using the compositor's namespaced-key
// convention: '<gen>.<key>' → '<key>' → manifest default.
function paramOf(params, name, key, def) {
  const pfx = name + '.' + key;
  if (params && pfx in params) return params[pfx];
  if (params && key in params) return params[key];
  return def;
}

// Pack up to 4 ACTIVE volumetric clips into flat uniform arrays for the
// sampler pass. `active` = [{ generator, params, blend, opacity }] in LAYER
// ORDER (bottom → top, the compositor's blend order); extras beyond 4 are
// dropped (top-most first — the cap is documented in the clip UI).
// Layout per clip i:
//   meta[i]  = (fieldId, blendIndex, opacity, 0)
//   a[i]     = field params slot A   b[i] = slot B (see the per-field comments)
//   colA[i]  = primary colour        colB[i] = secondary (gradient only)
export function packVolumetrics(active) {
  const n = Math.min(4, active.length);
  const meta = new Float32Array(16), a = new Float32Array(16), b = new Float32Array(16);
  const colA = new Float32Array(12), colB = new Float32Array(12);
  for (let i = 0; i < n; i++) {
    const { generator, params, blend, opacity } = active[i];
    const defs = defaultParams(generator);
    const P = (key) => Number(paramOf(params, generator, key, defs[key])) || 0;
    const C = (key) => hexToRgb(paramOf(params, generator, key, defs[key]));
    const id = FIELD_IDS[generator];
    meta.set([id, blendIndex(blend), opacity == null ? 1 : Number(opacity), 0], i * 4);
    if (id === FIELD_IDS.planesweep) {
      a.set([P('axis'), P('pos'), P('thickness'), P('softness')], i * 4);
      colA.set(C('color'), i * 3);
    } else if (id === FIELD_IDS.axisgradient) {
      a.set([P('axis'), P('scroll'), 0, 0], i * 4);
      colA.set(C('colorA'), i * 3);
      colB.set(C('colorB'), i * 3);
    } else if (id === FIELD_IDS.noise3d) {
      // A = (scale, speed, axis, drift)
      a.set([P('scale'), P('speed'), P('axis'), P('drift')], i * 4);
      colA.set(C('color'), i * 3);
    } else { // spherepulse: A = (cx, cy, cz, radius), B = (thickness, softness, speed, 0)
      a.set([P('centerX'), P('centerY'), P('centerZ'), P('radius')], i * 4);
      b.set([P('thickness'), P('softness'), P('speed'), 0], i * 4);
      colA.set(C('color'), i * 3);
    }
  }
  return { count: n, meta, a, b, colA, colB };
}

// JS twin of the sampler's per-LED field dispatch — evaluates one PACKED clip
// at p/t (trigAges = seconds since recent ⚡ triggers, for spherepulse shells).
// Used by tests (and the e2e GPU-parity check) to predict sampler output.
export function evalPacked(packed, i, p, t, trigAges = []) {
  const A = packed.a.subarray(i * 4, i * 4 + 4);
  const cA = Array.from(packed.colA.subarray(i * 3, i * 3 + 3));
  const cB = Array.from(packed.colB.subarray(i * 3, i * 3 + 3));
  const id = packed.meta[i * 4];
  if (id === FIELD_IDS.planesweep) return planeSweep(p, { axis: A[0], pos: A[1], thickness: A[2], softness: A[3], color: cA });
  if (id === FIELD_IDS.axisgradient) return axisGradient(p, { axis: A[0], colorA: cA, colorB: cB, scroll: A[1] });
  if (id === FIELD_IDS.noise3d) return noise3d(p, t, { scale: A[0], speed: A[1], axis: A[2], drift: A[3], color: cA });
  const B = packed.b.subarray(i * 4, i * 4 + 4);
  const base = { center: [A[0], A[1], A[2]], thickness: B[0], softness: B[1], color: cA };
  let out = spherePulse(p, { ...base, radius: A[3] });
  for (const age of trigAges) {
    const s = spherePulse(p, { ...base, radius: age * B[2] });
    if (s[3] > out[3]) out = s;
  }
  return out;
}
