# Volumetric `flowfield` Source — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one new volumetric source, `flowfield` — organic filaments that stream along a wind direction, built from domain-warped curl-ish 3D noise with trails, thickness, and randomness controls.

**Architecture:** A stateless analytic field `f(x,y,z,t) → premultiplied rgba`, exactly like the existing 6 volumetric fields. No particle buffer. It rides the established 3-file lockstep: `manifest.js` (registry + thumbnail GLSL + label), `fields.js` (id + JS twin + packing), `sampler.js` (GLSL twin). The 8 strict param slots (`a`+`b`) are full at 8 floats, so the 9th float (`speed`) is parked in the otherwise-unused secondary-colour slot `colB.x`.

**Tech Stack:** Vanilla JS ES modules, WebGL2 GLSL ES 3.00, `node --test`.

**Design doc:** `docs/plans/2026-07-06-volumetric-flowfield-design.md`

**Field id:** `6`. **Packing:** `a=(windX,windY,windZ,scale)`, `b=(turbulence,thickness,trail,seed)`, `colB.x=speed`, `colA=color`.

**Run tests with:** `node --test "test/*.test.js"` (whole suite) or `node --test test/fields.test.js`.

---

### Task 1: `flowfield` field id + JS reference function

**Files:**
- Modify: `src/engine/fields.js` (add id to `FIELD_IDS` line 130; add function after `bodyWave`, ~line 125)
- Test: `test/fields.test.js`

**Step 1: Write the failing tests**

Add near the other field tests in `test/fields.test.js`. First add `flowfield` to the import from `../src/engine/fields.js` (the top `import { … } from '../src/engine/fields.js'` block).

```js
// --- flowfield ---------------------------------------------------------------

test('flowfield: id registered and distinct', () => {
  assert.equal(FIELD_IDS.flowfield, 6);
});

test('flowfield: output is premultiplied and in range', () => {
  const c = flowfield([0.4, 0.6, 0.3], 1.2, { color: [1, 0.5, 0.25] });
  assert.equal(c.length, 4);
  const [r, g, b, a] = c;
  for (const v of c) assert.ok(v >= 0 && v <= 1, `${v} out of range`);
  // premultiplied: rgb == color * alpha
  near(r, 1 * a, 1e-9); near(g, 0.5 * a, 1e-9); near(b, 0.25 * a, 1e-9);
});

test('flowfield: zero wind is static in time (no motion term)', () => {
  const P = { windX: 0, windY: 0, windZ: 0, speed: 1 };
  const a0 = flowfield([0.3, 0.7, 0.2], 0, P);
  const a5 = flowfield([0.3, 0.7, 0.2], 5, P);
  nearRGBA(a5, a0, 1e-9);   // dir = 0 ⇒ advection term drops out
});

test('flowfield: seed decorrelates the pattern', () => {
  const base = { windX: 0.3, seed: 0 };
  const a = flowfield([0.5, 0.5, 0.5], 0, base)[3];
  const b = flowfield([0.5, 0.5, 0.5], 0, { ...base, seed: 0.7 })[3];
  assert.notEqual(a, b);
});

test('flowfield: thicker filaments cover at least as much as thin ones', () => {
  // Average alpha over a small grid rises monotonically-ish with thickness.
  const avg = (thickness) => {
    let s = 0, n = 0;
    for (let x = 0; x < 1; x += 0.2) for (let y = 0; y < 1; y += 0.2) for (let z = 0; z < 1; z += 0.2) {
      s += flowfield([x, y, z], 0, { thickness, seed: 0.1 })[3]; n++;
    }
    return s / n;
  };
  assert.ok(avg(0.9) >= avg(0.1), 'thick should cover >= thin');
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/fields.test.js`
Expected: FAIL — `flowfield is not a function` / `FIELD_IDS.flowfield` is undefined.

**Step 3: Add the id**

In `src/engine/fields.js` line 130, extend `FIELD_IDS`:

```js
export const FIELD_IDS = { planesweep: 0, axisgradient: 1, noise3d: 2, spherepulse: 3, bodywave: 4, planepulse: 5, flowfield: 6 };
```

**Step 4: Add the JS reference function**

In `src/engine/fields.js`, immediately after `bodyWave` (after line 125), add. It reuses the existing `fbm3`, `sstep`, `clamp01` helpers:

```js
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
```

**Step 5: Run tests to verify they pass**

Run: `node --test test/fields.test.js`
Expected: PASS (all flowfield tests green, existing tests unaffected).

**Step 6: Commit**

```bash
git add src/engine/fields.js test/fields.test.js
git commit -m "feat(fields): flowfield JS reference field (curl-noise wind/trails)"
```

---

### Task 2: Pack + eval round-trip for `flowfield`

**Files:**
- Modify: `src/engine/fields.js` (`packVolumetrics` ~line 194 add branch before the `else` sphere fallback; `evalPacked` ~line 221 add branch)
- Test: `test/fields.test.js`

**Step 1: Write the failing test**

Add to `test/fields.test.js` (near the existing `packVolumetrics`/`evalPacked` round-trip block at the tail):

```js
test('flowfield: packs A/B/colB and round-trips through evalPacked', () => {
  const p = packVolumetrics([{ generator: 'flowfield',
    params: { 'flowfield.windX': 0.5, 'flowfield.windY': -0.2, 'flowfield.scale': 3,
              'flowfield.turbulence': 0.6, 'flowfield.thickness': 0.3, 'flowfield.trail': 0.8,
              'flowfield.seed': 0.4, 'flowfield.speed': 1.2, 'flowfield.color': '#ff8040' },
    blend: 'add', opacity: 1 }]);
  // A = (windX, windY, windZ, scale), B = (turbulence, thickness, trail, seed), colB.x = speed
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
```

**Step 2: Run test to verify it fails**

Run: `node --test test/fields.test.js`
Expected: FAIL — packing branch missing, `a`/`b` come back as zeros (falls into the sphere `else`).

**Step 3: Add the packing branch**

In `src/engine/fields.js` `packVolumetrics`, insert BEFORE the final `else { // spherepulse` branch (line 190):

```js
    } else if (id === FIELD_IDS.flowfield) {
      // A = (windX, windY, windZ, scale), B = (turbulence, thickness, trail, seed),
      // colB.x = speed (parked in the unused secondary-colour slot).
      a.set([P('windX'), P('windY'), P('windZ'), P('scale')], i * 4);
      b.set([P('turbulence'), P('thickness'), P('trail'), P('seed')], i * 4);
      colB.set([P('speed'), 0, 0], i * 3);
      colA.set(C('color'), i * 3);
```

> Note: `P('windX')` uses `Number(...) || 0`, so a literal `0` wind axis stays `0` (correct) and negatives pass through (they're truthy).

**Step 4: Add the eval branch**

In `src/engine/fields.js` `evalPacked`, before the final sphere fallback (`const B = packed.b.subarray...` at line 221), add:

```js
  if (id === FIELD_IDS.flowfield) {
    const B = packed.b.subarray(i * 4, i * 4 + 4);
    return flowfield(p, t, {
      windX: A[0], windY: A[1], windZ: A[2], scale: A[3],
      turbulence: B[0], thickness: B[1], trail: B[2], seed: B[3],
      speed: packed.colB[i * 3], color: cA,
    });
  }
```

**Step 5: Run tests to verify they pass**

Run: `node --test test/fields.test.js`
Expected: PASS.

**Step 6: Commit**

```bash
git add src/engine/fields.js test/fields.test.js
git commit -m "feat(fields): pack/eval flowfield (speed in colB slot)"
```

---

### Task 3: Registry entry, thumbnail shader, label

**Files:**
- Modify: `src/engine/shaders/manifest.js` (thumb const ~line 480 after `PLANEPULSE_THUMB`; registry entry ~line 961 after `planepulse`; `LABELS` line 1135)
- Test: `test/fields.test.js`

**Step 1: Write the failing test**

Add to `test/fields.test.js`:

```js
test('flowfield: registered as a volumetric generator with defaults + label', () => {
  assert.ok(volumetricNames().includes('flowfield'));
  assert.equal(getEntry('flowfield').volumetric, true);
  assert.equal(labelOf('flowfield'), 'Flow Field');
  const d = defaultParams('flowfield');
  assert.equal(d.windX, 0.3); assert.equal(d.speed, 0.4); assert.equal(d.scale, 2);
  assert.equal(d.turbulence, 0.5); assert.equal(d.thickness, 0.4);
  assert.equal(d.trail, 0.5); assert.equal(d.seed, 0);
  assert.equal(d.color, '#ffffff'); assert.equal(d.fromCanvas, false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/fields.test.js`
Expected: FAIL — `getEntry('flowfield')` is null.

**Step 3: Add the thumbnail shader**

In `src/engine/shaders/manifest.js`, after `PLANEPULSE_THUMB` (line 480), add (self-contained: inline `vfbm3`, mirrors `NOISE3D_THUMB`'s helpers):

```js
const FLOWFIELD_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float windX; uniform float windY; uniform float windZ; uniform float speed;
uniform float scale; uniform float turbulence; uniform float thickness; uniform float trail; uniform float seed;
uniform float uT; uniform vec3 color;
float vhash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float x00 = mix(vhash3(i), vhash3(i + vec3(1, 0, 0)), f.x);
  float x10 = mix(vhash3(i + vec3(0, 1, 0)), vhash3(i + vec3(1, 1, 0)), f.x);
  float x01 = mix(vhash3(i + vec3(0, 0, 1)), vhash3(i + vec3(1, 0, 1)), f.x);
  float x11 = mix(vhash3(i + vec3(0, 1, 1)), vhash3(i + vec3(1, 1, 1)), f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}
float vfbm3(vec3 p){ float n = 0.0, amp = 0.5, fr = 1.0;
  for (int i = 0; i < 4; i++){ n += amp * vnoise3(p * fr); fr *= 2.0; amp *= 0.5; } return n; }
void main(){
  vec3 p = vec3(uv.x, uv.y, uv.y);
  vec3 wind = vec3(windX, windY, windZ); float wm = length(wind);
  vec3 dir = wm < 1e-5 ? vec3(0.0) : wind / wm;
  float s = seed * 11.0;
  vec3 q = p * scale - dir * (speed * uT) + vec3(s, s * 1.7, s * 0.3);
  vec3 w = vec3(
    vfbm3(q + vec3(19.19, 7.3, 2.7)),
    vfbm3(q + vec3(5.2, 41.7, 13.1)),
    vfbm3(q + vec3(31.3, 9.1, 27.9))) * 2.0 - 1.0;
  q += turbulence * w;
  float k = trail * 0.9; float along = dot(q, dir); q -= dir * along * k;
  float nrm = vfbm3(q);
  float hw = 0.02 + thickness * 0.48;
  float tt = clamp((abs(nrm - 0.5) - hw * 0.5) / max(hw - hw * 0.5, 1e-5), 0.0, 1.0);
  float v = 1.0 - tt * tt * (3.0 - 2.0 * tt);
  frag = vec4(color * v, 1.0);
}`;
```

**Step 4: Add the registry entry**

In `src/engine/shaders/manifest.js`, after the `planepulse` entry (line 961, before `displace`), add:

```js
  flowfield: {
    name: 'flowfield', type: 'generator', volumetric: true, src: FLOWFIELD_THUMB,
    params: [
      { key: 'windX', type: 'float', min: -1, max: 1, default: 0.3 },
      { key: 'windY', type: 'float', min: -1, max: 1, default: 0 },
      { key: 'windZ', type: 'float', min: -1, max: 1, default: 0 },
      { key: 'speed', type: 'float', min: 0, max: 2, default: 0.4 },
      { key: 'scale', type: 'float', min: 0.2, max: 8, default: 2 },
      { key: 'turbulence', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'thickness', type: 'float', min: 0, max: 1, default: 0.4 },
      { key: 'trail', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'seed', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'fromCanvas', type: 'bool', default: false },
    ],
  },
```

**Step 5: Add the label**

In `src/engine/shaders/manifest.js` `LABELS` (line 1135), add `flowfield` to the volumetric label line:

```js
  bodywave: 'Body Wave', planepulse: 'Plane Pulse', flowfield: 'Flow Field',
```

**Step 6: Run tests to verify they pass**

Run: `node --test "test/*.test.js"`
Expected: PASS (registry test green; every other suite unaffected).

**Step 7: Commit**

```bash
git add src/engine/shaders/manifest.js test/fields.test.js
git commit -m "feat(manifest): register flowfield source + thumbnail shader"
```

---

### Task 4: Sampler GLSL twin (per-LED evaluation)

**Files:**
- Modify: `src/engine/sampler.js` (`fieldColor`, add `if (id == 6)` after the `id == 5` block at line 86, BEFORE the sphere fallback)

> No unit test — GLSL runs on the GPU. Correctness is verified by the JS twin (Task 1–2) plus the manual app check in Task 6. The critical rule: this branch must be inserted BEFORE the sphere fallback, otherwise id 6 falls through into sphere-pulse.

**Step 1: Add the GLSL branch**

In `src/engine/sampler.js`, immediately after the `id == 5` block (closing `}` at line 86) and before the `// sphere pulse:` comment (line 87), insert:

```glsl
  if (id == 6) {           // flow field: A=(windX,windY,windZ,scale), B=(turbulence,thickness,trail,seed), colB.x=speed
    vec3 wind = uVolA[i].xyz; float wm = length(wind);
    vec3 dir = wm < 1e-5 ? vec3(0.0) : wind / wm;
    float s = uVolB[i].w * 11.0;   // seed
    vec3 q = p * uVolA[i].w - dir * (uVolColB[i].x * uT) + vec3(s, s * 1.7, s * 0.3);
    vec3 w = vec3(
      vfbm3(q + vec3(19.19, 7.3, 2.7)),
      vfbm3(q + vec3(5.2, 41.7, 13.1)),
      vfbm3(q + vec3(31.3, 9.1, 27.9))) * 2.0 - 1.0;
    q += uVolB[i].x * w;                       // turbulence
    float k = uVolB[i].z * 0.9; float along = dot(q, dir); q -= dir * along * k;   // trail
    float nrm = vfbm3(q);
    float hw = 0.02 + uVolB[i].y * 0.48;       // thickness
    float tt = clamp((abs(nrm - 0.5) - hw * 0.5) / max(hw - hw * 0.5, 1e-5), 0.0, 1.0);
    float v = 1.0 - tt * tt * (3.0 - 2.0 * tt);
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }
```

**Step 2: Sanity-check the shader compiles (headless smoke)**

The GLSL is only compiled inside a WebGL2 context. Verify structurally that the source string embeds the new branch and stays balanced:

Run:
```bash
node -e "import('./src/engine/sampler.js').then(()=>console.log('sampler.js imports OK'))"
```
Expected: `sampler.js imports OK` (module parses; the GLSL string is inert until a GL context builds it — real compile is exercised in Task 6).

**Step 3: Commit**

```bash
git add src/engine/sampler.js
git commit -m "feat(sampler): GLSL twin for flowfield (id 6)"
```

---

### Task 5: Add `flowfield` to the source picker

**Files:**
- Modify: `src/ui/layers.js` (`SOURCE_CATEGORIES`, line 1564 — this list is hardcoded, NOT auto-derived from `volumetricNames()`)

**Step 1: Add to the Volumetric group**

In `src/ui/layers.js` line 1564, append `flowfield`:

```js
    ['Volumetric', ['planesweep', 'axisgradient', 'noise3d', 'spherepulse', 'bodywave', 'planepulse', 'flowfield']],
```

**Step 2: Commit**

```bash
git add src/ui/layers.js
git commit -m "feat(ui): flowfield in the Volumetric source picker"
```

---

### Task 6: Full suite + manual app verification

**Step 1: Run the whole test suite**

Run: `node --test "test/*.test.js"`
Expected: PASS, no regressions.

**Step 2: Verify end-to-end in the app**

REQUIRED SUB-SKILL: use the `verify` (or `run`) skill to launch the app. Then:
1. Add a clip → open the source picker → **Volumetric → Flow Field**. Confirm the thumbnail renders (organic filaments, not black).
2. Drop it on a layer with fixtures/LEDs present. Confirm LEDs light with streaming filaments.
3. Sweep `windX` positive/negative → flow direction reverses. Raise `speed` → faster travel. Raise `turbulence` → filaments churn/tangle. Raise `trail` → filaments elongate into streaks. Raise `thickness` → wider bands. Change `seed` → pattern changes. Toggle `fromCanvas` with a colourful layer below → filaments take the canvas colour.
4. Confirm it stacks with other volumetric fields and respects the 4-active cap.
5. Confirm no console GLSL-compile errors.

**Step 3: Update the memory pointer**

The `theming-and-3d-color` / volumetric roadmap memories track shipped volumetric work — add a one-line note that `flowfield` shipped (curl-noise wind/trails/thickness/seed, speed parked in the colB slot).

**Step 4: Final commit (if any docs/memory changed)**

```bash
git add -A && git commit -m "docs: note flowfield volumetric source shipped"
```

---

## Invariants / gotchas (recap for the implementer)

- **id 6 branch MUST precede the sphere fallback** in `sampler.js` `fieldColor` — the fallback catches every id it doesn't explicitly handle.
- **`uVolCount == 0` stays byte-identical** to the plain sampler — no code runs in the field loop when there are no volumetric clips. Don't touch the loop guard.
- **Premultiplied output** — rgb is already × alpha.
- **JS/GLSL parity is structural, not byte-pinned** — the sin-hash noise diverges float64↔float32 exactly like `noise3d`; that's expected and acceptable. Unit tests compare JS-vs-JS only.
- **`speed` lives in `colB.x`** — `flowfield` uses one colour, so the secondary-colour uniform (`uVolColB[i]`, uploaded every frame at sampler.js:235) is free. Keep A/B/colB layout identical across `packVolumetrics`, `evalPacked`, and the GLSL branch.
