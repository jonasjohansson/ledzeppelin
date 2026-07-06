# Volumetric "From Canvas" Color — Design + Plan

> Approved approach (brainstorm, fan-out of 3 lenses): a `fromCanvas` color mode on volumetric
> sources — the 3D shape is colored by the composited 2D canvas at each LED. Answers
> merge-with-plasma + 2D-fx-for-3D + colorful-3D in one small change.

**Goal:** Volumetric sources (Plane Pulse / Sphere Pulse / Body Wave / Noise 3D / Plane Sweep) get a **From Canvas** toggle: when on, the field's intensity masks the 2D composite color at each LED instead of a flat `color`.

**Architecture:** The sampler already samples the composited canvas per-LED (`uCanvas` at the LED's map-UV `c`). Pass that UV into `fieldColor`, and when a per-source flag (packed into the free `uVolMeta[i].w` slot) is set, use `texture(uCanvas, cuv).rgb` as the tint. A `fromCanvas` bool param + one packing line + the param on each source.

**Files:** `src/engine/sampler.js`, `src/engine/fields.js`, `src/engine/shaders/manifest.js`, `test/fields.test.js`.

---

## Task 1: sampler — tint from canvas

**File:** `src/engine/sampler.js`

- Change `vec4 fieldColor(int i, vec3 p){` (line 54) → `vec4 fieldColor(int i, vec3 p, vec2 cuv){`.
- Add a helper right above `fieldColor`:
  ```glsl
  vec3 volTint(int i, vec2 cuv, vec3 flat) { return uVolMeta[i].w > 0.5 ? texture(uCanvas, cuv).rgb : flat; }
  ```
- In the intensity-masked branches, replace `uVolColA[i] * v` with `volTint(i, cuv, uVolColA[i]) * v`:
  - `id == 4` (bodywave), `id == 5` (planepulse), the sphere-pulse fallthrough, `id == 2` (noise3d),
    `id == 0` (planesweep). (Leave `id == 1` axisgradient as-is — it's a two-color gradient, not
    intensity×color; `fromCanvas` doesn't apply there and its param is omitted in Task 3.)
- At the call site (line 111): `vec4 f = fieldColor(i, texelFetch(uPos, t, 0).xyz, c);` (`c` is the
  LED canvas UV computed at line 100).
- **Verify GLSL compiles** — run the scratch WebGL harness against `SAMPLE_FS` (extract `const SAMPLE_FS = \`…\`` and compile+link in headless Chromium via playwright, as prior scratchpad `validate-*.mjs` do) → expect it compiles + links.
- `node --check src/engine/sampler.js`.
- **Commit:** `feat(3d): volumetric sources can tint from the 2D canvas (fieldColor gets the LED UV)`
  (Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; hook bumps version.)

---

## Task 2: pack the `fromCanvas` flag (TDD)

**Files:** `src/engine/fields.js`; Test `test/fields.test.js`

- **Failing test** — add to `test/fields.test.js` (mirror the existing packVolumetrics tests' style):
  ```js
  test('packVolumetrics packs the fromCanvas flag into meta.w', () => {
    const on = packVolumetrics([{ generator: 'planepulse', params: { 'planepulse.fromCanvas': true }, blend: 'add', opacity: 1 }]);
    assert.equal(on.meta[3], 1);
    const off = packVolumetrics([{ generator: 'planepulse', params: {}, blend: 'add', opacity: 1 }]);
    assert.equal(off.meta[3], 0);
  });
  ```
- **Implement** — in `packVolumetrics` (fields.js:167), change the meta line to carry the flag:
  ```js
    const fromCanvas = (e.params?.[`${gen}.fromCanvas`] ? 1 : 0);
    meta.set([id, blendIndex(blend), opacity == null ? 1 : Number(opacity), fromCanvas], i * 4);
  ```
  (Confirm the local var for the generator name is `gen` in that loop — read the function; the
  existing `P`/`C` helpers key params as `${gen}.${key}`, so reuse that exact prefix.)
- `node --test test/fields.test.js` PASS; `npm test` green.
- **Commit:** `feat(3d): pack fromCanvas flag into the volumetric meta slot`

---

## Task 3: add the `fromCanvas` param to the sources

**Files:** `src/engine/shaders/manifest.js`; Test `test/fields.test.js`

- Add `{ key: 'fromCanvas', type: 'bool', default: false }` to the `params` of: `planepulse`,
  `spherepulse`, `bodywave`, `noise3d`, `planesweep` (NOT `axisgradient`). Place it last in each.
- **Update the affected `defaultParams(...)` assertions** in `test/fields.test.js` — adding a param
  changes `defaultParams('planepulse')` etc. Grep the test for `defaultParams('planepulse'|'spherepulse'|'bodywave')`
  and add `fromCanvas: false` to each expected object. (bodywave/planepulse have explicit checks; add
  to any that assert the full object.)
- `npm test` green. `node --check src/engine/shaders/manifest.js`.
- **Commit:** `feat(3d): From Canvas toggle on volumetric sources (Plane/Sphere Pulse, Body Wave, Noise3D, Plane Sweep)`

---

## Task 4: verify + release

- `npm test` all green; re-run the WebGL sampler compile check.
- **Manual smoke:** add a **Plasma** clip on one layer; on another layer add **Plane Pulse**, tick
  **From Canvas**; confirm the pulse's swept plane is filled with the plasma's colors (and that
  adding a Hue/Colorize effect to the Plasma layer changes the pulse's color → "2D fx for 3D").
- Cut a signed/notarized release; update memory.
