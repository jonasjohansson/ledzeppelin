# Audio-Triggered Pulses + Shader Pack — Design

**Date:** 2026-07-06
**Status:** Approved (brainstorm) — Phase A first, then Phase B.

## Goal

Let a USB microphone fire the app's existing trigger bus on musical onsets, so making
a sound fires the 2D **Pulse** and 3D **Sphere Pulse** (both already exist and read the
trigger uniform). Then add a tight pack of new movement/liquid/volumetric shader effects.

## Context (what already exists)

- **Audio capture** — browser-side in `src/model/audio.js`: mic via `getUserMedia`, an
  `AnalyserNode`, and per-frame bands `bass/mid/high/level` (`updateAudio()`, called in
  the render loop at `src/app.js`). Today audio only *modulates params*, never fires.
- **Trigger bus** — `pulseTrigSecs` (array of up to 8 timestamps, seconds) in `src/app.js`,
  fed to the `uTrigs[8]` / `uTrigCount` uniforms by the compositor. The ⚡ button and
  double-click push timestamps here.
- **Triggerable sources** — `pulse` (2D), `radial`, `spherepulse` (3D volumetric shells)
  in `src/engine/shaders/manifest.js` (`triggerable: true`). They already react to `uTrigs`.
- **Effect registry** — every generator/effect is a declarative entry in `REGISTRY`
  (`manifest.js`): `{ name, type: 'generator'|'effect', src: GLSL, triggerable?, volumetric?,
  params: [{key,type,min,max,default}] }`. GLSL contract: `#version 300 es`, `in vec2 uv`,
  `out vec4 frag`, uniforms `uT`, `uPhase`, `uTrigs[8]`, `uTrigCount`, plus each param as a
  typed uniform. Effects also get `uTex` (prior pass) and optional `uFeedback` (persistent).
  UI palette categories live in `src/ui/layers.js` (`SOURCE_CATEGORIES`) + `LABELS`.

**The only missing piece for the core ask: onset detection wiring audio → trigger bus.**

## Phase A — Audio → Trigger

**Onset detector** (new, in `src/model/audio.js`):
- Track an EMA (running average) of a selected band.
- Fire when `current > avg·(1 + sensitivity)` **and** `current > noiseFloor`, gated by a
  refractory timer (default ~120 ms) so one clap = one pulse.
- Expose a per-frame "fired this frame" flag (e.g. `pollOnset()` or an added field on the
  `updateAudio()` return).

**Wire** (in `src/app.js` render loop): after `updateAudio()`, if onset fired, push the
current `t` into `pulseTrigSecs` exactly as the ⚡ path does (respect the 8-slot cap).

**UI** — small **Audio Trigger** block in the audio/composition panel:
enable toggle · band select (default **bass**) · sensitivity slider · refractory slider.
Reuses the existing external-mic enable + device picker.

**Data flow:**
```
mic → analyser bands (exists) → onset detector (NEW) → pulseTrigSecs (NEW wire)
    → uTrigs[8] (exists) → Pulse (2D) + Sphere Pulse (3D) react (exist)
```

**Testing:** headless unit test — feed a synthetic band envelope (quiet → spike → quiet →
spike), assert exactly 2 fires and that the refractory window suppresses double-fires.

## Phase B — Shader pack (fan-out, after Phase A verified)

Fresh subagent per effect, in parallel. Each returns a **self-contained effect spec**
(GLSL matching the `#version 300 es` + uniform contract, a `REGISTRY` entry, category, and
label). The controller integrates them one at a time into `manifest.js` / `layers.js` with a
quick compile + smoke review — avoids concurrent edits colliding in one file.

Tight "greatest hits" set (7):

| Family | Effect | Notes |
|---|---|---|
| Liquid | Domain-Warp flow | fbm domain warping, constant organic flow |
| Liquid | Metaballs | lava-lamp blobs |
| Audio-reactive | Shockwave-on-onset | full-frame ripple riding `uTrigs` (pairs with Phase A) |
| Audio-reactive | Bass-Warp | displacement driven by the bass band |
| Geometric | Plasma | classic sinusoidal plasma with phase drift |
| Geometric | Tunnel | feedback-zoom tunnel (uses `uFeedback`) |
| Volumetric 3D | Body-Wave | traveling wave along the whale's long axis (world-space) |

**Testing:** each subagent confirms its GLSL compiles against the contract; controller
smoke-tests in the app.

## Sequencing

1. Phase A: build, test, verify onset firing live, cut a release.
2. Phase B: fan out the 7 shaders, integrate + smoke-test, cut a release.
