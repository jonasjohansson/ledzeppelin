# 3D Mapping (2D/3D mode) — Design

**Date:** 2026-07-01
**Branch:** `feat/3d-mapping`
**Status:** approved — ready for implementation plan

## Goal

A **3D authoring mode** for the rig. Fixtures and their polyline points gain XYZ; an
orbitable isometric/perspective viewport lets you arrange them in space; strips can be
**bezier** curves ("pull the centre dot up → a standing arch"). The existing 2D visuals
are **projected** onto the 3D-positioned rig through a fixed projection camera — so, e.g.,
a line sweeping down the canvas travels through an arc with real foreshortening.

This is **arrangement + projection (approach A)**, explicitly **not** volumetric visuals.
The visual engine (sources, effects, GPU sampler, daemon output) is reused unchanged; 3D
only changes *where each LED reads from* on the 2D composition.

## Confirmed decisions

- **A, not B** — project the 2D composition onto 3D-arranged strips; no volumetric/3D-field sources.
- **Projection camera is separate from the orbit/inspect camera.** You orbit freely to edit; the visual always projects from a fixed, placeable projection camera (front-orthographic by default) so the mapping is stable regardless of viewpoint.
- **2D is the flat-front special case** of 3D — every z = 0 + a front orthographic projection camera → byte-identical to today. The toggle is one projection with the camera locked flat (2D) vs. free + orbitable (3D).
- **Hand-rolled projection, zero new runtime deps** (no three.js — the app ships dependency-free; current deps: `ws` only). The viewport draws by projecting 3D→2D onto the existing stage canvas + SVG chrome layer.
- **Vertex editing:** drag = ground plane (X/Z); a modifier constrains to height (Y); plus precise numeric XYZ fields in the inspector.
- **The 2D/3D toggle** is a top-bar button in the canvas-tools cluster (`#corner-toggles`, by Snap · Grid · Tint · Preview), default 2D, persisted in `composition.view3d.mode`.

## Architecture

### The seam (why this is tractable)

`src/model/pipeline.js` derives each fixture's sample UVs from `input.points` (normalized
2D) via `samplePoints`. This is the **only** place that turns geometry into "where to read
the canvas." Make points carry XYZ and project them here, and everything downstream
(`sampling.js`, the GPU sampler, `pipeline.js`'s daemon route, `preview.js` output tap) is
untouched. **3D is entirely authoring-side; the output/daemon path never changes.**

### Data model

- `input.points`: `[x, y]` → `[x, y, z]`. Missing z reads as **0** (lazy migration — every existing show stays valid; existing `transform`/`pointsFromTransform` unchanged).
- `input.mode`: `'bar' | 'polyline' | 'bezier'`. Bezier fixtures store control points; the evaluated curve becomes the sampled centreline.
- `composition.view3d`: `{ mode: '2d' | '3d', projectionCamera: { pos, target, up, ortho | fov, ... }, orbit: { az, el, dist, target } }`. Absent → `'2d'` with the implicit flat-front camera.

### Projection core — `src/model/project3d.js` (new, pure)

- `buildCamera(cfg, canvasAspect)` → view + projection matrices (orthographic for flat/2D, perspective for 3D).
- `project(xyz, cam) → [u, v]` normalized canvas coords.
- `unproject(u, v, cam) → ray` + `rayGroundHit(ray) → xyz` — for dragging vertices in the viewport.

### Sampling — `src/model/sampling.js`

- `samplePoints3D(points, n)` — resample a 3D polyline by **3D arc length** (LEDs stay physically even).

### `pipeline.js: fixtureUVs`

- 3D fixture: `samplePoints3D(points3d, samples)` (physical LED positions) → `project` each → UV. Foreshortening is emergent: physically-even LEDs bunch up in the image where the arc bends away in depth.
- 2D fixture (all z = 0 + flat-front camera): identical UVs to today. **Regression-guarded.**

### 3D viewport (UI)

- The stage overlay renders through the **orbit camera**: a ground grid, strips as projected polylines, per-vertex handles, and the **projection-camera frustum gizmo**.
- Orbit = azimuth/elevation/distance; drag-rotate, scroll-zoom, pan. Hand-rolled ortho + perspective.
- **2D mode** locks the render to the flat-front camera, hides Z/orbit, and editing reverts to today's bar/polyline gestures on the flat canvas.

### Editing

- Vertex handles: drag on the ground plane (X/Z); modifier → height (Y). Numeric XYZ in the inspector for precision. Whole-fixture Z offset.
- **Bezier mode:** flag a fixture bezier; show control handles. A **quadratic** (two ends + one mid control) lifted in Y bows a flat strip into a symmetric standing arch. Evaluated to an N-segment polyline, then sampled physically. (Cubic is a later option.)

## Phasing (each step shippable + testable)

1. **Engine seam** — XYZ points, `project3d.js`, `samplePoints3D`, `fixtureUVs` projection; 2D regression-identical. *Pure, unit-tested, no UI.*
2. **Orbit viewport** — render the projected scene + ground grid + strips through the orbit camera; the 2D/3D toggle.
3. **Editing** — per-vertex XYZ (drag + numeric), fixture Z.
4. **Bezier arc** mode.
5. **Projection-camera placement** gizmo (front default until then).

## Testing

- `node:test` on `project3d` / `samplePoints3D` / `fixtureUVs`:
  - 2D fixtures produce **UVs identical to today** (regression).
  - A physically-even semicircular arc projects **denser near the apex** (foreshortening).
  - A bezier mid-lift yields a **symmetric arch**.
  - `unproject` round-trips a ground-plane point.
- Viewport + editing verified via Playwright (DOM + screenshots).

## Non-negotiables

- **Zero new runtime deps.**
- **Output/daemon path unchanged** — 3D is authoring-only.
- **Every existing 2D show works unchanged** (lazy z = 0).
- Per-sample matrix multiply — negligible cost.

## Out of scope (v1)

- Volumetric 3D visuals (approach B).
- Multiple projection cameras / multi-projector blending.
- 3D geometry import from LEDger (LEDger is 2D today) — future.
