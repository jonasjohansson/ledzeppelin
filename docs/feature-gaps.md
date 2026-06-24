# Feature gaps vs the industry

A four-agent competitive audit benchmarking ledzeppelin against **Resolume** (content/
compositing), **MadMapper / xLights / Jinx! / LedFx** (mapping & output), **grandMA /
ChamSys / QLab** (show control), and **TouchDesigner / Notch / NDI tools** (sources & I/O).
De-duplicated and ranked for the project's two goals: *run a real timed LED show* and
*richer content*. Effort: S/M/L. Items the agents verified already exist are omitted.

## Already strong (don't rebuild)
Layers + blend (alpha/add/screen/multiply) + per-layer opacity/bypass/crossfade · clip
deck with drag-drop · transport (autopilot: forward/back/shuffle, loop, per-clip dwell) ·
BPM + tap tempo + MIDI-clock-in · 4 modulation sources (timeline/audio/external/dashboard)
with soft-takeover · ~10 GLSL generators + ISF import + video source · ~11 effects incl.
cascade · 4-band FFT from mic/line + clip audio · DDP + Art-Net (ArtSync, universe chunking)
· per-controller colour order, gamma+brightness LUT (daemon-side) · 16 serpentine/pixel-order
patterns · fixture chains · WLED scan/config/reboot/health · OSC-in (:9000) · MIDI/key bindings
· phone control surface · blackout · undo/redo · save/load.

## Tier 0 — near-free wins (engine already there, only UI/wiring missing)
- **Wire up "identify"** — `identify()` is fully implemented in `wled.js` and imported into `fixtures.js` but **never called**. Add a per-device/fixture button → flashes the physical strip. *Critical with 12 controllers.* **S**
- **Gamma slider** — the gamma LUT is built end-to-end (`calibrate.js`/`pipeline.js`); `fixtures.js` only shows a brightness slider. Add one slider. **S**
- **Raw FFT spectrum as a modulation source** — the 512-bin `getByteFrequencyData` is computed then discarded; only 4 reduced bands reach params. Expose bins (bin→fixture is the LedFx/NestDrop core look). **S**
- **PNG snapshot** of the composite (`toBlob`) — for presets/cue thumbnails/docs. **S**

## Tier 1 — to run a real, repeatable, timed show
- **Cue list + scene recall + GO** — *the* structural gap (all four reviews + memory note). Add `composition.cues[]`; a cue = snapshot of {active clip/layer, opacities, bypass, param/dashboard values}; GO/next/prev steps them; standby highlights next. Everything below hangs off this primitive. **L** (snapshot store itself is **M**)
- **Per-cue fade time** — extend the existing per-layer `transitionMs` crossfade to a cue-level fade so GO ramps over N seconds. **M**
- **LFO waveforms** (sine/triangle/saw/square/random/S&H) — timeline modulation is currently linear forward/back/mirror only. Add a `shape` field in `animatedValue`. *Biggest animation gap; transforms all modulation + audio-reactivity.* **S–M**
- **Grand-master + freeze + panic** — blackout exists (0/1); add a 0–100% master multiplier on output bytes, a freeze (re-send last frame), and a one-key panic. **S**
- **Test patterns / channel check** — inject a synthetic frame (solid R/G/B, all-on, single-pixel walk) to verify wiring/colour-order/count when commissioning. **M**

## Tier 2 — core content + mapping parity
- **Image source** (still) — video exists; stills only enter via ISF inputs. Logos/art are routine. **S–M**
- **Video playback controls** — currently hardcoded loop/muted/autoplay; add in/out, scrub, rate, play mode. **S**
- **Webcam + screen/window capture** sources (`getUserMedia`/`getDisplayMedia`) — same texture path as video. **S–M**
- **Audio beat/onset detection + audio-BPM** — beats come only from MIDI clock today; makes the built-in beat-sync usable without a master. **M**
- **Masking / luma-key / matte** — cut content to fixture shapes; no mask concept exists. **M**
- **Column / scene launch** — fire a whole column (every layer's clip at index N) with one click; grid indices already align. **M**
- **Multiple modulators per param + additive/relative mode + colour modulation** — today: one modulator per param, it replaces the value, colours can't be modulated. **M**
- **sACN / E1.31 output** — structurally near-identical to the Art-Net packer; preferred by many pro nodes/desks. **M**
- **Dithering / temporal smoothing** — output is raw 8-bit + point-sampled, so slow dim fades band; add error-diffusion or supersampled area-average. **M**
- **MIDI learn** — channels are typed manually (`cc1`, `note64`); capture-next-message flow. **S–M**

## Tier 3 — strategic / heavier
- **Timecode sync (LTC / MTC / Art-Net TC)** — daemon adds a TC listener → cues fire on timestamps (music-locked shows). **L**
- **Art-Net / DMX input** — be a slave to a front-of-house console; daemon already binds UDP. **M**
- **NDI input** — the main reason pros reach for TD/Resolume; daemon receives NDI → frames over WS. **L**
- **Automation curves / keyframe envelopes** — draw "ramp 0→1 over this clip" (needs a curve UI). **L**
- **Multi-pass ISF** — `PASSES` is parsed but not rendered; unlocks a large feedback/blur shader library. **L**
- **Per-channel white-balance / dimming curves** — match mismatched strip batches (3×LUT). **M**
- **Setlist / multi-composition** with next/prev. **M**
- **A/B preview vs program** — cue a clip before it goes live (second compositor pass). **L**
- **Blur + frame-feedback effects** (needs ping-pong) · more blend modes · text/title source · particle generator · Ableton Link · OSC/MIDI-out feedback · Syphon/Spout out. **M–L each**

## If we build in order
1. Tier 0 (identify, gamma, raw-FFT, snapshot) — hours, all plumbing exists.
2. **Cue list + scene recall + per-cue fade** — the one primitive that makes it a show tool.
3. **LFO waveforms** — small change, outsized creative payoff.
4. Grand-master/freeze/panic + test patterns — commissioning + safety for the Kagora rig.
