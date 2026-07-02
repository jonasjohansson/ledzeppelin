# Volumetric sources — z-aware light fields (design)

**Date:** 2026-07-02
**Status:** SHIPPED 2026-07-02 — fields.js kit + sampler field pass + clips-in-deck UI;
no-volumetric byte-identical invariant verified before/after; e2e in test/e2e/volumetric.e2e.mjs.
Notes vs. design: positions carry real z only via the 3D projection path (Front/Front-wide —
the Flat camera keeps z = 0, the byte-identical guarantee); volumetric clips switch without
crossfade; sphere-pulse triggers ride the global ⚡ clock like Pulse/Radial.
Follow-up shipped 2026-07-02: the 3D viewport draws a schematic GHOST per active field
(plane quad / gradient arrow / sphere rings / noise-lattice dots — preview.js
drawFieldGhosts) from the same packVolumetrics uniforms, toggled by the FIELDS chip in
the projection row (localStorage `lz.fieldghosts`, default on); pure viewport chrome —
sampling untouched. e2e: test/e2e/fieldghosts.e2e.mjs.

## Why

3D mapping (Phases 1–5) lets fixtures stand in space — but the projection model
(approach A) collapses depth: every LED at the same projected screen point gets the
same color, so nothing can vary *along z*. The motivating ask: **"a color that moves
up and down in z"** climbing a standing arch. That requires evaluating light at each
LED's world position — a field, not an image.

## What (decided)

- **NOT a volumetric engine rewrite.** The 2D canvas/composition stays the heart of
  the app. Volumetrics are a **small per-LED pass on top**.
- **A volumetric source kit** — fields `f(x, y, z, t) → rgba` evaluated at each LED's
  world position (which the pipeline already computes: `samplePoints3D` before
  projection). v1 kit:
  - **Plane sweep** — a colored plane (thickness, softness) moving along a chosen
    axis (x/y/z); `pos` animatable → the motivating use case.
  - **Axis gradient** — a color ramp along x/y/z, scrollable.
  - **Noise 3D** — fbm value-noise in space (organic volume shimmer), with an
    optional directional **drift** (axis + speed, default off) that flows the
    whole volume along x/y/z — drift along z climbs a standing arch.
  - **Sphere pulse** — radial burst from a point in space (triggerable).
- **UI: clips in the same deck** (interview decision). Volumetric sources appear in
  the clip picker under a **"Volumetric"** group and live in the layer/clip grid like
  any clip — same triggering, params, modulation (timeline/audio/OSC-MIDI), naming.
  No new UI surface.
- **Blending: standard blend modes** (interview decision). A volumetric clip's layer
  opacity + blend (over/add/multiply) apply **per-LED after canvas sampling**:
  `led = blend(canvasSample(uv), field(xyz), mode, opacity)`.

## Architecture

The seam is the **GPU sampler** (`src/engine/sampler.js`): it already visits every
LED (reading the composited canvas at that LED's UV). Extend it:

1. **Per-LED world positions** — the pipeline already derives them; pass xyz alongside
   uv into the sampler (a second attribute/texture, matching the existing uv map's
   layout). 2D fixtures get z = 0 — fields still work on a flat rig.
2. **Field evaluation in the sampler shader** — a fixed small set of field functions
   (the kit) with a uniform block per ACTIVE volumetric clip: field id, params, color,
   blend mode, opacity. Cap simultaneous volumetric clips (4) for uniform budget —
   `log`/document the cap honestly in the UI (extras ignored oldest-first or by layer
   order; pick and document).
3. **Param flow** — volumetric clips reuse the existing per-frame clip-param
   computation (animation/modulation included); their resolved params go to sampler
   uniforms instead of compositor uniforms. The clip is **skipped by the 2D
   compositor** (it has no canvas image; its cell shows a generated thumbnail/label).
4. **Preview comes free** — the wall Preview and the 3D viewport LED dots color from
   the sampled output buffer, which now includes the volumetric pass. The flat canvas
   view shows no volumetric contribution (correct: it isn't on the canvas) — the 3D
   viewport + Preview are where volumetrics read.

### Coordinate space

Fields evaluate in the fixture world space: x, y ∈ 0..1 across the canvas, z in the
same scale (z=0 = canvas plane) — identical to project3d's convention. Plane sweep
`axis=z, pos` sweeps from the canvas plane upward through lifted geometry.

## Invariants

- Zero new runtime deps; `server/` untouched (per-LED colors already flow through the
  existing flat buffer).
- A show with NO volumetric clips samples **byte-identically** to today (regression
  test — the field pass must be a true no-op when inactive).
- 2D mode: volumetric clips still evaluate (z=0 plane) — a plane sweep along z acts
  as a global fade as it passes 0; along x/y it sweeps across the rig. Document this;
  it is coherent, not an error.
- Params animatable/mappable exactly like 2D source params.

## Testing

- Pure: field math extracted to a testable module (`src/engine/fields.js` or inline
  manifest-style GLSL + a JS twin for tests — prefer a JS reference implementation
  unit-tested against known values: plane at pos hits LEDs within thickness,
  gradient endpoints, sphere radius).
- Pipeline: xyz buffer layout matches the uv map layout (same LED order — pinned).
- No-volumetric regression: sampled bytes identical to pre-feature snapshot.
- Playwright: add a Plane Sweep clip on a lifted arch in 3D; Preview shows the band
  climbing; screenshots; no page errors.

## Out of scope (v1)

- Volumetric EFFECTS chains (fields are sources only; the clip's effect chain is
  disabled/hidden for volumetric clips in v1).
- Arbitrary user GLSL fields (ISF-style) — future.
- More than 4 simultaneous volumetric clips.
