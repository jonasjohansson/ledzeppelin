# Clip FFT Visualizer — Design

**Date:** 2026-07-06
**Status:** Approved (brainstorm).

## Goal

A small live FFT spectrum in each clip's Audio Trigger inspector: draw the mic spectrum, shade
the bass/mid/high regions (matching the trigger band split), highlight the clip's selected band,
show per-band levels, and flash when the clip fires — so you tune each per-clip audio trigger by eye.

## Context

- `src/model/audio.js`: `SRC.external.analyser` (fftSize 1024 → 512 bins), `SRC.external.data`
  (Uint8Array). `computeBands` uses `getByteFrequencyData` and splits bins bass 0–10% / mid
  10–40% / high 40–100% (hard-coded `0.10`/`0.40`). `externalBand(name)` already exists.
- The per-clip Audio Trigger controls live in `src/ui/layers.js selectedClipEditor` (the
  `gen?.triggerable` block: ⚡, enable, Band select, Sensitivity, Hold). `clip.audioTrigger.band`
  is the selected band. Per-clip trigger buses are in `src/model/clip-triggers.js` (in app.js).
- No spectrum/meter UI exists yet.

## Architecture

**`src/model/audio.js`:**
- `export const AUDIO_BAND_SPLIT = { bass: [0, 0.10], mid: [0.10, 0.40], high: [0.40, 1] };` — the
  single source of truth. Refactor `computeBands` to derive its bass/mid/high ranges from it (DRY;
  `level` stays full-range). Band values must be byte-identical after the refactor.
- `export function externalFFT(out)` — if the mic is running, `s.analyser.getByteFrequencyData(out)`
  and return `s.analyser.frequencyBinCount`; else return 0. `out` is a caller-owned `Uint8Array`
  (length ≥ binCount). Self-refreshing → the widget reads fresh data on its own rAF.
- `export function externalBinCount()` → `SRC.external.analyser?.frequencyBinCount || 0` (for
  sizing the caller's buffer; falls back to 512).

**`src/ui/spectrum.js`** (new):
- `createClipSpectrum({ band, trigsFor })` → `{ el }` (a `<canvas>`), self-animating:
  - Own `requestAnimationFrame` loop; **stops when `el.isConnected` is false** (inspector re-render
    detaches the old canvas → loop self-cancels, no leak, no handle to track).
  - Each frame: `externalFFT(buf)`; if 0 → draw a faint "enable the mic in Settings" placeholder.
    Else draw bars over the bins; shade the three `AUDIO_BAND_SPLIT` regions; brighten the region
    for `band`; draw a per-band level tick (reuse `externalBand`); if `trigsFor()` reports a
    newer newest-timestamp than last seen, set `flashUntil` and glow the selected region ~150ms.
  - Uses `performance.now()` for the flash clock (monotonic; fine in a browser widget).
- **Pure helpers (unit-tested):** `bandRegions(split, width) → [{band, x0, x1}]` (pixel spans),
  and `barHeights(fft, n, height) → number[]` (bin → bar px). Keep drawing thin around these.

**`src/ui/layers.js`:** in the audio-trigger block, append `createClipSpectrum({ band: at.band ||
'bass', trigsFor: () => clipTrigsFor(clip.id) }).el`. Re-created each inspector render, so a Band
change re-highlights. `clipTrigsFor` arrives via the panel hooks.

**`src/app.js`:** add `clipTrigsFor: (id) => clipTriggers.trigsFor(id)` to the object of hooks passed
into the layer panel (grep how the panel is constructed; add alongside `transport`).

## Data flow
```
mic → analyser → externalFFT(buf) each rAF → canvas bars
AUDIO_BAND_SPLIT → shaded regions (+ highlight clip's band)
externalBand(b) → per-band level tick
clipTrigsFor(clip.id) newest-timestamp grew → flash the selected region
```

## Error handling / edges
- Mic off (`externalFFT`→0): placeholder text, no bars. No throw.
- Canvas detached: rAF self-cancels via `isConnected`.
- Non-triggerable clip: no spectrum (the whole block is gated on `gen?.triggerable`).
- `trigsFor` may be undefined (defensive): guard → no flash.
- DPR: size the canvas backing store to `devicePixelRatio` for crisp bars (optional, match other
  canvases in the app if they do this).

## Testing
- **`test/spectrum.test.js`** (pure): `bandRegions` maps the split to correct pixel spans across a
  width (bass 0–10%, etc., ordered, non-overlapping, covering 0..width); `barHeights` maps bin
  values 0..255 to 0..height and length n.
- **`test/audio` (or extend existing):** after the `AUDIO_BAND_SPLIT` refactor, a small check that
  the split constant equals the old hard-coded boundaries (guards the DRY refactor). (computeBands
  itself needs Web Audio so isn't node-testable — assert the constant + that computeBands references it.)
- Manual smoke: enable mic, open a triggerable clip's inspector, confirm live bars, shaded regions,
  the selected band highlighted, and a flash on each fire.

## Out of scope (YAGNI)
Composition/video-source spectrum, log-frequency axis, a standalone spectrum window, waveform view,
configurable colors.
