# Color effects on volumetric sources — design (Phase 1)

**Date:** 2026-07-08
**Status:** approved, ready for planning

## Background — the unifying model

Research (Resolume / TouchDesigner / Notch / MadMapper + Íñigo Quílez domain-warping)
converges on one idea: **a 2D canvas source and a 3D volumetric source are the same
thing — a field `f(p, t) → colour`.** Effects fall into three classes:

- **A — Colour (pointwise):** `c' = g(c)` *after* sampling. Source-agnostic, trivial.
- **B — Coordinate (domain-warp):** `c = f(warp(p))` *before* sampling. Also
  source-agnostic (warps the sample coordinate); no neighbourhood needed.
- **C — Neighbourhood (resample):** blur/glow/feedback — genuinely needs the field
  materialised on a grid. The industry answer is "render to a buffer, effect it,
  then sample"; for LEDs the honest version is blur over LED *topology*, not world space.

Our per-LED sampler (`sampler.js`) is a pure per-point evaluation (no neighbour
access), which is exactly why Classes A and B "just work" per-LED and C does not.

**This design is Phase 1: Class A (colour effects) on volumetric sources.** Phases
2 (coordinate warps) and 3 (topology blur / bake) are deferred.

## Goal

A volumetric/3D clip can carry a chain of per-LED colour effects — `hue`, `invert`,
`threshold`, `rgb`, `colorize`, `color` (Adjustments), `strobe` — applied to the
field's colour before it blends onto the LED, using the **same effects rail as 2D clips**.

## Effect taxonomy (from the codebase)

Pointwise / **colour** (Phase 1): `hue`, `color` (Adjustments), `invert`, `rgb`,
`threshold`, `colorize`, `strobe`. Each is `texture(uTex,uv)` + colour math only.

Spatial / **coord** or **resample** (not Phase 1): `displace`, `repeat`, `segmenter`,
`cascade`, `trails`, `feedback`, `shockwave`, `basswarp`.

## Model — kind-tagging

- Each effect entry in `src/engine/shaders/manifest.js` gains `kind: 'color' | 'coord'
  | 'resample'`. Phase 1 tags the 7 pointwise effects `'color'`; the rest `'coord'`/
  `'resample'` (informational now; drives the picker filter and sets up Phases 2/3).
- Volumetric clips reuse `clip.effects` (array of effect names) + `clip.params`
  UNCHANGED — identical to 2D clips. No new model shape.
- The clip-effect picker filters to `kind === 'color'` **when the clip's generator is
  volumetric** (`getEntry(clip.generator)?.volumetric`). Spatial effects simply aren't
  offered on a volumetric clip yet.

## Execution — in the sampler, per-LED

The colour effects run in `src/engine/sampler.js` (`SAMPLE_FS`), NOT the compositor —
volumetric fields are evaluated per-LED there, not on the 2D canvas.

Per active volumetric clip `i`, in the composite loop (`sampler.js` ~line 132):
1. `vec4 f = fieldColor(i, p, cuv)` — premultiplied, as today.
2. **Un-premultiply** → straight colour `s = f.rgb / max(f.a, ε)`.
3. **Fold the clip's colour-effect chain** over `s` in order, reusing GLSL ports of the
   existing effect math (hue Rodrigues, invert mix, threshold step, rgb gain, colorize
   ramp, Adjustments grade, strobe time-gate).
4. **Re-premultiply** → `f.rgb = s' * f.a`; blend as today.

Un-premult matters: `invert`/`threshold` on a premultiplied colour are wrong at partial
alpha. (`hue` is linear so it's unaffected, but the un-premult path is uniform for all.)

## Data flow

- `app.js` already collects the ≤4 active volumetric clips in layer order.
- A new packer in `src/engine/fields.js` flattens each clip's colour-effect chain into
  NEW uniform arrays (id + params per effect), capped at **N ≈ 3–4 effects/clip** — the
  existing per-field `uVolA/B/Col*` arrays are full, so effects need their own uniforms.
- `sampler.js` gains: the new uniforms + their `getUniformLocation`/upload, a
  `colorFx(vec3 s, int clip)` fold, and the un-premult/re-premult wrap in the loop.
- A JS twin of the fold in `fields.js` mirrors the GLSL for parity tests.

**Param encoding:** each colour effect has ≤4 scalar params (Adjustments =
gamma/bright/contrast/sat is the max). Pack per effect as `(effectId, p0, p1, p2, p3)`.
`colorize` needs two colours (6 floats) — include via a small colour slot if it fits the
budget cleanly; otherwise it is the one Phase-1 deferral (documented, not silent).

## Testing

- **JS-twin parity** (like `evalPacked`): the packed colour-chain fold matches the JS
  reference for representative chains.
- **Behaviour:** `invert` flips, `threshold` binarises on luminance, `hue` rotates,
  `rgb`/Adjustments scale; premult round-trip is correct at partial alpha.
- **In-app:** drop `hue` then `invert` on a Flow Field clip; the LEDs recolour; removing
  the effect restores; stacks with other volumetric clips; respects the ≤4-active cap.

## Invariants / risks

- **JS/GLSL lockstep** — the packer + fold twin must match the sampler (the GPU-parity
  test enforces it), same discipline as the fields.
- **`uVolCount == 0` unchanged** — no volumetric clips ⇒ no new code runs; output stays
  byte-identical to the plain sampler.
- **2D clips are untouched** — they keep running their full effect chain (all classes) in
  the compositor. Only volumetric clips get the sampler-side colour chain.
- Keep the per-LED cost bounded: the fold is a short switch over ≤N effects per clip.

## Non-goals (Phase 1)

Coordinate/domain-warp effects (Phase 2 — warp `p` before `fieldColor`), neighbourhood
effects (Phase 3 — topology blur on the LED graph, or opt-in bake-to-buffer), and any
shared compositor/sampler effect-engine refactor (the eventual unified end-state).
