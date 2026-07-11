# Per-Clip Triggers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give every triggerable clip its own trigger bus + audio-onset config (band/sensitivity/hold) in its inspector, so different clips fire on different audio; ⚡ fires only its own clip; remove the global Settings audio trigger.

**Architecture:** A pure `src/model/clip-triggers.js` owns per-clip onset detectors + trigger buses keyed by `clip.id`. The compositor already passes `clip.id` as `instanceKey` to `runEntry`, so 2D per-clip `uTrigs` is a lookup. The sampler gains per-slot `uVolTrigs[4×8]` for volumetric clips. Design: `docs/plans/2026-07-06-per-clip-triggers-design.md`.

**Tech Stack:** Vanilla ESM, Node built-in test runner, WebGL2. No new deps.

---

## Sequencing note
Order keeps the suite green at every commit: build the pure core first (Task 1), make the
compositor + sampler accept per-clip data **with a fallback to the old global path** (Tasks 3–4)
so nothing breaks before the app is rewired (Task 5), then UI (6–7), then verify (8).

---

## Task 1: Pure `clip-triggers.js` module (TDD)

**Files:** Create `src/model/clip-triggers.js`; Test `test/clip-triggers.test.js`

**Step 1: Failing test** — `test/clip-triggers.test.js`
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipTriggers } from '../src/model/clip-triggers.js';

// A band sampler that returns a spike for a chosen band at chosen frames.
function bands(map) { return (name) => map[name] ?? 0; }

test('two clips on different bands fire independently', () => {
  const ct = createClipTriggers();
  const clips = [
    { id: 'a', audioTrigger: { enabled: true, band: 'bass', sensitivity: 0.5, refractoryMs: 100 } },
    { id: 'b', audioTrigger: { enabled: true, band: 'high', sensitivity: 0.5, refractoryMs: 100 } },
  ];
  let ms = 0, sec = 0;
  const step = (bassV, highV) => { const f = ct.poll(clips, bands({ bass: bassV, high: highV }), ms, sec); ms += 16.7; sec += 0.0167; return f; };
  for (let i = 0; i < 30; i++) step(0.1, 0.1);       // settle both EMAs
  const f1 = step(0.9, 0.1);                          // bass spike → only 'a'
  assert.deepEqual(f1, ['a']);
  for (let i = 0; i < 30; i++) step(0.1, 0.1);
  const f2 = step(0.1, 0.9);                          // high spike → only 'b'
  assert.deepEqual(f2, ['b']);
  assert.equal(ct.trigsFor('a').length, 1);
  assert.equal(ct.trigsFor('b').length, 1);
});

test('enabled:false never fires; missing audioTrigger never fires', () => {
  const ct = createClipTriggers();
  const clips = [{ id: 'a', audioTrigger: { enabled: false, band: 'bass' } }, { id: 'b' }];
  let ms = 0;
  for (let i = 0; i < 40; i++) { assert.deepEqual(ct.poll(clips, bands({ bass: 0.9 }), ms, ms / 1000), []); ms += 16.7; }
  assert.equal(ct.trigsFor('a').length, 0);
});

test('fire() pushes a manual trigger onto the clip bus (cap 8)', () => {
  const ct = createClipTriggers();
  for (let i = 0; i < 10; i++) ct.fire('a', i);
  const b = ct.trigsFor('a');
  assert.equal(b.length, 8);
  assert.deepEqual(b, [2, 3, 4, 5, 6, 7, 8, 9]);      // newest 8, oldest dropped
});

test('changing a clip tuning rebuilds its detector without touching other clips', () => {
  const ct = createClipTriggers();
  ct.fire('other', 1);                                // give 'other' a bus entry
  const clips = [{ id: 'a', audioTrigger: { enabled: true, band: 'bass', sensitivity: 0.5, refractoryMs: 100 } }];
  let ms = 0; const step = (v) => { const f = ct.poll(clips, bands({ bass: v }), ms, ms / 1000); ms += 16.7; return f; };
  for (let i = 0; i < 30; i++) step(0.1);
  clips[0].audioTrigger.sensitivity = 2;              // retune → detector rebuilds, EMA cold
  step(0.1);
  assert.equal(ct.trigsFor('other').length, 1);       // unrelated bus intact
});

test('prune drops buses + detectors for dead clips', () => {
  const ct = createClipTriggers();
  ct.fire('a', 1); ct.fire('b', 1);
  ct.prune(['a']);
  assert.equal(ct.trigsFor('a').length, 1);
  assert.equal(ct.trigsFor('b').length, 0);
});
```

**Step 2: Run — `node --test test/clip-triggers.test.js` — FAIL (no module).**

**Step 3: Implement `src/model/clip-triggers.js`**
```js
// Per-clip triggers: each triggerable clip owns an onset DETECTOR + a BUS of recent trigger
// timestamps (seconds), keyed by clip id. Pure (no DOM / Web Audio) → node-testable. The ⚡
// button calls fire(); the render loop calls poll() with a band sampler; both push to the SAME
// per-clip bus, read back by the compositor/sampler via trigsFor(clipId).
import { createOnsetDetector } from './onset.js';

const CAP = 8;
const EMPTY = [];

export function createClipTriggers() {
  const buses = new Map();       // clipId → number[] (seconds, newest last, cap 8)
  const detectors = new Map();   // clipId → { det, sig }
  const sigOf = (a) => `${a.sensitivity}|${a.refractoryMs}|${a.floor}`;
  const push = (id, sec) => { let b = buses.get(id); if (!b) { b = []; buses.set(id, b); } b.push(sec); if (b.length > CAP) b.splice(0, b.length - CAP); };

  return {
    fire(clipId, sec) { if (clipId != null) push(clipId, sec); },

    // clips: active triggerable clips (each {id, audioTrigger?}). bandOf(name)→0..1.
    // nowMs: monotonic ms (detector clock). nowSec: elapsed seconds (bus stamp).
    poll(clips, bandOf, nowMs, nowSec) {
      const fired = [];
      for (const c of clips || []) {
        const at = c && c.audioTrigger;
        if (!at || !at.enabled) continue;
        const sig = sigOf(at);
        let d = detectors.get(c.id);
        if (!d || d.sig !== sig) { d = { det: createOnsetDetector(at), sig }; detectors.set(c.id, d); }
        if (d.det.push(bandOf(at.band || 'bass'), nowMs)) { push(c.id, nowSec); fired.push(c.id); }
      }
      return fired;
    },

    trigsFor(clipId) { return buses.get(clipId) || EMPTY; },

    prune(liveIds) {
      const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
      for (const k of [...buses.keys()]) if (!live.has(k)) buses.delete(k);
      for (const k of [...detectors.keys()]) if (!live.has(k)) detectors.delete(k);
    },

    reset() { buses.clear(); detectors.clear(); },
  };
}
```

**Step 4: Run — PASS (5 tests).**

**Step 5: Commit** — `feat(triggers): pure per-clip trigger buses + onset detectors`
(Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; hook bumps version — expected. Applies to every task.)

---

## Task 2: `audio.js` — expose the mic band (additive)

**Files:** Modify `src/model/audio.js`

**Step 1:** Add an accessor so clip detectors can read the live external band (keep the global
trigger functions for now — removed in Task 5 to stay green):
```js
// Current external (mic) band value 0..1 (0 when the mic isn't running). Per-clip triggers
// (src/model/clip-triggers.js) sample this in the render loop.
export function externalBand(name) {
  const s = SRC.external;
  return s.enabled ? (s.bands[name] || 0) : 0;
}
```
**Step 2:** `node --check src/model/audio.js`; `npm test` (still green).
**Step 3: Commit** — `feat(audio): externalBand() accessor for per-clip triggers`

---

## Task 3: Compositor — per-clip `uTrigs` via `trigSecsFor` (with fallback)

**Files:** Modify `src/engine/compositor.js`

**Step 1:** Add an `ownerOf` helper near the top of the module (an equivalent exists inside the
cleanup block ~line 461 — hoist/duplicate a module-scope one):
```js
const ownerOf = (k) => { const i = (k || '').indexOf(':'); return i >= 0 ? k.slice(0, i) : (k || ''); };
```
**Step 2:** In `runEntry` (the `uTrigs` block ~line 195-204), replace the single global source
with a per-instance lookup, falling back to the old global `trigSecs` if no `trigSecsFor` given:
```js
  const uTrigs = loc(c, 'uTrigs[0]');
  if (uTrigs !== null) {
    const arr = TRIG_SCRATCH; arr.fill(1e6);
    const trigs = (frameEnv.trigSecsFor ? frameEnv.trigSecsFor(ownerOf(instanceKey || entry.name)) : frameEnv.trigSecs) || [];
    const n = Math.min(trigs.length, 8);
    for (let i = 0; i < n; i++) arr[i] = timeSec - trigs[trigs.length - n + i];
    gl.uniform1fv(uTrigs, arr);
    const cnt = loc(c, 'uTrigCount');
    if (cnt !== null) gl.uniform1i(cnt, n);
  }
```
**Step 3:** `node --check src/engine/compositor.js`; `npm test` (green — app.js still passes the
global `trigSecs`, which the fallback uses).
**Step 4: Commit** — `feat(compositor): per-instance uTrigs via trigSecsFor (fallback to global)`

---

## Task 4: Sampler — per-slot volumetric triggers (with fallback)

**Files:** Modify `src/engine/sampler.js`

**Step 1: GLSL** — replace the shared trigger uniforms (`uniform float uTrigs[8]; uniform int
uTrigCount;`, lines ~25-26) with per-slot arrays:
```glsl
uniform float uVolTrigs[32];   // 4 slots × 8 — seconds since each trigger, per volumetric clip
uniform int uVolTrigCount[4];
```
Update the two trigger loops in `fieldColor(int i, vec3 p)`:
- plane pulse (`id == 5`, ~line 80):
  `for (int k = 0; k < 8; k++) { if (k >= uVolTrigCount[i]) break; v = max(v, vband(coord - uVolTrigs[i*8+k] * uVolB[i].x, uVolA[i].y, uVolA[i].z)); }`
- sphere pulse (fallthrough, ~line 88-91):
  `for (int k = 0; k < 8; k++) { if (k >= uVolTrigCount[i]) break; v = max(v, vband(d - uVolTrigs[i*8+k] * uVolB[i].z, uVolB[i].x, uVolB[i].y)); }`
(`i*8+k` dynamic indexing of a uniform array is valid in GLSL ES 3.00.)

**Step 2: JS** — replace `locTrigs`/`locTrigCount` (line ~165) with:
```js
const locVolTrigs = gl.getUniformLocation(prog, 'uVolTrigs[0]');
const locVolTrigCount = gl.getUniformLocation(prog, 'uVolTrigCount[0]');
```
In `sample(canvasTex, vol)`, replace the single-`uTrigs` upload with a per-slot fill. Prefer
`vol.volTrigs` (array of per-slot `sec[]`); fall back to replicating `vol.trigSecs` into every
active slot (preserves old behavior until app.js provides per-slot):
```js
    const VT = new Float32Array(32); const VC = new Int32Array(4);
    for (let s = 0; s < Math.min(n2, 4); s++) {
      const trigs = (vol.volTrigs && vol.volTrigs[s]) || vol.trigSecs || [];
      const tn = Math.min(trigs.length, 8);
      for (let k = 0; k < tn; k++) VT[s * 8 + k] = (vol.time || 0) - trigs[trigs.length - tn + k];
      VC[s] = tn;
    }
    gl.uniform1fv(locVolTrigs, VT); gl.uniform1iv(locVolTrigCount, VC);
```
(Allocate `VT`/`VC` once at module/closure scope like `TRIG_SCRATCH` rather than per-frame — mirror the existing scratch pattern.) Remove the now-unused `TRIG_SCRATCH` trig upload + `locTrigs`.

**Step 3: Verify GLSL compiles** — run the existing WebGL harness pattern against `SAMPLE_FS`
(the scratchpad `validate-*.mjs` scripts show how: extract `const SAMPLE_FS = \`…\``, compile+link
in headless Chromium). Confirm it still compiles with the new uniforms + `i*8+k` indexing.
`npm test` green (fallback keeps volumetric behavior identical for the current global caller).
**Step 4: Commit** — `feat(sampler): per-slot volumetric triggers (uVolTrigs[4x8])`

---

## Task 5: `app.js` — wire per-clip triggers, remove the global

**Files:** Modify `src/app.js`; Modify `src/model/audio.js`

**Step 1:** Import + instantiate. Replace the audio import (`app.js:35`) — drop
`setAudioTrigger, pollAudioTrigger`, add `externalBand`:
```js
import { updateAudio, setAudioGain, enableAudio, audioEnabled, externalBand } from './model/audio.js';
```
Add near `pulseTrigSecs` (which stays only if other non-clip code needs it — otherwise remove it):
```js
import { createClipTriggers } from './model/clip-triggers.js';
const clipTriggers = createClipTriggers();
```
**Step 2:** `transport.fire` becomes clip-scoped; `reset` clears clip triggers:
```js
  fire(clipId) { clipTriggers.fire(clipId, nowSec()); },
  reset() { t0 = lastTs; this.startTs = lastTs; clipTriggers.reset(); compositor?.resetPhases?.(); },
```
**Step 3:** In the render loop, replace the old global audio-trigger lines (`setAudioTrigger(...)`
at ~2742 and `if (pollAudioTrigger(ts)) transport.fire()` at ~2747). Collect the **active
triggerable clips** (each layer's active clip whose generator OR clip is triggerable) and poll:
```js
    // Per-clip audio triggers: poll each live triggerable clip's detector on ITS band.
    const activeTrigClips = [];
    for (const L of (show.composition?.layers || [])) {
      const c = (L.clips || []).find((x) => x && x.id === L.activeClipId);
      if (c && getEntry(c.generator)?.triggerable) activeTrigClips.push(c);
    }
    clipTriggers.poll(activeTrigClips, externalBand, ts, nowSec());
```
**Step 4:** Pass `trigSecsFor` to the compositor (replace `trigSecs: pulseTrigSecs` in the
`compositor.render(...)` env, ~line 2775):
```js
      trigSecsFor: (id) => clipTriggers.trigsFor(id),
```
**Step 5:** Volumetric — build per-slot `volTrigs` from each active volumetric clip's bus, in the
SAME order `packVolumetrics` packs `act` (so slot index matches). Where `act` is assembled
(~2799) keep each entry's `clip.id`; then:
```js
      if (act.length) vol = { ...packVolumetrics(act), time: t, volTrigs: act.map((e) => clipTriggers.trigsFor(e.id)) };
```
(Ensure the `act.push({...})` includes `id: c.id`.)
**Step 6:** Prune dead clips each frame (after building the layer list):
```js
    { const live = new Set(); for (const L of (show.composition?.layers || [])) for (const c of (L.clips || [])) if (c) live.add(c.id); clipTriggers.prune(live); }
```
**Step 7:** Remove the now-dead global trigger code in `src/model/audio.js` (`_trig`, `_onset`,
`_tune`, `setAudioTrigger`, `pollAudioTrigger`, and the `createOnsetDetector` import if unused
there). Keep `externalBand`, mic capture, bands.
**Step 8:** `node --check` both files; `npm test` (green). Grep to confirm no remaining references
to `pollAudioTrigger`/`setAudioTrigger`/`pulseTrigSecs` (remove `pulseTrigSecs` if fully unused).
**Step 9: Commit** — `feat(app): drive triggers per-clip; remove the global audio trigger`

---

## Task 6: Clip inspector — per-clip Audio Trigger controls

**Files:** Modify `src/ui/layers.js`

**Step 1:** In `selectedClipEditor` where the ⚡ button is added (~line 1271-1277 for
`gen?.triggerable`): (a) change `onclick: () => transport.fire()` → `onclick: () => transport.fire(clip.id)`;
(b) mount the per-clip config below it, writing `clip.audioTrigger` via the panel's existing clip
mutate/commit helper (grep how other per-clip fields like opacity/params commit — reuse that path,
e.g. a `commit(updateClip(show(), clip.id, { audioTrigger: {...} }))` or the inspector's setter):
```js
      const at = clip.audioTrigger || {};
      const setAT = (patch) => commitClip(clip.id, { audioTrigger: { ...(clip.audioTrigger || {}), ...patch } });
      // enable checkbox · band select (bass/mid/high/level) · Sensitivity slider · Hold(ms) slider
      // labelled + styled like the other inspector rows; hint: "fires THIS clip on mic onset in this band"
```
Use the file's existing control helpers (the same `el`/`Slider`/select the inspector already uses).
Match the surrounding inspector style. Find the exact commit helper by reading how nearby clip
fields persist — do NOT invent a new persistence path.
**Step 2:** `node --check src/ui/layers.js`; `npm test` green.
**Step 3: Commit** — `feat(ui): per-clip Audio Trigger controls in the clip inspector`

---

## Task 7: Remove the global Audio Trigger from Settings

**Files:** Modify `src/ui/settings.js`

**Step 1:** Delete the "audio trigger" section (the block from `const trig = ... audioTrigger`
through the Hold slider + hint, ~lines 73-102). Keep the "audio input" device picker + Gain.
**Step 2:** `node --check src/ui/settings.js`; `npm test` green. Grep `audioTrigger` across `src/`
to confirm only `clip.audioTrigger` (per-clip) remains — no `composition.audioTrigger`.
**Step 3: Commit** — `refactor(settings): remove the global audio trigger (now per-clip)`

---

## Task 8: Verify + release

**Step 1:** `npm test` — all green (incl. `clip-triggers.test.js`).
**Step 2:** Re-run the WebGL validators (the full sampler compiles; the shader pack + volumetric
thumbs still compile).
**Step 3: Manual smoke** (`npm start`): two clips, each **Plane Pulse** (or Pulse), give each its
own Audio Trigger — clip A Band=Bass, clip B Band=High, enable both, enable the mic. Play music →
confirm A fires on kicks, B on hats, independently. Confirm the ⚡ on a clip fires only that clip.
Confirm no "audio trigger" remains in Settings.
**Step 4:** Cut a signed/notarized release (session cadence) + update memory.
