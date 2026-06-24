# ledzeppelin — next horizons

## Executive thesis

ledzeppelin is the only tool in its class that can credibly straddle two worlds that have never met: it lets you *author* like a creative VJ/generative engine (WebGL compositor, ISF/GLSL, audio-reactive modulation) while *deploying* like a permanent architectural lighting controller (a stateless Node/Bun daemon that owns the output clock, DDP/Art-Net, per-controller calibration, WLED management). Resolume/MadMapper/TouchDesigner are touring-shaped — they assume a trusted operator at a laptop and a rig that's gone by morning. xLights/LedFx/FPP are install-shaped but creatively thin. **The unique place to win is the permanent generative art install** — its 12 QuinLEDs running unattended for years — where the product must be *alive* (never visibly loops), *reliable* (survives the browser, GPU, network, and power dying at 2am), and *runnable by a gallery host*. The strategy is to push hard on three moats no competitor structurally occupies: a **deterministic, self-evolving engine** (feedback bus + coherent noise + drift + a living director), a **resilient show-control + reliability layer** living in the daemon (scene recall, watchdog, scheduler, telemetry, safe-state), and **install-grade commissioning/ops** (test patterns through the real path, power budgets, as-built docs, event logs). Everything below is sequenced so each "Now" item is a keystone that cheaply unlocks several later ones.

---

## Now — the keystones (build these first)

These are small, high-leverage, mostly engine/daemon primitives. Each one is reused by three to five later features.

| Idea | One-line spec | Why (for the install) |
|---|---|---|
| **Scene snapshots (recall primitive)** | `composition.scenes[]` = named saved states (the undo blob minus geometry); recalled by name with a fade via the existing crossfade. NOT an operator cue/GO list — it is the substrate the scheduler + director recall. | A permanent generative piece is not hand-driven, but the scheduler (“at sunset → Evening”) and the living-show director must recall named looks identically. Capture = an undo step, so it is nearly free. |
| **Modulator stack per param (additive bus)** | `anim[key]` becomes an ordered list of specs, each with `depth` + `combineOp` (replace/add/mul/max); `animatedValue` → `combineModulators`; single-spec fast-path; migrate old shows on load. | The single biggest expressive ceiling: today every modulator *replaces* the value, so you can't "breathe slowly on a sine **and** kick on the bass." Bread-and-butter for a wall, beyond any commercial per-param single-FFT. |
| **Persistent per-layer feedback bus (`uFeedback`)** | Double-buffered FBO per layer-id (runtime-only, like `phaseClocks`), bound as `uFeedback` when a shader declares it; ship 2–3 clamped trail/decay/drip effects. | Nothing remembers the last frame, so every look is flat. ~20-line keystone that unlocks trails, particles, spectrogram, multi-pass ISF persistence, Ken-Burns — five ideas from one change. The reason TD/Notch content feels alive and this doesn't. |
| **True coherent-noise modulator (seeded fBm)** | Add `shape:'noise'` to `animatedValue`: 1-D value-noise over the clock with rate + octaves + persisted seed, deterministic, branch-free. | Today's "random" is steppy sample-and-hold — useless for organic drift. The single most "alive" modulator and the thing that keeps a 24/7 install from looking looped. Resolume can't expose coherent noise per-param. |
| **Bounded self-evolving "drift" autopilot** | A `drift` mode: per-param range + rate, seeded RNG (reproducible), reseed + global freeze controls; built on the noise modulator. | A permanent piece spends most of its life undriven; today's content visibly loops. "Evolve within designer-set bounds" is the difference between a screensaver and a living piece — exactly on-brand for an art install. |
| **Response shaping: transfer curve + asymmetric slew** | Add optional `curve` (gamma/S/4-pt bezier) + `slew` (attack/release ms) to *any* spec; applied after `p`, before from/to. | Raw audio bands are jumpy and linear; a gamma curve makes bass *punch*, asymmetric slew turns a square LFO into a soft pulse and kills flickery faders. Two cheap fields on the universal spec — cleaner than any commercial tool's scattered approach. |
| **Adaptive per-band audio normalization (AGC) + onset** | `audio.js` publishes `*:norm` (rolling AGC), `*:env` (attack/release decay), `*:onset` (spectral-flux pulse); high-confidence onset can drive BPM via the MIDI-clock path. | Today bands just multiply by fixed gain and clamp, so quiet tracks barely light the rig and loud ones pin at 1. AGC is why LedFx "always feels right" set-and-forget — and gives audio-BPM without a MIDI master. Self-contained in `audio.js`. |
| **Wall watchdog → autonomous safe-state failover** | Daemon: if no *fresh* frame for N s, fade to a persisted idle frame (or black) instead of repeating stale; surface state in `/health` + corner HUD. | The worst unattended failure: the browser dies at 2am and the daemon keep-alives a half-rendered frame forever — looks fine, dead underneath. No VJ tool can do this (their render and output share a process). |
| **Render-loop error boundary + per-element auto-bypass** | `try/catch` the `loop()` body (always re-rAF); count throws per site; auto-bypass the offending layer/effect after K; `onerror`/`unhandledrejection` snapshot to the undo vault. | `loop()` has no try/catch — one bad ISF shader kills the rAF loop and the daemon freezes the wall indefinitely. Cheap "one bad clip can't take down the wall" guarantee that earns 24/7 operator trust. |
| **Grand-master + timed fade + zone submasters** | Daemon output stage: global 0–100% master with fade-over-N-seconds + named submaster groups scaling their fixtures' bytes; OSC/MIDI-bound; PANIC overrides all. | "Bring it down over 30s at end of night" and "dim the bar wall, not the art" — applied at the daemon byte stage where gamma/brightness already live, so panic-safe and content-independent. |
| **Calendar + astronomical scheduler** | Daemon scheduler fires scene/setlist targets on wall-clock + computed sunrise/sunset + day-of-week, with DST handling and missed-trigger recovery. | The install is permanent, not touring — the highest-value show-control feature is that *nobody has to be at a laptop*. "At sunset go to Evening, 23:00 fade to Closing." Matches Pharos/Mosaic; Resolume/MadMapper lack it entirely. |
| **Per-controller telemetry watchdog + canvas health overlay** | Daemon polls all controllers every ~5–10s (throttled, yields to stream); pushes status to editor/phone/`/health`; dead node greys its fixtures + canvas marker; optional one-shot config re-push on recovery with backoff. | With 12 Wi-Fi QuinLEDs the #1 real failure is one node browning out or rebooting to factory config — today you only learn by seeing the dark patch. Tells you *which* strip died, live. Leverages the daemon's WLED-API position. |
| **Topology-scoped commissioning test patterns** | Daemon frame generator (solid RGBW, single-pixel runner, per-fixture gradient, count-check) scoped all/controller/fixture/chain via byteStart/byteEnd; TEST ACTIVE state; clean hand-back to live. | Core commissioning ritual: verify colour order, pixel count, wiring direction *through the same route the show uses*, so a passing test proves the real production path. Beats power-cycling into WLED's UI 12 times. |

**Folded-in critic gaps that belong in Now:**

| Idea | One-line spec | Why |
|---|---|---|
| **Photosensitivity / flash-rate governor** | Daemon + editor guard measuring global luminance delta and per-region flash frequency on the *composited* frame; clamp >~3 flashes/s or large luminance steps; "Public Safety" mode with live readout + per-scene safe badge + logged override. | It's a **permanent public** install; a runaway shader or mistuned audio-strobe can harm a photosensitive visitor and the operator is liable. The autonomous director and audio-reactive modes make an accidental strobe *more* likely. No VJ/LED tool ships a content-agnostic flash limiter (broadcast ITU-R BT.1702 / Harding concept). |
| **Controller rediscovery by mDNS/hostname** | Patch a device by stable identity (WLED mDNS hostname / MAC) as well as raw IP; daemon resolves/refreshes on startup and whenever sends start failing, atomically re-binding the route and logging it. | 12 DHCP Wi-Fi nodes *will* change IP after a router reboot — the most common silent failure of a fixed WLED rig. The telemetry watchdog *detects* it; this *heals* it. Pairs directly with the watchdog (the trigger) and event log (the record). |

---

## Next — make it a product

Operator ergonomics, install commissioning, content depth, and the ops backbone.

| Idea | One-line spec | Why |
|---|---|---|
| **Operator console (hardened big-button GO)** | Show-mode layout binding only to scene-recall/master/blackout/panic; no editing affordances; desktop + phone; BLACKOUT/PANIC always available. | At an opening the "operator" is a gallery host, not the designer. Performance mode only locks *keys*; this is a purpose-built run surface where a stray click can't dismantle the mapping. QLab/grandMA ergonomics no VJ tool offers. |
| **GPU particle generator (audio/trigger-aware)** | Fragment-based sim (pos/vel in float textures, gravity/curl/drag/lifetime) rendered as additive sprites into the clip texture; burst-on-`uTrigs`. Builds on the feedback bus. | Zero particle content today. Beat-triggered sparks up the columns is the install's "wow"; curl-noise embers are gorgeous slow ambient. Emits in the *same* canvas space fixtures sample — no "particles in a separate 3D world you can't map." |
| **Full multi-pass ISF + persistent passes** | Render each declared pass into its own (optionally persistent, via feedback bus) target; support sized passes + feedback macros; scope to the common subset, fail gracefully. | ISF imports but only pass 0 runs, so most interesting community shaders (blur/glow/feedback/reaction-diffusion) import broken. Finishing PASSES turns the entire isf.video ecosystem into the install’s content library — "borrow the world's shaders." |
| **Shared role-tagged palette + palette-cycle** | `composition.palette` = ordered named swatches with roles; colour params hold `palette:N` refs resolved on upload; a "palette cycle" modulation walks on beat; literal hex stays default. | Every colour is a buried standalone hex; re-theming for a season means hunting dozens of pickers. "Make tonight blue/gold" becomes one action, and multi-source looks stay coherent. A design-system move beyond Resolume's colour presets. |
| **Polar / kaleidoscope / mirror domain-warp family** | Coordinate-warp effects (read `uTex` at warped coords) with adjustable origin, reusing aspect injection + a softness param to curb aliasing on sparse LEDs. | Cheap, high-yield UV remaps that turn linear content into symmetric/centred content on *any* source. Kaleidoscope on the noise generator alone = endless mandala ambient. Multiplies the value of every existing source. |
| **Token-bound text source** | Rasterize text to a canvas2D atlas→texture; params content/size/weight/tracking/scroll + marquee\|big-glyph; `{{token}}` bindings (time/date/scene/BPM/OSC) via the signal map. | No way to put words on the rig. A venue routinely needs an opening time, event name, countdown, one-word message — staff change it without opening the editor. Big-glyph beat-advance is the LED-specific detail tools miss. |
| **Fixture-space generative coordinates** | Second per-LED attribute texture (strip-index, along-strip 0→1, controller-id, x/y); a "mapping mode" lets a generator render in fixture/strip space instead of canvas-UV. | Content is authored in flat canvas pixels and fixtures merely sample it, so "chase down each tube" or "ripple out from controller 6" needs faking geometry. Fuses content + mapping — the xLights/LedFx per-pixel superpower canvas-only tools can't do. Additive, per the decoupling memory. |
| **Audio macros (one source → many params)** | Audio-macro object: pick source/band/feature once, route to N targets each with from/to/invert/curve; editing retargets all; combine additively per destination. | "The kick brightens the floor, kicks the cascade, AND nudges a shader's speed" without hand-wiring ten params. Closer to a TD CHOP fan-out than any VJ tool's per-param FFT. Pairs with response shaping + the modulator stack. |
| **Configurable log/mel band splitter + raw-FFT-to-texture** | Replace the fixed 4-band with log/mel N-band (per-source) as namespaced signals; upload `getByteFrequencyData` as a 1D texture (`uAudioFFT`); implement ISF audio/audioFFT input types. | The hard-coded linear bin splits are musically wrong and dump everything into "bass"; the 512-bin FFT is computed then discarded. "The rig IS the spectrum" (LedFx/NestDrop) + unlocks audio-reactive ISF whose inputs are silently dropped today. |
| **DMX/Art-Net/sACN INPUT (be a slave to a house desk)** | Daemon UDP listener; a patch table maps universe+channel → external-modulation channel / master / blackout / scene recall via the existing `broadcastExt` path. | A permanent install is often run from a house lighting desk. Folding inbound DMX into the *same* external bus OSC/MIDI already feed makes any exposed param DMX-controllable with zero new plumbing — essential when handed to venue operators. |
| **sACN / E1.31 output (multicast + priority)** | Add `protocol:'sacn'` beside ddp/artnet: E1.31 packer, universe→multicast group, DMX start code, per-source priority; unicast fallback. | The lingua franca for serious fixed installs and non-WLED nodes (Advatek/PixLite, ENTTEC). Multicast avoids unicasting the same data 12×; priority lets a console take over. Near-identical to the Art-Net packer, so cheap. |
| **Versioned local snapshot vault + crash-safe autosave** | IndexedDB ring of ~30 timestamped snapshots + daily milestones (write on idle/blur/heartbeat); History panel to scrub/restore; startup integrity walks back to newest valid. | The entire show lives in one synchronous localStorage key; a corrupt parse silently drops to defaults — the whole show vanishes. Turns "a non-author broke it on-site" into a 5-second restore. No VJ tool has an in-app scrubbable version ring. |
| **WebGL context-loss recovery** | `webglcontextlost` listener `preventDefault`s + tears down GL; `contextrestored` rebuilds compositor/sampler/program cache and re-uploads video textures from the current show; brief recovery HUD. | On a long-running Pi/kiosk the GPU process resets (driver timeout, sleep/wake) and silently kills the whole GL stack — the classic unattended-WebGL failure. Turns a dead wall into a 1-second reflash. |
| **Daemon last-good-frame + cold-boot safe state** | Persist last route + last frame (route always, frame at low rate) to disk; on daemon start with no client within T s, replay route + last frame or a configurable safe pattern; never override a live client. | On a daemon/power restart (cleaners, breakers, mains timer) the wall sits in WLED's own boot state (default effect or full white) until the editor wakes. Makes the piece look deliberate from second one — console-grade boot behaviour. |
| **Power & current budget per controller** | Per-fixture mA/pixel-at-full-white → estimate live + worst-case current per port/controller vs configurable PSU budgets; device-list power bar + canvas heat overlay; optional daemon-side global cap. | A permanent 12-controller piece has real fused supplies and fire-marshal limits; knowing all-white would pull 14A through a 10A injection point *at design time* is exactly the safety check a fixed install needs. WLED has only per-node ABL; xLights has no power model. |
| **Crowd/presence-reactive mode** | Define sensor channels on the ext bus (`sensor:presence/nearest_m/crowd`) with smoothing/hysteresis; ship reference ESP sketches + "presence behaviours" presets. | A public art piece that *responds* to people is far more compelling than one that plays. Plumbing (ext → signals) already exists, so it's mostly a convention + reference firmware. Turnkey "plug a sensor, get presence-reactive art" is novel for this class. |
| **Per-channel white balance + per-segment dimming (3× LUT)** | `buildLut`→`buildLut3` (three 256-entry tables) applied per channel in the existing pass; per-device/segment R/G/B gain + gamma + white-point with a match-neighbour eyedropper. | A multi-year install accumulates strip from different batches/vendors that visibly mismatch; one global gamma can't fix it. The difference between a polished install and a patchy one. Folds into the existing zero-copy output pass. |

**Folded-in critic gaps that belong in Next:**

| Idea | One-line spec | Why |
|---|---|---|
| **Installer documentation export (as-built pack)** | One-click per-controller patch table (port→fixture→pixel range→universe/DDP offset), labelled canvas diagram, IP/hostname sheet, daisy-chain order — regenerated from the live model. | A 12-controller rig is installed/maintained by people who aren't the author. Today every fact lives in a localStorage blob; a printed sheet taped in the rack is how fixed installs are serviced. `repackOffsets()` already computes the ranges. No creative tool produces a commissioning doc. |
| **Access control + change audit on the daemon** | One-time operator token (or LAN allowlist) for any state-changing route (WLED config/reboot, route, OSC rebind, future scene/master/blackout); `/health` + read-only surface stay open; append-only audit log. | The daemon is wide open on the LAN — any device on venue Wi-Fi can reboot a QuinLED or (with the new control APIs) blacken the wall. Table-stakes before exposing the headless control API + DMX/OSC-in. Security is the classic blind spot of this category. |
| **Operational event log + nightly health digest** | Append-only ring log on the daemon (client connect/disconnect, route change, controller dark/recovered, IP rebind, watchdog failover, safety clamps, scheduler triggers, errors) at `/api/log` + optional daily summary; in-editor timeline. | For an unattended piece the author isn't there at 2am. Turns "a guest said it was dark Tuesday" into a 5-second diagnosis. The maintenance backbone the watchdog/rediscovery/recorder ideas all *assume* but none provides. |
| **Managed media pool + deployment-target health checks** | Media stored by content hash with metadata, de-duplicated, continuously health-checked (missing file, undecodable codec on the Pi, oversized texture); Library panel flags anything that would render black *before* it reaches the wall. | A curated install accumulates content over years, often updated by non-authors; today a broken/oversized file just renders black, discovered when a guest notices. Validating against *this kiosk's* decode/texture limits is novel and uniquely useful for a single deployment. |
| **Environment-adaptive output (thermal derate + curfew dimming)** | Daemon modulators on the global cap: progressive brightness/current cap as a controller (or ext temp sensor) runs hot; a late-night curfew/circadian curve tied to the scheduler's sunset/sunrise. | A semi-outdoor permanent piece overheats in summer and a bright wall at 3am annoys neighbours / violates light ordinances. Thermal derate is genuine hardware protection; curfew is the difference between a permitted install and a complaint-driven shutdown. Architectural-lighting thinking imported into the engine. |
| **Self-status on the rig + designed holding/attract state** | Optionally reserve a few pixels the daemon drives as a status tell (amber breathe = idle/no client, red = node dark, green = healthy boot); plus a designer-authored holding look the daemon owns for cold-boot/idle/error. | When the author is off-site, the first diagnostic is the wall itself; a tiny on-rig tell lets non-technical staff report the right thing, and a branded holding look means a power blip never exposes WLED's factory rainbow. Embedded-appliance thinking; the visible surface of the watchdog/safe-state ideas. |
| **Output latency / inter-controller sync measurement** | Flash a known pattern through the real output path, capture via the phone camera (or a photodiode), compute per-controller timing offset, write `syncDelayMs` back; report stream-to-light latency. | The engine *has* per-device `syncDelayMs` but no way to know the right value — today it's trial-and-error by eye. 20ms skew turns a clean horizontal wipe into a staircase. Pro servers expose latency; none *measures* per-node delay and writes it back. |

---

## Later — deepen the moat

Bigger refactors and ecosystem reach that pay off once the foundations exist.

| Idea | One-line spec | Why |
|---|---|---|
| **A/B preview vs program + LED-sampled preview + TAKE** | Refactor compositor to render an arbitrary state; second program+preview pass (preview also sampled to a strip view); commit via TAKE / manual A/B crossfader. | Every edit is live on the wall; no way to build the next look without the audience watching you fumble. The strip-sampled preview (not just the 2D art) is the LED-specific twist Resolume's preview lacks. |
| **Timecode-locked scene firing (LTC/MTC/Art-Net TC)** | Daemon TC listener (LTC over line-in, or MTC/Art-Net-TC over UDP) publishes a timestamp over WS; scenes gain fire-at HH:MM:SS:FF; playhead re-seated with jam-sync/freewheel. | For any moment scored to music/video (opening ceremony, synced multi-room) visuals must lock frame-accurately, not free-run on BPM. `playheadClip` is *already* a pure function of elapsed time — "swap the time source," not a rewrite. |
| **`.ledshow` portable bundle** | Export a zip (show JSON, embedded ISF source, media embedded or by-hash, `{schemaVersion,version,canvas,deviceCount}` manifest); drag-to-open with relink + migration prompts. | The whole show lives only in one localStorage key — a cache wipe loses the installation's programming. The unit every other ecosystem feature (versioning, sync, registry) depends on; restores the show on the Pi after a reflash. |
| **Schema version + ordered migration chain** | Migration registry run on load from `file.version`→CURRENT, then validate; stamp on save; golden-file tests that every old fixture JSON round-trips. | `version:1` is stamped but never read; upgrades happen via scattered field-sniffing normalizers that fight each other. A show authored this year must open after a year of updates. Gives a clear "file newer than app" failure instead of silent wrong behaviour. |
| **Headless show server + REST/WS control API** | Extend the daemon with `/api/show`, `/api/scene/go|next|prev`, `/api/master`, `/api/blackout`, `/api/state` stream + a headless flag (offscreen render or baked-frame replay), LAN-bound + optional token. | The install should boot the Pi, load the show, and run with no browser tab, integrating with the building (kiosk button, Home-Assistant, "gallery open" switch). Today streaming needs a live tab — fragile for an unattended piece. (Gate behind the access-control gap.) |
| **Autonomous "living show" director** | Director process emits `director:energy/palette` + scene-recall from a tunable declarative grammar (mood blocks, allowed transitions, intensity-by-time, anti-repeat memory); human pin/override always available. | A fixed loop looks repetitive within a day; a generative director keeps a permanent piece alive for months and degrades gracefully. The single biggest differentiator of an installation vs a VJ set — none of Resolume/MadMapper/grandMA/xLights ship this. Built on scene snapshots as the recall substrate. |
| **xLights / FPP (.fseq) export** | Offline render pass bakes the *deterministic* timeline through the existing sample pipeline to `.fseq` by fixture pixel order; flag audio-reactive content as un-bakeable. | The permanent-install world runs on FPP+fseq for rock-solid unattended playback on $35 hardware. "Author like Resolume, deploy like FPP" is a position no creative VJ tool occupies. |
| **Modulation routing matrix (live-metered)** | Aggregate read/write panel over the existing anim/dmx-bind data (reuse `dashboardLinkLabels`) with filtering so only bound/hovered params render; live meters per cell. | Once a show has dozens of binds across clips/layers/DMX you lose track of what drives what. Makes the hidden modulation graph legible to whoever maintains the install later (surfaces dead binds too). A signature "serious software" surface. |
| **GDTF fixture-profile interop** | Import a GDTF zip/XML subset (channel functions/modes) into the `dmx.js` channel model; export ledzeppelin DMX defs as GDTF; MVR placement a stretch goal. | An install rig mixing addressable LED with conventional DMX (washes, haze, moving heads) can pull correct profiles instead of hand-typing channels and round-trip with a real console. No LED-pixel/VJ tool reads GDTF. |

**Folded-in critic gap that belongs in Later:**

| Idea | One-line spec | Why |
|---|---|---|
| **Linear-light compositing + temporal (blue-noise) dithering** | Composite/gamma in linear light (sRGB decode → blend → encode); add ordered/blue-noise temporal dithering at the daemon byte stage; both off by default with a preview toggle. | The biggest perceived image-quality upgrade for a fixed install seen up close at night: slow dim fades currently *staircase* on a real strip, and crossfades mix in non-linear space. Temporal dithering buys ~2 perceptual bits on WS2815. *Opt-in + migration-aware* (it changes every existing look). Pairs with the 3× LUT (same byte pass) and the watchdog (don't dither a frozen frame). |

---

## Moonshots — category-defining bets

High effort, high risk, but each redefines what a permanent generative LED piece can be. All three depend on a one-time **determinism audit** (`Math.random`/wall-clock), which is itself the shared unlock.

| Idea | One-line spec | Why |
|---|---|---|
| **Deterministic state black-box recorder + replay** | Ring-buffer logger of the deterministic state stream (clock, seed, scene, key signals) + auto-bookmarks; scrub/replay any window, export to a scene. Needs the determinism audit first. | Record *state*, not pixels: months fit on a Pi in bytes/sec and re-render at any resolution; auto-harvest rare/high-energy looks. A pixel recording of a 12-controller rig is huge and topology-bound. No LED/VJ tool records generative state for exact replay. |
| **Camera-based LED self-calibration via the phone** | Guided capture: daemon walks `identify()` per pixel, phone `getUserMedia` + blob detection locates each lit point, homography back-projects to canvas to auto-write fixture transforms with touch-up. | Hand-placing 12 controllers' worth of strips is the most tedious, error-prone commissioning step, redone whenever the rig is adjusted. Turns hours into a 10-minute walk-around. Madrix/xLights camera mapping, built into the phone companion. CV robustness + homography make it genuinely hard. |
| **Multi-instance venue sync (phase-locked generative)** | Tiny sync protocol over the existing WS broadcasting `{epoch,seed,sceneId,bpm}`; periodic re-sync for clock drift; shares the determinism audit. | If the install spans more than one host (or gains a satellite piece), they should pulse as one organism. Because the engine is deterministic, byte-trivial state broadcast keeps generative content frame-aligned — even over the public internet. Resolume pixel-streams between machines; syncing deterministic *state* is novel. |

---

## Critic's blind spots (the unglamorous layers that make it deployable)

The competitive idea list is strong on *expression* and *show control* but, viewed as a **permanent public appliance**, had real holes. These are merged into the tiers above, but called out here because collectively they're the difference between "a clever tool" and "a piece a venue will sign off on":

- **Safety is unaddressed.** Nothing bounds flash rate — and the autonomous director + audio-reactive modes make an accidental strobe *more* likely. The **photosensitivity governor** (Now) is a deployability prerequisite, not a nice-to-have, given real-world liability for a public install.
- **Self-healing, not just self-detecting.** The telemetry watchdog *sees* a dead node; **mDNS/hostname rediscovery** (Now) *fixes* the most common silent failure (DHCP IP change). Detection without healing still means a dark patch until someone notices.
- **No observability culture.** A permanent unattended piece needs an **event log + nightly digest** and **access control + audit** (Next) — building-automation hygiene that every other idea (recorder, watchdog, headless API) silently assumes.
- **The physical world intrudes.** **Thermal derate + curfew dimming**, **power budgets**, **output-latency measurement**, and **as-built docs** (Next) are the architectural-lighting concerns touring tools ignore because they're gone by morning.
- **Image quality up close at night.** **Linear-light + temporal dithering** (Later) fixes banding on hero pixels that a flicker-fade modulation patch can only partially mask.
- **Content ops.** A **managed media pool with deployment-target health checks** (Next) stops a seasonal video drop from silently rendering black on the Pi.
- **The rig as its own diagnostic.** **Self-status pixels + a designed holding/attract state** (Next) make cold-boot/idle/error first-class authored looks instead of WLED's factory rainbow.

---

## Deep dives (full build specs)

### 1. Scene snapshots — the recall primitive — *Now*

**What it does.** Named saved states the scheduler and the living-show director recall by name (“Opening”, “Peak”, “Ambient”) — built on the *same blob* `app.js` already pushes onto the undo stack, so capture is free. This is the recall SUBSTRATE the autonomous layers need; it is deliberately NOT an operator “cue list / GO” surface — a generative permanent install is not hand-driven from a console.

**Data model (`src/model/`).** `composition.scenes = [{ id, name, state }]` where `state` is `composition` minus geometry (drop `fixtures/devices/deviceTypes`). Pure reducers in a new `src/model/scenes.js`: `captureScene`, `renameScene`, `deleteScene`, `reorderScene`, `recallScene(show, id, fadeMs)`. `show.js` migrate defaults `scenes ||= []`.

**Engine.** Recall is a state interpolation in `app.js` (not the compositor): `lerpComposition(from, to, t)` walks layers by id (lerp `opacity`, numeric params, `composition.opacity`); discrete fields switch at the midpoint via the existing per-layer `transitionMs` crossfade. No `server/` or compositor changes.

**UI.** A small list in the Composition area (capture / name / recall), monospace + hairline — no standby/GO/console chrome. The scheduler and director recall scenes by id.

**MVP vs full.** *MVP:* capture/recall/delete + numbers-only lerp (discrete = hard switch at t≥0.5). *Full:* clip-dissolve integration, reorder/rename, thumbnails.

**Effort.** MVP **S–M**. Key files: new `src/model/scenes.js`; edits to `src/app.js`, `src/model/show.js`.

### 2. Modulator stack per param (additive / multiply / max bus) — *Now*

**What it does + UX.** `anim[key]` becomes an **ordered list** of specs, each with `depth` (0..1 wet/dry) and `combineOp` (`replace`/`add`/`mul`/`max`), folded over the base `params[key]`. So a wall can "breathe slowly on a sine **and** kick on the bass **and** be nudged by a phone fader" on one param. The animated-param row keeps the cog popover; below the active modulator a **"+ modulator"** affordance adds a collapsible sub-row with the existing mode controls plus an op chooser (`+ × max ⟂`) and a depth mini-knob. First modulator defaults to `replace`; subsequent ones to `add`.

**Data model (`src/model/anim.js`, `layers.js`).** Reuse the exact spec shape as a list element; add optional `depth` (default 1) and `combineOp`. `anim[key]` may be `Spec | Spec[]` — keep the single-object form valid on disk so mapping/dashboard readers keep working. New normalizers: `asStack(entry)` → always an array (no-alloc shortcut when already an object), `firstSpec(entry)` → object form. New combiner:
```js
combineModulators(base, specs, timeSec, signals, instanceKey, key, params) // folds each spec via applyOp
```
`applyOp` semantics: `replace → lerp(acc,v,d)`; `add → acc + (v - s.from)*d` (a resting band adds 0); `mul → acc*(1 + (v-1)*d)`; `max → max(acc, lerp(acc,v,d))`. **Clamp the final result to the param's [min,max] at the call site.** Migration leaves single-object specs *as-is* (zero churn) and normalizes array elements. Editing helpers (`addClipModulator`/`setClipModulator`/`removeClipModulator`, layer mirror) collapse a 1-length stack back to a bare object on save so single-modulator params stay byte-identical.

**Engine.** The fold lives in `resolveParams`/`animatedValue`'s callers — **compositor needs no change**. `resolveParams` gets a single-spec fast-path (`length===1 && op==='replace' && depth===1` → today's exact path) so the common case stays allocation-free. Transform reads (`a['tf.'+f]`, `tf.opacity`) switch to a `resolveOne(base, entry, …)` helper. External soft-takeover state keys per slot (`instanceKey + '|' + key + '#' + i`). No `server/` changes.

**UI.** In `animatableParam` (Inspector), render one sub-block per modulator (reuse `rangeTrack` + `animControls`), each prefixed by an op segmented control + depth mini, plus a "+ modulator" ghost button. The cog popover sets the focused slot's mode. Mapping/Dashboard panels keep using `firstSpec()` (target slot 0). CSS: `.mod-slot`/`.mod-op`/`.mod-depth`, hairline, accent-underline active.

**MVP vs full.** *MVP:* `asStack`/`firstSpec`/`combineModulators`/`applyOp`; fast-path + fold; transform `resolveOne`; ops limited to `replace`+`add`; UI render + op toggle + depth + add/remove; migration that leaves single specs untouched. *Full:* all four ops, per-slot solo/mute, combined-value readout with contribution breakdown, per-slot MIDI/OSC mapping, drag-reorder, copy/paste.

**Risks.** Per-frame fold at rig FPS (mitigated by the object-shape fast-path; audit `combineModulators` allocation on the 12-controller budget). `add`/`mul` range semantics are a design choice (`acc + (v - s.from)*d` chosen so resting contributes 0; confirm against real FFT scaling). Two externals on one param: per-slot ids prevent fighting but summing may surprise — document. **Backward-compat is the main surface:** grep `\.anim\?\.\[` and `\.anim\[` and route every reader through `firstSpec()`/`asStack()` before merge.

**Effort.** MVP **M**, full **L**. Key files: `src/model/anim.js`, `src/model/layers.js`, `src/app.js` (render loop ~L2628–2641 + transform reads), `src/ui/layers.js` (`animatableParam`, `applyLive`), `src/ui/ui.css`; audit `mappings.js`, `dashboard.js`.

---

### 3. Wall watchdog → autonomous safe-state failover — *Now*

**What it does + UX.** The daemon detects "no *fresh* frame for N seconds" and, instead of repeating stale pixels, cross-fades the output to a persisted idle frame (or black) over a configurable ramp, then holds. When fresh frames resume it fades back. State (`live`/`stale`/`idle`/`recovering`) shows in `/health` and a small corner HUD. In normal operation invisible; when the browser falls over at 2am the wall settles to a known-good look within N seconds instead of freezing on garbage, and `/health` reveals the renderer is down without walking to the wall.

**Data model.** Config on the composition (saves with the show): `composition.watchdog = { staleSec: 8, fadeMs: 1500, idle: { mode: 'black'|'hold'|'frame' } }`. Persist the idle frame in **route/pixel space** (the daemon has no compositor): `idle.solid = [r,g,b]` (recommended MVP) or `idle.frameB64` (base64 RGB sized to the route's total LED count, captured from the browser's existing RGB buffer in `bridge.js`). `show.js` validation clamps ranges and drops `frameB64` if its length doesn't match the current route.

**Engine/output (`server/`).** Entirely daemon-side. `index.js` route handler stashes `m.watchdog` + optional `m.idleFrame`; per-connection state gains `lastGoodFrame`, `lastFreshAt`. Record `lastFreshAt` **only on inbound binary browser frames**, never on the daemon's own keep-alive resends. The output timer becomes a 3-regime state machine: **live** (current behaviour), **fading→idle** (`t = clamp((staleFor - staleSec*1000)/fadeMs)`, send `lerp(lastGoodFrame, idleTarget, t)` at `outFps`, then keep-alive at ~1Hz), **recovering** (symmetric fade back on a fresh frame). The lerp runs on the route byte buffer pre-protocol, then goes through the unchanged `sendFrame` so per-device colour order/gamma still apply. `output.js` adds `lerpFrame(out,a,b,t)` + `solidFrame(len,[r,g,b])`. `/health` adds `watchdog`, `staleForMs`, `staleThresholdMs`, `idleMode`, `lastFreshMsAgo`. `bridge.js` adds `setWatchdog`/`setIdleFrame`/`onWatchdog` over the existing socket.

**UI.** Corner HUD (reuse `out-hud`) shows `WALL: IDLE (renderer offline)` on `onWatchdog('idle')`. Settings → Output island: `staleSec`, `fadeMs`, idle mode (Black / Hold last / Solid + swatch / Snapshot), with a "Capture idle look" button grabbing the route RGB buffer.

**MVP vs full.** *MVP (½–1 day):* stale detection + `black`/`solid` instant cut after `staleSec`; one `staleSec` field + Black/Solid toggle; `/health` reports `watchdog` + `staleForMs`. Kills the "stale frame forever" failure. *Full:* fades in/out, snapshot capture/persist with route validation, HUD + daemon→editor push, explicit `hold` mode, optional external alert when entering idle.

**Risks.** Multiple output clients (only the client that sent a `route` owns freshness; phones must not reset `lastFreshAt`). Distinguishing fresh vs keep-alive (record `lastFreshAt` only on binary frames). Backpressure (default `staleSec` 8s, above worst-case stall). Route changes invalidate a stored idle frame. Persisted base64 bloats the show JSON (prefer `solid`).

**Effort.** MVP **S**, full **M**. Key files: `server/index.js`, `server/output.js`, `src/bridge.js`, `src/model/show.js`, `src/app.js`, `src/ui/fixtures.js`.

---

### 4. Render-loop error boundary + per-element auto-bypass — *Now*

**What it does + UX.** Wraps the `loop()` body and the per-element draw calls so a throwing shader/effect/clip skips just that element instead of killing the rAF chain. Each throw is attributed to a *site* (layer/clip/effect slot); after **K=3** throws in a sliding window the element is auto-bypassed with a "degraded — `<name>` bypassed" toast + re-enable action. Global `window.onerror`/`unhandledrejection` snapshot the show into the undo vault and surface a recoverable banner. The guarantee: **one bad clip can't take down the wall.**

**Data model.** Reuse the existing `bypass` field (error counters are runtime, not persisted). `layers.js` adds `setLayerBypass(show, id, on)` and, for per-effect disable, an effect entry may be `"name"` *or* `{name, disabled:true}` with `effectName()`/`effectEnabled()` normalizers; `migrate()` tolerates both shapes. No new persisted error fields.

**Engine.** In `compositor.js`, a module-level `faults = new Map()` keyed by the existing site ids (`layer.id`, `clip.id`, `layer.id+':fx'+i`, `'comp:fx'+i`). A `guard(siteId, label, fn)` wraps each draw (`try{fn()}catch{recordFault(...)}`), skips already-bypassed sites cheaply, and bumps a sliding-window counter that flips `bypassed` at K. Apply `guard()` at the generator, video, ISF, and clip/layer/composition effect loops; a thrown effect leaves `cur` untouched (degrades to passthrough, not black). Factory exposes `getDegraded()` + `clearFault()`; reuse the dead-state GC to evict faults for dead ids. In `app.js`, wrap `loop()` in `try/catch` with `finally{ requestAnimationFrame(loop) }` (the loop must never die); on repeated *out-of-compositor* faults enter safe mode (keep compositing, stop `bridge.send`). After `compositor.render`, drain `getDegraded()`, flip the persisted flag, raise a toast. Add `window.onerror`/`unhandledrejection` → `snapshotForUndo` + a `localStorage` recovery marker. `server/` adds a stale-frame watchdog (shared with idea #3) reporting on `/health`.

**UI.** New minimal `src/ui/toast.js` (near-black, monospace, hairline, accent underline, auto-dismiss 8s, optional action). Deck integration: a degraded layer/clip/effect shows its `B` toggle in a degraded state with a `!` marker; clicking re-enables via `clearFault`. Status dot reflects daemon `stale`/editor `safeMode`.

**MVP vs full.** *MVP:* `try/catch`+`finally` around `loop()`; `guard()` at the four compositor sites with per-site counter + auto-bypass (whole layers, runtime-only); `getDegraded()` → flip existing `bypass` + `console.warn`; global handlers → snapshot + marker. *Full:* per-effect disable (`{name,disabled}` + migration), `toast.js` + deck markers + re-enable, sliding-window dedupe, editor safe-mode + daemon stale-frame watchdog/health.

**Risks.** `try/catch` only catches JS throws — most GL errors are async/non-throwing; the boundary catches null params, bad ISF compile (`program()` throw), and exceptions in `resolveParams`/`runEntry` (confirm `program()` throws on compile/link). A mid-draw throw can leave GL state dirty — restore default framebuffer/blend/active-texture in the catch. Context loss is a separate failure (idea: WebGL context-loss recovery). Counter thrash → use K-in-window, not K-ever. Effect-shape migration touches every `effects` reader — centralize via `effectName()`/`effectEnabled()`.

**Effort.** MVP **S**, full **M** (effect-shape migration is the only cross-file ripple). Key files: `src/app.js` (loop ~2572–2704, `snapshotForUndo` ~173, health poll ~2692), `src/engine/compositor.js` (call sites 285–308, 463–519, 541–551, factory 589), `src/engine/gl.js` (`program()`), `src/model/layers.js`, `src/ui/layers.js`, new `src/ui/toast.js`, `server/output.js` + `server/index.js`.

---

### 5. Coherent-noise modulator (`shape:'noise'`) — *Now*

**What it does + UX.** A fifth LFO waveform, **`noise`**: deterministic 1-D value-noise (fBm) over the same free-running clock, producing smooth organic drift instead of steppy sample-and-hold. Reuses the existing rate control (seconds *or* beat-sync) as base frequency, adds **octaves** (1–4) and a persisted **seed**; reverse/bounce stay meaningful. A new glyph in the waveform row reveals `oct` and `seed` (with a dice/reroll) fields.

**Data model.** Only `src/model/anim.js` changes. `LFO_SHAPES = [...,'noise']`; optional `octaves` (default 2, clamp 1–4) and `seed` (uint, default 1). Add a branch-free value-noise core (`fade` smoothstep, `vnoise1` reusing `rand01` as the lattice hash, `fbm1` with normalization) next to `rand01`. In `animatedValue`'s timeline branch, add a `noise` arm *before* saw/sine (bypasses `lfoCurve`), feeding the continuous *unwrapped* phase derived from `specDurationMs(spec, signals.__bpm)` — so beat-sync comes for free. Clamp output to [0,1] before mapping to from/to.

**Engine/output.** **None.** `resolveParams`→`animatedValue` collapses every spec to a number before the compositor/daemon see it. The only requirement is determinism — `Math.sin`-hash + `Math.floor` are pure, so replays at the same `timeSec` are bit-identical.

**UI (`src/ui/layers.js`).** Add `{value:'noise', glyph:'≈', title:'noise (coherent drift, fBm)'}` to `WAVE_DEFS`. In `animControls`' timeline branch, when shape is noise append `mini('oct', …)` and a seed field + reroll. The sparkline preview and live readout already call `animatedValue`, so they render noise correctly (verify the sparkline samples a few cycles). `retimeLfo`: skip retiming for noise (non-invertible) — accept a tiny jump on reverse/bounce toggle.

**MVP vs full.** *MVP:* single-octave value noise (octaves fixed at 2 internally), seed default 1 + reroll, base period from existing rate, reverse/bounce honored — ~30 lines + one `WAVE_DEFS` entry. *Full:* expose octaves field, sparkline tuned for multi-cycle drift, optional contrast knob.

**Risks.** Determinism across reload (confirm the master clock is monotonic from a fixed origin). fBm normalization — clamp to [0,1]. Beat-synced noise speeds/slows with tempo (usually desired). Glyph must render in Commit Mono (fallback to a Pixelarticons SVG).

**Effort.** **S** (MVP), **S–M** (full). Lowest-risk modulation feature — lives entirely behind the resolve-to-number contract. Key file: `src/model/anim.js`, `src/ui/layers.js`.

---

### 6. Bounded self-evolving "Drift" modulation — *Now*

**What it does + UX.** A fifth per-param mode, `drift`: a slow seeded random-walk / value-noise within the designer's `from..to` bounds at a per-param `rate`. Picked from the same cog menu as Basic/Timeline/Audio/Dashboard; the in/out track sets bounds, one `s` field sets wander speed. Two composition-level controls make it production-safe: **Reseed** (re-rolls every drift seed) and global **Freeze** (holds every modulator's clock for a still — commissioning/photos/forced calm). Seeds + one shared clock fully determine output, so a saved show replays identically.

**Data model.** `src/model/anim.js`: `makeDriftAnim(from, to, rateHz=0.05, seed)`; a `spec.mode==='drift'` branch in `animatedValue` using the existing `rand01` hash for smooth value-noise (no `Math.random` in the frame loop), reading only the clock passed as `timeSec`. `composition.frozen: false` + transient `_freezeAt` (stripped on save).

**Engine.** Compositor: **none** (drift resolves to a number via `resolveParams`). Server: none. In `app.js`'s frame loop, gate the modulation clock when frozen (`t = _freezeAt`), and a reseed helper walks layers/clips rewriting drift seeds, then persists via the debounced save.

**UI (`src/ui/layers.js`).** Cog menu gets a `drift` item; controls reuse the in/out range track + one `s` rate field. The composition island gets a Drift sub-row with **Reseed** + **Freeze** (mirrored to the phone surface and a keyboard binding via `mappings.js`). A `D` clip badge alongside `A`/`E`.

**MVP vs full.** *MVP:* `mode:'drift'` single-octave smoothstep noise, per-param from/to/rate/seed; cog item + rate field; composition Freeze (clock gate) + Reseed. Turns looping clips into a living piece. *Full:* two-octave/Perlin, per-param reseed, a drift master-rate multiplier, audio-pinning freeze, delayed-correlation across neighbouring fixtures (reusing cascade/fixture-chain stagger, not a second system), phone `D`.

**Risks.** Save churn (persist reseed via debounced save, strip `_freezeAt`). Clock source must be the shared monotonic clock (don't reset on clip advance). Route drift through `animatedValue` only (not external takeover). Perceptual rate band ~0.02–0.1 Hz (clamp). Freeze must look distinct from blackout/panic.

**Effort.** **S–M.** Key files: `src/model/anim.js`, `src/app.js` (frame loop), `src/ui/layers.js`, `src/model/mappings.js`.

---

### 7. Response shaping: transfer curve + asymmetric slew per modulator — *Now*

**What it does + UX.** Two optional, universal post-processors on *any* spec, applied to the normalized phase `p` before mapping to from/to: a **transfer curve** (gamma / S-curve / 4-pt bezier) and an **asymmetric slew** (attack/release ms). Works identically for Timeline/Audio/Dashboard/External — one place to make a bass band *punch* (gamma) or a square LFO read as a soft pulse (release slew). A "shape" disclosure adds a curve selector + draggable mini-thumbnail + `atk`/`rel` fields.

**Data model (`src/model/anim.js`).** New optional fields, omitted when neutral (keeps saves clean + fast-path intact): `curve:{type:'gamma'|'s'|'bezier', amount?, p1?, p2?}` and `slew:{atk, rel}` (ms). `CURVE_TYPES`. Pure `applyCurve(curve,p)` (clamped; bezier via Newton+bisect). Slew state in a module-level `Map` keyed `${instanceKey}|${key}`, with `resetSlew()`.

**Engine.** `animatedValue` is the single chokepoint: after `p` is computed and before mapping, `if(spec.curve) p = applyCurve(...)` then `if(spec.slew && ctx?.key) p = applySlew(ctx, spec.slew, p)`. Slew needs wall-clock dt + a state key → add an optional `ctx = {instanceKey, key, nowMs}` 4th arg; `applySlew` is a one-pole toward target with τ = atk (rising) / rel (falling), frame-rate independent. Thread `ctx` from `resolveParams` and the transform/opacity calls in `app.js` (capture `nowMs` once per `resolveParams`). Call `resetSlew()` (and the latent-bug `resetTakeover()`) in `rebuild()` on load/undo. **No `server/` changes** — DMX layer-bindings read layer opacity, which can itself be a shaped modulator, so shaping rides through.

**UI (`src/ui/layers.js`).** In `animControls`, a collapsible **Shape** row: a 3-way curve segmented control + an `amount` field; bezier reveals a ~64px draggable mini-canvas; two ms fields `atk`/`rel`. Wire via `onAnim`/`onAnimLive`. The live readout already reflects post-curve value.

**MVP vs full.** *MVP:* `gamma` + slew (~40 lines + one row), reset via `rebuild()`. Covers ~80%: bass punch + de-flicker faders / soft-pulse square. *Full:* S-curve, 4-pt bezier with draggable canvas, live thumbnails, presets ("punch"/"ease"/"gate-soft").

**Risks.** Slew makes shaped specs non-deterministic vs frame timing (acceptable; keep `applyCurve` pure + unit-tested; un-slewed specs stay deterministic so existing tests pass). State-key coverage — slew no-ops on `tf.*` if ctx missing (acceptable fallback). Bezier degenerate control points (clamp). Slew sits after `externalValue`, so order with soft-takeover is fine.

**Effort.** MVP **S**, full **M**, risk **Low**. Key files: `src/model/anim.js` (`animatedValue`, `resolveParams`, `resetTakeover`), `src/app.js` (caller ctx + `rebuild` reset), `src/ui/layers.js`, `src/ui/ui.css`.

---

### 8. Operator console: hardened big-button GO surface — *Next*

**What it does + UX.** A full-screen **Console** show mode replacing editor chrome with a few oversized targets: **STANDBY → GO**, **PREV**, **MASTER** fader, **BLACKOUT**, **PANIC** — nothing else. Binds only to existing live actions so a gallery host can't dismantle the mapping. Runs in the editor (new layout preset) and on the phone surface; BLACKOUT/PANIC always rendered and hot. **GO advances a steplist of saved scenes** (`composition.scenes[]`) or clip-trigger addresses.

**Data model.** New `src/model/console.js` (pure): `show.console = { steps:[{id,label,address,value}], index:-1, showMaster, showBlackout, showPanic }`. Helpers `goStep(show)`→`{show, fire:{address,value}}` (returns a descriptor routed through the existing `handleExt`, not direct mutation), `prevStep`, add/remove/reorder/setLabel. `emptyShow()` seeds `console`; migration in `show.js`. Extend `buildRemoteManifest` with a `console` block (armed/current labels, index/count, master, blackout, panic, mode) reusing `structSig` so the phone only rebuilds DOM on structural change. Full version adds canonical `/console/go|prev|master|blackout|panic` to `osc-map.js`.

**Engine/output.** **None for MVP** — every target routes through existing `app.js` code: GO/PREV → `handleExt(address)` → `setActiveClip`; MASTER → `setMasterOpacity`; BLACKOUT → toggle `composition.bypass`; PANIC → `setPanic`. Phone path unchanged (`{type:'ext'}` → daemon relay → `handleExt`).

**UI.** Editor: a 5th layout preset (`console`) hiding deck/inspector/timeline; auto-engages lock, with the safelist extended to pass Space/Enter=GO, Backspace=PREV, B=blackout. New `src/ui/console.js` (OCR/near-black/mono, ≥72px targets, `touch-action:none`): one giant STANDBY/GO button, smaller PREV, vertical MASTER, fixed bottom BLACKOUT (latching) + PANIC. Exit requires a deliberate gesture (long-press corner pip / L-unlock). Phone (`control/remote.js`): when `console.mode==='console'`, render the five targets with sticky BLACKOUT/PANIC footer.

**MVP vs full.** *MVP:* `console.js` model + GO/PREV/MASTER/BLACKOUT/PANIC wired to existing funcs; auto-lock; a "+ to console" affordance on clip slots builds the steplist; phone render. *Full:* canonical `/console/*` OSC for hardware footswitch + MIDI-learn, per-step fade times, GO recalls saved scenes.

**Risks.** GO recalls a saved scene per step; a step with no scene just triggers that step's clips. Lock-gate completeness (audit GO keys don't collide with field focus). Phone PANIC over a dead socket can't reach the daemon — desktop `K` is the true failsafe. Exit-gesture ergonomics balance.

**Effort.** **M** overall (MVP **S–M**). Key files: `src/app.js` (layout presets, lock gate, `setPanic`/`setMasterOpacity`/`composition.bypass`/`handleExt`), `src/model/show.js`, `src/model/remote.js`, `src/model/osc-map.js`, phone `control/`, `src/ui/ui.css`; new `src/model/console.js`, `src/ui/console.js`.

---

### 9. Grand-master + timed fade + assignable zone submasters — *Now*

**What it does + UX.** A daemon-side output stage applies a **global grand-master (0–100%)** and named **zone submasters** to the final per-device bytes, at the same point the gamma/brightness LUT lives. Each can **fade over N seconds** (daemon interpolates), is OSC/MIDI-bindable, and is content-independent. **PANIC** sets an output-stage hard zero that survives the editor freezing. A slim Master strip in the output/Stage island: a GM fader + "fade to 0 over [30]s / GO", plus zone faders ("Art wall", "Bar wall").

**Data model.** `show.js`: `composition.output = { master:1, masters:[{id,name,value}] }` + `normalizeOutput`. Zone membership on the **device** (`device.masterId`) with optional per-fixture override. `pipeline.js` `buildPipelineInputs` adds `masterId` to each route entry. `mappings.js`/`osc-map.js` register `master`, `master:<zoneId>`, `panic`, `master.fade` bind targets via the existing channel→action path (soft-takeover free).

**Engine/output.** Applied in the **daemon** (panic-safe, content-independent). `calibrate.js`: `buildLut(gamma, brightness, scale=1)` folds the master into the existing single-pass LUT at zero per-pixel cost (cache keyed by `gamma|brightness|scale`). `output.js`: fade state `gm = {cur,target,startMs,durMs}` + a `zones` Map + `panic`, a `tick()` advancing toward targets on the **daemon clock** (so it progresses even with the tab backgrounded), and `effScale = panic ? 0 : gm.cur * (zone?.cur ?? 1)` per device → `deviceLut(d, effScale)`; skip sending devices at `effScale===0`. The keep-alive resend must re-run scaling so fades progress / panic holds. `index.js` handles `{type:'master'|'submaster'|'panic'}` WS messages → exported setters. `bridge.js` adds `setMaster`/`setSubmaster`/`setPanic`; repoint `app.js`'s panic to also call `bridge.setPanic(true)`.

**UI.** A compact Master strip in the output/Stage island, grouped under "OUTPUT" to distinguish it from deck opacity: GM fader + "fade to" target/seconds/GO + FULL snap; "Add zone" rows with fader + fade/GO + assigned count; a "Zone" dropdown in the device editor; the existing panic key/HUD now drives the daemon and shows GM%.

**MVP vs full.** *MVP:* grand master only, daemon-side scale folded into the LUT, timed fade interpolated on the daemon clock, daemon-enforced PANIC, one GM fader + bindable. *Full:* named zones + device assignment + per-fixture override, submaster fades, FULL/flash, HUD readouts, direct daemon-side OSC→master, MIDI-learn, save/load semantics (load at FULL to avoid a "why is it dark" trap; persist zone *definitions*, not transient values).

**Risks.** Fade timing must live on the **daemon**, not rAF. DMX channel bytes aren't LUT-scaled today — decide whether master dims DMX dimmer channels (risky for pan/tilt; MVP: pixels only or only intensity kinds). LUT-fold quantizes a fade to 256 steps (fine with gamma; pairs with future temporal dither). Panic-zero must gate *inside* `sendFrame` so a stale keep-alive can't re-light.

**Effort.** MVP **S–M**, full **M** on top. Key files: `server/calibrate.js`, `server/output.js`, `server/index.js`, `src/bridge.js`, `src/model/show.js`/`pipeline.js`/`mappings.js`, `src/ui/layers.js`/`fixtures.js`.

---

### 10. Calendar + astronomical scheduler — *Now*

**What it does + UX.** A daemon-resident scheduler fires named show targets (scene / setlist step / master-fade / panic) on wall-clock, day-of-week, and computed local sunrise/sunset (± offset): "at sunset −15m → Evening", "Fri/Sat 23:00 → fade Closing over 60s then sleep". Because the **renderer lives in the browser**, the daemon owns the *clock and schedule* and fires by emitting canonical OSC/command messages over the existing `/frames` WS relay to the connected editor/kiosk tab (with a direct daemon blackout path for panic/sleep). A Schedule panel lists rules (`when → do`), a live "next 5 fires" preview, and "Run now".

**Data model.** New `src/model/schedule.js` (pure): `show.schedule = { tz, lat, lon, enabled, rules:[{id,label,enabled, when:{kind:'clock'|'sun', event, offsetMin, time, days[7], from, to}, do:{action:'scene'|'setlist'|'master'|'panic'|'sleep'|'wake', target, fadeMs, masterTo}}] }`. `emptySchedule()`, immutable add/update/remove, `normalizeSchedule` (tz from `Intl`), a pure planner `nextFires(schedule, fromEpoch, n)` shared by daemon + UI, and a pure NOAA `sunTimes(date, lat, lon)`. Wire `normalizeSchedule` into the load path; `saveShow` persists it.

**Engine/daemon (`server/`).** New `server/scheduler.js`: in-memory schedule + a persisted `<dataDir>/schedule.json` (the daemon currently persists nothing — add a `dataDir` reusing `ROOT` resolution). A **1-second tick** tests "did any rule's fire-time fall in `(lastTick, now]`?" via `nextFires`; on startup/wake, fire the *latest* due rule within a `catchUpWindowSec` (default 6h) that hasn't fired today (missed-trigger recovery), deduped by per-rule `lastFiredEpoch`. **DST/TZ:** store wall-clock + IANA tz, resolve daily via `Intl` parts; recompute sun times per local day. Firing pushes `{type:'sched', ruleId, do}` to WS clients (editor handles it through the *same* GO/master/panic code path as manual fires); panic/sleep also call `output.js` blackout directly. HTTP `/api/schedule` (GET preview, POST replace), `/api/schedule/run`; `/health` gains `nextSunrise/nextSunset` + `scheduler:{enabled,nextFireEpoch}`.

**UI.** A Schedule island (left stack, OCR/mono aesthetic): rule list (`[✓][when ▾][→ do ▾][⋯]`), `when` editor (clock/sun toggle, time or sun-event+offset, 7-box day mask, date window), `do` editor (action + scene dropdown + fade/master), a location header (lat/lon/tz + "use this device" geolocation), a live "next fires" strip, and per-rule "Run now". On edit: `saveShow` + `POST /api/schedule`.

**MVP vs full.** *MVP:* clock-only rules + day mask targeting active-clip-index + master-opacity (works without saved scenes); daemon tick + persistence + the three API routes; plain UI; DST from day one. *Full:* sun events + lat/lon picker, catch-up + dedupe, scene/setlist targets, per-fire fade, sleep/wake, `/health` fields + "armed" badge, date windows.

**Risks.** Renderer dependency — a fire is only *visual* if a tab is alive (mitigate: point at a headless kiosk tab, keep the daemon's direct blackout independent, surface "no renderer connected" in `/health`). Persistence split-brain (daemon file authoritative for firing; version/timestamp the payload). Hand-rolled tz/DST math is bug-prone — lean on `Intl` + unit tests for transition days. "Sleep" = rig-dark, not OS-suspend. Missed-fire: fire only the latest due rule, never replay a day.

**Effort.** MVP **M**, full **L**. Depends ideally on the scene-snapshot primitive (but MVP ships without it) + new daemon persistence. New files: `src/model/schedule.js`, `server/scheduler.js`, `src/ui/schedule.js`; edits to `server/index.js`, `server/output.js`, `src/app.js`.

---

### 11. Per-controller telemetry watchdog + canvas health overlay + auto-recover — *Now*

**What it does + UX.** A daemon-side watchdog polls every WLED controller in the route every ~7s (staggered, paused during config/identify), pushing a status array to all clients over `/frames` as `{type:'telemetry'}`; `/health` gains `controllers[]`. The editor shows a 12-dot status strip (reach/RSSI/heap/uptime) and greys + marks the canvas footprint of any fixtures whose controller is dead, so you instantly see *which* strip died and *why*. On recovery, an opt-in flag does one throttled config re-push (length + colour order) with backoff so a node that rebooted to factory config self-heals.

**Data model.** `show.js` device gets opt-in `autoRecover` (default false) and `monitor` (default true for WLED, ignored for Art-Net). `pipeline.js` adds `id`, `name`, `monitor`, `autoRecover`, and a small `recoverConfig:[{len,order}]` (built from segments) to each route entry — the watchdog needs `id` to key status and must never reach back into the show. Telemetry is runtime-only, never persisted.

**Engine/daemon.** `server/wled.js`: a lightweight `getInfo(ip)` GETting only `/json/info` → `{ok, reachable, rssi, heap, uptime, ver, leds}`, reusing `wledFetch` + `HOST_RE` + a 4s timeout, returning `{ok:false}` on timeout. New `server/watchdog.js` `startWatchdog({getRoute, broadcast})`: every `POLL_MS` (default 7000) iterate `monitor!==false` devices **staggered** (`delay = i*(POLL_MS/n)`); **yield to stream** — skip any ip currently in `output.js`'s `suppressUntil`, and `suppressOutput(ip, 1500)` around its own probe so the ESP can answer. Maintain a `status` Map; flip offline after `FAIL_THRESHOLD` (default 2) consecutive fails (debounce), online on first success. On `false→true` with `autoRecover`, schedule one `pushConfig` with exponential backoff, guarded against flap storms (require a stable-online window). Broadcast after each sweep + immediately on any transition. `index.js` tracks `currentRoute`, starts the watchdog, extends `/health`. `output.js` exports `getSuppressUntil(ip)`.

**UI.** `bridge.js` adds `onTelemetry` (mirrors `onExt`). `fixtures.js` stores incoming telemetry in a `liveStatus` Map keyed by device id, renders a status-dot strip (green/amber[weak RSSI/low heap]/red) with `name · RSSI · heap · uptime` tooltips (reuse `fmtUptime`), live device-row stats, and an "auto-recover" checkbox per device. `preview.js` draws offline fixtures at reduced alpha + a hairline `c4 offline` marker (reuse `dragHint` styling + the `spans`/`samplePts` already computed).

**MVP vs full.** *MVP:* `getInfo` + reachability-only staggered polling with 2-fail debounce + broadcast; `pipeline.js` adds id+monitor; `index.js` tracks route + starts watchdog + `/health`; status-dot strip + RSSI text. Solves the #1 real failure. *Full:* canvas footprint greying + label, RSSI/heap → amber thresholds, per-device auto-recover with backoff, phone-surface dots, `/health controllers[]`.

**Risks.** HTTP contention on ESP8266 while DDP floods → false offlines (mitigate: stagger + brief probe-suppress; try bare reachability before `/json/info`). WLED field availability varies by firmware (guard every field). Auto-recover footgun — a flapping node re-pushing config mid-show blacks it ~1s each time; once-per-recovery guard + backoff + opt-in-off are essential. `currentRoute` should poll the editor's WLED union, deduped, ignoring Art-Net. Telemetry volume is trivial.

**Effort.** **M** (MVP **S–M**). No new deps. New `server/watchdog.js`; edits to `server/wled.js`, `server/index.js`, `server/output.js`, `src/model/pipeline.js`/`show.js`, `src/bridge.js`, `src/ui/fixtures.js`/`preview.js`.

---

### 12. Persistent per-layer feedback bus (`uFeedback`) — *Now*

**What it does + UX.** Each layer gets a private double-buffered FBO holding last frame's final texture, exposed to any shader declaring `uniform sampler2D uFeedback;`. This is the missing primitive — nothing currently remembers a prior frame, so every look is instantaneous. A designer drops a "Trails"/"Decay"/"Drip" effect (same drag-drop as today's effects) and the look gains persistence that reads as alive. No new panel: three registry entries + one-time engine wiring.

**Data model.** `manifest.js`: three `type:'effect'` entries (`trails`, `decay`, `drip`) whose GLSL declares `uTex` + `uFeedback`, with clamped params (e.g. `trails.decay` 0..0.99, `gain` capped in-shader), plus `LABELS`. Add a static `feedback:true` descriptor (mirrors `triggerable`/`phaseParam`) so the engine detects feedback without string-sniffing GLSL. No `layers.js` shape change — feedback effects are stored like any effect string; state is runtime-only, never serialized.

**Engine (`compositor.js`, the ~20–30 line keystone).** A lazy per-layer-id ping-pong `feedbackHold` Map (two `makeTarget` RGBA8 each, allocated on first use). GC like `phaseClocks` in the existing live-id sweep (delete targets for dead ids; add to `dispose()`; resets on resize since the compositor is rebuilt). In `runEntry`, after the `uTex` binding: if `loc(c,'uFeedback')!==null`, bind the pair's *read* buffer to a fixed unit (`TEXTURE1` for the manifest effects; pin to `TEXTURE7` for any future ISF-feedback to avoid aliasing ISF inputs), set the uniform, restore `TEXTURE0`. Key the pair by `instanceKey`. Capture = render into the pair's `write` buffer, `blitInto` back to `dst`, swap read↔write for next frame — self-contained so `renderClipInto`/layer-fx ping-pong is untouched. Clamp in-shader (`clamp(..., 0, 1)`, gain ≤ ~1.05) and clear both buffers on allocation. No `server/` or sampler changes — they consume `compositor.tex` unchanged.

Sample `trails`:
```glsl
uniform sampler2D uTex; uniform sampler2D uFeedback; uniform float decay;
void main(){
  vec4 src  = texture(uTex, uv);
  vec4 prev = texture(uFeedback, uv) * clamp(decay, 0.0, 0.99);
  frag = clamp(max(src, prev), 0.0, 1.0); // max = additive trails, no runaway
}
```

**UI.** None new — the three effects appear automatically via `effectNames()`, params render from the registry. Optional polish: a "↺" glyph in the picker + a "clear feedback" button calling a new `compositor.resetFeedback(layerId)`.

**MVP vs full.** *MVP (½–1 day):* the engine wiring + `trails` only, layer-tier, single unit, clamped. *Full:* all three effects at clip/layer/composition tier (the `'comp:fx'` key already exists), `resetFeedback()` + UI clear, `dt`-aware decay (reuse the `phaseClocks` dt guard so trails decay in real time, important because the loop throttles to OUTPUT_FPS). Becomes the documented substrate for multi-pass ISF persistence, spectrogram, particles, Ken-Burns.

**Risks.** RGBA8 feedback at low decay quantizes → stuck dim pixels / banding (mitigate with `max()` accumulation + clamped gain; option to make only the feedback pair RGBA16F via `EXT_color_buffer_float` if needed — keep MVP RGBA8 to match the 8-bit DDP output). Resize resets history (document). Frozen transport freezes trails (the `dt` guard fixes it; MVP should at least not diverge). Texture-unit collision with ISF inputs (pin high). Unwritten targets are undefined — clear to black on allocation.

**Effort.** Engine + `trails` MVP **S**; full **M**; risk **Low** (isolated, runtime-only, GC mirrors `phaseClocks`). Key files: `src/engine/compositor.js` (`runEntry` ~84–204, GC ~430–444, dispose ~575–589), `src/engine/shaders/manifest.js`, `src/engine/gl.js` (`makeTarget`). No model or server changes.

---

## If we build in order

A sequenced path. The principle: **ship the cheap keystones that de-risk 24/7 operation and unlock the most downstream features first**, then layer expression and ecosystem on a foundation that can't take the wall down.

1. **Reliability floor (days, not weeks).** Render-loop error boundary + daemon stale-frame watchdog/safe-state + WebGL context-loss recovery + daemon last-good-frame cold-boot. These are mostly **S**, independent, and together deliver the "the install cannot end the night frozen on garbage" guarantee that every other feature implicitly assumes. Do these *before* anything that makes the engine wilder (drift, director, audio strobes).

2. **The two structural keystones.** **Scene snapshots** (named saved states reusing the undo blob — the recall substrate for the scheduler, timecode, and director; NOT an operator cue/GO list) and the **per-layer feedback bus** (the engine substrate for trails, particles, multi-pass ISF, and spectrogram). Each is cheap relative to what it unlocks — build them early so later items are wiring, not invention.

3. **The "alive" engine pass.** Modulator stack → coherent-noise modulator → drift autopilot → response shaping → audio AGC/onset. This is the cluster that makes a permanent install stop looking looped, and each builds on the previous (drift needs noise; macros and shaping ride the stack). Mostly **S/M**, all behind the resolve-to-number contract, so low blast radius.

4. **Make it unattended.** Telemetry watchdog + mDNS rediscovery (detect *and* heal), grand-master + zone submasters, then the calendar/astronomical scheduler (which wants scene snapshots + master from steps 2–3). Add the **photosensitivity governor** here — it's a deployability gate, not a feature, and it must exist before the autonomous/audio-reactive modes get heavy real-world runtime.

5. **Make it runnable + serviceable.** Operator console (binds to scene recall/master/panic from above), commissioning test patterns + power budgets + as-built docs + output-latency measurement, then the ops backbone: event log + access-control/audit + snapshot vault + managed media pool. This is the layer that lets you hand the install to a venue.

6. **Content depth + image quality.** Particles, polar/kaleidoscope, palette system, text, full multi-pass ISF (all riding the feedback bus), and — once shows are stable and migration-safe — linear-light + temporal dithering (a correctness change that must be opt-in and come *after* the schema-version/migration chain and snapshot vault exist).

7. **Ecosystem + determinism bets.** `.ledshow` bundle + schema migration + headless control API + `.fseq` export, then the **determinism audit** that simultaneously unlocks the living-show director, the state black-box recorder, and multi-venue sync — the moonshots that, taken together, define a category no commercial tool occupies: *author like a creative engine, deploy like an appliance, evolve like a living thing.*
