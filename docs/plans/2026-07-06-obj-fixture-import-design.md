# OBJ → Fixture Import (Phase C) — Design

**Date:** 2026-07-06
**Status:** Approved (brainstorm). Supersedes the Blender-plugin sketch in the Phase C
section of `2026-07-06-audio-trigger-shader-pack-design.md`.

## Goal

Design an installation in any 3D tool (Blender, Cinema 4D, Maya, …), export it, drag the
file onto LED Zeppelin, and have each modeled run appear as a fixture — with 3D positions,
pixel counts, and output wiring — automatically.

## Why OBJ, app-side (the agnostic choice)

The user's steer: *tool-agnostic, low effort, no per-tool plugin.* So all logic lives in the
app (one code path, in JS, testable in the node suite), and the interchange is **Wavefront
OBJ**:
- Every DCC exports OBJ; it's plain text → a dependency-free parser (fits "no build step,
  zero runtime deps").
- It preserves each run as an **ordered polyline** (`v` vertices + `l` line elements),
  grouped by object name (`o`/`g`).
- Object names carry LED metadata via a `Name__key=val` convention (below).
- It reuses the **existing, tested** `src/model/kagora-import.js` pipeline for the hard parts
  (normalize by bounding box, arc-length resample to LED positions, pack output offsets).

Rejected: a Blender/C4D plugin (per-tool, high maintenance); glTF (curves aren't in core,
DCC exporters rarely emit line primitives); native-project export (duplicates
normalization + offset packing).

## Naming convention (LED data in the object name)

Each OBJ object (`o Name…`) is `Name__key=val__key=val…`:

| Token | Meaning | Default |
|---|---|---|
| *(base name)* | fixture name | object name |
| `leds=204` | pixel count **(required)** | — (skip run + warn if absent) |
| `lpm=60` | LEDs/metre | 60 |
| `order=GRBW` | color order | controller's / empty |
| `out=oct110.0` | controller-id `.` port | orphan (unassigned) |
| `dir=rev` | LED 0 at the far end (reverse point order) | fwd |

e.g. `Tail__leds=204__order=GRBW__out=oct110.0`. Runs sharing a controller id (`oct110`)
become one device; multiple runs on the same port daisy-chain in file order.

## Architecture / data flow

```
DCC → export .obj → drag onto app
  → parseObj(text)         : v / o|g / l  → [{ name, points:[[x,y,z]…] }]      (NEW, pure)
  → objToKagora(objects)   : names→metadata, group by controller, build         (NEW, pure)
                             LEDger preset { types, instances(strip/controller), edges }
  → importKagora(preset)   : normalize by bbox, polyline+z, output daisy-chain   (EXISTS, tested)
  → import UI applyShow()   : live fixtures                                        (EXISTS)
```

**Coordinate/axis:** the importer normalizes by the rig's bounding span, so absolute
scale/units are irrelevant — only orientation. Default map is a **direct passthrough**
(OBJ `x,y,z` → app `x,y,z`) documented as "export **Y-up**"; if a rig comes in mis-oriented
we add a simple axis-swap option. (App: x = canvas-horizontal, y = vertical, z = depth/height
off the plane.)

## Components

- **`src/model/obj-import.js`** (new, pure, no DOM):
  - `parseObj(text) → { objects: [{ name, points }] }`. Collect `v` (global, 1-indexed);
    split by `o`/`g`; within an object, order points by its `l` polyline element(s) if present,
    else by vertex-declaration order. Ignore `f`, materials, normals, uvs.
  - `parseName(name) → { name, leds, lpm, order, out, dir }` (the `__key=val` convention).
  - `objToKagora(objects) → preset`: one `strip` instance per named run (points `{x,y,z}`,
    reversed if `dir=rev`); a deduped `stripType` per unique `(leds, lpm, order)`; a
    `controller` instance per distinct `out` device id; an `edge` controller-port → strip for
    each `out=dev.port`. Runs missing `leds` are dropped with a warning.
- **Import wiring** (`src/ui/project-io.js` / `src/ui/import.js`): detect `.obj` (extension or
  a leading `v `/`o ` sniff) in the existing drag-drop/open handler → `objToKagora` →
  `importKagora` → the existing apply path (reuses IP/color-order carry-forward + warnings UI).
- **Docs:** the naming convention + "export as OBJ, Y-up" in the guide / a short README.

## Error handling
- No `leds=` on a run → skip it, add a warning (surfaced in the existing import warnings UI).
- A run with < 2 points → skip + warn.
- Empty/again-malformed OBJ → warn, no-op (don't clobber the current show).
- Reuses `importKagora`'s existing warnings (dangling wiring, duplicate ids, orphan strips).

## Testing (node suite, `node --test`)
- **`test/obj-import.test.js`**: `parseObj` on a sample string (v/o/l, multiple objects) →
  correct objects + ordered points; `parseName` token parsing + defaults; `dir=rev` reversal;
  `objToKagora` → `importKagora` round-trip asserting fixtures' pixelCount, colorFormat,
  `output.deviceId`/`port`, and normalized 3D points; a run without `leds` is dropped + warned.
- **`test/fixtures/whale-sample.obj`**: a small golden OBJ (2–3 named runs, one 3D) exercised
  end-to-end.

## Out of scope (YAGNI)
Mesh edge-path import, glTF, a per-tool plugin, exporting the *current* rig back to OBJ,
in-app axis-tuning UI beyond a single flip if needed.
