# Volumetric Color Effects (Phase 1) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Volumetric (3D) clips can carry a per-LED chain of *color* effects (hue, Adjustments, invert, rgb, threshold, strobe), applied to each field's color before it blends onto the LED — reusing the same clip effects rail as 2D clips.

**Architecture:** Effects are tagged `kind` in the registry; the clip-effect picker filters to `kind==='color'` for volumetric clips. Each active volumetric clip's color-effect chain is packed into NEW sampler uniforms (`uFxId[16]`, `uFxP[16]` = 4 clips × 4 effects) and applied per-LED in `sampler.js` — un-premultiply the field color, fold the chain (GLSL ports of the existing effect math), re-premultiply, then blend. A JS twin in `fields.js` mirrors the fold for parity tests.

**Tech Stack:** Vanilla JS ES modules, WebGL2 GLSL ES 3.00, `node --test`.

**Design doc:** `docs/plans/2026-07-08-volumetric-color-effects-design.md`

**Phase-1 color effects + ids:** `hue=1, color=2, invert=3, rgb=4, threshold=5, strobe=6` (`none=0`). **`colorize` is deferred** (needs 2 colors = extra uniforms) — documented, not silently no-op'd.

**Cap:** 4 effects per volumetric clip; 4 active clips → 16 slots. Slot for clip `i`, effect `j` = `i*4+j`.

**Param packing (vec4 `uFxP[slot]`) per effect id:**
- hue(1): `(shift, speed, 0, 0)` → angle `a=(shift+speed*uT)*2π`
- color(2): `(brightness, contrast, saturation, gamma)`
- invert(3): `(amount, 0, 0, 0)`
- rgb(4): `(red, green, blue, 0)`
- threshold(5): `(level, 0, 0, 0)`
- strobe(6): `(rate, 0, 0, 0)`

**Run tests:** `node --test test/fields.test.js` or `node --test test/*.test.js`.

---

### Task 1: Tag effects with `kind` + `effectKind` helper

**Files:**
- Modify: `src/engine/shaders/manifest.js` (6 effect entries: hue:1066, color:1073, invert:1082, rgb:1086, threshold:1094, strobe:1025; helper near `getEntry`/`effectNames`)
- Test: `test/fields.test.js`

**Step 1: Write the failing test** (add to `test/fields.test.js`; import `effectKind` from manifest in the existing top import from `../src/engine/shaders/manifest.js`):

```js
test('effectKind: the phase-1 color effects are tagged color; spatial ones are not', () => {
  for (const n of ['hue', 'color', 'invert', 'rgb', 'threshold', 'strobe']) assert.equal(effectKind(n), 'color', n);
  for (const n of ['displace', 'repeat', 'feedback', 'colorize']) assert.notEqual(effectKind(n), 'color', n);
});
```

**Step 2: Run `node --test test/fields.test.js` → FAIL** (`effectKind` not exported).

**Step 3: Add `kind: 'color'` to the six entries.** In each of the six effect registry objects add `kind: 'color',` after `type: 'effect'`. Example (strobe, manifest.js:1025-1030):

```js
  strobe: {
    name: 'strobe', type: 'effect', kind: 'color', src: STROBE,
    params: [ { key: 'rate', type: 'float', min: 0, max: 20, default: 4 } ],
  },
```

Do the same for `hue`, `color`, `invert`, `rgb`, `threshold` (add `kind: 'color',`). Leave `colorize` and all spatial effects untagged.

**Step 4: Add the helper** near `getEntry` (manifest.js ~1146):

```js
// Effect class: 'color' (pointwise — works per-LED on a volumetric clip), else
// undefined for spatial effects (coord/resample — 2D only for now).
export const effectKind = (name) => REGISTRY[name]?.kind || null;
```

**Step 5: Run `node --test test/fields.test.js` → PASS.**

**Step 6: Commit**

```bash
git add src/engine/shaders/manifest.js test/fields.test.js
git commit -m "feat(manifest): tag pointwise effects kind:'color' + effectKind()"
```

---

### Task 2: `packColorFx` + `evalColorFx` JS twin

**Files:**
- Modify: `src/engine/fields.js` (add near `packVolumetrics`)
- Test: `test/fields.test.js`

**Step 1: Write the failing tests** (add to `test/fields.test.js`; import `packColorFx, evalColorFx, FX_IDS` from `../src/engine/fields.js`):

```js
test('packColorFx: lays out per-clip effect slots (4 per clip)', () => {
  const act = [{ generator: 'flowfield', effects: ['invert', 'hue'],
    params: { 'invert.amount': 1, 'hue.shift': 0.25, 'hue.speed': 0 } }];
  const { fxId, fxParam } = packColorFx(act);
  assert.equal(fxId.length, 16); assert.equal(fxParam.length, 64);
  assert.equal(fxId[0], FX_IDS.invert);   // clip0, slot0
  assert.equal(fxId[1], FX_IDS.hue);      // clip0, slot1
  assert.equal(fxId[2], 0);               // empty
  assert.equal(fxParam[0], 1);            // invert amount
  assert.equal(fxParam[4], 0.25);         // hue shift (slot1 → base 4)
});

test('packColorFx: drops non-color effects and caps at 4/clip', () => {
  const act = [{ generator: 'flowfield', effects: ['displace', 'invert', 'rgb', 'threshold', 'hue', 'strobe'], params: {} }];
  const { fxId } = packColorFx(act);
  // displace (spatial) skipped; first 4 color effects kept: invert,rgb,threshold,hue
  assert.deepEqual([...fxId.slice(0, 4)], [FX_IDS.invert, FX_IDS.rgb, FX_IDS.threshold, FX_IDS.hue]);
});

test('evalColorFx: invert flips, threshold binarizes, rgb scales, strobe gates', () => {
  const near3 = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${a}!=${b}`));
  near3(evalColorFx([0.2, 0.4, 0.6], FX_IDS.invert, [1, 0, 0, 0], 0), [0.8, 0.6, 0.4]);
  near3(evalColorFx([1, 1, 1], FX_IDS.threshold, [0.5, 0, 0, 0], 0), [1, 1, 1]);
  near3(evalColorFx([0, 0, 0], FX_IDS.threshold, [0.5, 0, 0, 0], 0), [0, 0, 0]);
  near3(evalColorFx([0.5, 0.5, 0.5], FX_IDS.rgb, [2, 1, 0, 0], 0), [1, 0.5, 0]);
  near3(evalColorFx([1, 1, 1], FX_IDS.strobe, [1, 0, 0, 0], 0.6), [0, 0, 0]);   // fract(0.6)>=0.5 → gate 0... see note
});
```

> Note on the strobe expectation: gate = `step(0.5, fract(uT*rate))`. At `uT=0.6, rate=1` → `fract(0.6)=0.6 ≥ 0.5` → gate `1` → color kept. Adjust the test to `assert` kept (`[1,1,1]`) OR pick `uT=0.2` for gate 0. Use `uT=0.2` → `fract(0.2)=0.2 <0.5` → gate 0 → `[0,0,0]`. **Use `0.2` in the test.**

**Step 2: Run → FAIL** (`packColorFx`/`evalColorFx`/`FX_IDS` undefined).

**Step 3: Implement in `src/engine/fields.js`** (after `packVolumetrics`). Reuse the existing `paramOf`/`defaultParams`/`hexToRgb` helpers and `clamp01`:

```js
// --- Colour effects on volumetric clips (Phase 1) -----------------------------
// Pointwise colour ops applied per-LED to a field's STRAIGHT colour in the sampler.
// Stable ids — the GLSL colorFx() switch in sampler.js mirrors these.
export const FX_IDS = { none: 0, hue: 1, color: 2, invert: 3, rgb: 4, threshold: 5, strobe: 6 };
const FX_MAXPER = 4;   // colour effects packed per clip (must match sampler uFxId layout)

// Map one effect name + resolved params → (id, [p0..p3]) for packing.
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
// active = same list as packVolumetrics, but each entry ALSO carries `effects`
// (the clip's effect-name array). Non-colour effects are skipped; ≤4 kept per clip.
export function packColorFx(active) {
  const n = Math.min(4, active.length);
  const fxId = new Float32Array(16);      // 4 clips × 4 slots
  const fxParam = new Float32Array(64);   // 4 clips × 4 slots × vec4
  for (let i = 0; i < n; i++) {
    const { effects, params } = active[i];
    let j = 0;
    for (const name of (effects || [])) {
      if (j >= FX_MAXPER) break;
      if (FX_IDS[name] == null || FX_IDS[name] === 0) continue;   // non-colour / unknown → skip
      const [id, p] = fxSlot(name, params);
      const slot = i * FX_MAXPER + j;
      fxId[slot] = id;
      fxParam.set(p, slot * 4);
      j++;
    }
  }
  return { fxId, fxParam };
}

// JS twin of the GLSL colorFx fold — apply one effect to a straight colour.
// Used by tests (and the parity check). s = [r,g,b] 0..1.
export function evalColorFx(s, id, p, t) {
  let [r, g, b] = s;
  if (id === FX_IDS.hue) {
    const a = (p[0] + p[1] * t) * 2 * Math.PI, cs = Math.cos(a), sn = Math.sin(a), k = 0.57735026;
    const dot = k * (r + g + b);
    const cx = g * k - b * k, cy = b * k - r * k, cz = r * k - g * k;   // cross(k*ones, s)
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
```

> `paramOf` is already defined in fields.js; `clamp01`/`hexToRgb`/`defaultParams` too. `invert`'s `mix(s,1-s,a) = s + (1-2s)*a`. `threshold`'s `step(level,l)` = `l>=level`.

**Step 4: Run `node --test test/fields.test.js` → PASS** (fix the strobe test `uT` to `0.2` per the note).

**Step 5: Commit**

```bash
git add src/engine/fields.js test/fields.test.js
git commit -m "feat(fields): packColorFx + evalColorFx twin (volumetric colour effects)"
```

---

### Task 3: Sampler GLSL — uniforms, colorFx fold, un-premult wrap

**Files:**
- Modify: `src/engine/sampler.js` (uniform decls in `SAMPLE_FS` ~line 31; `colorFx` before `main`; the composite loop ~line 132; `getUniformLocation` ~line 192; `sample()` upload ~line 252)

> No unit test (GLSL runs on the GPU). Verified by the JS twin (Task 2) + the app check (Task 6).

**Step 1: Declare the new uniforms** in `SAMPLE_FS` after `uniform vec3 uVolColB[4];` (sampler.js:31):

```glsl
uniform float uFxId[16];   // 4 clips × 4 colour-effect slots (0 = none)
uniform vec4 uFxP[16];     // per-slot params
```

**Step 2: Add the `colorFx` fold** just before `void main(){` (sampler.js ~line 116):

```glsl
// Per-LED colour-effect chain for volumetric clip `clip` (4 slots). Operates on a
// STRAIGHT (un-premultiplied) colour. GLSL twin of fields.js evalColorFx.
vec3 colorFx(vec3 s, int clip){
  for (int j = 0; j < 4; j++) {
    int id = int(uFxId[clip * 4 + j] + 0.5);
    if (id == 0) continue;
    vec4 p = uFxP[clip * 4 + j];
    if (id == 1) {                       // hue (Rodrigues about grey axis)
      float a = (p.x + p.y * uT) * 6.2831853; vec3 k = vec3(0.57735026); float cs = cos(a), sn = sin(a);
      s = s * cs + cross(k, s) * sn + k * dot(k, s) * (1.0 - cs);
    } else if (id == 2) {                // Adjustments: gamma→bright→contrast→sat
      s = pow(clamp(s, 0.0, 1.0), vec3(1.0 / max(0.01, p.w))) * p.x;
      s = (s - 0.5) * p.y + 0.5;
      float l = dot(s, vec3(0.299, 0.587, 0.114)); s = mix(vec3(l), s, p.z);
    } else if (id == 3) {                // invert
      s = mix(s, 1.0 - s, clamp(p.x, 0.0, 1.0));
    } else if (id == 4) {                // rgb gain
      s = s * p.xyz;
    } else if (id == 5) {                // threshold (luminance binarise)
      s = vec3(step(p.x, dot(s, vec3(0.299, 0.587, 0.114))));
    } else if (id == 6) {                // strobe (time gate)
      s *= step(0.5, fract(uT * p.x));
    }
    s = clamp(s, 0.0, 1.0);
  }
  return s;
}
```

**Step 3: Wrap the field color in the composite loop.** In `main`, where the loop calls `fieldColor` (sampler.js:132), change:

```glsl
vec4 f = fieldColor(i, texelFetch(uPos, t, 0).xyz, c);
```
to:
```glsl
vec4 f = fieldColor(i, texelFetch(uPos, t, 0).xyz, c);
// Phase-1 colour effects: fold the clip's chain over the STRAIGHT colour, re-premult.
if (f.a > 0.0) { vec3 s = colorFx(f.rgb / f.a, i); f.rgb = s * f.a; }
```

**Step 4: Add uniform locations** after `locVolColB` (sampler.js:192):

```js
  const locFxId = gl.getUniformLocation(prog, 'uFxId[0]');
  const locFxP = gl.getUniformLocation(prog, 'uFxP[0]');
```

**Step 5: Upload them** inside `sample()`'s `if (n2 > 0)` block, after the `uVolColB` upload (sampler.js:252). The `vol` object will carry `fxId`/`fxParam` (Task 4); fall back to zeros if absent:

```js
        gl.uniform1fv(locFxId, vol.fxId || FX_ID_ZERO);
        gl.uniform4fv(locFxP, vol.fxParam || FX_P_ZERO);
```

Add the zero fallbacks near the other scratch buffers (sampler.js ~line 200, by `VOL_TRIG_SCRATCH`):

```js
  const FX_ID_ZERO = new Float32Array(16);
  const FX_P_ZERO = new Float32Array(64);
```

**Step 6: Verify it parses** (GLSL compiles only on a GPU; this confirms the module + string are intact):

```bash
node -e "import('/Users/jonas/Documents/GitHub/org/jonasjohansson/ledzeppelin/src/engine/sampler.js').then(()=>console.log('sampler.js OK')).catch(e=>{console.error(e);process.exit(1)})"
node --test test/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: `sampler.js OK`; all tests pass.

**Step 7: Commit**

```bash
git add src/engine/sampler.js
git commit -m "feat(sampler): per-LED colour-effect chain on volumetric clips (colorFx)"
```

---

### Task 4: Wire the packed effects into the frame (`app.js`)

**Files:**
- Modify: `src/app.js` (the volumetric collection, lines 2834-2839; the import at line 6)

**Step 1: Import `packColorFx`.** Change `src/app.js:6`:

```js
import { packVolumetrics, packColorFx } from './engine/fields.js';
```

**Step 2: Carry `effects` in the act entry.** In the `act.push({...})` (app.js:2834-2837), add `effects: c.effects`:

```js
        act.push({
          id: c.id, generator: c.generator, params: c.params, blend: L.blend, effects: c.effects,
          opacity: (L.opacity == null ? 1 : Number(L.opacity)) * (c.opacity == null ? 1 : Number(c.opacity)) * masterOpacity,
        });
```

**Step 3: Merge the packed effects into `vol`.** Change app.js:2839:

```js
      if (act.length) vol = { ...packVolumetrics(act), ...packColorFx(act), time: t, volTrigs: act.map((e) => clipTriggers.trigsFor(e.id)) };
```

**Step 4: Verify** (module has DOM deps at load — the check is the test suite + the app run in Task 6):

```bash
node --test test/*.test.js 2>&1 | grep -E "^# (pass|fail)"
```
Expected: all pass (no regression).

**Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat(app): pack volumetric clips' colour-effect chains into the frame"
```

---

### Task 5: Picker filter — color effects only on volumetric clips

**Files:**
- Modify: `src/ui/layers.js` (clip-effect add site ~line 1473; `openPicker` effect grid ~line 1606; import `effectKind`)

**Step 1: Import `effectKind`** — add it to the existing manifest import at the top of `src/ui/layers.js` (the import that already brings `effectNames`, `getEntry`, `labelOf`).

**Step 2: Pass a filter flag at the clip-effect add site** (layers.js:1473). The clip object is in scope (`clip`). Change:

```js
      addBtn.onclick = () => openPicker(addBtn, 'effect', (name) => commit(addClipEffect(show(), id, clip.id, name)));
```
to:
```js
      addBtn.onclick = () => openPicker(addBtn, 'effect', (name) => commit(addClipEffect(show(), id, clip.id, name)),
        { colorOnly: !!getEntry(clip.generator)?.volumetric });
```

**Step 3: Honor the flag in `openPicker`** (layers.js:1606). Change the effect branch:

```js
    } else {
      pop.append(grid(effectNames()));
    }
```
to:
```js
    } else {
      const names = opts.colorOnly ? effectNames().filter((n) => effectKind(n) === 'color') : effectNames();
      pop.append(grid(names));
    }
```

(`openPicker(anchor, kind, onPick, opts = {})` already accepts `opts`.)

**Step 4: Verify** the module parses:

```bash
node -e "import('/Users/jonas/Documents/GitHub/org/jonasjohansson/ledzeppelin/src/ui/layers.js').then(()=>console.log('layers.js OK')).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: `layers.js OK`.

**Step 5: Commit**

```bash
git add src/ui/layers.js
git commit -m "feat(ui): volumetric clips' effect picker shows only colour effects"
```

---

### Task 6: Full suite + in-app verification

**Step 1: Run the whole suite**

Run: `node --test test/*.test.js`
Expected: all pass, no regressions.

**Step 2: Verify end-to-end in the app**

REQUIRED SUB-SKILL: use the `verify` (or `run`) skill to launch the app, then:
1. Add a layer → source picker → **Volumetric → Flow Field** (a lit volumetric clip).
2. On that clip, open the effect picker (**+ effect**). Confirm it lists ONLY color effects (Hue, Adjustments, Invert, RGB, Threshold, Strobe) — no Displace/Blur/etc.
3. Add **Invert** → the LEDs' colors invert. Add **Hue**, drag `shift` → colors rotate. Add **Threshold** → binarizes. Remove an effect → reverts.
4. Confirm a 2D clip's effect picker still shows ALL effects (unchanged).
5. Stack with a second volumetric clip; confirm each clip's chain is independent; respects the ≤4-active cap.
6. No console GLSL-compile errors.

**Step 3: Update memory.** Add a pointer that Phase 1 (volumetric colour effects) shipped, and that Phases 2 (coord warps) / 3 (topology blur) remain — link the design doc and [[volumetric-field-budget]].

**Step 4: Final commit (if memory/docs changed).**

---

## Invariants / gotchas

- **JS/GLSL parity:** `evalColorFx` (fields.js) and `colorFx` (sampler.js) must match; the sin-based hue differs float32/float64 but is structurally identical (same policy as the fields). Keep the id switch + param order in lockstep.
- **`uVolCount == 0` unchanged:** with no volumetric clips the loop never runs, `colorFx` is never called, and output stays byte-identical to the plain sampler. The FX uniforms are only uploaded when `n2 > 0`.
- **2D clips untouched:** they keep running the full effect chain (all classes) in the compositor. Only volumetric clips get the sampler-side colour chain.
- **Premultiplied:** un-premult before the fold (`f.rgb / f.a`, guarded `f.a > 0`), re-premult after (`s * f.a`) — so invert/threshold are correct at partial alpha.
- **colorize deferred** — it needs two colours (6 floats) that don't fit the `uFxP` vec4 slot; a follow-up adds a colour-slot + tags it `kind:'color'`.
- **Cap = 4 effects/clip** — the packer drops extras; the picker doesn't yet enforce it, so a 5th color effect is silently ignored. Acceptable for Phase 1 (note in the effect UI later).
