# Clip FFT Visualizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A live mic FFT spectrum in each clip's Audio Trigger inspector — bars + bass/mid/high regions + selected-band highlight + flash on fire — to tune per-clip triggers by eye.

**Architecture:** `audio.js` exposes `AUDIO_BAND_SPLIT` (single source of truth for the band boundaries, used by both `computeBands` and the viz) + `externalFFT(out)` (self-refreshing mic spectrum). A new `src/ui/spectrum.js` has pure draw-model helpers (unit-tested) + a self-cancelling rAF canvas widget. It mounts in `layers.js`; a `clipTrigsFor` hook from `app.js` drives the flash. Design: `docs/plans/2026-07-06-clip-fft-visualizer-design.md`.

**Tech Stack:** Vanilla ESM, Canvas 2D, Web Audio AnalyserNode, Node built-in test runner.

---

## Task 1: audio.js — expose the band split + the raw FFT

**Files:** Modify `src/model/audio.js`; Test `test/audio-split.test.js`

**Step 1: Failing test** — `test/audio-split.test.js` (guards the DRY refactor; audio.js needs
Web Audio so we test the constant + that computeBands references it, not the runtime):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUDIO_BAND_SPLIT } from '../src/model/audio.js';

test('AUDIO_BAND_SPLIT matches the historical bass/mid/high boundaries', () => {
  assert.deepEqual(AUDIO_BAND_SPLIT.bass, [0, 0.10]);
  assert.deepEqual(AUDIO_BAND_SPLIT.mid, [0.10, 0.40]);
  assert.deepEqual(AUDIO_BAND_SPLIT.high, [0.40, 1]);
});

test('computeBands derives its ranges from AUDIO_BAND_SPLIT (no stray hard-coded 0.40)', () => {
  const src = readFileSync(new URL('../src/model/audio.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function computeBands'), src.indexOf('function computeBands') + 600);
  assert.match(body, /AUDIO_BAND_SPLIT/);           // uses the constant
  assert.doesNotMatch(body, /0\.40|0\.10/);          // no leftover magic boundaries
});
```

**Step 2: Run — `node --test test/audio-split.test.js` — FAIL (no export).**

**Step 3: Implement** — in `src/model/audio.js`:
Add the export near the top (by `AUDIO_BANDS`):
```js
// The bin-fraction ranges for each band — the ONE source of truth shared by computeBands
// (modulation) and the FFT visualiser (src/ui/spectrum.js). `level` is the full range.
export const AUDIO_BAND_SPLIT = { bass: [0, 0.10], mid: [0.10, 0.40], high: [0.40, 1] };
```
Refactor `computeBands` (currently hard-codes `n*0.10`/`n*0.40`) to derive from it:
```js
function computeBands(s) {
  if (!s.enabled || !s.analyser) return s.bands;
  s.analyser.getByteFrequencyData(s.data);
  const d = s.data, n = d.length;
  const avg = (a, b) => { let x = 0; for (let i = a; i < b; i++) x += d[i]; return b > a ? x / ((b - a) * 255) : 0; };
  const g = globalGain, clamp = (x) => (x > 1 ? 1 : x < 0 ? 0 : x);
  const rng = (band) => { const [lo, hi] = AUDIO_BAND_SPLIT[band]; return avg(Math.floor(n * lo), Math.floor(n * hi)); };
  s.bands.bass = clamp(rng('bass') * g);
  s.bands.mid = clamp(rng('mid') * g);
  s.bands.high = clamp(rng('high') * g);
  s.bands.level = clamp(avg(0, n) * g);
  return s.bands;
}
```
Add the FFT accessors near `externalBand`:
```js
// Live mic spectrum into a caller-owned Uint8Array (length >= binCount). Returns the bin
// count, or 0 when the mic isn't running. Self-refreshing → the visualiser reads it on its
// own rAF without depending on the main render loop.
export function externalFFT(out) {
  const s = SRC.external;
  if (!s.enabled || !s.analyser) return 0;
  s.analyser.getByteFrequencyData(out);
  return s.analyser.frequencyBinCount;
}
export function externalBinCount() { return SRC.external.analyser?.frequencyBinCount || 512; }
```

**Step 4: Run — PASS. Also `npm test` green** (the refactor must not change any existing audio
behavior — band values are computed from the same fractions).

**Step 5: Commit** — `feat(audio): AUDIO_BAND_SPLIT + externalFFT() for the spectrum viz`
(Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; hook bumps version.)

---

## Task 2: `spectrum.js` — pure helpers (TDD) + the widget

**Files:** Create `src/ui/spectrum.js`; Test `test/spectrum.test.js`

**Step 1: Failing test** — `test/spectrum.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandRegions, barHeights } from '../src/ui/spectrum.js';

const SPLIT = { bass: [0, 0.10], mid: [0.10, 0.40], high: [0.40, 1] };

test('bandRegions maps the split to ordered, gapless pixel spans covering the width', () => {
  const r = bandRegions(SPLIT, 200);
  assert.deepEqual(r.map((x) => x.band), ['bass', 'mid', 'high']);
  assert.equal(r[0].x0, 0);
  assert.equal(r[2].x1, 200);
  for (let i = 1; i < r.length; i++) assert.equal(r[i].x0, r[i - 1].x1);   // gapless
  assert.deepEqual([r[0].x1, r[1].x1], [20, 80]);                          // 10% / 40% of 200
});

test('barHeights maps 0..255 bins to 0..height, length n', () => {
  const fft = new Uint8Array([0, 255, 128, 64]);
  const h = barHeights(fft, 4, 100);
  assert.equal(h.length, 4);
  assert.equal(h[0], 0);
  assert.equal(h[1], 100);
  assert.ok(Math.abs(h[2] - 50.2) < 1);      // 128/255*100
});
```

**Step 2: Run — FAIL (no module).**

**Step 3: Implement** — `src/ui/spectrum.js`:
```js
// Live FFT spectrum for a clip's Audio Trigger inspector. Pure draw-model helpers (tested)
// + a self-animating <canvas> that stops when detached. Reads the mic via externalFFT.
import { externalFFT, externalBinCount, externalBand, AUDIO_BAND_SPLIT } from '../model/audio.js';

// Pixel spans for each band across `width`, ordered, gapless. [{band, x0, x1}].
export function bandRegions(split, width) {
  return ['bass', 'mid', 'high'].map((band) => {
    const [lo, hi] = split[band];
    return { band, x0: Math.round(lo * width), x1: Math.round(hi * width) };
  });
}

// Per-bin bar heights (px), fft value 0..255 → 0..height.
export function barHeights(fft, n, height) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (fft[i] || 0) / 255 * height;
  return out;
}

// createClipSpectrum({ band, trigsFor }) → { el } — a small self-animating canvas.
// `band`: the clip's selected band (highlighted). `trigsFor()`: () => number[] of that clip's
// trigger timestamps (flash when the newest grows). Both optional.
export function createClipSpectrum({ band = 'bass', trigsFor } = {}, doc = document) {
  const el = doc.createElement('canvas');
  el.className = 'clip-spectrum';
  el.width = 240; el.height = 48;                 // CSS can scale; DPR handled on first draw
  const ctx = el.getContext('2d');
  const buf = new Uint8Array(externalBinCount());
  let lastTrig = -Infinity, flashUntil = 0, started = false;
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

  function sizeOnce() { if (started) return; started = true; el.width = 240 * dpr; el.height = 48 * dpr; el.style.width = '240px'; el.style.height = '48px'; ctx.scale(dpr, dpr); }

  function frame() {
    if (!el.isConnected) return;                  // detached (inspector re-render) → stop
    sizeOnce();
    const W = 240, H = 48;
    ctx.clearRect(0, 0, W, H);
    const n = externalFFT(buf);
    if (!n) {                                     // mic off
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '10px monospace';
      ctx.fillText('enable the mic in Settings', 8, H / 2 + 3);
      requestAnimationFrame(frame); return;
    }
    // shaded band regions (+ highlight the selected one)
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    const trigs = (typeof trigsFor === 'function' && trigsFor()) || [];
    const newest = trigs.length ? trigs[trigs.length - 1] : -Infinity;
    if (newest > lastTrig) { lastTrig = newest; flashUntil = now + 150; }
    const flashing = now < flashUntil;
    for (const r of bandRegions(AUDIO_BAND_SPLIT, W)) {
      const sel = r.band === band;
      ctx.fillStyle = sel ? (flashing ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)') : 'rgba(255,255,255,0.03)';
      ctx.fillRect(r.x0, 0, r.x1 - r.x0, H);
    }
    // spectrum bars (bin → x across width)
    const hs = barHeights(buf, n, H);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < n; i++) { const x = (i / n) * W; ctx.fillRect(x, H - hs[i], Math.max(1, W / n), hs[i]); }
    // level tick for the selected band
    const lv = externalBand(band);
    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    const reg = bandRegions(AUDIO_BAND_SPLIT, W).find((r) => r.band === band);
    if (reg) ctx.fillRect(reg.x0, H - lv * H, reg.x1 - reg.x0, 2);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { el };
}
```
(Adjust colors/classes to match the app's palette if there's an obvious accent variable — but
keep it neutral/monochrome per the UI aesthetic. Add a `.clip-spectrum` rule to the stylesheet if
the inspector needs spacing — grep the CSS for where inspector rows are styled.)

**Step 4: Run — `node --test test/spectrum.test.js` PASS; `npm test` green.**
**Step 5: Commit** — `feat(ui): FFT spectrum widget (pure helpers + self-animating canvas)`

---

## Task 3: Wire the spectrum into the clip inspector

**Files:** Modify `src/app.js`; Modify `src/ui/layers.js`

**Step 1: app.js hook.** At the `createLayerPanel({ ... })` call (~app.js:464) add a hook:
```js
  clipTrigsFor: (id) => clipTriggers.trigsFor(id),
```
**Step 2: layers.js.** (a) Add `clipTrigsFor` to the destructured params of `createLayerPanel`
(~line 494). (b) Import the widget at the top: `import { createClipSpectrum } from './spectrum.js';`
(c) In `selectedClipEditor`'s audio-trigger block (after the Hold slider / the hint), mount it:
```js
      box.append(createClipSpectrum({ band: at.band || 'bass', trigsFor: () => clipTrigsFor?.(clip.id) }).el);
```
(The block re-renders when the clip/band changes, so the widget is recreated with the current
band — no manual update needed; the old canvas detaches and its rAF self-cancels.)

**Step 3:** `node --check src/app.js && node --check src/ui/layers.js`; `npm test` green.
**Step 4: Commit** — `feat(ui): show the FFT spectrum in the clip Audio Trigger inspector`

---

## Task 4: Verify + release

**Step 1:** `npm test` — all green (incl. `audio-split` + `spectrum` tests).
**Step 2: Manual smoke** (`npm start`): enable the mic (Settings → audio input); select a triggerable
clip (Pulse / Sphere Pulse / Plane Pulse); confirm the inspector shows live spectrum bars, the three
band regions shaded, the selected Band highlighted, a level tick, and a flash when the clip fires
(play music with Fire-on-sound enabled). Switch Band → highlight moves. Disable mic → placeholder.
**Step 3:** Cut a signed/notarized release (session cadence) + update memory.
