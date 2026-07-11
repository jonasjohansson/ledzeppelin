# Audio Trigger — Level (Threshold) Mode — Design

**Date:** 2026-07-06
**Status:** Approved (brainstorm). Synthesized from 3 parallel design lenses (performer UX, UI/interaction, codebase-fit).

## Goal

Add a second per-clip audio-trigger mode: **Level** — fire when a band's level is over an
**absolute threshold** — set by **dragging a line directly on the clip's FFT spectrum**. Keep the
existing **Onset** (spike-above-average) mode. Unify the language: one **"Threshold"** control,
one direction (**higher = harder to fire**) in both modes.

## Model

`clip.audioTrigger` gains two keys (both optional; absent → today's behavior):
- `mode: 'onset' | 'level'` (default `'onset'`).
- `threshold: 0..1` (level mode's absolute gate; default `0.5`).

Existing `sensitivity` (onset) stays as-is — it already reads *higher = harder* (`ema*(1+sensitivity)`),
so the rename to **"Threshold"** is a **pure UI relabel, no value migration, no behavior change**.

Both modes expose the same three knobs: **Band · Threshold · Hold**.
- **Onset** — Threshold slider (backed by `sensitivity`, ~0.05–2): "spike size needed above the
  running average." Hold = min gap between fires.
- **Level** — Threshold via the **draggable line** (backed by `threshold`, 0–1): "level needed to
  fire." Fire on the rising cross ≥ threshold; re-arm once level drops below `threshold − hysteresis`
  (**~0.05, baked in, no knob**) to stop chatter at the line; **Hold** = minimum re-fire time.
  The AnalyserNode already smooths (`smoothingTimeConstant 0.8`), so no extra smoothing control.

## The star control — the FFT spectrum becomes the threshold setter

In **Level** mode the existing clip spectrum (`src/ui/spectrum.js`) shows:
- a **draggable horizontal line** at `y = (1 − threshold)·H` (hairline; ±8px hit-zone; `ns-resize`
  cursor; a small handle nub at the right as the affordance; **click the value to type**);
- the **selected band filled as a column up to its live level** (reuse the existing level tick →
  a fill), so you see the level against the line;
- a **peak-hold tick** — a decaying max marker — so you can set the line just under the peaks;
- the **existing fire-flash** — line + fill go accent when the level crosses and the clip fires.

In **Onset** mode the same canvas shows the **running-average baseline as a faint dotted line**
(read-only reference for what onset is comparing against); the Threshold *slider* is the control.

Drag math must be **DPR-correct** (client-Y → canvas-Y uses `devicePixelRatio`); the widget is
recreated on every inspector re-render, so pointer handlers are re-bound with fresh props (the rAF
self-cancels on `!el.isConnected` — no leak).

## Components / edits (4 files, surgical — no refactor)

1. **`src/model/onset.js`** — add `createLevelGateDetector({ threshold, refractoryMs })`:
   armed-state gate. `push(v, nowMs)`: fire when `armed && v ≥ threshold && nowMs − lastFire ≥
   refractoryMs` (disarm + stamp on fire); re-arm when `v < threshold − HYSTERESIS`. `reset()`.
   (Onset detector unchanged.)
2. **`src/model/clip-triggers.js`** — `poll` picks the detector by `at.mode` (`'level'` →
   level gate, else onset). Extend `sigOf` to include `mode` + `threshold` so switching mode or
   dragging the threshold rebuilds the detector.
3. **`src/ui/layers.js`** (audio-trigger block) — add a **Trigger mode** select (Onset | Level);
   the **Threshold** control swaps by mode (Onset → the renamed slider; Level → no slider, the
   spectrum line is the control, plus a click-to-type numeric); **Hold** stays for both; hint text
   is mode-aware. Pass `mode`/`threshold`/`onThresholdChange` to the spectrum. Rename the existing
   "Sensitivity" label → **"Threshold"**.
4. **`src/ui/spectrum.js`** — new props `{ mode, threshold, level, onThresholdChange }`; draw the
   threshold line (level) / dotted baseline (onset), the band fill, the peak-hold tick; pointer
   drag → `onThresholdChange(clamped 0..1)` (DPR-correct); keep the existing bars/regions/flash.

## Data flow

```
mic → externalBand(band) (0..1 band average)  ─┬─► clip-triggers.poll → level gate (≥ threshold) → fire
                                                └─► spectrum: band fill + peak-hold vs the threshold line
drag line → onThresholdChange → setAT({threshold}) → clip.audioTrigger.threshold (persist)
```

## Error handling / edges
- Mic off → spectrum placeholder (unchanged); no fire.
- Absent `mode`/`threshold` → onset (back-compat). Old shows load unchanged.
- Mode switch mid-show rebuilds the detector cleanly (sig change) — a brief re-arm, harmless.
- Level gate + Hold: a sustained loud band fires once, then not again until it dips and Hold elapses.
- Drag clamps 0..1; click-to-type parses + clamps.

## Testing
- **`test/onset.test.js`** (extend): level gate fires on rising cross ≥ threshold; does NOT re-fire
  while held above; re-arms only after dropping below `threshold − hysteresis`; Hold enforces min
  re-fire; `reset()` re-arms.
- **`test/clip-triggers.test.js`** (extend): a `mode:'level'` clip uses the gate (fires while a
  synthetic band sits above threshold, respecting Hold), independent of an `onset` clip; sig change
  on mode/threshold rebuilds.
- **`test/spectrum.test.js`** (extend): a pure `thresholdY(threshold, H)` / `yToThreshold(y,H)`
  round-trip (the drag math), and peak-hold decay is a pure helper if extracted.
- Manual smoke: Level mode, drag the line, watch the band fill cross it and the clip fire; switch
  to Onset → dotted baseline + slider.

## Out of scope (YAGNI)
Input gain / exposed noise-floor / attack-release knobs, per-band multi-threshold, a threshold line
in onset mode (baseline is read-only there), MIDI-learn on the threshold.
