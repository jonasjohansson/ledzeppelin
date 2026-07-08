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

// Body wave — a traveling sine wave along a world `axis`: the band tracks a
// sine of the axis coordinate (wavelength/amplitude), sliding by phase = t·speed.
// The GLSL twin (sampler id==4) computes the identical (coord − offset + t·speed).
export function bodyWave(p, t, { axis = 2, wavelength = 0.5, amplitude = 0.1, offset = 0, speed = 1, color = [1, 1, 1] } = {}) {
  const coord = axisCoord(p, axis);
  const phase = t * speed;
  const wave = Math.sin((coord - offset + phase) * Math.PI * 2 / wavelength) * amplitude;
  const v = band(wave, amplitude * 0.2, 0.5);
  return [color[0] * v, color[1] * v, color[2] * v, v];
}

// Flow field — organic filaments that STREAM along a wind direction. Stateless:
// dir = normalize(wind) (guarded to 0 when wind ≈ 0), and the sample point is
// advected UPSTREAM by speed·t so the pattern appears to travel downstream along
// dir. A three-sample noise offset domain-warps the field (turbulence); an
// anisotropic squash along dir elongates features into trails; a band around the
// fbm 0.5 iso-level with half-width from `thickness` carves the filaments; `seed`
// offsets the noise domain so stacked instances decorrelate. PREMULTIPLIED rgba.
// GLSL twin: sampler.js fieldColor id==6 (sin-hash ⇒ float32/float64 differ
// numerically but are structurally identical — visually equivalent, like noise3d).
const FF_OA = [19.19, 7.3, 2.7], FF_OB = [5.2, 41.7, 13.1], FF_OC = [31.3, 9.1, 27.9];
export function flowfield(p, t, {
  windX = 0.3, windY = 0, windZ = 0, speed = 0.4, scale = 2,
  turbulence = 0.5, thickness = 0.4, trail = 0.5, seed = 0, color = [1, 1, 1],
} = {}) {
  const wm = Math.hypot(windX, windY, windZ);
  const dx = wm < 1e-5 ? 0 : windX / wm, dy = wm < 1e-5 ? 0 : windY / wm, dz = wm < 1e-5 ? 0 : windZ / wm;
  const s = seed * 11;
  let qx = p[0] * scale - dx * speed * t + s;
  let qy = p[1] * scale - dy * speed * t + s * 1.7;
  let qz = p[2] * scale - dz * speed * t + s * 0.3;
  // Domain-warp offset (three decorrelated fbm samples remapped to [-1, 1]).
  const wx = fbm3(qx + FF_OA[0], qy + FF_OA[1], qz + FF_OA[2]) * 2 - 1;
  const wy = fbm3(qx + FF_OB[0], qy + FF_OB[1], qz + FF_OB[2]) * 2 - 1;
  const wz = fbm3(qx + FF_OC[0], qy + FF_OC[1], qz + FF_OC[2]) * 2 - 1;
  qx += turbulence * wx; qy += turbulence * wy; qz += turbulence * wz;
  // Anisotropic squash ALONG dir → elongated streaks (trails).
  const k = trail * 0.9;
  const along = qx * dx + qy * dy + qz * dz;
  qx -= dx * along * k; qy -= dy * along * k; qz -= dz * along * k;
  // Filament band around the fbm 0.5 iso-level; half-width from thickness.
  const nrm = fbm3(qx, qy, qz);
  const hw = 0.02 + thickness * 0.48;
  const v = 1 - sstep(hw * 0.5, hw, Math.abs(nrm - 0.5));
  return [color[0] * v, color[1] * v, color[2] * v, v];
}

// --- Sampler packing ---------------------------------------------------------

// Stable field ids — the GLSL dispatcher in sampler.js switches on these.
export const FIELD_IDS = { planesweep: 0, axisgradient: 1, noise3d: 2, spherepulse: 3, bodywave: 4, planepulse: 5, flowfield: 6 };

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
    const fromCanvas = (paramOf(params, generator, 'fromCanvas', false) ? 1 : 0);
    meta.set([id, blendIndex(blend), opacity == null ? 1 : Number(opacity), fromCanvas], i * 4);
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
    } else if (id === FIELD_IDS.bodywave) {
      // A = (axis, wavelength, amplitude, offset), B = (speed, 0, 0, 0)
      a.set([P('axis'), P('wavelength'), P('amplitude'), P('offset')], i * 4);
      b.set([P('speed'), 0, 0, 0], i * 4);
      colA.set(C('color'), i * 3);
    } else if (id === FIELD_IDS.planepulse) {
      // A = (axis, thickness, softness, 0), B = (speed, 0, 0, 0) — pos comes from trigger age.
      a.set([P('axis'), P('thickness'), P('softness'), 0], i * 4);
      b.set([P('speed'), 0, 0, 0], i * 4);
      colA.set(C('color'), i * 3);
    } else if (id === FIELD_IDS.flowfield) {
      // A = (windX, windY, windZ, scale), B = (turbulence, thickness, trail, seed),
      // colB.x = speed (parked in the unused secondary-colour slot).
      a.set([P('windX'), P('windY'), P('windZ'), P('scale')], i * 4);
      b.set([P('turbulence'), P('thickness'), P('trail'), P('seed')], i * 4);
      colB.set([P('speed'), 0, 0], i * 3);
      colA.set(C('color'), i * 3);
    } else { // spherepulse: A = (cx, cy, cz, radius), B = (thickness, softness, speed, 0)
      a.set([P('centerX'), P('centerY'), P('centerZ'), P('radius')], i * 4);
      b.set([P('thickness'), P('softness'), P('speed'), 0], i * 4);
      colA.set(C('color'), i * 3);
    }
  }
  return { count: n, meta, a, b, colA, colB };
}

// --- Colour effects on volumetric clips (Phase 1) -----------------------------
// Pointwise colour ops applied per-LED to a field's STRAIGHT colour in the sampler.
// Stable ids — the GLSL colorFx() switch in sampler.js mirrors these.
export const FX_IDS = { none: 0, hue: 1, color: 2, invert: 3, rgb: 4, threshold: 5, strobe: 6 };
const FX_MAXPER = 4;   // colour effects packed per clip (must match sampler uFxId layout)

function fxSlot(name, params) {
  const id = FX_IDS[name] || 0;
  const P = (k, d) => Number(paramOf(params, name, k, d)) || 0;
  if (id === FX_IDS.hue) return [id, [P('shift', 0), P('speed', 0), 0, 0]];
  if (id === FX_IDS.color) return [id, [P('brightness', 1), P('contrast', 1), P('saturation', 1), P('gamma', 1)]];
  if (id === FX_IDS.invert) return [id, [P('amount', 1), 0, 0, 0]];
  if (id === FX_IDS.rgb) return [id, [P('red', 1), P('green', 1), P('blue', 1), 0]];
  if (id === FX_IDS.threshold) return [id, [P('level', 0.5), 0, 0, 0]];
  if (id === FX_IDS.strobe) return [id, [P('rate', 4), 0, 0, 0]];
  return [0, [0, 0, 0, 0]];
}

// Pack up to 4 ACTIVE clips' colour-effect chains into flat uniform arrays.
// active entries carry `effects` (the clip's effect-name array) + `params`.
export function packColorFx(active) {
  const n = Math.min(4, active.length);
  const fxId = new Float32Array(16);
  const fxParam = new Float32Array(64);
  for (let i = 0; i < n; i++) {
    const { effects, params } = active[i];
    let j = 0;
    for (const name of (effects || [])) {
      if (j >= FX_MAXPER) break;
      if (FX_IDS[name] == null || FX_IDS[name] === 0) continue;
      const [id, p] = fxSlot(name, params);
      const slot = i * FX_MAXPER + j;
      fxId[slot] = id;
      fxParam.set(p, slot * 4);
      j++;
    }
  }
  return { fxId, fxParam };
}

// JS twin of the GLSL colorFx fold — apply ONE effect to a straight colour [r,g,b] 0..1.
export function evalColorFx(s, id, p, t) {
  let [r, g, b] = s;
  if (id === FX_IDS.hue) {
    const a = (p[0] + p[1] * t) * 2 * Math.PI, cs = Math.cos(a), sn = Math.sin(a), k = 0.57735026;
    const dot = k * (r + g + b);
    const cx = g * k - b * k, cy = b * k - r * k, cz = r * k - g * k;
    r = r * cs + cx * sn + k * dot * (1 - cs); g = g * cs + cy * sn + k * dot * (1 - cs); b = b * cs + cz * sn + k * dot * (1 - cs);
  } else if (id === FX_IDS.color) {
    const gm = 1 / Math.max(0.01, p[3]);
    r = Math.pow(clamp01(r), gm) * p[0]; g = Math.pow(clamp01(g), gm) * p[0]; b = Math.pow(clamp01(b), gm) * p[0];
    r = (r - 0.5) * p[1] + 0.5; g = (g - 0.5) * p[1] + 0.5; b = (b - 0.5) * p[1] + 0.5;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * p[2]; g = l + (g - l) * p[2]; b = l + (b - l) * p[2];
  } else if (id === FX_IDS.invert) {
    const a = clamp01(p[0]); r = r + (1 - 2 * r) * a; g = g + (1 - 2 * g) * a; b = b + (1 - 2 * b) * a;
  } else if (id === FX_IDS.rgb) {
    r *= p[0]; g *= p[1]; b *= p[2];
  } else if (id === FX_IDS.threshold) {
    const l = 0.299 * r + 0.587 * g + 0.114 * b, v = l >= p[0] ? 1 : 0; r = g = b = v;
  } else if (id === FX_IDS.strobe) {
    const gate = (p[0] * t - Math.floor(p[0] * t)) >= 0.5 ? 1 : 0; r *= gate; g *= gate; b *= gate;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
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
  if (id === FIELD_IDS.bodywave) {
    const B = packed.b.subarray(i * 4, i * 4 + 4);
    return bodyWave(p, t, { axis: A[0], wavelength: A[1], amplitude: A[2], offset: A[3], speed: B[0], color: cA });
  }
  if (id === FIELD_IDS.planepulse) {
    const B = packed.b.subarray(i * 4, i * 4 + 4);
    const base = { axis: A[0], thickness: A[1], softness: A[2], color: cA };
    let out = [0, 0, 0, 0];
    for (const age of trigAges) { const s = planeSweep(p, { ...base, pos: age * B[0] }); if (s[3] > out[3]) out = s; }
    return out;
  }
  if (id === FIELD_IDS.flowfield) {
    const B = packed.b.subarray(i * 4, i * 4 + 4);
    return flowfield(p, t, {
      windX: A[0], windY: A[1], windZ: A[2], scale: A[3],
      turbulence: B[0], thickness: B[1], trail: B[2], seed: B[3],
      speed: packed.colB[i * 3], color: cA,
    });
  }
  const B = packed.b.subarray(i * 4, i * 4 + 4);
  const base = { center: [A[0], A[1], A[2]], thickness: B[0], softness: B[1], color: cA };
  let out = spherePulse(p, { ...base, radius: A[3] });
  for (const age of trigAges) {
    const s = spherePulse(p, { ...base, radius: age * B[2] });
    if (s[3] > out[3]) out = s;
  }
  return out;
}
