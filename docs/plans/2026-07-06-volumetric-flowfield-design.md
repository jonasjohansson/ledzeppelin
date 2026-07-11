# Volumetric `flowfield` source — design

**Date:** 2026-07-06
**Status:** approved, ready for planning

## Goal

Add one new volumetric source, `flowfield`: an organic, directional flow that
reads as filaments of particles streaming in a wind direction. It is the
organic, directional cousin of the existing `noise3d` drift.

## Approach — stateless, procedural (curl noise)

Every existing volumetric source is a stateless analytic field
`f(x,y,z,t) → premultiplied rgba` evaluated per-LED, per-frame in the sampler
pass. `flowfield` keeps that invariant — **no particle buffer, no simulation
state.** We fake convincing moving particles with **domain-warped curl noise**:

Per LED at world position `p`:
1. **Scroll** along the wind direction over time: `q = p*scale - dir*speed*t`,
   where `dir = normalize(wind)` (guarded so `wind ≈ 0` → static). Wind sets the
   **direction**; `speed` is an **explicit, independent** scroll rate.
2. **Curl offset:** compute the curl of a 3D noise potential at `q`. Curl noise
   is divergence-free, so it swirls like a fluid instead of pooling — this is
   what makes the flow read as organic rather than as scrolling static.
3. **Domain warp:** sample a second noise at `q + turbulence*curl`. This bends
   the filaments along the flow.
4. **Anisotropic stretch (trails):** elongate the noise lookup along the flow
   direction so filaments become streaks. `trail` 0 = round blobs, 1 = long
   streaks. The streak *is* the trail — no history buffer needed.
5. **Contour → brightness:** map the warped scalar to a bright band whose width
   is `thickness`; multiply by `color` (or tint from the canvas if `fromCanvas`).
6. **Randomness (`seed`):** offset the noise domain (each clip/instance looks
   different) plus a little per-filament jitter, so it never reads mechanical.

Curl noise costs ~3–4 noise samples per LED — comfortably within budget given
the ≤4-active-volumetric cap.

## Params (9 floats + color + fromCanvas)

The strict `a`+`b` slots hold 8 floats and are full. `flowfield` uses only one
colour, so the **secondary-colour slot `colB` is free** — a spare vec3 per field.
We park the 9th float (`speed`) in `colB.x`. Packing:
- `a[i]` = (windX, windY, windZ, scale)
- `b[i]` = (turbulence, thickness, trail, seed)
- `colB[i].x` = speed (reusing the unused secondary-colour slot)
- `colA` = color, `fromCanvas` flag in `meta`

| key | type | range | default | role |
|---|---|---|---|---|
| `windX` | float | −1…1 | 0.3 | wind direction X |
| `windY` | float | −1…1 | 0 | wind direction Y |
| `windZ` | float | −1…1 | 0 | wind direction Z |
| `speed` | float | 0…2 | 0.4 | scroll rate along wind (independent) |
| `scale` | float | 0.2…8 | 2 | spatial frequency (filament fineness) |
| `turbulence` | float | 0…1 | 0.5 | curl warp amount (calm → churning) |
| `thickness` | float | 0…1 | 0.4 | filament / streak width |
| `trail` | float | 0…1 | 0.5 | anisotropic stretch along flow |
| `seed` | float | 0…1 | 0 | randomness (noise-domain offset + jitter) |
| `color` | color | — | #ffffff | tint |
| `fromCanvas` | bool | — | false | tint from composited canvas instead |

All params are animatable/mappable (timeline/audio/OSC-MIDI) exactly like every
other source param. Default feel = **gentle drift**: slow, wide filaments
streaming sideways — the safe ambient default for a permanent install.

## Where it lands — the 3-file lockstep

Follows the established add-a-field pattern. The integer id, the packing
branches, and the GLSL branch must all agree.

1. **`src/engine/shaders/manifest.js`**
   - `FLOWFIELD_THUMB` GLSL const (small standalone preview shader).
   - Registry entry `flowfield` with `volumetric: true`, `src: FLOWFIELD_THUMB`,
     the `params[]` above.
   - `LABELS` entry.
2. **`src/engine/fields.js`**
   - `FIELD_IDS.flowfield = 6`.
   - `flowfield(p, t, {...})` JS twin (source of truth).
   - `packVolumetrics` branch: `a = (windX,windY,windZ,scale)`,
     `b = (turbulence,thickness,trail,seed)`, `colB[i].x = speed`, `colA = color`.
   - `evalPacked` branch for tests.
3. **`src/engine/sampler.js`** — `if (id == 6)` branch in `fieldColor`, GLSL twin
   of the JS math (curl noise + domain warp + anisotropic stretch + contour),
   reading `uVolA[i]`/`uVolB[i]`/`uVolColA[i]` and `speed` from `uVolColB[i].x`,
   returning premultiplied `vec4`.
4. **`src/ui/layers.js`** — add `flowfield` to the hardcoded `SOURCE_CATEGORIES`
   `'Volumetric'` group (this list is not auto-derived).
5. **`test/fields.test.js`** — JS-twin parity + behavior tests: flow moves along
   `wind`, `turbulence`/`trail`/`thickness` monotonic effects, `seed` decorrelates,
   `wind = 0` is static, output premultiplied & in range.
6. *(optional)* `src/ui/preview.js` `drawFieldGhosts` — a 3D viewport schematic.

## Invariants / risks

- **JS twin ↔ GLSL twin parity** must hold (the e2e GPU-parity check enforces it).
  Curl noise + warp is the most math this system has had in one field — keep the
  noise basis identical between JS and GLSL.
- **`uVolCount == 0` unchanged:** with no volumetric clips the sampler loop never
  runs; output stays byte-identical to the plain sampler.
- **Premultiplied output** — rgb already × alpha, like every other field.
