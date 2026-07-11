# Phase A — Audio-Onset Trigger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the microphone fire the app's existing trigger bus on musical onsets, so making a sound fires the 2D Pulse and 3D Sphere Pulse.

**Architecture:** A pure, headless-testable onset detector (`src/model/onset.js`) tracks an EMA of a chosen audio band and fires on a rising spike with a refractory gate. Thin glue in `audio.js` runs a detector instance over the live `external` band; the render loop in `app.js` calls `transport.fire()` when it fires. A small Audio Trigger UI in `settings.js` (persisted in `composition.audioTrigger`) exposes enable / band / sensitivity / refractory.

**Tech Stack:** Vanilla ESM, Node built-in test runner (`node --test`), Web Audio (existing).

---

## Background the implementer needs

- **Trigger bus (already works):** `src/app.js:441` `let pulseTrigSecs = []`. `src/app.js:453`
  `transport.fire()` pushes `nowSec()` and caps to the last 8. The compositor feeds this to
  the `uTrigs[8]` / `uTrigCount` uniforms; `pulse` (2D) and `spherepulse` (3D) already react.
- **Audio (already works):** `src/model/audio.js` — `updateAudio()` returns a per-frame object
  with `external:bass`, `external:mid`, `external:high`, `external:level` (and plain
  back-compat keys) in 0..1. Mic is opened by `enableExternal(deviceId)` / `enableAudio()`.
- **Render loop:** `src/app.js` `loopBody(ts)` computes `t = (ts - t0) / 1000` (seconds) and
  calls `updateAudio()` at ~line 2742, then `compositor.render(..., t, { trigSecs: pulseTrigSecs, ... })`.
- **Settings audio section:** `src/ui/settings.js` `build(mount)` — the "audio input" block
  (lines 49–71) holds the device `<select>` and Gain `Slider`. New controls slot in right after.
  Config persists via `setShow({ ...s, composition: { ...s.composition, audioTrigger: {...} } })`.
- **Tests:** `npm test` runs `node --test "test/*.test.js"`. Detector test lives at
  `test/onset.test.js`. `onset.js` must import nothing browser-specific so it runs under node.

---

## Task 1: Pure onset detector module (TDD)

**Files:**
- Create: `src/model/onset.js`
- Test: `test/onset.test.js`

**Step 1: Write the failing test**

```js
// test/onset.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOnsetDetector } from '../src/model/onset.js';

// Feed a value stream at 60fps (dt≈16.7ms). Count fires.
function run(det, values, dtMs = 1000 / 60) {
  let fires = 0, tMs = 0;
  for (const v of values) { if (det.push(v, tMs)) fires++; tMs += dtMs; }
  return fires;
}

test('fires once on a rising spike above the running average', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  // 30 quiet frames to settle the EMA, then one loud frame, then quiet again.
  const vals = [...Array(30).fill(0.1), 0.9, ...Array(30).fill(0.1)];
  assert.equal(run(det, vals), 1);
});

test('refractory window suppresses a second fire that is too soon', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 200, floor: 0.05 });
  // Two spikes 3 frames (~50ms) apart — under the 200ms refractory → only the first fires.
  const vals = [...Array(30).fill(0.1), 0.9, 0.1, 0.1, 0.9, ...Array(30).fill(0.1)];
  assert.equal(run(det, vals), 1);
});

test('two spikes spaced beyond the refractory both fire', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  const gap = Array(30).fill(0.1);
  const vals = [...gap, 0.9, ...gap, 0.9, ...gap];
  assert.equal(run(det, vals), 2);
});

test('steady loud signal does not keep firing (only the initial rise)', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  const vals = [...Array(10).fill(0.1), ...Array(40).fill(0.8)];
  assert.equal(run(det, vals), 1); // one onset at the step, then EMA catches up
});

test('signal below the noise floor never fires', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.2 });
  const vals = [...Array(20).fill(0.02), 0.15, ...Array(20).fill(0.02)]; // peak < floor
  assert.equal(run(det, vals), 0);
});

test('reset() clears the EMA and refractory state', () => {
  const det = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });
  run(det, [...Array(30).fill(0.1), 0.9]);
  det.reset();
  // After reset the EMA is cold; a spike following a fresh quiet run fires again.
  assert.equal(run(det, [...Array(30).fill(0.1), 0.9]), 1);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="onset|spike|refractory"` (or `node --test test/onset.test.js`)
Expected: FAIL — `Cannot find module '../src/model/onset.js'`.

**Step 3: Write the minimal implementation**

```js
// src/model/onset.js
// Pure, browser-free onset detector: fires when a 0..1 signal spikes above its own
// running average (EMA), gated by a noise floor and a refractory period. No Web Audio,
// no DOM — so it unit-tests under `node --test` and is reused by src/model/audio.js.
//
// createOnsetDetector(opts) → { push(value, nowMs) → boolean, reset() }
//   sensitivity  how far above the EMA the value must jump to count as an onset,
//                as a fraction of the EMA (0.5 = 50% louder than recent average). 0..3.
//   refractoryMs minimum gap between fires (debounce); one clap = one pulse.
//   floor        absolute minimum value to consider (ignores room hum / silence).
//   attack       EMA smoothing per frame (higher = average adapts faster). 0..1.

export function createOnsetDetector(opts = {}) {
  const sensitivity = clampNum(opts.sensitivity, 0.5, 0, 3);
  const refractoryMs = clampNum(opts.refractoryMs, 120, 0, 5000);
  const floor = clampNum(opts.floor, 0.05, 0, 1);
  const attack = clampNum(opts.attack, 0.15, 0.01, 1);

  let ema = 0;
  let primed = false;      // seen at least one sample (so the first frame just seeds the EMA)
  let lastFireMs = -Infinity;

  return {
    push(value, nowMs) {
      const v = Number.isFinite(value) ? value : 0;
      if (!primed) { ema = v; primed = true; return false; }

      const threshold = Math.max(floor, ema * (1 + sensitivity));
      const fired =
        v >= threshold &&
        v >= floor &&
        nowMs - lastFireMs >= refractoryMs;

      if (fired) lastFireMs = nowMs;
      ema += (v - ema) * attack;   // update AFTER the test so the spike doesn't mask itself
      return fired;
    },
    reset() { ema = 0; primed = false; lastFireMs = -Infinity; },
  };
}

function clampNum(x, dflt, lo, hi) {
  const n = Number(x);
  if (!Number.isFinite(n)) return dflt;
  return n < lo ? lo : n > hi ? hi : n;
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/onset.test.js`
Expected: PASS — all 6 tests.

**Step 5: Commit**

```bash
git add src/model/onset.js test/onset.test.js
git commit -m "feat(audio): pure onset detector (EMA spike + refractory)"
```

---

## Task 2: Wire the detector into audio.js

**Files:**
- Modify: `src/model/audio.js` (add config + a `pollAudioTrigger` export; import onset.js)

**Step 1: Add the detector state + config setters**

At the top of `src/model/audio.js`, after the existing imports/exports add:

```js
import { createOnsetDetector } from './onset.js';

// --- audio-onset trigger --------------------------------------------------------
// One detector instance drives the app's trigger bus from the EXTERNAL (mic) band.
// Config is pushed from the UI (settings.js) via setAudioTrigger(); the render loop
// calls pollAudioTrigger(nowMs) once per frame and fires transport.fire() on true.
let _trig = { enabled: false, band: 'bass' };
let _onset = createOnsetDetector({ sensitivity: 0.5, refractoryMs: 120, floor: 0.05 });

export function setAudioTrigger(cfg = {}) {
  _trig.enabled = !!cfg.enabled;
  if (cfg.band && AUDIO_BANDS.includes(cfg.band)) _trig.band = cfg.band;
  _onset = createOnsetDetector({
    sensitivity: cfg.sensitivity, refractoryMs: cfg.refractoryMs, floor: cfg.floor,
  });
}
export function audioTriggerEnabled() { return _trig.enabled; }

// Poll the onset detector against the latest external band. Returns true on the frame
// an onset fires. No-op (false) when disabled or the mic isn't running. Call AFTER
// updateAudio() so the bands are current.
export function pollAudioTrigger(nowMs) {
  if (!_trig.enabled || !SRC.external.enabled) return false;
  return _onset.push(SRC.external.bands[_trig.band] || 0, nowMs);
}
```

**Step 2: Sanity-check it imports**

Run: `node --check src/model/audio.js`
Expected: no output (syntax OK). (Full behaviour is verified live in Task 5 — audio.js needs
Web Audio, so it isn't node-testable; the tested logic lives in onset.js.)

**Step 3: Commit**

```bash
git add src/model/audio.js
git commit -m "feat(audio): trigger config + pollAudioTrigger over the mic band"
```

---

## Task 3: Fire the trigger bus from the render loop

**Files:**
- Modify: `src/app.js` (import `pollAudioTrigger`; call it in `loopBody` after `updateAudio()`)

**Step 1: Extend the audio import**

`src/app.js:35` currently:
```js
import { updateAudio, setAudioGain, enableAudio, audioEnabled } from './model/audio.js';
```
Change to:
```js
import { updateAudio, setAudioGain, enableAudio, audioEnabled, setAudioTrigger, pollAudioTrigger } from './model/audio.js';
```

**Step 2: Fire on onset in the loop**

In `loopBody`, immediately after the `Object.assign(frameSignals, updateAudio(), ...)` block
(around `src/app.js:2742`), add:

```js
    // Audio-onset trigger: a mic spike fires the same bus as the ⚡ button.
    if (pollAudioTrigger(t * 1000)) transport.fire();
```

(`t` is seconds; the detector wants ms. `transport.fire()` is the existing path at line 453.)

**Step 3: Push config when the show loads / changes**

Find where the loop first reads `show.composition` config each frame (near the
`setAudioGain(show.composition?.audioGain ?? 1)` call at ~`src/app.js:2741`) and add
alongside it:

```js
    setAudioTrigger(show.composition?.audioTrigger || {});
```

(Cheap to call per frame — it just rebuilds a tiny detector; fine for now. If profiling ever
flags it, guard with a shallow-equality check. YAGNI for now.)

**Step 4: Verify the app still boots**

Run: `node --check src/app.js`
Expected: no output.

**Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat(audio): mic onset fires the trigger bus in the render loop"
```

---

## Task 4: Audio Trigger UI (settings.js)

**Files:**
- Modify: `src/ui/settings.js` (add controls after the Gain slider, ~line 71)

**Step 1: Add the controls**

Right after the Gain `Slider` append (`src/ui/settings.js:71`), insert:

```js
    // --- Audio trigger: a mic onset fires the ⚡ trigger bus (Pulse + Sphere Pulse) ---
    const trig = getShow().composition?.audioTrigger || {};
    const setTrig = (patch) => {
      const s = getShow();
      setShow({ ...s, composition: { ...s.composition, audioTrigger: { ...(s.composition?.audioTrigger || {}), ...patch } } }, { undoable: true, defer: true });
    };
    mount.append(el('div', { className: 'fx-pts', textContent: 'audio trigger' }));
    const onToggle = el('input', { type: 'checkbox' });
    onToggle.checked = !!trig.enabled;
    onToggle.addEventListener('change', () => setTrig({ enabled: onToggle.checked }));
    mount.append(el('label', { className: 'fx-field' }, [el('span', { textContent: 'Fire on sound' }), onToggle]));

    const bandSel = el('select', { title: 'which frequency band drives the onset' });
    ['bass', 'mid', 'high', 'level'].forEach((b) => {
      const o = el('option', { value: b, textContent: b[0].toUpperCase() + b.slice(1) });
      if ((trig.band || 'bass') === b) o.selected = true;
      bandSel.append(o);
    });
    bandSel.addEventListener('change', () => setTrig({ band: bandSel.value }));
    mount.append(el('label', { className: 'fx-field' }, [el('span', { textContent: 'Band' }), bandSel]));

    mount.append(Slider('Sensitivity', trig.sensitivity ?? 0.5, {
      min: 0.05, max: 2, step: 0.05, default: 0.5, commit: 'live',
      onInput: (v) => setTrig({ sensitivity: v }),
    }));
    mount.append(Slider('Hold (ms)', trig.refractoryMs ?? 120, {
      min: 40, max: 800, step: 10, default: 120, commit: 'live',
      onInput: (v) => setTrig({ refractoryMs: Math.round(v) }),
    }));
    mount.append(el('div', { className: 'seg-hint', textContent: 'needs the mic input enabled above; drives any triggerable clip (Pulse, Sphere Pulse)' }));
```

**Step 2: Verify it parses**

Run: `node --check src/ui/settings.js`
Expected: no output.

**Step 3: Commit**

```bash
git add src/ui/settings.js
git commit -m "feat(audio): Audio Trigger controls in Settings (enable/band/sensitivity/hold)"
```

---

## Task 5: Live verification + release

**Step 1: Full test suite**

Run: `npm test`
Expected: PASS, including the new `test/onset.test.js`.

**Step 2: Manual smoke test (dev server)**

1. `npm start`, open the app.
2. Add a **Pulse** clip (Motion category) and a **Sphere Pulse** (Volumetric) to the layer.
3. Settings → audio input → pick the USB mic (grant permission).
4. Settings → audio trigger → enable "Fire on sound", Band = Bass.
5. Clap / play music near the mic → confirm both the 2D Pulse beam and the 3D shell fire on hits.
6. Raise **Hold (ms)** and confirm rapid claps stop double-firing; lower **Sensitivity** and
   confirm quieter sounds trigger.

**Step 3: Cut a signed/notarized release** (matches this session's cadence — build from an
isolated worktree pinned at the merge commit; verify via `/health` that the new daemon runs).

**Step 4: Update memory** if the onset-detector approach or the trigger-bus wiring is worth
recording for future audio work.
