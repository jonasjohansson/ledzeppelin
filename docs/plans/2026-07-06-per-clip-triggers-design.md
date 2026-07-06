# Per-Clip Triggers — Design

**Date:** 2026-07-06
**Status:** Approved (brainstorm).

## Goal

Every triggerable clip owns its trigger bus, with its own audio-onset config (band /
sensitivity / hold) in its inspector — so different clips fire on different audio (bass on
one, highs on another). The ⚡ button fires just its own clip. The single global "Audio
Trigger" (Settings, `composition.audioTrigger`, shipped v1.0.381) is removed and superseded.

## Current state (from recon)

- **Global bus:** `pulseTrigSecs` in `src/app.js:441`; `transport.fire()` (`:453`) pushes
  `nowSec()`, cap 8. Fired from: the audio onset (`app.js:2747`), the ⚡ button
  (`ui/layers.js:1275`). The SAME array feeds `uTrigs[8]` for every triggerable shader.
- **2D uniform:** `compositor.js:192-204` sets `uTrigs`/`uTrigCount` from `frameEnv.trigSecs`
  (one global array) for every `runEntry`.
- **Per-instance keying ALREADY EXISTS:** `runEntry(..., instanceKey)` is called with `clip.id`
  for generators (`compositor.js:323`) and `clip.id + ':fx' + i` for clip effects (`:332`);
  `phaseClocks` + `feedbackTargets` are keyed by it, pruned by `ownerOf(key)=key.split(':')[0]`
  against live clip/layer ids (`:461-470`). **This is the per-clip routing key to reuse.**
- **Volumetric:** `app.js:2806` packs one global `trigSecs` into `vol`; `sampler.js:231-238`
  fills ONE shared `uTrigs[8]` used by all up-to-4 volumetric slots.
- **Onset detector:** `src/model/onset.js` `createOnsetDetector(opts)` — pure, stateful, already
  unit-tested. Reused per clip.
- **Clip model:** `makeClip` (`model/layers.js:318`) → `{ id, name, generator, params, effects,
  transform, opacity, durationMs, anim? }`. Inspector `selectedClipEditor` (`ui/layers.js:1198+`)
  shows the ⚡ for `gen?.triggerable` (`:1271-1277`).

## Architecture

**`src/model/clip-triggers.js`** (new, pure, no DOM) — owns per-clip state:
- `Map<clipId, detector>` and `Map<clipId, sec[]>` (bus, cap 8).
- `createClipTriggers()` → `{ poll(activeClips, bandOf, nowMs, nowSec) → firedIds[], fire(clipId, sec), trigsFor(clipId) → sec[], prune(liveIds), reset() }`.
  - `poll`: for each active clip whose `audioTrigger.enabled`, ensure a detector (rebuild only
    when its tuning `sensitivity|refractoryMs|floor` changes — the sig-compare trick from
    `audio.js setAudioTrigger`), `push(bandOf(clip.audioTrigger.band), nowMs)`; on fire push
    `nowSec` to that clip's bus and collect the id.
  - `fire`: manual (⚡) push of `nowSec` to a clip's bus (cap 8).
  - `trigsFor`: the clip's bus (empty array if none).
  - `prune`: drop detectors + buses for clip ids not in `liveIds`.

**`clip.audioTrigger = { enabled, band, sensitivity, refractoryMs }`** — new clip field; absent = off.

## Data flow

```
mic (SRC.external bands, unchanged, global input)
  ⚡ button ──────────────► clipTriggers.fire(clip.id, nowSec)
  render loop: clipTriggers.poll(activeTriggerableClips, externalBand, ts, nowSec) ─► per-clip bus
  → 2D:  compositor.render(..., { trigSecsFor: key => clipTriggers.trigsFor(ownerOf(key)) })
         runEntry uses instanceKey (clip.id / clip.id:fxN) → uTrigs for THAT clip
  → 3D:  packVolumetrics fills per-slot ages from each clip's bus → sampler uVolTrigs[slot*8+k]
```

## Components / changes

1. **`src/model/clip-triggers.js`** — the pure module above (+ `ownerOf` helper exported or inline).
2. **`src/model/audio.js`** — remove `setAudioTrigger`/`pollAudioTrigger`/`_trig`/`_onset`; add
   `export function externalBand(name)` → `SRC.external.enabled ? SRC.external.bands[name]||0 : 0`.
   Keep `createOnsetDetector` import out (it moves to clip-triggers). Mic enable/bands unchanged.
3. **`src/app.js`** — replace the global `pulseTrigSecs` + `pollAudioTrigger` wiring: instantiate
   `clipTriggers`; in the render loop collect the active triggerable clips and
   `clipTriggers.poll(...)`; `prune` against live clip ids each frame; pass
   `trigSecsFor` to `compositor.render`; feed per-clip trigs into the volumetric pack; `transport.reset()`
   resets clipTriggers. `transport.fire(clipId)` becomes clip-scoped (⚡ passes the id).
4. **`src/engine/compositor.js`** — `render()` accepts `trigSecsFor(key)`; `runEntry` uses it with
   its `instanceKey` (via `ownerOf`) to fill `uTrigs`/`uTrigCount`. Remove the single `frameEnv.trigSecs`.
5. **`src/engine/sampler.js`** — add `uniform float uVolTrigs[32]; uniform int uVolTrigCount[4];`
   (4 slots × 8). Sphere-pulse (`id==3`) + plane-pulse (`id==5`) loops index `uVolTrigs[i*8+k]` /
   `uVolTrigCount[i]` instead of the shared `uTrigs`/`uTrigCount`. `sample()` uploads the per-slot arrays.
6. **`src/engine/fields.js`** — `packVolumetrics` also emits a `trigAges`/`trigCount` per slot (or app.js
   builds them from each clip's bus + time). `evalPacked` already takes `trigAges` — keep parity.
7. **`src/ui/layers.js`** — in `selectedClipEditor`, next to the ⚡, mount the per-clip Audio Trigger
   controls (enable · band · sensitivity · hold) writing `clip.audioTrigger`. ⚡ `onclick` fires this clip.
8. **`src/ui/settings.js`** — delete the "audio trigger" section (keep "audio input" / gain).

## Error handling / edges
- A triggerable **clip effect** (e.g. Shockwave applied to a clip) shares its clip's bus via
  `ownerOf('clipId:fxN') === clipId`. Layer/composition-level triggerable effects have no clip owner
  → empty trigs (acceptable; triggering is a clip concept now). Note this in code.
- Old shows with `composition.audioTrigger` → ignored (no error), no migration needed.
- Detector polled only for the layer's ACTIVE clip (what's rendered) — inactive clips don't fire.
- Volumetric cap stays 4 slots; per-slot trigs bounded to 8 each.

## Testing
- **`test/clip-triggers.test.js`** (pure): two clips on different bands fire independently; a clip
  with `enabled:false` never fires; tuning change rebuilds the detector without losing others;
  `fire()` pushes a manual trigger; `prune` drops dead clips; buses are independent + capped at 8.
- **`test/fields.test.js`**: extend the volumetric pack test to assert per-slot `trigAges` packing.
- Onset detector already covered (`test/onset.test.js`).
- Manual smoke: two Plane Pulse clips, one Band=Bass one Band=High, confirm independent firing.

## Out of scope (YAGNI)
Beat/BPM trigger source, per-layer trigger buses, triggering inactive clips, migrating the old
global config, more than 4 concurrent volumetric slots.
