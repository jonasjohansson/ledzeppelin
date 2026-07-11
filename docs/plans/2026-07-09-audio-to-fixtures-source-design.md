# Audio → Fixtures source ("Audio Bars") — design

**Date:** 2026-07-09 · **Status:** approved, queued for implementation

## Goal
A turnkey source where **each fixture's brightness pulses with an assigned frequency band** —
bass / mid / high auto-mapped from fixture names, editable per fixture, each band with a base
colour. On the whale: Tail thumps on bass, Ribs shimmer on mids, Fins sparkle on highs.

## Decisions (from brainstorming)
- **Mapping:** auto by fixture name (Tail→bass, Rib*→mid, Fin*→high, else→mid), **editable** per fixture.
- **Reaction:** brightness pulse (band level → fixture brightness) over a per-band base colour, with gain + floor + smoothing.

## Architecture — the "source knows fixtures" part
A normal source only sees per-LED world position (`uPos`). This one needs two new inputs:

1. **Per-LED band tag `uBand`** — in `src/model/pipeline.js`, alongside the per-LED positions
   (`buildLedPositions` / `fixtureSamples`), build a per-LED band-index array (0=bass,1=mid,2=high)
   from each fixture's assigned band. Feed it to the sampler as a small texture, mirroring `uMap`/`uPos`
   (`src/engine/sampler.js` texture setup + `update()`).
2. **Audio band levels `uAudioBands` (vec3)** — the FFT system already computes band energy
   (verify exact signals in `docs/audio.md` + the audio agent / `signals`). Feed bass/mid/high as a
   `vec3` uniform to the sampler each frame from the render loop's `signals` (like `uT`/`uVolTime`).

3. **The `audiobars` field** — a per-LED field in `fieldColor` (GLSL) + JS twin:
   ```
   band = uBand[led];  level = smoothed(uAudioBands[band]);
   v = clamp(floor + level * gain, 0, 1);
   col = bandColor(band);   // premultiplied → v*col, v
   ```
   Smoothing (attack/decay) can live in the audio-signal side (per-band envelope) so the field stays
   stateless.

## Band assignment
- **Auto from name** via built-in keyword rules — a pure helper `fixtureBand(name)` (unit-tested):
  `/tail/i→bass`, `/rib/i→mid`, `/fin/i→high`, `/spline/i→mid`, default `mid`. Optional bass/mid/high
  **keyword params** on the source to customise the matches.
- **Per-fixture override** — an optional `audioBand` field on the fixture (`'auto'|'bass'|'mid'|'high'`),
  edited in the fixture inspector; `auto` uses the name rule. (Override UI can be a v1.1 follow-up; v1
  can ship auto-by-name only.)

## Params (fit the volumetric budget A[4]+B[4]+colA+colB)
`gain`, `floor`, `smoothing` (or attack/decay), plus band colours. NOTE: three full colours exceed
colA+colB — v1 uses **bassColor + highColor with mid interpolated**, OR a single base colour + a
per-band hue offset. Pick the cleaner at build. Pack: A=(gain, floor, smoothing, mode), colA=bassColor,
colB=highColor.

## Testing
- **Unit:** `fixtureBand(name)` mapping (tail→bass, rib→mid, fin→high, default), and the per-LED band
  array builder (right band index per LED given fixtures).
- **Live:** play audio in → confirm tail brightens on bass hits, fins on highs, no jitter (smoothing),
  no shader-compile errors (Playwright + the WebGL validation pattern used for the volumetric pack).

## Non-goals (v1)
Per-fixture VU-meter fill, hue-from-level, more than 3 bands, a full drag-assign UI (auto-by-name +
optional per-fixture override field is enough to ship).

## Sequencing
Queued behind: the 13 WLED 2D generators, the volumetric-pack merge/release, and the Pi-perf changes.
Build via subagent-driven development (pure helper + plumbing + field + live audio validation).
