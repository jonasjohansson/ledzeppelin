# Audio Trigger — Level (Threshold) Mode — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-clip **Level** trigger mode (fire when a band's level ≥ an absolute threshold) set by dragging a line on the clip's FFT spectrum, alongside the existing Onset mode; unify the control to one "Threshold" (higher = harder to fire).

**Architecture:** A new `createLevelGateDetector` in `onset.js`; `clip-triggers.js` picks onset-vs-gate by `clip.audioTrigger.mode`. `spectrum.js` gains a draggable threshold line + band fill + peak-hold. `layers.js` adds the mode toggle + threshold control + the "Sensitivity"→"Threshold" relabel. Design: `docs/plans/2026-07-06-audio-trigger-level-mode-design.md`.

**Tech Stack:** Vanilla ESM, Canvas 2D, Node built-in test runner.

---

## Task 1: Level-gate detector (TDD)

**Files:** Modify `src/model/onset.js`; Test `test/onset.test.js`

**Step 1: Failing test** — add to `test/onset.test.js`:
```js
import { createLevelGateDetector } from '../src/model/onset.js';

test('level gate fires on the rising cross above threshold, once', () => {
  const g = createLevelGateDetector({ threshold: 0.5, refractoryMs: 0 });
  assert.equal(g.push(0.2, 0), false);      // below
  assert.equal(g.push(0.6, 10), true);      // crosses up → fire
  assert.equal(g.push(0.7, 20), false);     // still above → no re-fire (held)
  assert.equal(g.push(0.65, 30), false);
});

test('level gate re-arms only after dropping below threshold - hysteresis', () => {
  const g = createLevelGateDetector({ threshold: 0.5, refractoryMs: 0 });
  g.push(0.6, 0);                            // fire, disarm
  assert.equal(g.push(0.48, 10), false);    // dipped but within hysteresis (0.05) → still disarmed
  assert.equal(g.push(0.6, 20), false);     // back up but never re-armed → no fire
  assert.equal(g.push(0.40, 30), false);    // now below thr-hyst → re-arm (no fire on a fall)
  assert.equal(g.push(0.6, 40), true);      // next rising cross fires
});

test('level gate Hold enforces a minimum gap between fires', () => {
  const g = createLevelGateDetector({ threshold: 0.5, refractoryMs: 200 });
  assert.equal(g.push(0.6, 0), true);       // fire
  g.push(0.3, 50);                          // drop → re-arm
  assert.equal(g.push(0.6, 100), false);   // rising cross but only 100ms since last fire < 200 → suppressed
  g.push(0.3, 150);
  assert.equal(g.push(0.6, 260), true);    // 260ms ≥ 200 → fires
});

test('level gate reset() re-arms', () => {
  const g = createLevelGateDetector({ threshold: 0.5, refractoryMs: 0 });
  g.push(0.6, 0);
  g.reset();
  assert.equal(g.push(0.6, 10), true);
});
```

**Step 2: Run — FAIL (no export).**

**Step 3: Implement** — append to `src/model/onset.js` (reuse the existing `clampNum`):
```js
// Absolute-level GATE (the twin of the onset detector for "Level" mode): fires when the
// value rises to/above `threshold`, then stays quiet until it drops below
// `threshold - HYSTERESIS` (anti-chatter at the line) AND it rises again. `refractoryMs`
// is the minimum gap between fires (the clip's Hold). Pure, no browser deps.
const LEVEL_HYSTERESIS = 0.05;
export function createLevelGateDetector(opts = {}) {
  const threshold = clampNum(opts.threshold, 0.5, 0, 1);
  const refractoryMs = clampNum(opts.refractoryMs, 120, 0, 5000);
  let armed = true;
  let lastFireMs = -Infinity;
  return {
    push(value, nowMs) {
      const v = Number.isFinite(value) ? value : 0;
      if (v < threshold - LEVEL_HYSTERESIS) armed = true;   // fell back below → re-arm
      if (armed && v >= threshold && nowMs - lastFireMs >= refractoryMs) {
        armed = false; lastFireMs = nowMs; return true;
      }
      if (v >= threshold) armed = false;                     // above but suppressed (held/refractory)
      return false;
    },
    reset() { armed = true; lastFireMs = -Infinity; },
  };
}
```

**Step 4: Run — PASS.** Then `npm test` green.

**Step 5: Commit** — `feat(audio): level-gate detector (absolute threshold + hysteresis)`
(Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; hook bumps version. Every task.)

---

## Task 2: clip-triggers picks the detector by mode

**Files:** Modify `src/model/clip-triggers.js`; Test `test/clip-triggers.test.js`

**Step 1: Failing test** — add to `test/clip-triggers.test.js` (reuse the file's `bands` helper):
```js
test('a level-mode clip fires via the gate, independent of an onset clip', () => {
  const ct = createClipTriggers();
  const clips = [{ id: 'lv', audioTrigger: { enabled: true, band: 'bass', mode: 'level', threshold: 0.5, refractoryMs: 0 } }];
  const bandOf = (v) => () => ({ bass: v }[arguments] ?? 0); // (use the file's bands() helper instead)
  let ms = 0;
  const step = (v) => { const f = ct.poll(clips, (n) => (n === 'bass' ? v : 0), ms, ms / 1000); ms += 16.7; return f; };
  assert.deepEqual(step(0.2), []);      // below threshold
  assert.deepEqual(step(0.7), ['lv']);  // crosses → fire
  assert.deepEqual(step(0.8), []);      // held above → no re-fire
  assert.deepEqual(step(0.1), []);      // drop (re-arm, no fire on fall)
  assert.deepEqual(step(0.7), ['lv']);  // next cross fires
});
```
(Match the existing tests' `bandOf` style — a `(name) => value` function; the pseudo-code above is illustrative, write it in the file's real style.)

**Step 2: Run — FAIL (onset gate used, wrong behavior).**

**Step 3: Implement** — in `src/model/clip-triggers.js`:
- Import the gate: `import { createOnsetDetector, createLevelGateDetector } from './onset.js';`
- Extend the rebuild signature so mode/threshold changes rebuild:
  `const sigOf = (a) => \`${a.mode || 'onset'}|${a.sensitivity}|${a.refractoryMs}|${a.floor}|${a.threshold}\`;`
- In `poll`, pick the detector by mode when (re)building:
```js
        if (!d || d.sig !== sig) {
          const det = (at.mode === 'level') ? createLevelGateDetector(at) : createOnsetDetector(at);
          d = { det, sig };
          detectors.set(c.id, d);
        }
```
(Everything else in `poll` unchanged — `d.det.push(bandOf(at.band||'bass'), nowMs)` works for both.)

**Step 4: Run — PASS; `npm test` green.**

**Step 5: Commit** — `feat(audio): clip-triggers selects onset vs level gate by mode`

---

## Task 3: Spectrum — threshold line, band fill, peak-hold, drag

**Files:** Modify `src/ui/spectrum.js`; Test `test/spectrum.test.js`

**Step 1: Failing test** (the pure drag-math helpers) — add to `test/spectrum.test.js`:
```js
import { thresholdY, yToThreshold } from '../src/ui/spectrum.js';

test('thresholdY / yToThreshold are inverse maps over the canvas height', () => {
  assert.equal(thresholdY(1, 48), 0);        // full → top
  assert.equal(thresholdY(0, 48), 48);       // zero → bottom
  assert.equal(thresholdY(0.5, 48), 24);
  assert.ok(Math.abs(yToThreshold(24, 48) - 0.5) < 1e-9);
  assert.equal(yToThreshold(-10, 48), 1);    // clamped 0..1
  assert.equal(yToThreshold(100, 48), 0);
});
```

**Step 2: Run — FAIL (no exports).**

**Step 3: Implement** in `src/ui/spectrum.js`:
- Add the pure helpers (exported, tested):
```js
export const thresholdY = (t, H) => (1 - clamp01(t)) * H;
export const yToThreshold = (y, H) => clamp01(1 - y / H);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
```
- Extend `createClipSpectrum` signature: `{ band = 'bass', trigsFor, mode = 'onset', threshold, onThresholdChange } = {}`.
- Track a **peak-hold** for the selected band across frames (module-of-closure vars):
  `let peak = 0;` and each frame `peak = Math.max(peak * 0.94, lv);` (decay), draw a 2px tick at `thresholdY(peak, H)` within the band region.
- In `frame()` after the existing bars + level tick, draw:
  - **Level mode** (`mode === 'level'` and `threshold != null`): a solid **band fill** in the
    selected region from bottom up to `thresholdY(lv, H)` (accent while flashing), the **threshold
    line** (1px hairline across the band region at `thresholdY(threshold, H)` with a small handle
    nub at the right edge; accent while flashing), the peak-hold tick, and the numeric value near
    the line.
  - **Onset mode**: draw the running-average **baseline** as a faint **dotted** line. (We don't
    have the EMA here; approximate the baseline with a short trailing average of `externalBand(band)`
    kept in a closure var, `base = base*0.9 + lv*0.1`, drawn dotted — read-only reference.)
- Add pointer drag (DPR-correct — the canvas backing store is scaled by `dpr`, client coords are CSS px):
```js
  let dragging = false;
  const yCanvas = (clientY) => { const r = el.getBoundingClientRect(); return (clientY - r.top) / r.height * 48; };
  el.addEventListener('pointerdown', (e) => {
    if (mode !== 'level' || threshold == null) return;
    if (Math.abs(yCanvas(e.clientY) - thresholdY(threshold, 48)) <= 8) {
      dragging = true; el.setPointerCapture(e.pointerId); el.style.cursor = 'ns-resize';
      onThresholdChange?.(yToThreshold(yCanvas(e.clientY), 48));
    }
  });
  el.addEventListener('pointermove', (e) => { if (dragging) onThresholdChange?.(yToThreshold(yCanvas(e.clientY), 48)); });
  el.addEventListener('pointerup', (e) => { if (dragging) { dragging = false; try { el.releasePointerCapture(e.pointerId); } catch {} el.style.cursor = ''; } });
```
(Note: `yCanvas` maps via `getBoundingClientRect().height` → the 48 logical units, which is DPR-correct because the CSS size stays 48px while only the backing store scales. Keep all drawing in the 48-unit logical space as the existing code does.)

**Step 4: Run — `node --test test/spectrum.test.js` PASS; `npm test` green.**
**Step 5: Commit** — `feat(ui): spectrum threshold line + band fill + peak-hold + drag`

---

## Task 4: Inspector UI — mode toggle, Threshold control, relabel

**Files:** Modify `src/ui/layers.js`

**Step 1:** In the audio-trigger block of `selectedClipEditor` (grep `'audio trigger'` / the
`Sensitivity` slider):
- **Add a Trigger-mode select** after the Band select:
```js
      const mode = at.mode || 'onset';
      box.append(field('Trigger', selectInput(
        [{ value: 'onset', label: 'Onset' }, { value: 'level', label: 'Level' }],
        mode, (v) => setATu({ mode: v }))));
```
- **Rename the existing "Sensitivity" slider label → "Threshold"**, and show it ONLY in onset mode:
```js
      if (mode === 'onset') {
        box.append(Slider('Threshold', at.sensitivity ?? 0.5, {
          min: 0.05, max: 2, step: 0.05, default: 0.5, commit: 'live',
          onInput: (v) => setAT({ sensitivity: v }),
        }));
      }
```
  (Level mode has no slider — the spectrum line is the control; add a click-to-type numeric only if
  cheap, else rely on the drag.)
- **Hold** slider stays for both (unchanged).
- **Mode-aware hint:**
```js
      box.append(el('div', { className: 'seg-hint', textContent: mode === 'level'
        ? 'fires THIS clip while the band level is over the line — drag it on the spectrum'
        : 'fires THIS clip on a spike above the running average in this band' }));
```
- **Pass the new props to the spectrum:**
```js
      box.append(createClipSpectrum({
        band: at.band || 'bass', trigsFor: () => clipTrigsFor?.(clip.id),
        mode, threshold: mode === 'level' ? (at.threshold ?? 0.5) : undefined,
        onThresholdChange: (v) => setAT({ threshold: v }),
      }).el);
```
(`setATu` = undoable/re-render for the discrete mode select; `setAT` = commitLive for the live
threshold drag + sliders. The mode select re-renders, which swaps the slider in/out and re-creates
the spectrum with the right props — the drag persists via `setAT` without a re-render, so it stays
smooth.)

**Step 2:** `node --check src/ui/layers.js`; `npm test` green.
**Step 3: Commit** — `feat(ui): Onset|Level trigger mode + Threshold control in the clip inspector`

---

## Task 5: Verify + release

**Step 1:** `npm test` — all green (incl. the new level-gate, clip-triggers mode, and spectrum
drag-math tests).
**Step 2: Manual smoke** (`npm start`, mic on): on a Pulse/Sphere/Plane Pulse clip set **Trigger =
Level**; drag the line on the spectrum → the band fills under it, the peak-hold tick shows headroom,
and the clip fires (line/fill flash) when the level crosses; raise **Hold** to slow re-fires.
Switch to **Onset** → dotted baseline + the "Threshold" slider; confirm it still fires on hits.
**Step 3:** Cut a signed/notarized release (session cadence) + update memory.
