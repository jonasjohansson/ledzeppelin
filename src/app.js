import { getGL, program, drawFullscreen } from './engine/gl.js';
import { emptyShow, addDevice, addFixture, validate, repackOffsets, syncFixtureTypes, syncDeviceTypes, nextDeviceColor, pushTypeToFixtures } from './model/show.js';
import { buildPipelineInputs } from './model/pipeline.js';
import { makeSampler } from './engine/sampler.js';
import { makeCompositor } from './engine/compositor.js';
import { connectBridge } from './bridge.js';
import { createPreview, enableDragPlacement } from './ui/preview.js';
import { createFixturePanel, loadShow, saveShow } from './ui/fixtures.js';
import { stampFixture, stampDevice } from './model/templates.js';
import { placePopover, dismissOnOutside } from './ui/kit/popover.js';
import { createLayerPanel } from './ui/layers.js';
import { createCompositionPanel } from './ui/composition.js';
import { createControlPanel } from './ui/control.js';
import { Slider } from './ui/controls.js';
import { Section } from './ui/section.js';
import { activateTabs } from './ui/kit/tabs.js';
import {
  prefixedDefaults, normalizeComposition, makeClip, setActiveClip, tidyEmptyLayers,
  setCanvasSize as setCanvasSizeModel, clampCanvasSize, playheadClip, setShowBpm, setCompositionOpacity, addISFClip, addISFEffect,
  copyName,
} from './model/layers.js';
import { parseISF, isfParams, wrapISF } from './engine/shaders/isf.js';
import { routeOsc } from './model/osc-map.js';
import { listMappables, bindMapping, clearMapping, setMappingMode, applyBindings } from './model/mappings.js';
import { buildRemoteManifest } from './model/remote.js';
import { syncShowFixtures, setFixtureTransform, transformFromPoints, pointsFromTransform, snap90, flipFixture, fixtureLabel, fixtureRange, fitCanvasToFixtures, thicknessOf, isAutoThickness, setFixtureZ, isPolylineFixture, setFixtureVertex, setFixtureShape, setBezierControl } from './model/fixture-transform.js';
import { isBezierFixture } from './model/bezier.js';
import { toggleView3d, ORBIT_DIST_MIN, ORBIT_DIST_MAX, PROJECTION_PRESETS, setProjectionPreset } from './model/project3d.js';
import { chainOf, freePort, pruneChains, wireAfter, wireFirst } from './model/chains.js';
import { fieldState, applyField } from './model/selection.js';
import { DMX_PROFILES, dmxProfile, dmxChannelsOf, isDmxFixture, DMX_CHANNEL_KINDS, DMX_COLOUR_KINDS, DMX_KIND_LABELS, fixtureTypeChannels, fixtureControlChannels, paramKinds, paramSpan, isColourParam, channelsToParams, isDmxType } from './model/dmx.js';
import { resolveParams, animatedValue } from './model/anim.js';
import { dashboardSignals } from './model/dashboard.js';
import { updateAudio, setAudioGain, enableAudio, listInputs, registerMediaElement, unregisterMediaElement } from './model/audio.js';
import { enableMidi, midiEnabled, midiInputs, setBpmCallback } from './model/midi.js';
import { extSet, extChannels } from './model/external.js';
import { renderSourceThumbnails } from './engine/thumbs.js';
import { armStartupRiff } from './ui/startup-riff.js';
import { VERSION } from './version.js';
import { confirmDelete, confirmDeletesOn, setConfirmDeletes } from './ui/confirm.js';
// Appearance/theme overrides removed — the app ships one curated base design
// (the :root tokens in ui.css). No saved colour overrides are applied.

const canvas = document.getElementById('stage');
const gl = getGL(canvas);

// Bake a small thumbnail (data URL) per source generator for the library + slots.
const thumbnails = renderSourceThumbnails(gl);

// --- Default show: one controller with a single fixture wired into it, so a fresh
//     project already has a working patch to build from. ---
function defaultShow() {
  let show = emptyShow();
  const cv = show.composition.canvas;
  cv.w = 1280; cv.h = 1280;        // square default canvas
  // Generic placeholder hardware so the first run shows SOMETHING on the wall —
  // the user reconfigures (or scans) these to match their real rig.
  show = addDevice(show, { id: 'c1', name: 'Controller 1', typeId: 'generic', ip: '', colorOrder: 'RGB', port: 4048 });   // blank IP — no false "offline" alarm; set/scan to go live
  // Clean starter Inventory: just the built-in Generic Fixture (added by
  // syncFixtureTypes) plus the FOS Luminus PRO (the real DMX light). Build any other
  // definition in the Inventory (+ fixture → set the Layout / channels).
  show.fixtureTypes = [
    // FOS Luminus PRO / H6 — RGBWA+UV battery par, 6-CH mode, as name+count params
    // (DMX-profile model): an RGBWA colour block (5 ch) + a UV channel.
    { id: 'fos_luminus_pro', name: 'FOS Luminus PRO', cols: 1, rows: 1, params: [
      { name: 'RGBWA', count: 5 }, { name: 'UV', count: 1, value: 0 },
    ] },
  ];
  // One placed fixture (the Generic Fixture) wired to Controller 1 — a thin upright
  // strip in the middle of the canvas (Width 10 × Height 96, rotation 0).
  const tf = { x: cv.w / 2, y: cv.h / 2, w: 10, h: 96, rotation: 0 };
  show.fixtures = [{
    id: 'f1', typeId: 'generic',
    input: { transform: tf, points: pointsFromTransform(tf, cv) },
    output: { deviceId: 'c1', port: 1, pixelOffset: 0, pixelCount: 96 },
  }];
  show = repackOffsets(syncFixtureTypes(syncDeviceTypes(show)));   // models + pack offsets + cache type spec
  // A clear two-layer starter: Checkered on the bottom, Lines on top (half
  // opacity so both read). Prefixed manifest defaults per source.
  const checkers = { ...makeClip('checkers', undefined, 'c1'), params: prefixedDefaults('checkers') };
  const lines = { ...makeClip('line', undefined, 'l1c'), params: prefixedDefaults('line') };
  // Array order is bottom → top (the deck renders the array END as the top row,
  // and addLayer prepends new layers UNDER the stack). So Layer 1 is on top.
  show.composition.layers = [
    { id: 'l2', name: 'Layer 2', blend: 'alpha', opacity: 1,
      clips: [checkers], activeClipId: checkers.id,
      effects: [], params: {}, transitionMs: 500 },
    { id: 'l1', name: 'Layer 1', blend: 'alpha', opacity: 0.5,
      clips: [lines], activeClipId: lines.id,
      effects: [], params: {}, transitionMs: 500 },
  ];
  show.composition.blendV2 = true;     // born on the new defaults — no migration needed
  show.composition.opacityV2 = true;
  return show;
}

// Load persisted show, but fall back to the default if it's missing, structurally
// bad, or fails validation — otherwise buildPipelineInputs/samplePoints could throw at init.
function initialShow() {
  const loaded = loadShow();
  if (!loaded) return defaultShow();
  try {
    // Repack BEFORE validating: offsets are derived (never authored), and older
    // saves stacked outputs per-device — the rule is per-OUTPUT now. Without the
    // repack, a perfectly good old rig would fail validation and be discarded.
    const packed = repackOffsets(loaded);
    const v = validate(packed);
    if (!v.ok) {
      console.warn('Loaded show failed validation, using default:', v.errors.join(' · '));
      return defaultShow();
    }
    // Upgrade persisted OLD-shape compositions to the clip schema on load
    // (idempotent — new-shape shows pass through unchanged).
    return normalizeComposition(packed);
  } catch (e) {
    console.warn('Loaded show is invalid, using default:', e.message);
    return defaultShow();
  }
}

// On load: migrate legacy flat fixtures into definitions + instances (so the
// Library shows definitions immediately), then sync fixture geometry.
let show = tidyEmptyLayers(normalizeComposition(syncShowFixtures(syncFixtureTypes(syncDeviceTypes(initialShow())))));

// --- Canvas resolution (composition.canvas drives source render + stage) ---
// The canvas resolution affects ONLY the source render targets + on-screen
// stage. Fixtures sample NORMALIZED 0–1 UVs into an n×1 sampler buffer, so the
// sampler/pipeline/routing are INDEPENDENT of canvas resolution.
{
  const c = clampCanvasSize(show.composition?.canvas?.w ?? 1280, show.composition?.canvas?.h ?? 720);
  canvas.width = c.w; canvas.height = c.h;
}

// --- Pipeline (rebuildable on every show edit) ---
// The compositor's internal targets are sized to the canvas. It caches programs
// by name and reads the current show's layers each frame, so layer/clip edits
// don't require recreating it — only a RESOLUTION change does (see setCanvasSize).
let compositor = makeCompositor(gl, canvas.width, canvas.height);
let sampler = null, bridge = null, lastRGBA = null;
let samplerDirty = false;   // set during a live fixture drag → rebuild the sampler next frame so lit content follows in realtime
// --- Output live controls: Freeze (hold the last frame) + Panic (force all output dark).
//     The master DIMMER is the composition opacity (a fader in the deck's master row),
//     applied in the compositor — not duplicated here. ---
let panicOn = false, sendBuf = null;
// Force the sent frame dark (panic) via a reused buffer; identity otherwise.
function scaleOutput(rgba, m) {
  if (m >= 1) return rgba;
  if (!sendBuf || sendBuf.length !== rgba.length) sendBuf = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) { sendBuf[i] = rgba[i] * m; sendBuf[i + 1] = rgba[i + 1] * m; sendBuf[i + 2] = rgba[i + 2] * m; sendBuf[i + 3] = rgba[i + 3]; }
  return sendBuf;
}
let controlPanel = null;   // Control-tab panel (assigned once built; null-safe before)
// Global output framerate cap sent to the daemon (System › Settings; persisted).
const OUTFPS_KEY = 'lz.outfps';
const savedOutFps = () => { try { return Math.max(1, Math.min(60, Number(localStorage.getItem(OUTFPS_KEY)) || 42)); } catch { return 42; } };
let prevBindCh = {};     // last frame's channel values, for action-binding rising edges
let bindSaveTimer = null;

// On-screen blit so the composited output is visible on the real framebuffer.
const SCREEN_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex;
// Pass the composite's alpha through so empty regions are transparent and the
// CSS checkerboard "canvas paper" shows behind them (opaque content covers it).
void main(){ frag = texture(uTex, uv); }`;
let screenProg = program(gl, SCREEN_FS);          // `let` so it can be rebuilt after GL context loss
let uScreenTex = gl.getUniformLocation(screenProg, 'uTex');

// --- Undo / redo history (Cmd+Z · Cmd+Shift+Z) -----------------------------
// The show is immutable (commits produce new objects), so a snapshot is just the
// previous reference. Rapid edits (a slider drag) coalesce into ONE entry so an
// undo step maps to a user action, not a tick.
const undoStack = [];
const redoStack = [];
let undoLastAt = 0;
let undoSuppress = false;
function snapshotForUndo(prev) {
  if (undoSuppress || !prev) return;
  const now = performance.now();
  if (now - undoLastAt < 500 && undoStack.length) { undoLastAt = now; return; }   // coalesce a drag
  undoStack.push(prev);
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;          // a fresh edit invalidates redo
  undoLastAt = now;
}
function restoreShow(s) {
  undoSuppress = true;
  // Restore the stage resolution too, so undo/redo of a canvas-size change (e.g.
  // Fit to fixtures) fully reverts — not just the data.
  const c = s?.composition?.canvas;
  if (c && (c.w !== canvas.width || c.h !== canvas.height)) {
    canvas.width = c.w; canvas.height = c.h;
    if (previewCanvas) { previewCanvas.width = c.w; previewCanvas.height = c.h; }
    preview?.setBaseSize?.(c.w, c.h);
    compositor.dispose(); compositor = makeCompositor(gl, c.w, c.h);
  }
  rebuild(s);
  saveShow(show);   // persist the reverted state — else a reload resurrects the pre-undo show
  panel?.refresh?.(); layerPanel?.refresh?.(); renderOutput(); redrawOverlay();
  syncMode3d?.();   // an undone/redone 2D↔3D flip must re-sync the corner button (hoisted fn)
  undoSuppress = false;
  undoLastAt = 0;
}
function undo() { if (undoStack.length) { redoStack.push(show); restoreShow(undoStack.pop()); } }
function redo() { if (redoStack.length) { undoStack.push(show); restoreShow(redoStack.pop()); } }

function rebuild(next) {
  snapshotForUndo(show);   // capture the pre-change state for undo
  // 1) sync each instance's cached spec from its TYPE (so a definition edit fans
  //    out to all its placed copies), 2) auto-pack pixel offsets contiguous per
  //    device, 3) sync derived sample points to transforms + canvas.
  show = syncShowFixtures(repackOffsets(syncFixtureTypes(syncDeviceTypes(next))));
  const { sampleUVs, samplePositions, route, spans } = buildPipelineInputs(show);
  curRoute = route;     // kept so the render loop can live-resolve layer-bound params
  sampler?.dispose?.(); // free the previous sampler's GL objects before reassigning
  sampler = sampleUVs.length ? makeSampler(gl, sampleUVs, samplePositions) : null;
  // Push the new route over the existing socket (no reconnect blip); only
  // construct a bridge on first build. Keeps output live + stats across edits.
  if (bridge?.setRoute) bridge.setRoute(route);
  else bridge = connectBridge(route, { onExt: handleExt, onManifestReq: () => broadcastManifest(true), onStatus: (live) => { panel?.refresh?.(); updateHealthBtn?.(live); }, fps: savedOutFps() });   // canonical OSC addresses + ext channels; phone asks → publish; status → re-gate scan + health icon
  lastSpans = spans;
  recomputeHiddenSpans();
  lastRGBA = null;
  syncWallDim();         // live-view dim follows fixture count (don't blank an empty stage)
  broadcastManifest();   // geometry change can rename/restructure → refresh the phone
  maybeBroadcastTypes(); // if this rebuild changed the type LIBRARY, tell the Inventory popout
}

// Cheap sampler-only rebuild (no route/manifest/bridge churn) — used live during a
// fixture drag so the sampled colours follow the new positions each frame.
function refreshSampler() {
  const { sampleUVs, samplePositions, spans } = buildPipelineInputs(show);
  sampler?.dispose?.();
  sampler = sampleUVs.length ? makeSampler(gl, sampleUVs, samplePositions) : null;
  lastSpans = spans; recomputeHiddenSpans();
}

// Hidden ("eye"-off) fixtures must go DARK on the wall, not just in the preview —
// so we still sample them (to keep DDP indices contiguous) and zero their bytes
// before sending. Recompute when the hidden flag toggles (no full rebuild).
let lastSpans = [];
let hiddenSpans = [];
let curRoute = null;   // current daemon route (for live layer-bound DMX params)

// Resolve bound DMX parameters from their source — a LAYER's opacity or a DASHBOARD
// link's value (0..1 → 0..255) — writing into the route's per-fixture `fixed`
// overrides. Bind refs are 'layer:<id>' / 'dash:<id>' (a bare id = legacy layer).
// Returns true if any value changed (→ caller pushes the route). Safe every frame.
function resolveLayerBindings() {
  if (!curRoute) return false;
  const layers = show.composition?.layers || [];
  const links = show.composition?.dashboard?.links || [];
  const levelOf = (ref) => {
    if (!ref) return 0;
    if (ref.startsWith('dash:')) return links.find((d) => d.id === ref.slice(5))?.value ?? 0;
    // A layer binding reads the layer's opacity. By default a BLOCKED (bypassed/B)
    // layer reads 0 (it's off); a "layerkeep:" ref ignores the block and reads its
    // opacity regardless (hide the layer visually, keep the DMX connection working).
    let lid, ignoreBlock = false;
    if (ref.startsWith('layerkeep:')) { lid = ref.slice(10); ignoreBlock = true; }
    else if (ref.startsWith('layer:')) lid = ref.slice(6);
    else lid = ref;   // legacy bare id
    const L = layers.find((x) => x.id === lid);
    if (!L) return 0;
    if (L.bypass && !ignoreBlock) return 0;
    return L.opacity ?? 0;
  };
  let changed = false;
  for (const dev of curRoute) {
    if (!dev.dmx) continue;
    for (const entry of dev.dmx) {
      if (!entry.bind) continue;
      for (const k in entry.bind) {
        const v = Math.round(Math.max(0, Math.min(1, levelOf(entry.bind[k]))) * 255), ci = +k;
        if (entry.fixed[ci] !== v) { entry.fixed[ci] = v; changed = true; }
      }
    }
  }
  return changed;
}
// Live-set a DMX channel's manual value while dragging its fader — updates the route
// (→ daemon) and the show WITHOUT a rebuild/re-render, so the slider isn't replaced
// mid-drag. Persist is debounced. (Mirrors the clip-param commitLive pattern.)
let dmxSaveTimer = null;
function dmxFixedLive(fxId, ci, v) {
  const f = (show.fixtures || []).find((x) => x.id === fxId);
  if (!f?.input?.dmx) return;
  (f.input.dmx.fixed ||= {})[ci] = v;   // transient drag value (saved debounced)
  if (curRoute) {
    for (const dev of curRoute) if (dev.dmx) for (const e of dev.dmx) if (e.id === fxId) e.fixed[ci] = v;
    bridge?.setRoute?.(curRoute);
  }
  if (!dmxSaveTimer) dmxSaveTimer = setTimeout(() => { dmxSaveTimer = null; saveShow(show); }, 300);
}
function recomputeHiddenSpans() {
  hiddenSpans = (lastSpans || []).filter((s) => {
    const f = show.fixtures.find((x) => x.id === s.id);
    return f && f.hidden;
  });
}

// Composition-only edit path (layers/effects/params): the compositor reads
// show.composition.layers every frame, so we only need to swap in the new show
// and persist it — NO sampler/route/bridge rebuild (that's expensive and only
// fixture/device GEOMETRY changes require it).
function setComposition(next) {
  snapshotForUndo(show);   // capture the pre-change state for undo (coalesced)
  show = tidyEmptyLayers(next);   // collapse any pile-up of empty layers (never auto-adds)
  saveShow(show);
  broadcastManifest();
  postMapParams();   // a clip/layer/param change → refresh the Mapping window now (not on the 2s poll)
}

// Publish the companion-remote manifest (master layers + ticked params) to any
// connected phone. Coalesced (rapid edits collapse to one send). A VALUE-only
// change (a streaming OSC fader) doesn't re-send — only a STRUCTURAL change
// (layers/clips/active/bypass/exposed params) does, so live modulation can't
// spam the socket or churn the phone/Control DOM. `now` forces a full publish
// with current values (a phone just connected and asked).
let manifestTimer = null;
let lastManifestSig = '';
// Signature of the manifest's STRUCTURE only (ignores opacity/param values).
const manifestSig = (d) => JSON.stringify([
  (d.layers || []).map((L) => [L.n, L.name, L.bypass, (L.clips || []).map((c) => [c.m, c.name, c.active])]),
  (d.controls || []).map((c) => c.address),
]);
function broadcastManifest(now = false) {
  const run = () => {
    const data = buildRemoteManifest(show, thumbnails);
    // Carry the editor's CURRENT computed accent vars so the separate phone
    // CONTROL surface (which can't read the editor's localStorage) follows the
    // active accent instead of its own hardcoded :root default.
    const cs = getComputedStyle(document.documentElement);
    data.theme = {
      accent: cs.getPropertyValue('--accent').trim(),
      accentSoft: cs.getPropertyValue('--accent-soft').trim(),
      accentLine: cs.getPropertyValue('--accent-line').trim(),
      accentText: cs.getPropertyValue('--accent-text').trim(),
    };
    const sig = manifestSig(data);
    if (now || sig !== lastManifestSig) { lastManifestSig = sig; bridge?.sendJson?.({ type: 'manifest', data }); }
    // (The companion surface lives in its own window now; nothing in-editor to refresh.)
  };
  if (now) { manifestTimer && clearTimeout(manifestTimer); manifestTimer = null; run(); return; }
  if (manifestTimer) return;
  manifestTimer = setTimeout(() => { manifestTimer = null; run(); }, 200);
}

// External messages (OSC over UDP / socket JSON), relayed by the daemon. FIRST
// try the canonical address map (/layer/…, /selected/… — Resolume-style, every
// param always addressable, values normalized 0..1); anything that doesn't
// match stays a free channel for the per-param binding model (extSet).
function handleExt(channel, value) {
  const r = routeOsc(show, layerPanel?.getSelectedClipId?.() ?? null, channel, value);
  if (!r) { extSet(channel, value); return; }
  if (r.trigger) {
    // Same path as a deck double-click: activate the clip (compositor crossfades).
    applyExternal(setActiveClip(show, r.trigger.layerId, r.trigger.clipId));
    layerPanel?.refresh?.();
    return;
  }
  // Model-only write, NO panel re-render (the commitLive path): the compositor
  // reads the show each frame so output follows immediately. An open slider may
  // read stale until the next re-render — acceptable; re-rendering at OSC
  // message rate would churn the DOM and fight a focused drag.
  if (r.show !== show) applyExternal(r.show);
}

// External/companion writes are LIVE PERFORMANCE control, not edits: they must
// NOT enter undo history (a streaming fader would spam undo + wipe redo) and
// must not hammer localStorage at message rate. So set the live show, debounce
// the save, and publish the manifest (which itself only re-sends on a structural
// change like a trigger).
let extSaveTimer = null;
function applyExternal(next) {
  show = next;
  if (!extSaveTimer) extSaveTimer = setTimeout(() => { extSaveTimer = null; saveShow(show); }, 400);
  broadcastManifest();
}
// Debounced persist for LIVE-dragged settings (e.g. the audio gain slider) so a
// drag doesn't write localStorage on every tick.
let cfgSaveTimer = null;
function saveShowSoon() { if (!cfgSaveTimer) cfgSaveTimer = setTimeout(() => { cfgSaveTimer = null; saveShow(show); }, 400); }

// Resolution-change path. Updates composition.canvas (clamped, immutable),
// resizes the stage canvas, and RECREATES the compositor so all its internal
// targets are re-sized. Because fixtures are now defined in PIXEL space, their
// derived normalized sample points DO depend on the canvas — so we re-sync the
// fixtures and rebuild the sampler/route here (via rebuild()). The fixtures
// panel is refreshed so its px fields read against the new canvas.
function setCanvasSize(w, h) {
  const next = setCanvasSizeModel(show, w, h); // clamps + immutably updates canvas
  const c = next.composition.canvas;
  canvas.width = c.w; canvas.height = c.h;
  if (previewCanvas) { previewCanvas.width = c.w; previewCanvas.height = c.h; }
  preview?.setBaseSize?.(c.w, c.h);   // keep the overlay's logical size in step (no stretch)
  compositor.dispose();
  compositor = makeCompositor(gl, c.w, c.h);
  rebuild(next);          // syncs fixtures to the new canvas + rebuilds sampler
  saveShow(show);
  panel.refresh();
}

// --- Preview overlay + editor panel wiring ---
const previewCanvas = document.getElementById('preview');
// Match the overlay's internal resolution to the stage so it doesn't distort.
if (previewCanvas) { previewCanvas.width = canvas.width; previewCanvas.height = canvas.height; }
const preview = previewCanvas ? createPreview(previewCanvas, { svg: document.getElementById('ovl') }) : null;

const panel = createFixturePanel({
  getShow: () => show,
  setShow: (next) => rebuild(next),
  // A device/model row was clicked or edited → point the Fixture editor group at the
  // right kind (a device vs. an Inventory model) and refresh it.
  onSelect: () => {
    const k = panel.lastSel?.();
    if (k === 'devtype' || k === 'type') outputTab = 'library';
    else if (k === 'device') outputTab = 'fixtures';
    if (devicePopOpen()) updateInspector();   // keep an OPEN group live as lists refresh
  },
  // An Inventory/model row was clicked → pop its editor group up beside the row.
  onPick: () => popAtSelectedRow(),
  // A scanned controller was added via the ⌖ scan results' ADD button. The panel's
  // commit already persisted + rebuilt; sync the app's selection and re-render the
  // LIVE device list so it shows up (selected/open) without any extra click (#4).
  onDeviceAdded: (id) => { selectedDeviceId = id; selectedFixtureIds = new Set(); expandedDevices.add(id); renderOutput(); },
  // LAN scan needs the daemon; it's absent on the hosted web demo. Gate the
  // Scan button on a live daemon socket (re-checked via onStatus → panel.refresh).
  getConnected: () => bridge?.connected?.() ?? false,
});
// Timeline transport: plays the clip deck left→right, holding each clip for its
// durationMs, looping. It only drives RENDERING (derives the active clip per
// frame); the persisted show is untouched, so editing and playback don't fight.
// startTs/lastTs are in requestAnimationFrame timestamp units (ms).
let lastTs = 0, t0 = 0;
let pulseTrigSecs = []; // seconds of recent ⚡ triggers (up to 8 stack as beams)
const nowSec = () => (lastTs - t0) / 1000;
const transport = {
  direction: 'off',   // 'off' | 'forward' | 'backward' | 'shuffle'
  loop: true, startTs: 0, _shuffle: null,
  now: nowSec,        // the animation clock — lets UI edits retime sweeps continuously
  isPlaying() { return this.direction !== 'off'; },
  getDirection() { return this.direction; },
  setDirection(d) { this.direction = d; this.startTs = lastTs; this._shuffle = null; },
  getLoop() { return this.loop; },
  setLoop(b) { this.loop = !!b; },
  toggle() { this.setDirection(this.direction === 'off' ? 'forward' : 'off'); },
  fire() { pulseTrigSecs.push(nowSec()); if (pulseTrigSecs.length > 8) pulseTrigSecs = pulseTrigSecs.slice(-8); },
  // Restart the animation timer: clock back to 0 (Timeline sweeps, pulse autofire),
  // clear pending pulse triggers, and reset the compositor's integrated phase
  // clocks (line/hue speed sweeps) so everything re-syncs to its start.
  reset() { t0 = lastTs; this.startTs = lastTs; pulseTrigSecs = []; compositor?.resetPhases?.(); },
};

// The composer renders into the Resolume-style shell's three regions: the DECK
// strip above the canvas, the INSPECTOR column, and the LIBRARY column.
let isfExamples = [];   // bundled example shaders (examples/isf/index.json), for the source picker
const layerPanel = createLayerPanel({
  getShow: () => show,
  setShow: (next) => setComposition(next), // composition-only: persist, no rebuild
  transport,
  thumbnails,
  onClipSelect: () => setInspectorTab('clip'), // switch the left column to the Clip tab
  onLayerSelect: () => setInspectorTab('layer'), // switch to the Layer tab
  onCompositionSelect: () => setInspectorTab('composition'), // switch to the Composition tab
  getISFExamples: () => isfExamples,
  onAddISF: (file) => importISFExample(file),
  mounts: {
    deck: document.getElementById('deckbar'),
    inspectorClip: document.getElementById('insp-clip'),
    inspectorLayer: document.getElementById('insp-layer'),
    inspectorComposition: document.getElementById('insp-compfx'),
    library: document.getElementById('library'),
  },
});
// LEDger import → assign-IP → apply. The import UI now lives in the Inventory
// popout (it hosts the catalog); the popout persists the imported show + broadcasts
// 'inventory-import' on the 'lz-inventory' channel. This is the main window's side:
// adopt only the RIG (devices + fixtures + their types) and the canvas from the
// saved blob, KEEPING the live composition (layers/clips) — the popout's blob carries
// a STALE composition, so adopting it whole would clobber edits made here since the
// popout opened. Resize the canvas first, then run the normal rebuild() path.
function applyImportedShow(saved) {
  // Build the adopted show: LIVE main-window `show` + rig/canvas from the saved blob.
  // Guard every field with ?? so a malformed blob can't inject undefined; keep
  // show.composition.layers (the live ones) and take only the canvas from `saved`.
  const next = { ...show,
    devices: saved.devices ?? [], fixtures: saved.fixtures ?? [],
    deviceTypes: saved.deviceTypes ?? [], fixtureTypes: saved.fixtureTypes ?? [],
    composition: { ...show.composition, canvas: saved.composition?.canvas ?? show.composition.canvas },
  };
  // Adopt the imported composition canvas (it matches the rig's aspect, so the
  // layout isn't stretched) — resize stage/overlay/compositor, then rebuild.
  const c = next.composition.canvas || { w: 1280, h: 720 };
  const cur = show.composition?.canvas;
  if (c.w !== cur?.w || c.h !== cur?.h) {
    canvas.width = c.w; canvas.height = c.h;
    if (previewCanvas) { previewCanvas.width = c.w; previewCanvas.height = c.h; }
    preview?.setBaseSize?.(c.w, c.h);
    compositor.dispose(); compositor = makeCompositor(gl, c.w, c.h);
  }
  // An import is a SINGLE undoable step: capture one snapshot of the CURRENT
  // (pre-import) show now, so ⌘Z restores the prior rig + composition. Then suppress
  // ONLY around rebuild() so its own internal snapshotForUndo doesn't double-enter.
  snapshotForUndo(show);
  invMerging = true; undoSuppress = true;   // don't echo back over the channel; no second undo entry
  try { rebuild(next); } finally { invMerging = false; undoSuppress = false; }
  // The popout's persisted blob carries a stale composition; now that we keep the
  // live layers, our adopted show differs from storage — persist it (else a reload
  // resurrects the blob's composition). Mirrors the 'inventory-changed' branch.
  saveShow(show);
  // Full UI refresh — a (re)import replaces every device + fixture, so the placement
  // list and canvas overlay must redraw, and any selection of now-gone fixtures must
  // clear (else the Output list looks unchanged).
  selectedFixtureIds.clear();
  panel.refresh(); layerPanel.refresh(); compositionPanel.refresh?.();
  renderOutput(); redrawOverlay();
}
// Composition (canvas resolution) is composition-global, so it sits at the top
// of the editor, above Import/Layers/Fixtures.
const compositionPanel = createCompositionPanel({
  getShow: () => show,
  setSize: (w, h) => setCanvasSize(w, h),
  fitToFixtures: () => fitToFixtures(),   // hoisted fn decl defined later in this module
  setTitle: (t) => { setComposition({ ...show, composition: { ...show.composition, title: t } }); layerPanel.refresh(); },   // reflect in the deck's composition-group header now
  // BPM is read live from show.composition.bpm each frame — no rebuild needed.
  // Snapshot so a manual BPM change is undoable (coalesced for tap/slider drags).
  setBpm: (b) => { snapshotForUndo(show); show = setShowBpm(show, b); saveShow(show); },
  // Master opacity — live (the loop reads composition.opacity each frame); the deck's
  // master fader picks it up on its next render. Same value the deck master row drives.
  setMasterOpacity: (v) => { show = setCompositionOpacity(show, v); saveShow(show); },
});
// Output selection + snap state. Declared here (before the Settings panel, whose
// initial render reads snap state) to avoid a temporal-dead-zone access.
let selectedFixtureIds = new Set();
let SNAP_GRID = 20;     // grid step (px) fixtures snap to when not aligning to a neighbour
let SNAP_DIST = 10;     // px tolerance for aligning to another fixture / centre
let snapEnabled = false;
let showGrid = false;   // draw the alignment grid on the overlay (independent of snap)
let snapGuides = [];    // alignment guide lines to draw during a snapped drag
let marqueeRect = null; // active rubber-band selection box (normalized), or null
let marqueeBase = new Set();   // selection to keep when a Shift-marquee is additive

// Fixtures whose footprint (normalized bbox) intersects a marquee rect.
function fixturesInRect(r) {
  const ids = [];
  for (const f of show.fixtures || []) {
    const pts = f.input?.points; if (!pts?.length) continue;
    let minx = 1, miny = 1, maxx = 0, maxy = 0;
    for (const [u, v] of pts) { minx = Math.min(minx, u); maxx = Math.max(maxx, u); miny = Math.min(miny, v); maxy = Math.max(maxy, v); }
    if (maxx >= r.x0 && minx <= r.x1 && maxy >= r.y0 && miny <= r.y1) ids.push(f.id);
  }
  return ids;
}
// Global Settings panel — app-wide preferences (theme, audio gain, crossfade,
// snap, composition file I/O). Mounts into its own top-level Settings view.
// (Settings panel removed — its items live in the bottom-corner File/Audio menus
//  + the Composition subtab. Snap is the corner toggle; grid/dist keep defaults.)

// Replace the whole composition (layers/clips/effects/canvas) from a loaded file,
// keeping devices/fixtures. Resizes the stage + recreates the compositor for the
// new canvas, then refreshes every panel.
function applyComposition(comp) {
  const next = tidyEmptyLayers(normalizeComposition({ ...show, composition: comp }));
  const c = next.composition.canvas || { w: 1280, h: 720 };
  canvas.width = c.w; canvas.height = c.h;
  if (previewCanvas) { previewCanvas.width = c.w; previewCanvas.height = c.h; }
  compositor.dispose(); compositor = makeCompositor(gl, c.w, c.h);
  saveShow(next); rebuild(next);
  layerPanel.refresh(); panel.refresh(); compositionPanel.refresh(); renderOutput(); redrawOverlay();
}
// --- Resolume-style shell routing ----------------------------------------
// Panels are CONSTRUCTED ONCE and mounted into fixed regions; switching
// tabs/modes only toggles region visibility + interactivity (never
// destroys/recreates panels, so panel state + .refresh() keep working).
//
//   Composition tab → DECK strip (clip slots + transport) over the canvas,
//                     INSPECTOR column (canvas settings + selected clip +
//                     composition FX), LIBRARY column (Sources/Effects).
//   Output tab      → Input/Output segmented toggle + Import + Fixtures.
//                     The #preview fixture overlay shows here (hidden in
//                     Composition for a clean composite); drag is gated to
//                     Output+Input mode.
// Three top tabs:
//   Composition → deck strip + inspector + library (the composing view).
//   Output      → the MAPPING view: canvas with the fixture overlay; add +
//                 drag fixtures to position them.
//   Fixtures    → design fixtures + devices + Kagora import.
const compSettings = document.getElementById('comp-settings');
compSettings?.append(compositionPanel.el);     // Title/BPM/canvas-size panel atop the Composition tab
// The live DEVICE list is the Output list below (renderOutput), and the selected
// device's editor mounts in the left sidebar via panel.deviceDetailEl(). The
// Inventory catalog (panel.libraryEl) + the LEDger importer are no longer mounted in
// the main window — they live in the Inventory popout (inventory/). The popout
// persists imports + broadcasts 'inventory-import'; this window adopts them via
// applyImportedShow (see the 'lz-inventory' channel handler below).

// (Output selection + snap state are declared earlier, above the Settings panel.)

// Snap a proposed CENTRE (x,y) for fixture `fid`: align its left/centre/right
// EDGES (and top/centre/bottom) to other fixtures' edges/centres and the canvas
// edges/centre — so fixtures sit neatly next to each other. Records guide lines;
// falls back to the grid on any axis that didn't snap.
// Axis-aligned half-extents of a fixture's (possibly ROTATED) footprint — so a
// vertical bar (rotation 90/270°) snaps by its real height, not its raw width.
function fixtureAABB(t) {
  const a = (Number(t?.rotation) || 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (Number(t?.w) || 0) / 2, hh = (Number(t?.h) || 0) / 2;
  return [c * hw + s * hh, s * hw + c * hh];     // [halfWidth, halfHeight]
}
function snapPoint(x, y, fid, excludeIds) {
  snapGuides = [];
  if (!snapEnabled) return [x, y];
  const ex = new Set(excludeIds || []);
  const cv = show.composition?.canvas || { w: 1280, h: 720 };
  const [mhw, mhh] = fixtureAABB(show.fixtures.find((f) => f.id === fid)?.input?.transform);
  // PRIMARY targets: every OTHER fixture's edges + centre (so strips align corner
  // -to-corner / edge-to-edge), plus the canvas edges/centre.
  const xT = [0, cv.w / 2, cv.w], yT = [0, cv.h / 2, cv.h];
  for (const f of show.fixtures || []) {
    if (ex.has(f.id)) continue;
    const t = f.input?.transform; if (!t) continue;
    const [hw, hh] = fixtureAABB(t);
    xT.push(t.x - hw, t.x, t.x + hw);
    yT.push(t.y - hh, t.y, t.y + hh);
  }
  // Align the dragged fixture's own left/centre/right (top/centre/bottom) edges.
  let sx = x, sy = y, bestX = SNAP_DIST, bestY = SNAP_DIST, gx = null, gy = null;
  for (const off of [-mhw, 0, mhw]) for (const tx of xT) {
    const d = Math.abs((x + off) - tx); if (d < bestX) { bestX = d; sx = tx - off; gx = tx; }
  }
  for (const off of [-mhh, 0, mhh]) for (const ty of yT) {
    const d = Math.abs((y + off) - ty); if (d < bestY) { bestY = d; sy = ty - off; gy = ty; }
  }
  // SECONDARY: the grid is only a soft fallback — snap to it only when no
  // fixture/canvas line caught AND the cursor is already near a grid line, so
  // movement stays free elsewhere ("primarily snap to fixtures").
  if (gx !== null) snapGuides.push({ axis: 'x', v: gx });
  else { const g = Math.round(x / SNAP_GRID) * SNAP_GRID; if (Math.abs(x - g) <= SNAP_DIST) sx = g; }
  if (gy !== null) snapGuides.push({ axis: 'y', v: gy });
  else { const g = Math.round(y / SNAP_GRID) * SNAP_GRID; if (Math.abs(y - g) <= SNAP_DIST) sy = g; }
  return [sx, sy];
}
const redrawOverlay = () => preview?.draw(show, lastRGBA, selectedFixtureIds, showGrid ? SNAP_GRID : 0, snapGuides, marqueeRect);

// Update the selection from a click. shift = toggle; clicking an already-selected
// fixture keeps the group (so it can be dragged); a new one selects just it.
// Select a device for editing — the left sidebar shows its settings (IP / model /
// colour order / scan). Mutually exclusive with a fixture selection: one editor at
// a time. Unassigned ('') has no device to edit, so it's ignored here.
function selectDevice(id, ev) {
  if (!id) return;
  selectedDeviceId = id;
  selectedFixtureIds.clear();
  expandedDevices.add(id);
  panel.setDevice?.(id);
  renderOutput(); redrawOverlay();
  // Pop the controller editor up at the click (or beside its freshly-rendered header).
  openDevicePop((ev && (ev.clientX || ev.clientY)) ? ev : (outputListEl?.querySelector('.insp-sec-head.is-sel') || null));
}

function selectFixture(fxId, ev, opts = {}) {
  selectedDeviceId = null;   // picking (or clearing) fixtures ends any device edit
  if (ev && ev.shiftKey) {
    if (fxId == null) return;
    if (selectedFixtureIds.has(fxId)) selectedFixtureIds.delete(fxId); else selectedFixtureIds.add(fxId);
  } else if (fxId == null) {
    selectedFixtureIds.clear();
  } else if (opts.isolate || !selectedFixtureIds.has(fxId)) {
    // isolate = a LIST click → always select just this fixture, even if it was
    // part of a multi-selection. (On the CANVAS, clicking an already-selected
    // fixture keeps the group so it can be dragged together.)
    selectedFixtureIds = new Set([fxId]);
  }
  // Picking a single fixture (not a shift multi-select / empty click) points the
  // right column at the Fixtures patch; its editor shows in the Fixture group.
  if (fxId != null && !(ev && ev.shiftKey)) {
    outputTab = 'fixtures';
    const sf = show.fixtures.find((f) => f.id === fxId);   // keep its controller + group open after deselect
    if (sf) { expandedDevices.add(sf.output?.deviceId || ''); expandedGroups.add(`${sf.output?.deviceId || ''}:${sf.output?.port ?? 1}`); }
    panel.selectFixture?.(fxId);
  }
  renderOutput(); redrawOverlay();
  // Pop the editor group up at the click; an empty click clears + dismisses it.
  if (fxId == null) closeDevicePop();
  else if (!(ev && ev.shiftKey)) openDevicePop(ev);
  // Scroll the picked fixture's row into view in the placement list.
  if (fxId != null) outputListEl?.querySelector(`[data-fxid="${fxId}"]`)?.scrollIntoView({ block: 'nearest' });
}

let dragHandle = null;
let dragOrig = null;   // show state captured at the START of a canvas drag (for ONE undo entry)
if (previewCanvas) {
  dragHandle = enableDragPlacement(previewCanvas, {
    getShow: () => show,
    getSelected: () => selectedFixtureIds,
    onSelect: (fxId, ev) => selectFixture(fxId, ev),
    // Live drag overwrites `show` each frame — so remember the PRE-drag state once,
    // here, before the first mutation, for undo.
    onEdit: (next) => { if (!dragOrig) dragOrig = show; show = next; samplerDirty = true; redrawOverlay(); },
    onCommit: (next) => {
      snapGuides = [];
      if (dragOrig) { undoStack.push(dragOrig); if (undoStack.length > 120) undoStack.shift(); redoStack.length = 0; dragOrig = null; }
      undoSuppress = true; saveShow(next); rebuild(next); undoSuppress = false;   // rebuild must NOT snapshot the post-drag show
      panel.refresh(); renderOutput();
    },
    snap: snapPoint,
    // Rubber-band select: keep the prior selection only when Shift-additive.
    onMarqueeStart: (additive) => {
      marqueeBase = additive ? new Set(selectedFixtureIds) : new Set();
      if (!additive) { selectedFixtureIds = new Set(); renderOutput(); redrawOverlay(); }   // empty click clears
    },
    onMarquee: (rect) => {
      marqueeRect = rect;
      selectedFixtureIds = new Set([...marqueeBase, ...fixturesInRect(rect)]);
      // Per pointermove: only redraw the cheap canvas overlay. The Output list is
      // a full DOM teardown+rebuild — defer it to marquee end (a no-op while
      // dragging since the list isn't what the user is watching).
      redrawOverlay();
    },
    onMarqueeEnd: () => { marqueeRect = null; renderOutput(); redrawOverlay(); },
    // 3D orbit/pan (view-only): swap the show in and save DEBOUNCED without undo
    // — like zoom/pan, moving the inspect camera is not an edit. No sampler
    // rebuild either: sampling reads the PROJECTION camera (a preset, not the
    // orbit), so orbiting never changes the UVs.
    onView: (next) => { show = next; saveShowSoon(); redrawOverlay(); },
    enabled: false, // gated by view state below; default tab is Composition
  }, {
    // opts (3rd arg). Hit-test/drag over the whole stage (incl. the pasteboard
    // margin around the composition) so fixtures dragged off-canvas stay
    // selectable + movable.
    eventTarget: document.getElementById('stagewrap'),
  });
}

// --- Output mapping panel: add / select / position fixtures ------------------
const outputListEl = document.getElementById('output-list');
// The Fixture editor group (right column): #fxinsp-body holds the selected
// fixture/device/model editor; updateInspector() (re)mounts it on selection.
const fxBodyEl = document.getElementById('fxinsp-body');
let outputTab = 'fixtures';   // which the Fixture editor reflects: 'fixtures' (fixture/device) | 'library' (Inventory model)
let selectedDeviceId = null;  // a device picked for editing in the left sidebar (merged Fixtures tab)
let collapsedDevices = new Set();   // controller groups collapsed in the Devices list (empty = all open)
let insetRaf = 0;             // rAF handle for the deferred camera re-clamp after a layout change (see updateStageInsets)
const expandedGroups = new Set();    // device:output groups the user has OPENED (default = collapsed)
const expandedDevices = new Set();   // controllers the user has OPENED (default = collapsed)
let dragFxIds = [];                   // fixture id(s) being dragged onto a device/output (drag-to-assign)
// Assign the given fixtures to a device (+ optional output port) and re-pack — the
// drag-to-assign / drag-to-unassign action (deviceId '' = back to the Unassigned pool).
function assignFixturesTo(fxIds, deviceId, port) {
  if (!fxIds || !fxIds.length) return;
  const n = structuredClone(show);
  for (const f of n.fixtures) if (fxIds.includes(f.id)) { f.output.deviceId = deviceId; if (port != null) f.output.port = port; }
  selectedFixtureIds = new Set(fxIds); expandedDevices.add(deviceId);
  saveShow(n); rebuild(n); panel.refresh(); renderOutput(); redrawOverlay();   // rebuild repacks pixel offsets
}
// Controller-colour tint for the UI (preview chrome + placement-list swatches).
// Toggled from the corner "▢ color" button; persisted. Default ON.
let controllerTint = (() => { try { return localStorage.getItem('lz.tint') !== '0'; } catch { return true; } })();
const colorBtn = document.getElementById('color-btn');
function setControllerTint(on) {
  controllerTint = !!on;
  try { localStorage.setItem('lz.tint', controllerTint ? '1' : '0'); } catch { /* ignore */ }
  if (colorBtn) colorBtn.classList.toggle('on', controllerTint);
  preview?.setColorTint?.(controllerTint);
  renderOutput(); redrawOverlay();
}
colorBtn?.addEventListener('click', () => setControllerTint(!controllerTint));
// Initial sync (preview exists; the startup renderOutput reads controllerTint).
if (colorBtn) colorBtn.classList.toggle('on', controllerTint);
preview?.setColorTint?.(controllerTint);
// Snap toggle: a viewport corner button (mirrored by the Settings panel).
// setSnapEnabled keeps both in step.
const snapBtn = document.getElementById('snap-btn');
function setSnapEnabled(v) {
  snapEnabled = !!v;
  if (snapBtn) snapBtn.classList.toggle('on', snapEnabled);
  redrawOverlay();
}
// Snap prefs persist (corner toggle on/off + the grid/distance config in Settings).
const SNAP_KEY = 'lz.snap';
function saveSnap() { try { localStorage.setItem(SNAP_KEY, JSON.stringify({ on: snapEnabled, grid: SNAP_GRID, dist: SNAP_DIST })); } catch { /* private */ } }
(() => { try { const s = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); if (s) { snapEnabled = !!s.on; SNAP_GRID = Number(s.grid) || SNAP_GRID; SNAP_DIST = Number(s.dist) || SNAP_DIST; } } catch { /* ignore */ } })();
setSnapEnabled(snapEnabled);   // reflect the loaded state on the corner button

// Grid overlay toggle (show the alignment grid without enabling snap).
const gridBtn = document.getElementById('grid-btn');
function setShowGrid(v) {
  showGrid = !!v;
  if (gridBtn) gridBtn.classList.toggle('on', showGrid);
  try { localStorage.setItem('lz.grid', showGrid ? '1' : '0'); } catch { /* private */ }
  redrawOverlay();
}
gridBtn?.addEventListener('click', () => setShowGrid(!showGrid));
try { if (localStorage.getItem('lz.grid') === '1') showGrid = true; } catch { /* ignore */ }
setShowGrid(showGrid);

// MIDI: clock drives the global BPM (debounced save — the clock fires ~1×/beat);
// CC/notes arrive as external channels (cc<n>/note<n>) via the external store.
const MIDI_KEY = 'lz.midi';
let midiBpmSaveTimer = null;
setBpmCallback((b) => {
  show = setShowBpm(show, b);
  const f = document.querySelector('.cmp-bpm input'); if (f && document.activeElement !== f) f.value = String(b);
  if (!midiBpmSaveTimer) midiBpmSaveTimer = setTimeout(() => { midiBpmSaveTimer = null; saveShow(show); }, 1000);
});
(() => { try { if (localStorage.getItem(MIDI_KEY) === '1') enableMidi(); } catch { /* ignore */ } })();

// --- Mappings: keyboard → channels + a bus to the separate Mappings window -----
// Keyboard keys become external channels `key:<code>` (0/1), so they can drive
// params via the External modulator just like MIDI. Skip while typing in a field.
// The Mappings window (a separate same-origin browser window) talks to the editor
// over a BroadcastChannel: the editor streams live channel values + the parameter
// list, and applies the bind/clear it sends back. The editor stays the single
// owner of the show.
let mapBus = null;
try { mapBus = new BroadcastChannel('lz-mappings'); } catch { /* unsupported */ }
function postMapParams() { if (mapBus) { try { mapBus.postMessage({ type: 'params', data: listMappables(show) }); } catch { /* closed */ } } }
function pushMapChannels() { if (mapBus) { try { mapBus.postMessage({ type: 'channels', data: { ...extChannels() } }); } catch { /* closed */ } } }
function postMapMidi() { if (mapBus) { try { mapBus.postMessage({ type: 'midi', enabled: midiEnabled(), inputs: midiInputs().map((i) => i.name) }); } catch { /* closed */ } } }

// --- Inventory window sync (BroadcastChannel 'lz-inventory') -----------------
// The Inventory popout (inventory/) edits the TEMPLATE LIBRARY (show.fixtureTypes /
// show.deviceTypes) on the SAME localStorage key and broadcasts { type:
// 'inventory-changed' }. The store is whole-document last-writer-wins, and the
// popout's saved blob carries a STALE copy of devices/fixtures/scenes/composition —
// so on receive we MERGE ONLY the two type arrays into the live show (never adopt
// the whole saved show), then re-run the normal rebuild path. Symmetric: when OUR
// type arrays actually change (signature diff), we post back so the popout reloads.
let invBus = null;
try { invBus = new BroadcastChannel('lz-inventory'); } catch { /* unsupported */ }
let lastTypeSig = '';                 // signature of the last broadcast/applied type arrays
let invMerging = false;               // true while applying an inbound merge → suppress echo
const typeSig = (s) => JSON.stringify(s.fixtureTypes || []) + ' :: ' + JSON.stringify(s.deviceTypes || []);
lastTypeSig = typeSig(show);          // baseline from the loaded show — never broadcast on init
// Called from rebuild() (the single chokepoint for type-affecting changes). Posts
// ONLY when the type arrays changed vs the last seen signature, and never echoes an
// inbound merge — so the ~30 ordinary saveShow sites stay silent.
function maybeBroadcastTypes() {
  const sig = typeSig(show);
  if (sig === lastTypeSig) return;
  lastTypeSig = sig;
  if (invMerging) return;             // don't echo a change we just merged in
  if (invBus) { try { invBus.postMessage({ type: 'inventory-changed' }); } catch { /* closed */ } }
}
if (invBus) {
  invBus.onmessage = (e) => {
    // A LEDger import was applied in the popout → adopt the WHOLE saved show (devices
    // + fixtures + composition), not just the type arrays. This is the one inbound
    // message that replaces the live rig (the import flow's old applyShow path).
    if (e.data?.type === 'inventory-import') {
      const saved = loadShow();
      if (saved) applyImportedShow(saved);
      return;
    }
    // Template "push to placed fixtures" done in the popout → apply the push on OUR
    // live fixtures (the popout's blob has stale fixtures, so we re-run it here;
    // rebuild makes it one undoable step). The type itself arrived just before via
    // 'inventory-changed' (per-channel message order is guaranteed).
    if (e.data?.type === 'inventory-push-type') {
      rebuild(pushTypeToFixtures(show, e.data.typeId));
      saveShow(show);
      panel.refresh(); renderOutput(); redrawOverlay();
      return;
    }
    if (e.data?.type !== 'inventory-changed') return;
    const saved = loadShow();
    if (!saved) return;
    // Merge ONLY the type arrays; keep the live devices/fixtures/scenes/composition.
    const next = { ...show, fixtureTypes: saved.fixtureTypes ?? [], deviceTypes: saved.deviceTypes ?? [] };
    invMerging = true; undoSuppress = true;     // external library edit: not undoable, no echo
    try { rebuild(next); } finally { invMerging = false; undoSuppress = false; }
    saveShow(show);            // persist our live show + merged types (the popout's blob has stale fixtures)
    closeTemplateMenu();       // drop any open + Fixture/+ Device menu so it rebuilds with fresh types
    panel.refresh(); renderOutput(); redrawOverlay();   // renderOutput rebuilds the add toolbar from fresh show.*Types
  };
}

const isTyping = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const setKeyChannel = (code, on) => { extSet('key:' + code, on ? 1 : 0); pushMapChannels(); };   // immediate push so Learn catches a momentary key
document.addEventListener('keydown', (e) => { if (!e.repeat && !isTyping(e.target)) setKeyChannel(e.code, true); });
document.addEventListener('keyup', (e) => { if (!isTyping(e.target)) setKeyChannel(e.code, false); });

if (mapBus) {
  mapBus.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'hello') { postMapParams(); postMapMidi(); }
    else if (m.type === 'key') setKeyChannel(m.code, m.down);              // a key pressed in the Mappings window
    else if (m.type === 'enableMidi') { enableMidi().then(postMapMidi); }
    else if (m.type === 'bind' || m.type === 'clear') {
      snapshotForUndo(show);   // mapping edits are undoable like other show edits
      show = m.type === 'bind' ? bindMapping(show, m.id, m.channel, m.slot) : clearMapping(show, m.id, m.slot);
      saveShow(show); layerPanel?.refresh?.(); postMapParams();
    }
    else if (m.type === 'mode') { snapshotForUndo(show); show = setMappingMode(show, m.id, m.mode); saveShow(show); postMapParams(); }
  };
  setInterval(pushMapChannels, 100);   // stream live channel values @10Hz
  setInterval(postMapParams, 2000);    // catch structural show changes (clips added/removed)
}
const oel = (tag, props = {}, kids = []) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) n.append(k); return n; };
// Output is PLACEMENT only — fixtures are designed/created in the Fixtures tab.

// Axis-aligned bounding-box size (canvas px) of a fixture's rotated rectangle —
// length `tf.w` × effective thickness, rotated by `tf.rotation`. The rect rotates
// about its centre, so its AABB is centred there too: bbox top-left = centre −
// size/2. Used so the editor's X/Y read/write the TOP-LEFT (Figma-style) while the
// model stays centre-based (rotation pivot, drag handle).
function aabbSize(tf, effThickness) {
  const t = (tf.rotation || 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  // Use the real box dims w×h (orientation is the aspect, not a fixed length axis);
  // for legacy auto-thickness fixtures the height is the derived effective thickness.
  const w = Math.abs(tf.w) || 0;
  const h = isAutoThickness(tf.h) ? (effThickness || 0) : (Math.abs(tf.h) || 0);
  return { w: w * c + h * s, h: w * s + h * c };
}

// A px number field (commits on change) for the selected fixture's transform.
function txField(label, value, onCommit) {
  const i = oel('input', { type: 'number', step: '1', value: String(Math.round(value)) });
  i.addEventListener('change', () => onCommit(i.value === '' ? 0 : Number(i.value)));
  return oel('label', { className: 'fx-field' }, [oel('span', { textContent: label }), i]);
}

// Live fixture editors keep every group ALWAYS VISIBLE (no collapse): per user
// feedback, selecting/making a fixture must show all the info at once. `locked`
// forces the Section open and hides its chevron/toggle (CSS .is-locked) — so no
// change to the shared Section component, just how these call sites invoke it.
const flatGroup = (title, key, build) => Section(title, key, build, undefined, true);

// Placement + PATCH editor for one selected fixture (inlined under its row):
// canvas transform (x/y/length/height/rotation, rotate-90/flip) PLUS the patch —
// which device it's wired to + its (auto-packed) pixel range. The physical strip
// itself (LEDs/m, colour) is defined in the Library tab.
function positionEditor(sel) {
  const tf = sel.input.transform || transformFromPoints(sel.input.points, show.composition?.canvas);
  const apply = (next) => { saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay(); };
  const setT = (patch) => apply(setFixtureTransform(show, sel.id, patch));
  // A chain's device + output belong to the whole run, set by its HEAD (the first
  // fixture); later members inherit it and can't change it. Moving the head moves
  // every member together.
  const ch = chainOf(show, sel.id);
  const isHead = !ch || ch.index === 0;
  const runKeyOf = (f) => `${f.output?.deviceId || ''}:${f.output?.port ?? 1}`;
  const moveRun = (patch) => {
    const key = runKeyOf(sel);
    const next = structuredClone(show);
    for (const f of next.fixtures) if (runKeyOf(f) === key) Object.assign(f.output, patch);
    apply(next);
  };
  // Device picker (which controller the chain HEAD is wired to). Locked downstream.
  // First option is "unassigned" so a deviceless fixture reads as such (not a
  // false-selected first device) and can be left unassigned for prototyping.
  const devSel = oel('select');
  const noneOpt = oel('option', { value: '', textContent: '— unassigned —' });
  if (!sel.output?.deviceId) noneOpt.selected = true;
  devSel.append(noneOpt);
  for (const d of show.devices) {
    const o = oel('option', { value: d.id, textContent: `${d.name || d.id} (${d.id})` });
    if (d.id === sel.output?.deviceId) o.selected = true;
    devSel.append(o);
  }
  devSel.disabled = !isHead;
  if (!isHead) devSel.title = 'set by the chain, edit the first fixture in the chain';
  devSel.addEventListener('change', () => moveRun({ deviceId: devSel.value }));
  // Output/port picker — limited to the device's actual outputs. Locked downstream.
  const dev = show.devices.find((d) => d.id === sel.output?.deviceId);
  const nOut = Math.max(1, Math.round(dev?.outputs ?? 4));
  const portSel = oel('select');
  for (let p = 1; p <= nOut; p++) {
    const o = oel('option', { value: String(p), textContent: `Output ${p}` });
    if (p === (sel.output?.port ?? 1)) o.selected = true;
    portSel.append(o);
  }
  portSel.disabled = !isHead;
  portSel.addEventListener('change', () => moveRun({ port: Number(portSel.value) }));
  // Two collapsible groups (same accent-header + rule + chevron as the Clip
  // inspector, so the two read as one instrument): POSITION = on-canvas geometry;
  // PATCH = which controller/output it's wired to + its pixel range + the chain.
  // (The fixture's name is shown by the editor dock's title bar.)
  // Reverse-direction toggle (shared by the bar and polyline Position groups).
  // Not a transform flip — it reverses which end of the LED STRIP is pixel 0
  // (the canvas arrow points at pixel 0).
  const reverseRow = () => oel('div', { className: 'dir-btns out-transform' }, [
    (() => {
      const b = oel('button', { className: 'dir-btn' + (sel.input?.reversed ? ' on' : ''),
        title: 'reverse the LED strip direction (which end is pixel 0)',
        onclick: () => apply(flipFixture(show, sel.id)) });
      b.innerHTML = '<svg class="ic-sm" aria-hidden="true"><use href="#ic-reverse"/></svg> Reverse direction';
      return b;
    })(),
  ]);
  // Compact XYZ table (px; Z = height off the canvas plane, visible in 3D
  // mode) for geometries whose SHAPE is their points — a polyline's vertices, a
  // bezier's ends + control — where the bar's transform fields don't apply.
  // rows = [{ key, label, p (normalized [x,y,z?]), set(n3) }]; commits are
  // undoable via rebuild.
  const xyzTable = (rows, title) => {
    const cv = show.composition?.canvas || { w: 1280, h: 720 };
    const grid = oel('div', { className: 'vtx-grid' });
    for (const h of ['#', 'X', 'Y', 'Z']) grid.append(oel('span', { className: 'vtx-h', textContent: h }));
    rows.forEach((row) => {
      grid.append(oel('span', { className: 'vtx-idx', textContent: row.label }));
      const p = row.p || [0, 0];
      [((Number(p[0]) || 0) * cv.w), ((Number(p[1]) || 0) * cv.h), ((Number(p[2]) || 0) * cv.h)].forEach((val, axis) => {
        const inp = oel('input', { type: 'number', step: '1', value: String(Math.round(val)) });
        // data-vtx keys focus restoration across the inspector rebuild (see updateInspector).
        inp.dataset.vtx = `${row.key}:${axis}`;
        inp.addEventListener('change', () => {
          const v = inp.value === '' ? 0 : Number(inp.value);
          const n = [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
          n[axis] = axis === 0 ? v / cv.w : v / cv.h;   // x normalizes by width; y/z by height
          row.set(n);
        });
        grid.append(inp);
      });
    });
    grid.title = title;
    return grid;
  };
  const vertexTable = () => xyzTable(
    (sel.input.points || []).map((p, i) => ({ key: String(i), label: String(i + 1), p,
      set: (n) => apply(setFixtureVertex(show, sel.id, i, n[0], n[1], n[2])) })),
    'vertex positions in canvas px — Z lifts a vertex off the canvas plane (edit in 3D mode with Alt-drag too)');
  const bezierTable = () => {
    const pts = sel.input.points || [];
    const endRow = (i, label) => ({ key: String(i), label, p: pts[i],
      set: (n) => apply(setFixtureVertex(show, sel.id, i, n[0], n[1], n[2])) });
    return xyzTable([
      endRow(0, '1'),
      { key: 'c', label: 'C', p: sel.input.bezier?.c, set: (n) => apply(setBezierControl(show, sel.id, n)) },
      endRow(pts.length - 1, '2'),
    ], 'the arch: two ends + the C(ontrol) in canvas px — raise C’s Z to pull the middle up into a standing arch');
  };
  // SHAPE row — Bar (straight box) | Polyline (bendable run) | Bezier (arch).
  // Conversions keep the ends; entering bezier seeds the control at the chord
  // midpoint. Matrices keep their grid footprint (no shape row).
  const shapeRow = () => {
    const cur = isBezierFixture(sel.input) ? 'bezier' : isPolylineFixture(sel.input) ? 'polyline' : 'bar';
    return oel('div', { className: 'dir-btns shape-row' }, [
      ['bar', 'Bar', 'straight strip — an x/y/w/h/rotation box'],
      ['polyline', 'Polyline', 'bendable multi-segment run (double-click the run to add bends)'],
      ['bezier', 'Bezier', 'quadratic arch — drag the diamond control; in 3D, Alt-drag it up into a standing arch'],
    ].map(([m, label, tip]) => oel('button', {
      className: 'dir-btn' + (m === cur ? ' on' : ''), textContent: label, title: tip,
      onclick: () => { if (m !== cur) apply(setFixtureShape(show, sel.id, m)); },
    })));
  };
  return oel('div', { className: 'output-edit' }, [
    flatGroup('Position', 'position', (body) => {
      if (sel.input?.mode !== 'grid') body.append(shapeRow());
      if (isBezierFixture(sel.input)) { body.append(bezierTable(), reverseRow()); return; }
      if (isPolylineFixture(sel.input)) { body.append(vertexTable(), reverseRow()); return; }
      // X/Y address the bounding-box TOP-LEFT (Figma-style); convert to/from centre.
      const bb = aabbSize(tf, thicknessOf(sel, show.composition?.canvas));
      body.append(
        oel('div', { className: 'output-grid' }, [
          txField('X', tf.x - bb.w / 2, (v) => setT({ x: v + bb.w / 2 })),
          txField('Y', tf.y - bb.h / 2, (v) => setT({ y: v + bb.h / 2 })),
          // Z — the whole fixture's height off the canvas plane (px, 0 = flat on
          // it). Writes z on every vertex via setFixtureZ (normalized against the
          // canvas height, the same unit the viewport renders z with). Always
          // visible; only VISIBLE in the 3D viewport — output samples flat-front
          // either way until the projection camera ships. Per-vertex z is Phase 3.
          (() => {
            const cvH = (show.composition?.canvas?.h) || 720;
            const z0 = (Number(sel.input?.points?.find((p) => p?.length > 2)?.[2]) || 0) * cvH;
            const fld = txField('Z', z0, (v) => apply(setFixtureZ(show, sel.id, v / cvH)));
            fld.title = 'lift the whole fixture off the canvas plane (visible in 3D mode; output still projects flat-front)';
            return fld;
          })(),
          txField('Width', tf.w, (v) => setT({ w: v })),
          // Height is AUTO by default: drawn to PHYSICAL scale (10 mm strip × this
          // fixture's px-per-meter). The field shows the effective px; typing a
          // value overrides, 0 (or clearing) returns to auto.
          (() => {
            const eff = Math.round(thicknessOf(sel, show.composition?.canvas) * 10) / 10;
            const manual = !isAutoThickness(tf.h);
            const fld = txField('Height', manual ? tf.h : eff, (v) => setT({ h: v > 0 ? v : 0 }));
            fld.title = manual
              ? 'manual height (px) — set 0 to return to physical auto (10 mm strip)'
              : `auto — physical scale (10 mm strip ≈ ${eff}px on this fixture); type a value to override`;
            return fld;
          })(),
          // Rotation field with its ±90° steppers (icons) inline on the same row.
          (() => {
            const fld = txField('Rotation°', tf.rotation, (v) => setT({ rotation: v }));
            const ccw = oel('button', { className: 'dir-btn rot-step', title: 'rotate −90°', onclick: () => setT({ rotation: (snap90(tf.rotation) + 270) % 360 }) });
            ccw.innerHTML = '<svg class="ic-sm ic-flip" aria-hidden="true"><use href="#ic-rotate"/></svg>';
            const cw = oel('button', { className: 'dir-btn rot-step', title: 'rotate +90°', onclick: () => setT({ rotation: (snap90(tf.rotation) + 90) % 360 }) });
            cw.innerHTML = '<svg class="ic-sm" aria-hidden="true"><use href="#ic-rotate"/></svg>';
            fld.append(ccw, cw);
            return fld;
          })(),
        ]),
        reverseRow(),
      );
    }),
    flatGroup('Patch', 'routing', (body) => {
      body.append(
        oel('div', { className: 'output-grid' }, [
          oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Device' }), devSel]),
          oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Output' }), portSel]),
          oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Pixels' }), oel('span', { className: 'fx-readonly', textContent: fixtureRange(sel) })]),
        ]),
        // CHAIN status + wiring — is this fixture daisy-chained, and where in the run.
        chainStatusRow(sel),
      );
    }),
  ]);
}

// Editor for a selected DMX fixture: profile + position, Art-Net patch (controller,
// universe, address), and a slider per fixed channel — plus a channel-layout editor
// for the Generic profile. Colour is sampled from the canvas at the fixture's centre.
function dmxEditor(sel) {
  const cfg = sel.input.dmx || {};
  const channels = dmxChannelsOf(cfg);
  const generic = cfg.profileId === 'generic' || !!(cfg.channels && cfg.channels.length);
  // Type-derived fixture (unified model) → named Parameter faders; a legacy profile
  // fixture (no matching type) → the low-level Channels kind-editor.
  const ptype = (show.fixtureTypes || []).find((t) => t.id === sel.typeId);
  const tf = sel.input.transform || transformFromPoints(sel.input.points, show.composition?.canvas);
  const apply = (next) => { saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay(); };
  const setT = (patch) => apply(setFixtureTransform(show, sel.id, patch));
  const patchFix = (mut) => { const n = structuredClone(show); const f = n.fixtures.find((x) => x.id === sel.id); if (f) mut(f); apply(n); };
  const setDmx = (patch) => patchFix((f) => { f.input.dmx = { ...f.input.dmx, ...patch }; });
  const sel2 = (opts, value, onChange) => {
    const s = oel('select');
    for (const o of opts) { const op = oel('option', { value: o.value, textContent: o.label }); if (o.value === value) op.selected = true; s.append(op); }
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  const fld = (label, ctrl) => oel('label', { className: 'fx-field' }, [oel('span', { textContent: label }), ctrl]);
  const liveChannels = () => [...((show.fixtures.find((x) => x.id === sel.id)?.input?.dmx?.channels) || channels)];

  const out = oel('div', { className: 'output-edit' }, [
    flatGroup('Fixture', 'dmx-fixture', (body) => {
      // Per-instance only: WHICH definition + WHERE it sits. The channel LAYOUT is
      // owned by the type (edit it in Inventory → applies to every placed copy).
      const head = ptype
        ? fld('Type', oel('span', { className: 'fx-readonly', textContent: ptype.name || ptype.id, title: 'edit this fixture’s channels in the Library' }))
        : fld('Profile', sel2(DMX_PROFILES.map((p) => ({ value: p.id, label: p.name })), cfg.profileId, (id) => {
          if (id === 'generic') setDmx({ profileId: 'generic', channels: cfg.channels?.length ? cfg.channels : [{ kind: 'fixed', value: 0 }] });
          else setDmx({ profileId: id, channels: undefined });
        }));
      body.append(oel('div', { className: 'output-grid' }, [
        head,
        txField('X', tf.x, (v) => setT({ x: v })),
        txField('Y', tf.y, (v) => setT({ y: v })),
        // The on-canvas box is the fixture's physical footprint (where it samples
        // colour) — independent of the channel layout. Drag-resizable too.
        txField('W', tf.w, (v) => setT({ w: Math.max(4, v) })),
        txField('H', tf.h, (v) => setT({ h: Math.max(4, v) })),
      ]));
    }),
    flatGroup('Patch', 'dmx-patch', (body) => {
      const devs = [{ value: '', label: '— unassigned —' },
        ...show.devices.map((d) => ({ value: d.id, label: (d.name || d.id) + (d.protocol === 'artnet' ? '' : ' (not Art-Net)') }))];
      body.append(oel('div', { className: 'output-grid' }, [
        fld('Controller', sel2(devs, sel.output?.deviceId || '', (id) => patchFix((f) => { f.output = { ...f.output, deviceId: id }; }))),
        txField('Universe', cfg.universe ?? 0, (v) => setDmx({ universe: Math.max(0, Math.round(v)) })),
        txField('Address', cfg.address ?? 1, (v) => setDmx({ address: Math.min(512, Math.max(1, Math.round(v))) })),
        fld('Footprint', oel('span', { className: 'fx-readonly', textContent: `${channels.length} ch · U${cfg.universe ?? 0}.${cfg.address ?? 1}` })),
      ]));
    }),
  ]);

  // Parameters: one row PER PARAMETER (mirroring the Inventory definition — an RGB
  // block is ONE row, not three), each with a chosen SOURCE — Canvas (sample the
  // visual, default for colour), Manual (a fader), a Layer's level, or a Dashboard
  // link. A colour block's source applies to all its channels together.
  const hasFixed = channels.some((c) => c.kind === 'fixed');
  const typeParams = (ptype?.params || []).filter((p) => p && p.count != null);
  // Always present a parameter VIEW — even when the type has no DMX params (e.g. an
  // LED strip placed as DMX, whose channels come from its Color Format): derive params
  // from the channels so an RGB strip reads as one "RGB" row, not four raw channels.
  // Only a truly legacy "generic" profile keeps the low-level channel-kind editor.
  const legacyGeneric = cfg.profileId === 'generic';
  const params = typeParams.length ? typeParams : (channels.length ? channelsToParams(channels) : []);
  if (params.length && !legacyGeneric) {
    const layers = show.composition?.layers || [];
    const dashLinks = show.composition?.dashboard?.links || [];
    const srcOptions = (isColour) => [
      ...(isColour ? [{ value: 'canvas', label: 'Canvas' }] : []),
      { value: 'manual', label: 'Manual' },
      ...layers.map((L) => ({ value: `layer:${L.id}`, label: `Layer · ${L.name || L.id}` })),
      ...dashLinks.map((d) => ({ value: `dash:${d.id}`, label: `Dash · ${d.name || d.id}` })),
    ];
    out.append(flatGroup('Parameters', 'dmx-params', (body) => {
      let ci = 0;
      params.forEach((p) => {
        const span = paramSpan(p);
        const idxs = Array.from({ length: span }, (_, k) => ci + k);   // this param's channels
        const start = ci; ci += span;
        const isColour = paramKinds(p.name, p.count).some((k) => DMX_COLOUR_KINDS.has(k));
        // The block moves as one — read/show the source from its first channel. A
        // "layerkeep:" ref (layer binding that ignores the layer's Block) shows in the
        // picker as the plain layer (the checkbox below carries the ignore-block state).
        const rawRef = cfg.bind?.[start];
        const isLayerKeep = typeof rawRef === 'string' && rawRef.startsWith('layerkeep:');
        const normRef = isLayerKeep ? `layer:${rawRef.slice(10)}` : (rawRef && !rawRef.includes(':') ? `layer:${rawRef}` : rawRef);
        const hasManual = cfg.fixed && (start in cfg.fixed);
        const cur = normRef ? normRef : (hasManual ? 'manual' : (isColour ? 'canvas' : 'manual'));
        // Source picker: switching writes bind/fixed for EVERY channel in the block.
        body.append(fld(p.name, sel2(srcOptions(isColour), cur, (src) => setDmx({
          bind: (() => { const b = { ...(cfg.bind || {}) }; idxs.forEach((i) => { if (src.includes(':')) b[i] = src; else delete b[i]; }); return b; })(),
          fixed: (() => { const fx = { ...(cfg.fixed || {}) }; idxs.forEach((i) => { if (src === 'manual') { if (!(i in fx)) fx[i] = isColour ? 255 : (p.value ?? 0); } else delete fx[i]; }); return fx; })(),
        }))));
        // Manual → one fader (live, no re-render) driving the whole block together.
        if (cur === 'manual') body.append(Slider('', cfg.fixed?.[start] ?? p.value ?? 0, { min: 0, max: 255, step: 1, commit: 'live',
          onInput: (v) => idxs.forEach((i) => dmxFixedLive(sel.id, i, Math.round(v))) }));
        // Layer source → "ignore block (B)": read the layer's opacity even when the
        // layer is muted/blocked (so hiding the layer keeps this DMX connection live).
        if (cur.startsWith('layer:')) {
          const lid = cur.slice(6);
          const cb = oel('input', { type: 'checkbox' }); cb.checked = isLayerKeep;
          cb.addEventListener('change', () => setDmx({ bind: (() => { const b = { ...(cfg.bind || {}) }; const ref = cb.checked ? `layerkeep:${lid}` : `layer:${lid}`; idxs.forEach((i) => { b[i] = ref; }); return b; })() }));
          body.append(fld('ignore block (B)', cb));
        }
      });
    }));
  } else if (legacyGeneric || hasFixed) {
    out.append(flatGroup('Channels', 'dmx-channels', (body) => {
      channels.forEach((c, i) => {
        if (legacyGeneric) {
          const kindSel = sel2(DMX_CHANNEL_KINDS.map((k) => ({ value: k, label: k })), c.kind,
            (k) => patchFix((f) => { const ch = liveChannels(); ch[i] = { ...ch[i], kind: k }; f.input.dmx = { ...f.input.dmx, channels: ch }; }));
          const rm = oel('button', { className: 'fx-act', textContent: '⌫', title: 'remove channel',
            onclick: () => patchFix((f) => { const ch = liveChannels(); ch.splice(i, 1); f.input.dmx = { ...f.input.dmx, channels: ch.length ? ch : [{ kind: 'fixed', value: 0 }] }; }) });
          const r = fld(`Ch ${i + 1}`, kindSel); r.append(rm); body.append(r);
        }
        if (c.kind === 'fixed') {
          body.append(Slider(`Ch ${i + 1}`, cfg.fixed?.[i] ?? c.value ?? 0, { min: 0, max: 255, step: 1, commit: 'live',
            onInput: (v) => setDmx({ fixed: { ...(cfg.fixed || {}), [i]: Math.round(v) } }) }));
        }
      });
      if (legacyGeneric) body.append(oel('button', { className: 'fx-add', textContent: '+ channel',
        onclick: () => patchFix((f) => { f.input.dmx = { ...f.input.dmx, channels: [...liveChannels(), { kind: 'fixed', value: 0 }] }; }) }));
    }));
  }
  return out;
}

// Like txField, but the value may be null = "mixed" across the multi-selection:
// shows a "— mixed —" placeholder, dims the row (.is-mixed), and commits only when
// the user types something — which then writes that value to EVERY selected fixture.
function txFieldMulti(label, value, onCommit) {
  const i = oel('input', { type: 'number', step: '1', placeholder: '— mixed —' });
  if (value != null) i.value = String(Math.round(value));
  i.addEventListener('change', () => { if (i.value === '') return; onCommit(Number(i.value)); });
  return oel('label', { className: 'fx-field' + (value == null ? ' is-mixed' : '') }, [oel('span', { textContent: label }), i]);
}

// A <select> counterpart to txFieldMulti for discrete bulk fields (device/port).
// `state` is a { value, mixed } from fieldState: when mixed it prepends a selected
// "— mixed —" option and dims the row; committing writes to EVERY selected fixture.
function selFieldMulti(label, options, state, onCommit) {
  const s = oel('select');
  const MIXED = '__mixed__';
  if (state.mixed) s.append(oel('option', { value: MIXED, textContent: '— mixed —', selected: true }));
  for (const o of options) {
    const op = oel('option', { value: o.value, textContent: o.label });
    if (!state.mixed && o.value === String(state.value ?? '')) op.selected = true;
    s.append(op);
  }
  s.addEventListener('change', () => { if (s.value !== MIXED) onCommit(s.value); });
  return oel('label', { className: 'fx-field' + (state.mixed ? ' is-mixed' : '') }, [oel('span', { textContent: label }), s]);
}

// Position editor for a MULTI-selection — the SAME interface as positionEditor, but
// each field sets that property on EVERY selected fixture (X/Y/Width/Height/Rotation,
// ±90 and reverse applied per-fixture). A field shows the shared value, or blank
// ("— mixed —") when they differ. (Patch is per-chain, so it's omitted here.)
function multiPositionEditor(ids) {
  const fxOf = (id, src = show) => (src.fixtures || []).find((x) => x.id === id);
  const tfOf = (f, src = show) => f.input.transform || transformFromPoints(f.input.points, src.composition?.canvas);
  const tfs = ids.map((id) => tfOf(fxOf(id)));
  // Shared transform value across the selection, or null when they differ.
  const shared = (key) => { const v0 = tfs[0]?.[key] ?? 0; return tfs.every((t) => Math.abs((t?.[key] ?? 0) - v0) < 0.5) ? v0 : null; };
  // Apply a per-id mutation across the whole selection in ONE commit.
  const applyAll = (mutate) => { let next = show; for (const id of ids) next = mutate(next, id); applyShow(next); };
  const setEachT = (patch) => applyAll((nx, id) => setFixtureTransform(nx, id, patch));
  // X/Y address each fixture's bounding-box TOP-LEFT (Figma-style) — converted
  // to/from its own centre (per-fixture, since the bbox size depends on rotation).
  const leftOf = (id, src = show) => { const f = fxOf(id, src); const t = tfOf(f, src); return t.x - aabbSize(t, thicknessOf(f, src.composition?.canvas)).w / 2; };
  const topOf = (id, src = show) => { const f = fxOf(id, src); const t = tfOf(f, src); return t.y - aabbSize(t, thicknessOf(f, src.composition?.canvas)).h / 2; };
  const sharedFn = (fn) => { const v0 = fn(ids[0]); return ids.every((id) => Math.abs(fn(id) - v0) < 0.5) ? v0 : null; };
  const setEachLeft = (v) => applyAll((nx, id) => { const f = fxOf(id, nx); const t = tfOf(f, nx); return setFixtureTransform(nx, id, { x: v + aabbSize(t, thicknessOf(f, nx.composition?.canvas)).w / 2 }); });
  const setEachTop = (v) => applyAll((nx, id) => { const f = fxOf(id, nx); const t = tfOf(f, nx); return setFixtureTransform(nx, id, { y: v + aabbSize(t, thicknessOf(f, nx.composition?.canvas)).h / 2 }); });
  const rotStep = (sign) => applyAll((nx, id) => {
    const r = tfOf(fxOf(id, nx), nx).rotation || 0;
    return setFixtureTransform(nx, id, { rotation: (snap90(r) + (sign > 0 ? 90 : 270)) % 360 });
  });
  // Height: only show a shared number when every fixture has the SAME manual height.
  const hManual = tfs.every((t) => !isAutoThickness(t.h));
  const hVal = hManual ? shared('h') : null;
  // reverse button is "on" only when ALL selected strips are reversed.
  const allRev = ids.every((id) => !!fxOf(id)?.input?.reversed);

  // --- PATCH + per-instance DMX (bulk) -------------------------------------
  // The live selection as fixture objects, plus its strip / DMX subsets. Patch
  // fields shown depend on what's in the selection: Device is common to both;
  // Output port is a pixel-strip concept; Universe/Address are DMX-only.
  const selList = () => ids.map((id) => fxOf(id)).filter(Boolean);
  const list = selList();
  const stripList = list.filter((f) => !isDmxFixture(f));
  const dmxList = list.filter((f) => isDmxFixture(f));
  // Write a (dotted) field to every selected fixture matching `filter`, via the
  // tested applyField helper, then commit through the normal show pipeline.
  // (Device/port/offset are derived by repackOffsets on rebuild, so reassigning
  // a fixture's device or port here can never corrupt pixel offsets.)
  const setFieldAll = (key, value, filter = () => true) => {
    const next = structuredClone(show);
    const targetIds = new Set(next.fixtures.filter((f) => ids.includes(f.id) && filter(f)).map((f) => f.id));
    const updated = new Map(applyField(next.fixtures.filter((f) => targetIds.has(f.id)), key, value).map((f) => [f.id, f]));
    next.fixtures = next.fixtures.map((f) => updated.get(f.id) || f);
    applyShow(next);
  };
  // Device options: "— unassigned —" first (mirrors the single editors), then every
  // controller. Output options: 1..N where N is the largest output count among the
  // selection's devices (floor 4) — so the picker always offers the real ports.
  const devOpts = [{ value: '', label: '— unassigned —' },
    ...show.devices.map((d) => ({ value: d.id, label: `${d.name || d.id} (${d.id})` }))];
  const devIds = [...new Set(list.map((f) => f.output?.deviceId).filter(Boolean))];
  const nOut = Math.max(1, 4, ...devIds.map((id) => Math.round(show.devices.find((d) => d.id === id)?.outputs ?? 4)));
  const portOpts = Array.from({ length: nOut }, (_, i) => ({ value: String(i + 1), label: `Output ${i + 1}` }));

  return oel('div', { className: 'output-edit' }, [
    flatGroup('Position', 'position', (body) => {
      body.append(
        oel('div', { className: 'output-grid' }, [
          txFieldMulti('X', sharedFn(leftOf), (v) => setEachLeft(v)),
          txFieldMulti('Y', sharedFn(topOf), (v) => setEachTop(v)),
          txFieldMulti('Width', shared('w'), (v) => setEachT({ w: v })),
          txFieldMulti('Height', hVal, (v) => setEachT({ h: v > 0 ? v : 0 })),   // 0 = auto
          (() => {
            const fld = txFieldMulti('Rotation°', shared('rotation'), (v) => setEachT({ rotation: v }));
            fld.append(
              oel('button', { className: 'dir-btn rot-step', textContent: '−90°', title: 'rotate each −90°', onclick: () => rotStep(-1) }),
              oel('button', { className: 'dir-btn rot-step', textContent: '+90°', title: 'rotate each +90°', onclick: () => rotStep(1) }),
            );
            return fld;
          })(),
        ]),
        oel('div', { className: 'dir-btns out-transform' }, [
          oel('button', { className: 'dir-btn' + (allRev ? ' on' : ''), textContent: '⇄ Reverse direction',
            title: 'reverse each selected strip (which end is pixel 0)',
            onclick: () => applyAll((nx, id) => flipFixture(nx, id)) }),
        ]),
      );
    }),
    // PATCH (bulk): which controller/output the selection is wired to, plus per-
    // instance DMX address. Each field dims when it differs across the selection
    // and writes to ALL selected on edit. pixelOffset is intentionally omitted —
    // it's derived by repackOffsets, never authored.
    flatGroup('Patch', 'routing', (body) => {
      const grid = [
        selFieldMulti('Device', devOpts, fieldState(list, 'output.deviceId'),
          (v) => setFieldAll('output.deviceId', v)),
      ];
      // Output port — pixel-strip concept; show whenever the selection has a strip.
      if (stripList.length) grid.push(
        selFieldMulti('Output', portOpts, fieldState(stripList, 'output.port'),
          (v) => setFieldAll('output.port', Number(v), (f) => !isDmxFixture(f))),
      );
      // Universe/Address — DMX-only; show whenever the selection has a DMX fixture.
      if (dmxList.length) {
        const u = fieldState(dmxList, 'input.dmx.universe');
        const a = fieldState(dmxList, 'input.dmx.address');
        grid.push(
          txFieldMulti('Universe', u.mixed ? null : (u.value ?? 0),
            (v) => setFieldAll('input.dmx.universe', Math.max(0, Math.round(v)), isDmxFixture)),
          txFieldMulti('Address', a.mixed ? null : (a.value ?? 1),
            (v) => setFieldAll('input.dmx.address', Math.min(512, Math.max(1, Math.round(v))), isDmxFixture)),
        );
      }
      body.append(oel('div', { className: 'output-grid' }, grid));
    }),
    // GROUP parameter control: when every selected fixture is a DMX fixture of the
    // SAME type, expose one named fader per parameter that drives ALL of them at once.
    ...groupParamSection(ids),
  ]);
}

// A "Parameters" section for a multi-selection — only when all selected fixtures are
// DMX of one shared type. Each fader sets that param's override on every fixture.
function groupParamSection(ids) {
  const fxOf = (id, src = show) => (src.fixtures || []).find((x) => x.id === id);
  const sel = ids.map((id) => fxOf(id)).filter(Boolean);
  if (!sel.length || !sel.every(isDmxFixture)) return [];
  const typeId = sel[0].typeId;
  if (!sel.every((f) => f.typeId === typeId)) return [];
  const ptype = (show.fixtureTypes || []).find((t) => t.id === typeId);
  const ctl = ptype ? fixtureControlChannels(ptype) : [];
  if (!ctl.length) return [];
  const setEachParam = (ci, v) => {
    const next = structuredClone(show);
    for (const id of ids) {
      const f = next.fixtures.find((x) => x.id === id);
      if (f) f.input.dmx = { ...f.input.dmx, fixed: { ...(f.input.dmx?.fixed || {}), [ci]: Math.round(v) } };
    }
    applyShow(next);
  };
  return [flatGroup('Parameters', 'dmx-params', (body) => {
    ctl.forEach((c) => {
      const ci = c.index;
      // Shared value across the selection, else fall back to the first fixture's and
      // dim the row (.is-mixed) to flag that the fader's value differs across the
      // selection — consistent with the other mixed fields. Editing still writes all.
      const vals = sel.map((f) => f.input?.dmx?.fixed?.[ci] ?? c.value ?? 0);
      const mixed = !vals.every((v) => v === vals[0]);
      const row = Slider(c.name, vals[0], { min: 0, max: 255, step: 1, commit: 'live',
        onInput: (v) => setEachParam(ci, v) });
      if (mixed) row.classList.add('is-mixed');
      body.append(row);
    });
  })];
}

const applyShow = (next) => { saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay(); };

// --- Align & distribute the multi-selection (canvas px, bounding-box based) -----
// Each fixture's AABB on the canvas: centre ± size/2 (size = aabbSize, rotation-aware).
function fxMetrics(id, src = show) {
  const f = (src.fixtures || []).find((x) => x.id === id);
  const tf = f.input.transform || transformFromPoints(f.input.points, src.composition?.canvas);
  const s = aabbSize(tf, thicknessOf(f, src.composition?.canvas));
  return { id, w: s.w, h: s.h, cx: tf.x, cy: tf.y, left: tf.x - s.w / 2, right: tf.x + s.w / 2, top: tf.y - s.h / 2, bottom: tf.y + s.h / 2 };
}
// Align/distribute the selection. mode: left|cx|right|top|cy|bottom · distH|distV.
// ref: 'canvas' (the composition) or 'selection' (the selected fixtures' union bbox).
function alignSelected(mode, ref) {
  const ids = [...selectedFixtureIds].filter((id) => (show.fixtures || []).some((f) => f.id === id));
  if (!ids.length) return;
  const m = ids.map((id) => fxMetrics(id));
  const cv = show.composition?.canvas || { w: 1280, h: 720 };
  const minL = ref === 'canvas' ? 0 : Math.min(...m.map((x) => x.left));
  const maxR = ref === 'canvas' ? cv.w : Math.max(...m.map((x) => x.right));
  const minT = ref === 'canvas' ? 0 : Math.min(...m.map((x) => x.top));
  const maxB = ref === 'canvas' ? cv.h : Math.max(...m.map((x) => x.bottom));
  const patch = {};   // id → transform patch (centre)
  if (mode === 'distH' || mode === 'distV') {
    if (ids.length < 3) return;   // distribute needs 3+ (spread the inner ones evenly)
    const k = mode === 'distH' ? 'cx' : 'cy';
    const sorted = [...m].sort((a, b) => a[k] - b[k]);
    const first = sorted[0][k], last = sorted[sorted.length - 1][k];
    sorted.forEach((it, i) => { const v = first + (last - first) * i / (sorted.length - 1); patch[it.id] = mode === 'distH' ? { x: v } : { y: v }; });
  } else for (const it of m) {
    if (mode === 'left') patch[it.id] = { x: minL + it.w / 2 };
    else if (mode === 'right') patch[it.id] = { x: maxR - it.w / 2 };
    else if (mode === 'cx') patch[it.id] = { x: (minL + maxR) / 2 };
    else if (mode === 'top') patch[it.id] = { y: minT + it.h / 2 };
    else if (mode === 'bottom') patch[it.id] = { y: maxB - it.h / 2 };
    else if (mode === 'cy') patch[it.id] = { y: (minT + maxB) / 2 };
  }
  let next = show;
  for (const id of ids) if (patch[id]) next = setFixtureTransform(next, id, patch[id]);
  applyShow(next);
  updateInspector();   // positions changed wholesale → refresh the editor fields
}
// "Align" corner button (like File/Mapping) → a menu of all align/distribute
// options. Sections: between the selected fixtures (2+) and to the composition.
const alignBtnEl = document.getElementById('menu-align');
const ALIGN_ITEMS = [['left', '↤', 'Left'], ['cx', '↔', 'Centre'], ['right', '↦', 'Right'], ['top', '↥', 'Top'], ['cy', '↕', 'Middle'], ['bottom', '↧', 'Bottom']];
function openAlignMenu() {
  const n = selectedFixtureIds.size;
  if (!n) return;
  const items = [];
  if (n >= 2) {
    items.push({ head: 'Between items' });
    for (const [mode, g, label] of ALIGN_ITEMS) items.push({ label: `${g}  ${label}`, act: () => alignSelected(mode, 'selection') });
    if (n >= 3) {
      items.push({ label: '⇿  Distribute horizontally', act: () => alignSelected('distH', 'selection') });
      items.push({ label: '⇳  Distribute vertically', act: () => alignSelected('distV', 'selection') });
    }
    items.push({ sep: true });
  }
  items.push({ head: 'To canvas' });
  for (const [mode, g, label] of ALIGN_ITEMS) items.push({ label: `${g}  ${label}`, act: () => alignSelected(mode, 'canvas') });
  openMenu(alignBtnEl, menuList(items));
}
alignBtnEl?.addEventListener('click', (e) => { e.stopPropagation(); openAlignMenu(); });
// Align is always visible (like File/Mapping/Install) — just DISABLED when there's
// nothing selected to align.
function updateAlignBtn() {
  if (!alignBtnEl) return;
  alignBtnEl.disabled = selectedFixtureIds.size < 1;
}

// Wiring for the selected fixture: its INPUT comes FROM another fixture's output
// (or straight from the controller = first on its output), and its OUTPUT goes TO
// the next fixture. Picking a "from" fixture moves this one onto that fixture's
// output, right after it — the node-graph edge. "to" is the derived successor.
function chainStatusRow(sel) {
  const ch = chainOf(show, sel.id);
  const idxOf = (id) => show.fixtures.findIndex((x) => x.id === id);
  const nameOf = (id) => { const i = idxOf(id); return i >= 0 ? fixtureLabel(show.fixtures[i], i) : id; };
  const tag = (id) => { const f = show.fixtures[idxOf(id)]; return `${nameOf(id)} (${f?.output?.deviceId || '—'}·o${f?.output?.port ?? 1})`; };
  const dev = show.devices.find((d) => d.id === sel.output?.deviceId);
  const devName = dev?.name || dev?.id || 'controller';
  // Pixel load + capacity on this fixture's output (0 max = unlimited).
  const runKeyOf = (f) => `${f.output?.deviceId || ''}:${f.output?.port ?? 1}`;
  const key = runKeyOf(sel);
  const runPx = show.fixtures.filter((f) => runKeyOf(f) === key).reduce((m, f) => m + (f.pixelCount || 0), 0);
  const cap = Number(dev?.maxPerOutput) || 0;
  const full = cap > 0 && runPx >= cap;
  // FROM picker: the controller (=first on its output) + every other fixture. When
  // the fixture has no device, there IS no controller to be "first" on — say so
  // (picking another fixture here still wires + assigns it onto that fixture's run).
  const assigned = !!sel.output?.deviceId;
  const fromSel = oel('select');
  fromSel.append(oel('option', { value: '', textContent: assigned ? `${devName} (controller)` : '— unassigned (no controller) —' }));
  for (const f of show.fixtures) if (f.id !== sel.id) fromSel.append(oel('option', { value: f.id, textContent: tag(f.id) }));
  fromSel.value = ch && ch.index > 0 ? ch.members[ch.index - 1] : '';
  fromSel.addEventListener('change', () => applyShow(fromSel.value ? wireAfter(show, sel.id, fromSel.value) : wireFirst(show, sel.id)));
  // TO picker: which fixture follows this one. Greyed when the output is FULL
  // (can't drive more pixels on a single output → end of chain).
  const next = ch && ch.index < ch.members.length - 1 ? ch.members[ch.index + 1] : null;
  const toSel = oel('select');
  toSel.append(oel('option', { value: '', textContent: full ? 'End (output full)' : 'End of chain' }));
  const candidates = show.fixtures.filter((f) => f.id !== sel.id);
  for (const f of candidates) toSel.append(oel('option', { value: f.id, textContent: tag(f.id) }));
  toSel.value = next || '';
  // End of chain with nothing to offer — the output is full, or there are simply no
  // other fixtures to wire after this one → nothing to pick, so disable the picker.
  toSel.disabled = !next && (full || candidates.length === 0);
  if (full) toSel.title = `${devName} Output ${sel.output?.port ?? 1} is full (${runPx}/${cap}px)`;
  else if (!next && candidates.length === 0) toSel.title = 'no other fixtures to wire after this one';
  toSel.addEventListener('change', () => { if (toSel.value) applyShow(wireAfter(show, toSel.value, sel.id)); });
  const capTxt = cap > 0 ? ` · ${runPx}/${cap}px${full ? ' ⚠ full' : ''}` : '';
  return oel('div', {}, [
    oel('div', { className: 'fx-pts' + (full ? ' fx-err' : ''), textContent: (ch ? `⛓ ${ch.name} · ${ch.index + 1}/${ch.members.length}` : (assigned ? '⋈ first on its output' : '⋈ unassigned')) + capTxt }),
    oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Input ←' }), fromSel]),
    oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Output →' }), toSel]),
  ]);
}

// Multi-select action: put the selected fixtures on ONE shared output (a fresh
// port on the first one's device) so they become a chain.
function chainSelectedAction() {
  return oel('div', { className: 'output-edit' }, [
    oel('button', {
      className: 'fx-add', textContent: '⛓ chain (same output)',
      onclick: () => {
        const ids = [...selectedFixtureIds];
        const first = show.fixtures.find((f) => f.id === ids[0]); if (!first) return;
        const devId = first.output?.deviceId || '';
        const port = freePort(show, devId);
        const next = structuredClone(show);
        for (const f of next.fixtures) if (selectedFixtureIds.has(f.id)) { f.output.deviceId = devId; f.output.port = port; }
        applyShow(next);
      },
    }),
  ]);
}

// (Output kind — pixels vs DMX — follows the fixture's TYPE; there is no per-fixture
// toggle. Define a DMX fixture as a DMX type in Inventory, a strip as a pixel type.)

// The "+ fixture" / "+ controller" / "scan" toolbar above the placement list — the
// three actions sit side by side; the fixture-type picker (what "+ fixture" places)
// is a full-width row below them, then any scan results. Definitions live in Inventory.
// The size tag for a fixture TYPE: "6ch" for a DMX fixture, "C×R" for a matrix, "Npx"
// for a strip — shown as a greyed suffix wherever a type/fixture name appears.
const typeSizeSuffix = (t) => isDmxType(t)
  ? `${t.channels?.length || paramsToChannels(t.params || []).length}ch`
  : ((Number(t?.rows) || 1) > 1 ? `${t.cols}×${t.rows}` : `${t?.pixelCount ?? 1}px`);


// Confirm before deleting fixture(s) — it re-packs pixel ranges, and removing a
// chained fixture changes that whole output's wiring/addressing.
function confirmDeleteFixtures(ids) {
  const items = (show.fixtures || []).filter((f) => ids.includes(f.id));
  if (!items.length) return false;
  let msg;
  if (items.length === 1) {
    const f = items[0], ch = chainOf(show, f.id);
    msg = `Delete ${fixtureLabel(f, show.fixtures.indexOf(f))}?`
      + (ch ? `\n\nIt's chained on ${ch.name} (${ch.members.length} fixtures) — removing it re-wires that chain and re-packs its pixels.` : '');
  } else {
    const chained = items.filter((f) => chainOf(show, f.id)).length;
    msg = `Delete ${items.length} fixtures?` + (chained ? `\n\n${chained} are chained — this re-wires their outputs and re-packs pixels.` : '');
  }
  return confirmDelete(msg);
}

// The Fixture editor group: shows the selected item's properties — a fixture's
// position/DMX, a device's settings, or (when working in Inventory) the selected
// model. Always docked in the right column; shows a hint when nothing's selected.
function updateInspector() {
  if (!fxBodyEl) return;
  let detail = null, title = 'Properties';
  const fxName = (f) => (show.fixtureTypes || []).find((t) => t.id === f?.typeId)?.name || 'Fixture';
  // Inventory MODEL editor when the last interaction was in Inventory; otherwise the
  // selected fixture(s)/device editor.
  if (outputTab === 'library') {
    detail = panel.libraryDetailEl?.();
    title = panel.librarySelection?.()?.name || 'Library';
  } else if (selectedFixtureIds.size === 1) {
    const f = (show.fixtures || []).find((x) => x.id === [...selectedFixtureIds][0]);
    if (f) { detail = isDmxFixture(f) ? dmxEditor(f) : positionEditor(f); title = fxName(f); }
  } else if (selectedFixtureIds.size > 1) {
    // Several fixtures selected → the multi editor (batch X/Y/W/H/rotation/reverse).
    const ids = [...selectedFixtureIds].filter((id) => (show.fixtures || []).some((f) => f.id === id));
    if (ids.length > 1) { detail = multiPositionEditor(ids); title = `${ids.length} fixtures`; }
  } else if (selectedDeviceId && (show.devices || []).some((d) => d.id === selectedDeviceId)) {
    detail = panel.deviceDetailEl?.();
    title = (show.devices || []).find((d) => d.id === selectedDeviceId)?.name || 'Device';
  }
  // Never leave the Device group empty: with nothing selected, fall back to the first
  // fixture's editor (else the first device) so there's always something to edit.
  if (!detail && outputTab !== 'library') {
    const f0 = (show.fixtures || [])[0];
    if (f0) { detail = isDmxFixture(f0) ? dmxEditor(f0) : positionEditor(f0); title = fxName(f0); }
    else { const d0 = (show.devices || [])[0]; if (d0) { panel.setDevice?.(d0.id); detail = panel.deviceDetailEl?.(); title = d0.name || 'Device'; } }
  }
  const titleEl = document.getElementById('fxedit-title');
  if (titleEl) titleEl.textContent = title;
  // Preserve focus + caret across the rebuild: a spinner click / keystroke commits →
  // the panel re-mounts, which would otherwise drop focus (so each arrow press needed
  // a re-click). Re-focus the same field's input by its label after re-appending.
  const ae = document.activeElement;
  let focusKey = null, vtxKey = null, selStart = null, selEnd = null;
  if (ae && ae.tagName === 'INPUT' && fxBodyEl.contains(ae)) {
    focusKey = ae.closest('.fx-field')?.querySelector('span')?.textContent || null;
    vtxKey = ae.dataset?.vtx || null;   // per-vertex XYZ table cells key by "row:axis"
    try { selStart = ae.selectionStart; selEnd = ae.selectionEnd; } catch { /* number inputs don't expose selection */ }
  }
  fxBodyEl.textContent = '';
  if (detail) fxBodyEl.append(detail);   // no title bar — the selection is already visible on the canvas/list
  else fxBodyEl.append(oel('div', { className: 'ly-hint', textContent: 'select a fixture, device, or model' }));
  if (focusKey || vtxKey) {
    const fld = focusKey && [...fxBodyEl.querySelectorAll('.fx-field')].find((f) => f.querySelector('span')?.textContent === focusKey);
    const inp = vtxKey ? fxBodyEl.querySelector(`input[data-vtx="${vtxKey}"]`) : fld?.querySelector('input');
    if (inp) { inp.focus(); try { if (selStart != null) inp.setSelectionRange(selStart, selEnd); } catch { /* number input */ } }
  }
  updateStageInsets();
  updateAlignBtn();
}

// --- Device editor: a floating GROUP that pops up where you click a controller /
//     fixture / model. Its height follows the editor content. ---
const devicePop = document.getElementById('device-pop');
const devicePopOpen = () => devicePop && !devicePop.hidden;
function closeDevicePop() { if (devicePop) devicePop.hidden = true; }
// Park it in the CANVAS top-right corner (floats translucent over the output).
function positionDevicePop() {
  if (!devicePopOpen()) return;
  const pw = devicePop.offsetWidth || 290;
  const stage = document.getElementById('stage-island');
  const sr = stage?.getBoundingClientRect();
  const pad = 4;   // snug into the canvas corner
  const top = sr ? sr.top + pad : 84;
  const left = (sr ? sr.right : window.innerWidth) - pw - pad;
  devicePop.style.top = Math.max(8, top) + 'px';
  devicePop.style.left = Math.max(8, left) + 'px';
}
function openDevicePop() {
  if (!devicePop) return;
  updateInspector();          // fill #fxinsp-body (inside the group)
  devicePop.hidden = false;
  positionDevicePop();
}
function popAtSelectedRow() { openDevicePop(); }
// Reposition on resize, but coalesce to ONE update per frame (raw resize fires many
// times/sec while the canvas is also relaying out → the group stutters otherwise).
let popResizeRaf = 0;
window.addEventListener('resize', () => {
  if (!devicePopOpen() || popResizeRaf) return;
  popResizeRaf = requestAnimationFrame(() => { popResizeRaf = 0; positionDevicePop(); });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && devicePopOpen() && !typingIn(e.target)) closeDevicePop(); });
document.addEventListener('pointerdown', (e) => {
  if (!devicePopOpen()) return;
  if (devicePop.contains(e.target)) return;
  if (e.target.closest?.('.output-row, .insp-sec-head, [data-fxid], [data-devid], #stagewrap')) return;   // device/canvas clicks reopen or move it
  closeDevicePop();
}, true);
// === Add directly from a TEMPLATE (the Devices view's "+ Fixture" / "+ Device") ===
// The catalog (show.fixtureTypes / show.deviceTypes) is a template LIBRARY. Picking a
// template STAMPS a standalone instance (spec inlined, typeId = template.id) via the
// tested stamp helpers, then selects it so its editor opens. Issue #5: a clear,
// discoverable way to add/patch a fixture without hunting through a separate tab.
const nextFixtureId = (s) => { let n = (s.fixtures?.length || 0) + 1, id; do { id = `f${n}`; n++; } while ((s.fixtures || []).some((x) => x.id === id)); return id; };
const nextDeviceId = (s) => { let n = (s.devices?.length || 0) + 1, id; do { id = `c${n}`; n++; } while ((s.devices || []).some((x) => x.id === id)); return id; };

function addFixtureFromTemplate(template) {
  const next = structuredClone(show);
  const id = nextFixtureId(next);
  const fx = stampFixture(template, id);   // standalone instance, centred + unassigned
  next.fixtures.push(fx);
  selectedFixtureIds = new Set([id]); selectedDeviceId = null;
  expandedDevices.add('');             // keep the Unassigned group open so it shows
  saveShow(next); rebuild(next);
  setOverlay(true);                    // reveal the canvas overlay so the new fixture is visible
  panel.refresh(); renderOutput(); redrawOverlay();
}

function addDeviceFromTemplate(template) {
  const next = structuredClone(show);
  const id = nextDeviceId(next);
  const dev = stampDevice(template, id);
  dev.color = nextDeviceColor(next);   // distinct identity colour (round-robin palette)
  // Keep device names unique (the model name repeats across instances).
  const taken = new Set((next.devices || []).map((d) => d.name));
  if (taken.has(dev.name)) { let seq = 2; while (taken.has(`${dev.name} ${seq}`)) seq++; dev.name = `${dev.name} ${seq}`; }
  next.devices.push(dev);
  selectedDeviceId = id; selectedFixtureIds = new Set(); expandedDevices.add(id);
  saveShow(next); rebuild(next);
  panel.refresh(); renderOutput();
}

// Template-pick popover anchored under the "+ Fixture" / "+ Device" button. Lists the
// user templates by name (with a size hint) + a "Blank" entry that stamps from the
// always-present `generic` template. Reuses the kit picker chrome (.pick-pop) + the
// shared anchor/clamp + click-out/Esc dismissal.
let tplMenuPop = null, tplMenuDismiss = null;
function closeTemplateMenu() {
  if (!tplMenuPop) return;
  tplMenuPop.remove(); tplMenuPop = null;
  if (tplMenuDismiss) { tplMenuDismiss(); tplMenuDismiss = null; }
}
function openTemplateMenu(anchor, kind) {
  closeTemplateMenu();
  const pop = oel('div', { className: 'pick-pop' });
  const item = (label, onPick) => {
    const row = oel('div', { className: 'pick-item' }, [oel('span', { className: 'lib-label', textContent: label })]);
    row.onclick = (e) => { e.stopPropagation(); closeTemplateMenu(); onPick(); };
    return row;
  };
  if (kind === 'fixture') {
    const types = show.fixtureTypes || [];
    for (const t of types) {
      if (t.id === 'generic') continue;   // offered as "Blank" below
      pop.append(item(`${t.name} (${typeSizeSuffix(t)})`, () => addFixtureFromTemplate(t)));
    }
    const generic = types.find((t) => t.id === 'generic');
    pop.append(item('Blank', () => addFixtureFromTemplate(generic || {})));
  } else {
    const dts = show.deviceTypes || [];
    for (const t of dts) {
      if (t.id === 'generic') continue;   // offered as "Blank" below
      pop.append(item(`${t.name} (${t.outputs} out)`, () => addDeviceFromTemplate(t)));
    }
    const generic = dts.find((t) => t.id === 'generic');
    pop.append(item('Blank', () => addDeviceFromTemplate(generic || { name: 'Controller', outputs: 4 })));
  }
  placePopover(pop, anchor);                              // anchor + viewport-clamp (kit)
  tplMenuPop = pop;
  tplMenuDismiss = dismissOnOutside(pop, closeTemplateMenu);   // click-outside + Esc (kit)
}

function renderOutput() {
  updateInspector();
  if (!outputListEl) return;
  outputListEl.textContent = '';
  closeTemplateMenu();   // a re-render detaches the old anchor; drop any open menu
  // Add fixture / add device / inventory are header icons by the "Devices" title now
  // (wired once at boot) — no in-list toolbar.
  const fixtures = show.fixtures || [];
  for (const id of [...selectedFixtureIds]) if (!fixtures.some((f) => f.id === id)) selectedFixtureIds.delete(id);
  if (selectedDeviceId && !(show.devices || []).some((d) => d.id === selectedDeviceId)) selectedDeviceId = null;   // drop a stale device selection (e.g. after undo/delete)

  // The Fixtures group always shows the placement list (the Inventory model editor
  // is a separate group), so there's no longer a library-tab early-out.

  // selectable rows + inline position editor under the row.
  // (No early-out for an empty rig — the device containers still render below so
  // they're visible + droppable even before any fixture is placed.)
  // A header/row becomes a drop target: dropping the dragged fixture(s) assigns
  // them to `deviceId` (+ `port` when given; deviceId '' = unassign).
  const dropZone = (el, deviceId, port) => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-hover'); });
    // dragleave fires when entering a CHILD too — only clear when truly leaving,
    // so the hover doesn't flicker while dragging across the section's rows.
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover'); });
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop-hover'); assignFixturesTo(dragFxIds, deviceId, port); dragFxIds = []; });
    return el;
  };
  // A fixture row — same chrome as the Inventory list rows (.output-row + boxed
  // .fx-badge chips) so the two tabs read alike.
  const fixtureRow = (f, i, outLabel, devColor) => {
    const row = oel('div', { className: 'output-row' + (selectedFixtureIds.has(f.id) ? ' selected' : '') });
    row.dataset.fxid = f.id;
    // Controller identity colour: a subtle 3px left bar (CSS var; the selection
    // accent bar overrides it — see .output-row.selected).
    if (devColor) row.style.setProperty('--dev-color', devColor);
    // Drag a fixture row onto a device header to assign it (the whole selection drags
    // when this row is part of a multi-select).
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      dragFxIds = (selectedFixtureIds.has(f.id) && selectedFixtureIds.size > 1) ? [...selectedFixtureIds] : [f.id];
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragFxIds.join(',')); } catch { /* some browsers */ }
    });
    const ftype = (show.fixtureTypes || []).find((t) => t.id === f.typeId);
    const label = ftype?.name ? `${fixtureLabel(f, i)} ${ftype.name}` : fixtureLabel(f, i);
    const nameEl = oel('span', { className: 'lr-name', textContent: label });     // flex-grow name
    if (ftype) nameEl.append(oel('span', { className: 'lr-suffix', textContent: ` (${typeSizeSuffix(ftype)})` }));   // greyed size, appended to the name
    row.append(nameEl);
    if (outLabel) row.append(oel('span', { className: 'fx-badge', textContent: outLabel }));
    // DMX fixtures badge their Art-Net patch (U{universe}.{address}); pixel strips
    // badge their pixel range.
    row.append(oel('span', { className: 'fx-badge', textContent: isDmxFixture(f) ? `U${f.input.dmx.universe ?? 0}.${f.input.dmx.address ?? 1}` : fixtureRange(f) }));
    row.onclick = (e) => selectFixture(f.id, e, { isolate: true });   // list click → just this fixture (⌫ deletes it)
    return row;
  };
  // A collapsible controller group, styled exactly like the Inventory sections
  // (▾ accent header + body). The triangle toggles; clicking the header selects the
  // controller (or unassign group). Returns its parts so callers can wire drop-zones.
  const devSection = (deviceId, title, badges, headClick) => {
    // Controllers are ALWAYS expanded — no fold/collapse. Clicking the header still
    // selects the controller for editing.
    const sec = oel('div', { className: 'insp-sec out-sec is-open' });
    const head = oel('div', { className: 'insp-sec-head' }, [oel('span', { className: 'insp-sec-title', textContent: (title || '').toUpperCase() })]);
    for (const b of (badges || [])) head.append(oel('span', { className: 'fx-badge', textContent: b }));
    if (headClick) head.onclick = headClick;
    const body = oel('div', { className: 'insp-sec-body' });
    sec.append(head, body);
    return { sec, head, body };
  };
  // GROUP the placement list by CONTROLLER → output, rendered as Inventory-style
  // collapsible sections (one per controller) with the fixtures as rows beneath.
  const devOrder = []; const devMap = new Map();
  fixtures.forEach((f, i) => {
    const did = f.output?.deviceId || '';
    let dg = devMap.get(did);
    if (!dg) { dg = { deviceId: did, groups: [], gmap: new Map() }; devMap.set(did, dg); devOrder.push(dg); }
    const port = f.output?.port ?? 1, key = `${did}:${port}`;
    let g = dg.gmap.get(key);
    if (!g) { g = { key, deviceId: did, port, items: [] }; dg.gmap.set(key, g); dg.groups.push(g); }
    g.items.push({ f, i });
  });
  // Show EVERY device as a container (even with no fixtures) so it's a drop target
  // for drag-to-assign — you can drop a fixture onto an empty controller.
  for (const d of show.devices) {
    if (!devMap.has(d.id)) { const dg = { deviceId: d.id, groups: [], gmap: new Map() }; devMap.set(d.id, dg); devOrder.push(dg); }
  }
  // Always show an "Unassigned" container, even when empty — it's a persistent drop
  // target: drag a fixture onto it to UNASSIGN it (deviceId '').
  if (!devMap.has('')) { const dg = { deviceId: '', groups: [], gmap: new Map() }; devMap.set('', dg); devOrder.push(dg); }
  // Controllers first; the Unassigned holding group sits LAST (the place strips drop
  // out to, below the real rig).
  devOrder.sort((a, b) => (a.deviceId === '' ? 1 : 0) - (b.deviceId === '' ? 1 : 0));

  for (const dg of devOrder) {
    // UNASSIGNED — a plain heading (not a foldable group), still a drop target: drop
    // a fixture here to unassign it. Its rows sit directly below the heading.
    if (!dg.deviceId) {
      const items = dg.groups.flatMap((g) => g.items);
      const head = oel('div', { className: 'insp-sec-head out-unassigned' }, [
        oel('span', { className: 'insp-sec-title', textContent: 'Unassigned' }),
        oel('span', { className: 'fx-badge', textContent: `${items.length} fx` }),
      ]);
      dropZone(head, '', null);   // drop a fixture here → unassign it
      outputListEl.append(head);
      for (const { f, i } of items) outputListEl.append(fixtureRow(f, i));
      continue;
    }
    const gdev = show.devices.find((d) => d.id === dg.deviceId);
    const devName = gdev?.name || dg.deviceId;
    const devPx = dg.groups.reduce((m, g) => m + g.items.reduce((s, it) => s + (it.f.pixelCount || 0), 0), 0);
    const gcap = Number(gdev?.maxPerOutput) || 0;
    const devOver = gcap > 0 && dg.groups.some((g) => g.items.reduce((s, it) => s + (it.f.pixelCount || 0), 0) > gcap);
    const { sec, head, body } = devSection(dg.deviceId, devName, [`${devPx}px${devOver ? ' ⚠' : ''}`],
      (e) => selectDevice(dg.deviceId, e));   // click the header → edit the controller (popover)
    // Online/offline/checking dot (same machinery as the old Devices list): the panel
    // caches each controller's last health check; renderOutput just paints it. Art-Net
    // nodes have no WLED API (no dot state to poll); a device with no IP reads "no IP".
    if (gdev) {
      const st = panel.deviceState?.(gdev.id);
      const dotState = gdev.protocol === 'artnet' ? 'artnet'
        : !gdev.ip ? 'noip'
        : (panel.isPinging?.(gdev.id) || !st) ? 'check'
        : st.ok ? 'online' : 'offline';
      const dotTitle = { online: 'online', offline: 'offline', check: 'checking…', noip: 'no IP set', artnet: 'Art-Net node' }[dotState];
      // Dot sits before the title (the old .insp-tri anchor is gone — headers no
      // longer fold, so anchoring after the triangle silently dropped the dot).
      head.prepend(oel('i', { className: `dev-dot dev-${dotState}`, title: dotTitle }));
    }
    // Controller identity colour swatch, just before the title (assigned in
    // syncDeviceTypes / editable in the device editor; Tint mode uses the same colour).
    if (gdev?.color) {
      const sw = oel('i', { className: 'dev-swatch', title: 'controller colour' });
      sw.style.background = gdev.color;
      head.insertBefore(sw, head.querySelector('.insp-sec-title'));
    }
    if (devOver) head.querySelector('.fx-badge')?.classList.add('out-over');
    if (selectedDeviceId === dg.deviceId && !selectedFixtureIds.size) head.classList.add('is-sel');
    // The WHOLE section (header + its fixture rows) is the drop target — dropping
    // anywhere on a controller group assigns there; the 24px header alone was too
    // small a target to hit while dragging.
    dropZone(sec, dg.deviceId, null);
    // Fixtures as flat rows; a multi-output controller tags each row with its output.
    const multiOut = dg.groups.length > 1;
    for (const g of dg.groups) for (const { f, i } of g.items) body.append(fixtureRow(f, i, multiOut ? `out ${g.port}` : null, gdev?.color));
    outputListEl.append(sec);
  }

  if (selectedFixtureIds.size > 1) outputListEl.append(chainSelectedAction());
  // SCAN button sits UNDER the list (with Unassigned), connected to its results below.
  // Shows "Scanning…" + disabled while running so you can't double-scan; disabled when
  // the daemon isn't up. The list re-renders during a scan, so this reflects live state.
  const scanning = !!panel.scanning?.();
  const daemonUp = !!bridge?.connected?.();
  // Probe each WLED controller's status ONCE (one-shot per id) so the dots above
  // reflect real online/offline — only when a daemon is up (no daemon → no network).
  // Each resolved ping re-renders this list to repaint its dot. The Inventory popout
  // never reaches here, so it never pings.
  if (daemonUp) panel.pingDevices?.(show.devices, renderOutput);
  outputListEl.append(oel('button', {
    className: 'fx-add', textContent: scanning ? 'Scanning…' : '⌖ scan',
    title: daemonUp ? 'scan the network for WLED + Art-Net controllers' : 'start the daemon (npm start) to scan',
    disabled: scanning || !daemonUp,
    onclick: () => panel.runScan?.(renderOutput),
  }));
  const scanRes = panel.scanResultsEl?.(); if (scanRes) outputListEl.append(scanRes);
}

const renderOutputList = renderOutput; // back-compat alias

// This is an app surface, not a document — by default suppress the OS right-click menu
// everywhere EXCEPT editable text fields (where copy/paste is wanted), and sliders keep
// their right-click-to-reset. A Settings toggle ("native right-click") disables all of
// that so a normal browser context menu is available — modules read body.native-ctx.
let nativeCtxMenu = (() => { try { return localStorage.getItem('lz.ctxmenu') !== '0'; } catch { return true; } })();
const nativeCtxOn = () => nativeCtxMenu;
const setNativeCtxMenu = (on) => {
  nativeCtxMenu = !!on;
  document.body.classList.toggle('native-ctx', nativeCtxMenu);
  try { localStorage.setItem('lz.ctxmenu', nativeCtxMenu ? '1' : '0'); } catch { /* private */ }
};
setNativeCtxMenu(nativeCtxMenu);   // reflect on boot
document.addEventListener('contextmenu', (e) => {
  if (nativeCtxMenu) return;   // user opted into the browser's native menu everywhere
  if (e.target.closest?.('input:not([type=range]), textarea, [contenteditable]')) return;
  e.preventDefault();
});

// --- Workspace layout: there are NO top-level tabs. The deck, the Clip/Layer/
//     Composition inspector, and the Output/Fixtures column are all visible at
//     once. The fixture overlay (draggable rectangles on the canvas) is a
//     separate toggle, decoupled from any tab. ---
let overlayVisible = false;   // are the fixture rectangles shown over the composite?
const overlayToggleBtn = document.getElementById('overlay-toggle');
const ovlSvg = document.getElementById('ovl');
// The "fixtures" toggle IS the fixture-editing mode now (no Output section): showing
// the overlay puts the dock in body.output-mode so the canvas catches fixture clicks
// and the deck passes empty cells through.
function setOverlay(v) {
  overlayVisible = !!v;
  document.body.classList.toggle('output-mode', overlayVisible);
  if (previewCanvas) previewCanvas.style.display = overlayVisible ? '' : 'none';
  if (ovlSvg) ovlSvg.style.display = overlayVisible ? '' : 'none';   // hide the SVG chrome too
  dragHandle?.setEnabled(overlayVisible);
  overlayToggleBtn?.classList.toggle('on', overlayVisible);
  // Eye open when fixtures are shown, eye-off when hidden.
  overlayToggleBtn?.querySelector('use')?.setAttribute('href', overlayVisible ? '#ic-eye' : '#ic-eye-off');
  if (snapBtn) snapBtn.disabled = !overlayVisible;   // snap only matters while dragging fixtures (overlay on)
  if (overlayVisible) renderOutput();
  redrawOverlay();
}
overlayToggleBtn?.addEventListener('click', () => setOverlay(!overlayVisible));

// --- Live view (corner "▣ live"): the composite dims to a ghost and the fixture
// cells glow at full strength — where the visuals cross a tube, its pixels light
// up; everywhere else stays dark context. CSS only: the sampler reads the GL
// canvas regardless, so output is unaffected. Forces the overlay on (the cells
// ARE this view); the SVG chrome drops via CSS so it reads as the wall, not the
// editor.
let wallView = false;
try { wallView = localStorage.getItem('lz.wall') === '1'; } catch { /* ignore */ }
const wallBtn = document.getElementById('wall-btn');
// Live (wall) view dims the stage so the FIXTURES show the visuals lighting up.
// With no fixtures placed there's nothing to light, so dimming would just hide the
// composite — gate the dim on having fixtures (CSS keys off body.has-fixtures).
function syncWallDim() {
  document.body.classList.toggle('has-fixtures', (show.fixtures || []).length > 0);
}
function setWallView(v) {
  wallView = !!v;
  try { localStorage.setItem('lz.wall', wallView ? '1' : '0'); } catch { /* ignore */ }
  if (wallView && !overlayVisible) setOverlay(true);
  document.body.classList.toggle('wall-view', wallView);
  syncWallDim();
  preview?.setLiveView?.(wallView);   // all fixture cells full strength in live
  if (wallBtn) wallBtn.classList.toggle('on', wallView);
  redrawOverlay();
}
wallBtn?.addEventListener('click', () => setWallView(!wallView));

setWallView(wallView);

// --- 3D mode (corner cube): view the rig in 3D through an orbit camera. -------
// Phase 2 is a VIEWPORT: the projection camera stays FLAT, so the SAMPLED OUTPUT
// (what the LEDs get) is IDENTICAL in both modes — 3D mode currently views the
// rig in 3D; the OUTPUT samples through the chosen PROJECTION preset (below) —
// "Flat (2D)" by default, so entering 3D changes nothing until you pick a
// camera. The mode lives in composition.view3d (persisted with the show; flips
// are undoable). The orbit az/el/dist is view-only state — orbit drags save
// WITHOUT entering undo history (like zoom/pan, it's not an edit).
const mode3dBtn = document.getElementById('mode3d-btn');
const is3D = () => show.composition?.view3d?.mode === '3d';
// Reflect the CURRENT show's mode on the button + overlay (also called after
// undo/redo/open, where the mode may change without a click).
function syncMode3d() {
  mode3dBtn?.classList.toggle('on', is3D());
  // body.mode-3d dims the flat composite behind the 3D scene (ui.css) — the
  // image drawn flat would be spatially wrong under an angled viewport. It also
  // reveals the PROJECTION preset row in the stage corner.
  document.body.classList.toggle('mode-3d', is3D());
  // The 3D scene draws ON the fixture overlay, and ALL viewport gestures (orbit/
  // pan/select) run through its pointer handlers — so 3D REQUIRES the overlay.
  // Enforced HERE (the one place mode is reflected) so it also covers loading a
  // show persisted in 3D and undo/redo across the mode flip; without this the
  // viewport loaded dead: no scene, no orbit, just the flat composite. The EDIT
  // toggle is disabled in 3D for the same reason (hiding the overlay = hiding
  // the viewport).
  if (is3D() && !overlayVisible) setOverlay(true);
  if (overlayToggleBtn) {
    overlayToggleBtn.disabled = is3D();
    overlayToggleBtn.title = is3D() ? 'fixture overlay is always on in 3D (it is the 3D viewport)' : 'Edit fixtures (show the fixture overlay)';
  }
  syncProjRow();
  redrawOverlay();
}
function toggleMode3d() {
  snapshotForUndo(show);              // a mode flip is an undoable edit
  show = toggleView3d(show);
  saveShow(show);
  syncMode3d();                       // enforces the overlay in 3D (see above)
}
mode3dBtn?.addEventListener('click', toggleMode3d);

// --- PROJECTION presets (Phase 5): in 3D the OUTPUT samples through
// view3d.projectionCamera. "Flat (2D)" keeps the 2D mapping exactly; "Front"
// (ortho) is identity at z=0 but resamples lifted geometry by 3D arc length;
// "Front wide" adds real perspective foreshortening. Changing it REBUILDS the
// sampler (the UVs change) and is undoable + persisted like any edit. The
// camera renders as a frustum gizmo in the viewport (preview.js). Presets only
// in v1 — free camera placement (dragging the gizmo) is future work.
const projRow = document.getElementById('proj-row');
function syncProjRow() {
  if (!projRow) return;
  const cam = show.composition?.view3d?.projectionCamera;
  const cur = cam?.preset ?? (!cam || cam.mode === 'flat' ? 'flat' : null);
  projRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.preset === cur));
}
if (projRow) {
  projRow.append(oel('span', { className: 'proj-cap', textContent: 'Projection' }));
  const tips = {
    flat: 'sample flat (exactly the 2D mapping — depth ignored)',
    front: 'orthographic front camera: flat fixtures unchanged; lifted shapes resample by their true 3D length',
    frontwide: 'wide perspective front camera: real foreshortening — lifted shapes compress toward the centre',
  };
  for (const pr of PROJECTION_PRESETS) {
    const b = oel('button', { className: 'dir-btn', textContent: pr.label, title: tips[pr.id] || pr.label,
      onclick: () => {
        const next = setProjectionPreset(show, pr.id);
        if (next === show) return;
        saveShow(next); rebuild(next);            // rebuild snapshots undo + rebuilds the sampler (UVs change)
        renderOutput(); redrawOverlay(); syncProjRow();
      } });
    b.dataset.preset = pr.id;
    projRow.append(b);
  }
}
syncMode3d();   // reflect a persisted 3D mode (and its projection preset) on load

// (Canvas fit: the composite always fits the window as the BASE view — letterboxed
// to its aspect, never cropped (CSS) — then you zoom/pan freely on top. The ⤢ pill
// resets back to that fitted view. No fit-mode toggle.)

// Blackout: a live-performance master that holds ALL output dark (sends zeros) while
// the preview keeps playing, so you can cue without lighting the wall. Off by default.
// (Blackout state + setBlackout are declared above the layer panel — see there.
//  Toggled from the composition-group "B"; the corner button was removed.)

// (Play/transport UI and the keyboard cheat-sheet were removed — not needed.)


// (The three top-level sections are Design · Output · System — see setSection.
//  Project file actions live in the corner File menu.)

const typingIn = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

// Deselect: clear the fixture selection on Escape, or on a click in empty space —
// the canvas gap / checkerboard letterbox / page chrome. The canvas itself keeps
// its own click logic (empty → clear, a fixture → select), and panel clicks are
// left alone, so those regions are excluded.
function clearFixtureSelection() {
  if (!selectedFixtureIds.size) return false;
  selectedFixtureIds.clear(); renderOutput(); redrawOverlay(); updateInspector(); return true;   // also disables Align + hides the dock
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || typingIn(e.target)) return;
  if (clearFixtureSelection()) e.preventDefault();
});
document.addEventListener('pointerdown', (e) => {
  if (!selectedFixtureIds.size) return;
  // #menu-pop is a body-level popover (File/Align menus); acting in it must NOT
  // clear the selection the action operates on.
  // #stagewrap (the whole stage incl. the pasteboard margin) is the drag surface
  // now — it does its own empty-click clear via the marquee, and must NOT be
  // double-cleared here or it would wipe a just-made off-canvas selection.
  // #grp-patch (the patch panel holding + Fixture / + Device + the device/fixture
  // list) owns its own selection logic — a click inside it must NOT trigger the
  // global clear, or a real first click on + Fixture would clear the selection and
  // re-render the button out from under the gesture (needing a second click).
  // #device-pop is the floating fixture editor — its controls (e.g. the multi-select
  // Output/Device dropdowns) EDIT the current selection, so pressing them must NOT
  // clear it (that collapsed a multi-selection to single-fixture mode).
  if (e.target.closest?.('#stagewrap, #side, #side-2, #deckbar, #corner-controls, #show-ui, #menu-pop, #grp-patch, #device-pop')) return;
  clearFixtureSelection();
});

// Cmd/Ctrl+Z = undo · Cmd/Ctrl+Shift+Z = redo. Ignored while typing in a field
// (so the input does its own native text undo).
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  if (typingIn(e.target)) return;
  e.preventDefault();
  if (e.shiftKey) redo(); else undo();
});

// Show/hide all GUI to view the canvas full-screen — via the 'h' key OR the
// top-bar "hide UI" button (a "show UI" pill appears while hidden, so there's
// always a way back). Tab is intentionally NOT bound (too easy to hit).
let resetView = null;   // set by the zoom IIFE; used by the top menu's View › Reset zoom
let reflowView = null;  // set by the zoom IIFE; re-clamps the view when the canvas cell resizes
// One button in the corner toggles the whole UI; it stays put (the cluster keeps
// this button visible while hidden) and just relabels hide ⇄ show.
const toggleGui = () => {
  document.body.classList.toggle('gui-hidden');
  updateStageInsets();   // hiding the UI frees the canvas to span the full window
};
document.addEventListener('keydown', (e) => {
  if (e.key !== 'h' && e.key !== 'H') return;
  if (typingIn(e.target)) return;
  toggleGui();
});
// The only chrome left while hidden: a small "Show UI" pill (always visible in
// gui-hidden via CSS) so H is never a one-way trapdoor.
document.getElementById('show-ui-pill')?.addEventListener('click', toggleGui);

// --- Panic (K) hotkey, with a corner HUD so the operator always knows the live state.
//     (The master dimmer is the deck's master-row opacity fader.) ---
const outHud = (() => { const d = document.createElement('div'); d.id = 'out-hud'; d.hidden = true; document.body.appendChild(d); return d; })();
function updateOutHud() {
  outHud.textContent = panicOn ? 'PANIC' : ''; outHud.hidden = !panicOn;
  outHud.classList.toggle('is-panic', panicOn);
}
function setPanic(v) { panicOn = !!v; updateOutHud(); }
document.addEventListener('keydown', (e) => {
  if (typingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'k' || e.key === 'K') setPanic(!panicOn);
});

// --- LOCK / performance mode: the show keeps running + outputting, but ALL editing is
//     inert until you unlock. The render/output loop is independent of the UI, so locking
//     only blocks interaction (pointer-events via body.is-locked + a keyboard gate). ---
let locked = false;
try { locked = localStorage.getItem('lz.locked') === '1'; } catch { /* private mode */ }
function setLocked(on) {
  locked = !!on;
  document.body.classList.toggle('is-locked', locked);
  if (locked) document.activeElement?.blur?.();   // drop focus from any field being edited
  try { localStorage.setItem('lz.locked', locked ? '1' : '0'); } catch { /* private */ }
  const btn = document.getElementById('menu-lock');
  if (btn) {
    btn.classList.toggle('is-on', locked);
    btn.setAttribute('aria-pressed', String(locked));
    btn.title = locked ? 'Locked — click to unlock editing  (L)' : 'Lock editing (performance mode)  (L)';
    btn.querySelector('use')?.setAttribute('href', locked ? '#ic-lock' : '#ic-lock-open');
  }
}
document.getElementById('menu-lock')?.addEventListener('click', () => setLocked(!locked));
// Capture-phase gate: while locked, swallow every key EXCEPT the safelist (freeze/panic,
// the L toggle to unlock, Escape, ?) before the app's own keydown handlers can act on it.
document.addEventListener('keydown', (e) => {
  if (!locked) return;   // block even a field that's somehow focused — fully locked
  const k = e.key.toLowerCase();
  const allow = k === 'k' || k === 'l' || e.key === 'Escape';
  if (!allow) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
// L toggles the lock (allowed through the gate so it can unlock).
document.addEventListener('keydown', (e) => {
  if ((e.key === 'l' || e.key === 'L') && !typingIn(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) setLocked(!locked);
});
setLocked(locked);   // apply persisted state on boot

// Surface a dock group: scroll it into view + a brief accent flash on it (used when a
// clip/layer/fixture is selected so the relevant group draws the eye). Replaces the
// old "jump to that tab" behaviour now that every group is always visible.
function focusGroup(id) {
  const g = document.getElementById(id); if (!g) return;
  g.scrollIntoView({ block: 'nearest' });
  g.classList.add('grp-flash');
  setTimeout(() => g.classList.remove('grp-flash'), 500);
}

// LAYOUT — ONE system for the view presets (seg) AND the per-panel hide toggles, so
// they never disagree. Panel VISIBILITY is the single source of truth (a Set of
// hide-* flags); presets just set that Set (+ an optional style class). The panel
// toggles' `.on` glyphs and the active preset highlight are always derived from it,
// so a toggle can never lie about whether a panel is shown.
(function setupLayout() {
  const KEY = 'lz.view', HKEY = 'lz.hide';
  const seg = document.getElementById('view-seg');
  // [button id, body class] for the three hideable panels.
  const PANELS = [['panel-left', 'hide-left'], ['panel-right', 'hide-right'], ['panel-bottom', 'hide-timeline']];
  // Presets: which panels they hide + an optional style class. canvas/split are pure
  // visibility (so a matching toggle state re-highlights them); edit/overlay add style.
  const PRESETS = {
    canvas: { hide: ['hide-left', 'hide-right'], style: null },
    split: { hide: [], style: null },
    edit: { hide: [], style: 'view-edit' },
    overlay: { hide: [], style: 'view-overlay' },
  };
  let hidden, cur;
  try { const h = JSON.parse(localStorage.getItem(HKEY) || 'null'); hidden = new Set(Array.isArray(h) ? h : []); } catch { hidden = new Set(); }
  try { const v = localStorage.getItem(KEY); cur = (v && PRESETS[v]) ? v : ''; } catch { cur = ''; }
  if (!localStorage.getItem(HKEY) && !cur) cur = 'split';   // first run

  const persist = () => { try { localStorage.setItem(KEY, cur); localStorage.setItem(HKEY, JSON.stringify([...hidden])); } catch { /* private */ } };
  // If the current visibility matches a pure-visibility preset, highlight it; else custom.
  const matchPreset = () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      if (p.style) continue;
      if (p.hide.length === hidden.size && p.hide.every((c) => hidden.has(c))) return id;
    }
    return '';
  };
  const sync = () => {
    for (const [, cls] of PANELS) document.body.classList.toggle(cls, hidden.has(cls));
    document.body.classList.remove('view-edit', 'view-overlay');
    if (cur && PRESETS[cur]?.style) document.body.classList.add(PRESETS[cur].style);
    for (const [btnId, cls] of PANELS) document.getElementById(btnId)?.classList.toggle('on', !hidden.has(cls));
    if (seg) for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === cur);
    updateStageInsets();
  };
  seg?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]'); const p = b && PRESETS[b.dataset.view];
    if (!p) return;
    cur = b.dataset.view; hidden = new Set(p.hide); persist(); sync();
  });
  for (const [btnId, cls] of PANELS) {
    document.getElementById(btnId)?.addEventListener('click', () => {
      if (hidden.has(cls)) hidden.delete(cls); else hidden.add(cls);
      cur = matchPreset(); persist(); sync();   // toggling drops style presets to "custom"
    });
  }
  sync();
})();

// The one resize affordance: a "curtain" on the Timeline's top edge to trade height
// with the Canvas above it. Persisted; the canvas re-fits live. (Everything else
// relies on default sizes + the view presets.)
// (The Canvas/Timeline curtain is retired — the timeline now floats bottom-left over
//  the canvas and sizes to its content via CSS, so there's no shared height to drag.)

// The Patch island is Devices-only now (the Inventory tab moved to a popout, Txx).
// Force the fixtures view so any stale persisted 'library' tab can't leave the patch
// list hidden. setOutputTab still drives which editor the Device group shows.
setOutputTab('fixtures');

// Delete key removes the current selection: the active clip on Composition, or
// the selected fixture on Output/Fixtures. Ignored while typing in a field.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const t = e.target;
  if (typingIn(t)) return;
  // No fixture selected: an Inventory model or a device may be the delete target —
  // let the fixtures panel decide (it checks its own last-clicked selection and
  // returns false if nothing deletable, so we fall through to the composition).
  if (!selectedFixtureIds.size && (outputTab === 'library' || selectedDeviceId)) {
    if (panel.deleteSelected?.()) { selectedDeviceId = null; renderOutput(); redrawOverlay(); e.preventDefault(); return; }
  }
  // A SELECTED FIXTURE is the signal to delete fixtures (regardless of the overlay
  // toggle — gating on it caused a silent no-op / accidental clip-delete). With no
  // fixture selected, Delete acts on the composition (effect → layer → clip).
  if (selectedFixtureIds.size) {
    e.preventDefault();
    if (!confirmDeleteFixtures([...selectedFixtureIds])) return;
    const n = structuredClone(show); n.fixtures = n.fixtures.filter((x) => !selectedFixtureIds.has(x.id));
    selectedFixtureIds.clear(); rebuild(n); panel.refresh(); renderOutput();
  } else {
    // Delete priority: a selected effect, else a selected layer, else the clip.
    // (Clicking a layer clears the clip selection, so a layer is the delete
    // target only when no clip is selected.)
    if (!layerPanel.deleteSelectedEffect?.() && !layerPanel.deleteSelectedLayer?.()) layerPanel.deleteActiveClip();
    e.preventDefault();
  }
});

// ⌘D / Ctrl-D on the Inventory (Library) tab duplicates the selected controller
// model or fixture definition as an independent copy. Never while typing in a field.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'd' || e.altKey || e.shiftKey) return;
  if (typingIn(e.target)) return;
  if (outputTab === 'library') {
    e.preventDefault();
    if (panel.duplicateSelected?.()) { renderOutput(); redrawOverlay(); }
  }
});

// ⌘A / Ctrl-A in the Output section selects EVERY fixture (for bulk move /
// chain / delete). Only fires in Output, and never while typing in a field.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return;
  if (typingIn(e.target) || !overlayVisible) return;   // only while editing fixtures
  e.preventDefault();
  selectedFixtureIds = new Set((show.fixtures || []).map((f) => f.id));
  renderOutput(); redrawOverlay();
});

// Arrow-key nudge: move the selected fixture(s) by 1px (10px with Shift). Same
// commit path as a canvas drag. Only while the fixture overlay is up (mapping
// mode) with a selection; ignored while typing in a field.
document.addEventListener('keydown', (e) => {
  if (!selectedFixtureIds.size) return;   // act on selection, not the overlay toggle
  if (typingIn(e.target)) return;
  if (!overlayVisible && /^Arrow/.test(e.key)) setOverlay(true);   // reveal so the nudge is visible
  const step = e.shiftKey ? 10 : 1;
  let dx = 0; let dy = 0;
  if (e.key === 'ArrowLeft') dx = -step;
  else if (e.key === 'ArrowRight') dx = step;
  else if (e.key === 'ArrowUp') dy = -step;
  else if (e.key === 'ArrowDown') dy = step;
  else return;
  e.preventDefault();
  let next = show;
  for (const id of selectedFixtureIds) {
    const f = next.fixtures.find((x) => x.id === id);
    if (!f) continue;
    const tf = f.input.transform || transformFromPoints(f.input.points, next.composition?.canvas);
    next = setFixtureTransform(next, id, { x: tf.x + dx, y: tf.y + dy });
  }
  saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay();
});

// Cmd/Ctrl-C / -V: copy & paste the selected fixture(s) on the Output overlay.
// Paste appends each copy contiguously in its device's address space (so DDP
// indices stay valid), nudges it off the original, and selects the new ones.
// Only active in mapping mode; ignored while typing so it never steals the
// browser's text copy/paste.
// Clone the given fixtures into the show, placed next to their originals, and select
// the copies. Shared by paste (V) and duplicate (D).
function placeFixtureCopies(srcList) {
  if (!srcList?.length) return;
  if (!overlayVisible) setOverlay(true);   // reveal the copies
  const next = structuredClone(show);
  const devEnd = (devId) => next.fixtures
    .filter((x) => (x.output?.deviceId || '') === devId)
    .reduce((m, x) => Math.max(m, (x.output?.pixelOffset || 0) + (x.output?.pixelCount || 0)), 0);
  const newIds = [];
  const placed = [];   // clones of what we just made → the next paste cascades from these
  for (const src of srcList) {
    const copy = structuredClone(src);
    const base = (src.id || 'f').replace(/-copy\d*$/, '');
    let n = 1; do { copy.id = `${base}-copy${n > 1 ? n : ''}`; n++; } while (next.fixtures.some((x) => x.id === copy.id));
    copy.output.pixelOffset = devEnd(copy.output?.deviceId || '');   // contiguous append
    const tf = copy.input?.transform;
    if (tf) {
      // Place the copy NEXT TO the original (no overlap): shift x by the fixture's
      // on-screen bounding WIDTH (run/thickness rotated) + a small gap.
      const rad = (tf.rotation || 0) * Math.PI / 180;
      const th = thicknessOf(copy, next.composition?.canvas || { w: 1280, h: 720 });
      const aabbW = Math.abs(Math.cos(rad)) * (tf.w || 0) + Math.abs(Math.sin(rad)) * th;
      tf.x = (tf.x || 0) + Math.max(aabbW, 12) + 8;
    } else if (Array.isArray(copy.input?.points)) {
      // Nudge a points-canonical copy off its original — z (height) rides along,
      // and a bezier's control moves WITH its ends so the arch stays intact.
      const nudge = (p) => [p[0] + 0.02, p[1] + 0.02, ...(p.length > 2 ? [p[2]] : [])];
      copy.input.points = copy.input.points.map(nudge);
      if (Array.isArray(copy.input.bezier?.c)) copy.input.bezier.c = nudge(copy.input.bezier.c);
    }
    next.fixtures.push(copy);
    newIds.push(copy.id);
    placed.push(structuredClone(copy));
  }
  selectedDeviceId = null; selectedFixtureIds.clear(); newIds.forEach((id) => selectedFixtureIds.add(id));
  saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay();
  return placed;
}
// Clone a controller (its settings, not its fixtures) and select it.
function placeDeviceCopy(srcDev) {
  if (!srcDev) return;
  const next = structuredClone(show);
  let k = next.devices.length + 1, id; do { id = `c${k}`; k++; } while (next.devices.some((d) => d.id === id));
  next.devices.push({ ...structuredClone(srcDev), id, name: copyName(srcDev.name || srcDev.id, (next.devices || []).map((d) => d.name || '')) });
  selectedFixtureIds.clear(); selectedDeviceId = id; panel.setDevice?.(id); expandedDevices.add(id);
  saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay();
}

// Cmd/Ctrl + C copy · V paste · D duplicate — for the selected FIXTURES or the
// selected CONTROLLER. Ignored while typing (so native text copy/paste works).
let clipboard = null;   // { kind:'fixtures', data:[…] } | { kind:'device', data:{…} }
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  if (typingIn(e.target)) return;
  const k = e.key.toLowerCase();
  const dev = selectedDeviceId && (show.devices || []).find((d) => d.id === selectedDeviceId);
  if (k === 'c') {
    if (selectedFixtureIds.size) { clipboard = { kind: 'fixtures', data: show.fixtures.filter((f) => selectedFixtureIds.has(f.id)).map((f) => structuredClone(f)) }; e.preventDefault(); }
    else if (dev) { clipboard = { kind: 'device', data: structuredClone(dev) }; e.preventDefault(); }
  } else if (k === 'v') {
    if (!clipboard) return;
    e.preventDefault();
    if (clipboard.kind === 'fixtures') {
      // Cascade: each paste lands next to the LAST paste, not the original — so
      // repeated Cmd-V steps across the canvas instead of stacking in one spot.
      const placed = placeFixtureCopies(clipboard.data);
      if (placed?.length) clipboard.data = placed;
    } else placeDeviceCopy(clipboard.data);
  } else if (k === 'd') {
    if (selectedFixtureIds.size) { e.preventDefault(); placeFixtureCopies(show.fixtures.filter((f) => selectedFixtureIds.has(f.id))); }
    else if (dev) { e.preventDefault(); placeDeviceCopy(dev); }
  }
});

// --- Stage zoom (scroll-wheel, zoom-to-cursor) + pan. A CSS transform on
// #stageinner scales BOTH the WebGL stage and the #preview overlay together;
// because preview.js maps pointer coords via getBoundingClientRect(), dragging
// and hit-testing stay correct at any zoom with no extra math.
//
// The camera references the VIEWPORT (#stagewrap — the bounded flex cell between
// the deck and the inspector), NOT the whole window, so the clamp agrees with what
// you see. The
// transformOrigin is the layout top-left (0 0), so the untransformed top-left maps
// to (bx+panX, by+panY) and the scaled box is W·z × H·z. ---
(() => {
  const inner = document.getElementById('stageinner');
  const wrap = document.getElementById('stagewrap');
  if (!inner || !wrap) return;
  // The view ALWAYS starts at 100% / centred on (re)load — it isn't persisted, so
  // a reload is a clean slate (Jonas). Zoom/pan live only for the session.
  let z = 1, panX = 0, panY = 0;
  const clamp = (v) => Math.max(0.25, Math.min(10, v));
  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // The untransformed layout box of the canvas, in screen coords: offsetWidth/Height
  // ignore the transform (true layout size), and #stageinner is flex-centred in the
  // bounded #stagewrap cell, so its top-left is the wrap centre minus half the box.
  const frame = () => {
    const W = inner.offsetWidth, H = inner.offsetHeight;
    const wr = wrap.getBoundingClientRect();
    return { W, H, vx: wr.left, vy: wr.top, vw: wr.width, vh: wr.height,
      bx: wr.left + (wr.width - W) / 2, by: wr.top + (wr.height - H) / 2 };
  };
  // Pan clamp, viewport-relative + corner-friendly:
  //  • content ≤ viewport on an axis → keep it fully inside (slidable; no drift at
  //    exact fit, where the range collapses to centred).
  //  • content > viewport → allow overpan until any content point can reach the
  //    viewport CENTRE (so any corner can be brought in and inspected), but not so
  //    far that the canvas is flung away.
  const clampPan = () => {
    const f = frame();
    const axis = (pan, base, content, vStart, vSize) => {
      let lo, hi;
      if (content <= vSize) { lo = vStart - base; hi = vStart + vSize - content - base; }
      // Zoomed in: pan freely until only a sliver (`keep`) of the composite is left
      // in view — so ANY corner or edge can be pushed all the way to the viewport
      // corner/edge for full inspection, while the canvas can never be lost entirely.
      else { const keep = 48; lo = vStart + keep - base - content; hi = vStart + vSize - keep - base; }
      return lo > hi ? (lo + hi) / 2 : clampNum(pan, lo, hi);
    };
    panX = axis(panX, f.bx, f.W * z, f.vx, f.vw);
    panY = axis(panY, f.by, f.H * z, f.vy, f.vh);
  };
  // A reset/zoom-% pill in the corner cluster — appears only when zoomed/panned.
  const resetBtn = document.createElement('button');
  resetBtn.className = 'g-btn'; resetBtn.title = 'reset view (0)'; resetBtn.textContent = '⤢ 100%';
  // Append the zoom pill to the TOP (toggles) row, after rec.
  document.getElementById('corner-toggles')?.appendChild(resetBtn);
  const apply = () => {
    clampPan();
    inner.style.transformOrigin = '0 0';
    inner.style.transform = `translate(${panX}px,${panY}px) scale(${z})`;
    preview?.setRenderScale?.(z); redrawOverlay();      // re-render overlay crisp at the new zoom
    // Always-visible zoom readout (click to reset); 'on' accent only when zoomed/panned.
    const idle = z === 1 && panX === 0 && panY === 0;
    resetBtn.classList.toggle('on', !idle); resetBtn.textContent = `⤢ ${Math.round(z * 100)}%`;
  };
  apply();   // 100% / centred on startup
  const reset = () => { z = 1; panX = 0; panY = 0; apply(); };
  resetView = reset;          // expose to the top menu (View › Reset zoom)
  // When the viewport changes (sidebars open/close, section/tab switch, resize) the
  // base box recentres — re-clamp the existing pan/zoom against the new frame so the
  // view stays valid without resetting it.
  reflowView = () => { apply(); };
  resetBtn.onclick = reset;
  // Wheel-zoom / Shift-pan work ANYWHERE over the canvas — bound to the window so
  // they fire over the pasteboard and even when the (transformed) canvas has been
  // panned out from under the cursor. Skipped over the scrollable chrome so the
  // sidebar / deck / menus still scroll normally.
  const overChrome = (t) => t?.closest?.('#side, #deckbar, #corner-controls, #menu-pop, .pick-pop, #device-pop');
  // Wheel-zoom/pan ONLY when the cursor is over the canvas/pasteboard (#stagewrap).
  // Everywhere else (the device list, docks, popouts, menus) the wheel scrolls that
  // panel natively — so the Devices list etc. scroll normally.
  const overStage = (t) => !!t?.closest?.('#stagewrap');
  window.addEventListener('wheel', (e) => {
    if (!overStage(e.target)) return;                        // not over the canvas → let the panel scroll
    e.preventDefault();
    // Shift = pan instead of zoom — both axes (deltaX from a trackpad; a plain mouse
    // wheel only has deltaY, which pans vertically).
    if (e.shiftKey) { panX -= e.deltaX; panY -= e.deltaY; apply(); return; }
    // 3D mode: the wheel DOLLIES the orbit camera instead of CSS-zooming the
    // stage (the scene has real depth now). View-only — saved debounced, no undo.
    if (is3D() && overlayVisible) {
      const v3 = show.composition.view3d;
      const clampD = (v) => Math.max(ORBIT_DIST_MIN, Math.min(ORBIT_DIST_MAX, v));
      const d0 = clampD(Number(v3.orbit?.dist) || 1.6);
      const dist = clampD(d0 * Math.exp(e.deltaY * 0.0015));
      if (dist === d0) return;
      show = { ...show, composition: { ...show.composition, view3d: { ...v3, orbit: { ...v3.orbit, dist } } } };
      saveShowSoon(); redrawOverlay();
      return;
    }
    const z2 = clamp(z * Math.exp(-e.deltaY * 0.0015));
    if (z2 === z) return;
    const rect = inner.getBoundingClientRect();
    const lx = (e.clientX - rect.left) / z, ly = (e.clientY - rect.top) / z;   // content point under cursor
    panX = (e.clientX - lx * z2) - (rect.left - panX);
    panY = (e.clientY - ly * z2) - (rect.top - panY);
    z = z2; apply();
  }, { passive: false });

  // --- HAND pan: MIDDLE-mouse drag, OR hold SPACE and left-drag (the universal
  //     convention — works on a trackpad with no middle button). Anywhere over the
  //     canvas/pasteboard; skips the panels so they still scroll/click normally. ---
  let panDrag = null, spaceDown = false;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || typingIn(e.target)) return;
    if (!spaceDown) { spaceDown = true; if (!panDrag) document.body.style.cursor = 'grab'; }
    e.preventDefault();                                  // don't page-scroll on space
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    spaceDown = false; if (!panDrag) document.body.style.cursor = '';
  });
  window.addEventListener('pointerdown', (e) => {
    const panBtn = e.button === 1 || (e.button === 0 && spaceDown);   // middle, or Space+left
    if (!panBtn || overChrome(e.target)) return;
    e.preventDefault(); e.stopPropagation();             // capture phase: keep it from the selection/marquee handlers
    panDrag = { x: e.clientX, y: e.clientY };
    document.body.style.cursor = 'grabbing';
  }, { capture: true });
  window.addEventListener('pointermove', (e) => {
    if (!panDrag) return;
    panX += e.clientX - panDrag.x; panY += e.clientY - panDrag.y;
    panDrag.x = e.clientX; panDrag.y = e.clientY; apply();
  });
  const endPan = () => { if (!panDrag) return; panDrag = null; document.body.style.cursor = spaceDown ? 'grab' : ''; };
  window.addEventListener('pointerup', endPan);
  window.addEventListener('pointercancel', endPan);
})();

// Left-column tabs: Composition | Layer | Clip (one pane shown at a time).
// (Settings moved to a floating overlay panel off the top-left gear — see
// openSettingsPop; a stored 'settings' itab from older builds falls back here.)
function setInspectorTab(which) {
  const panes = { composition: 'insp-composition', layer: 'insp-layer', clip: 'insp-clip' };
  if (!panes[which]) which = 'composition';
  for (const [k, id] of Object.entries(panes)) { const el = document.getElementById(id); if (el) el.hidden = k !== which; }
  const tabs = document.getElementById('props-tabs');
  if (tabs) for (const b of tabs.querySelectorAll('.island-tab')) b.classList.toggle('is-on', b.dataset.itab === which);
  try { localStorage.setItem('lz.itab', which); } catch { /* private */ }
}
document.getElementById('props-tabs')?.addEventListener('click', (e) => { const b = e.target.closest('.island-tab'); if (b) setInspectorTab(b.dataset.itab); });
// (Scan is a button under the Unassigned heading in the Devices list — see renderOutput.)

// Tracks which editor the Device group reflects: 'fixtures' (Devices = placement list +
// controllers) vs 'library' (an Inventory model, set when the LEDger importer is open).
// The Inventory tab itself moved to a popout (Txx), so the main window has no tab bar —
// this only persists the focus + re-renders the Devices list.
function setOutputTab(which) {
  outputTab = which === 'library' ? 'library' : 'fixtures';
  try { localStorage.setItem('lz.otab', outputTab); } catch { /* private */ }
  renderOutput();
}

// Compat shim: there are no top-level sections anymore (everything is docked).
function setSection(which) { if (which === 'output') focusGroup('grp-patch'); }

const systemControlEl = document.getElementById('system-control');
// The Control surface URL. Prefer the daemon's LAN IP (a phone can't use localhost);
// fall back to this page's origin.
let companionUrl = `${location.origin}/control/`;
fetch('/api/info').then((r) => r.json()).then((info) => {
  if (info?.lan) companionUrl = `http://${info.lan}:${info.port}/control/`;
}).catch(() => { /* no daemon — keep the origin-based URL */ });

controlPanel = createControlPanel({
  mount: systemControlEl,
  getShow: () => show,
  showQr: false,   // the editor's Control overlay skips the QR (it lives on the phone surface)
  // Apply a companion command locally (same canonical addresses the phone uses),
  // then reflect it in the panel + on the canvas.
  send: (address, value) => { handleExt(address, value); controlPanel.refresh(); redrawOverlay(); },
  status: () => ({ connected: !!bridge?.connected?.(), url: companionUrl }),
});

// Mapping opens its breakout window; the Control (remote) icon jumps straight to the
// companion control surface in its own window — enabled only while the daemon is up
// (otherwise the button is disabled). No in-app popup.
// Open as a SIZED POPUP WINDOW (the features string makes it a popup, not a tab —
// minimal chrome; truly chromeless in the installed app). The named target reuses
// the same window on repeat clicks; the page is a responsive full route.
const POPUP_FEATURES = 'width=860,height=920';
function openMappingsWindow() { try { return window.open('mappings/', 'lz-mappings', POPUP_FEATURES); } catch { return null; } }
document.getElementById('menu-mapping')?.addEventListener('click', openMappingsWindow);
// Library opens the standalone TEMPLATE-LIBRARY editor in its own popup window
// (returns null if a popup blocker fires). Live type-merge sync runs over
// 'lz-inventory' (below).
function openInventoryWindow() { try { return window.open('inventory/', 'lz-inventory', POPUP_FEATURES); } catch { return null; } }
document.getElementById('menu-inventory')?.addEventListener('click', openInventoryWindow);
document.getElementById('devices-inventory')?.addEventListener('click', openInventoryWindow);   // small inventory icon by the Devices title
document.getElementById('devices-add-fixture')?.addEventListener('click', (e) => openTemplateMenu(e.currentTarget, 'fixture'));
document.getElementById('devices-add-device')?.addEventListener('click', (e) => openTemplateMenu(e.currentTarget, 'device'));
const remoteBtn = document.getElementById('menu-remote');
remoteBtn?.addEventListener('click', () => { if (!remoteBtn.disabled) { try { window.open(companionUrl, 'lz-control'); } catch { /* blocked */ } } });

// Restore the last-used right-column focus (fixtures/inventory) for the editor logic.
outputTab = ((() => { try { return localStorage.getItem('lz.otab'); } catch { return null; } })() === 'library') ? 'library' : 'fixtures';

// --- Accent colour (user-selectable; persisted; live via CSS vars) -----------
const ACCENT_KEY = 'lz.accent';
const ACCENT_DEFAULT = '#e8a35c';
const ACCENT_PRESETS = ['#eceef2', '#e8a35c', '#5cb8e8', '#6ee07d', '#5ce8c8', '#b98cff', '#e85c9e', '#e8d65c', '#ff6b6b'];   // first = near-white / monochrome
const accHexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [232, 163, 92]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const accToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const accMix = (a, b, w) => { const A = accHexToRgb(a), B = accHexToRgb(b); return accToHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };
// --accent cascades (green/amber/cyan + every color-mix(--accent …) follow); the
// soft/line/text variants AND the warm surface ramp are derived from it here, so
// changing the accent re-tints the whole sidebar (its gray surfaces carry a small
// % of the accent → a desaturated tint that follows whatever accent you pick).
function applyAccent(hex) {
  const s = document.documentElement.style;
  s.setProperty('--accent', hex);
  s.setProperty('--accent-soft', accMix(hex, '#0a0a0a', 0.16));
  s.setProperty('--accent-line', accMix(hex, '#0a0a0a', 0.40));
  s.setProperty('--accent-text', accMix(hex, '#ffffff', 0.62));
  // Surface ramp = a neutral dark gray with a SUBTLE touch of the accent. Each gray
  // anchor is first lifted toward white by `lift` (the Settings › Appearance
  // brightness, 0 = base near-black … ~0.2 = noticeably brighter).
  const lift = savedBright() / 100;     // negative = darker than the base anchors
  const tm = savedTint() / 100;         // accent-tint multiplier (Settings › Appearance)
  const L = (anchor) => accMix('#ffffff', anchor, lift);          // lift the gray anchor
  const S = (anchor, w) => accMix(hex, L(anchor), w * tm);        // + tint it by the accent
  s.setProperty('--bg', S('#0b0b0d', 0.03));
  s.setProperty('--field-bg', S('#121214', 0.03));
  const panel = S('#17171a', 0.04);
  s.setProperty('--panel', panel);
  s.setProperty('--panel-solid', panel);
  s.setProperty('--panel-2', S('#1e1e22', 0.05));
  s.setProperty('--hover', S('#2c2c31', 0.06));
  s.setProperty('--line', S('#303034', 0.06));
  s.setProperty('--line-2', S('#45454e', 0.07));
  preview?.setAccentColor?.(hex);   // fixture chrome on the canvas follows the accent
}
const savedAccent = () => { try { return localStorage.getItem(ACCENT_KEY) || ACCENT_DEFAULT; } catch { return ACCENT_DEFAULT; } };
function setAccent(hex) { applyAccent(hex); try { localStorage.setItem(ACCENT_KEY, hex); } catch { /* private */ } redrawOverlay(); broadcastManifest(true); }
// --- Appearance (Settings › Appearance): UI brightness (surface lift, can go negative
// = darker than base), accent tint, text contrast, text size. Persisted; live. ---
const num = (key, def, lo, hi) => { try { const raw = localStorage.getItem(key); const v = Number(raw); return (raw != null && Number.isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : def; } catch { return def; } };
const BRIGHT_KEY = 'lz.brightness';
const savedBright = () => num(BRIGHT_KEY, 0, -12, 20);
function setBrightness(v) { try { localStorage.setItem(BRIGHT_KEY, String(v)); } catch { /* private */ } applyAccent(savedAccent()); redrawOverlay(); }
const TINT_KEY = 'lz.tint.amt';
const savedTint = () => num(TINT_KEY, 100, 0, 220);
function setTint(v) { try { localStorage.setItem(TINT_KEY, String(v)); } catch { /* private */ } applyAccent(savedAccent()); redrawOverlay(); }
const CONTRAST_KEY = 'lz.contrast';
const savedContrast = () => num(CONTRAST_KEY, 130, 60, 130);
function applyContrast() {
  const f = savedContrast() / 100;   // 1 = base; <1 dims text toward bg; >1 brightens
  const s = document.documentElement.style;
  s.setProperty('--text', accMix('#f4f5f7', '#0c0c10', f));
  s.setProperty('--muted', accMix('#a3aab4', '#0c0c10', f));
  s.setProperty('--faint', accMix('#737a84', '#0c0c10', f));
  s.setProperty('--readout', accMix('#d7dbe0', '#0c0c10', f));
}
function setContrast(v) { try { localStorage.setItem(CONTRAST_KEY, String(v)); } catch { /* private */ } applyContrast(); }
const SCALE_KEY = 'lz.uiscale';
const savedScale = () => num(SCALE_KEY, 1, 0.8, 1.4);
function setUiScale(v) { const c = Math.max(0.8, Math.min(1.4, v)); document.documentElement.style.setProperty('--ui-scale', String(c)); try { localStorage.setItem(SCALE_KEY, String(c)); } catch { /* private */ } }
// Translucency of the floating panels (device editor + timeline): 0 = opaque … higher =
// more see-through. Drives --pop-opacity = (100 − translucency)%.
const TRANSLU_KEY = 'lz.translucency';
const savedTranslucency = () => num(TRANSLU_KEY, 0, 0, 90);
function setTranslucency(v) { const c = Math.max(0, Math.min(90, Math.round(v))); document.documentElement.style.setProperty('--pop-opacity', (100 - c) + '%'); try { localStorage.setItem(TRANSLU_KEY, String(c)); } catch { /* private */ } }
setUiScale(savedScale());        // apply text scale on boot
setTranslucency(savedTranslucency());   // apply panel translucency on boot
applyContrast();                // apply text contrast on boot

applyAccent(savedAccent());   // apply the saved accent (+ brightness + tint) on boot

// --- Hover tooltips (native `title`) — ON by default (the icon-heavy chrome needs
// them for discoverability). When toggled OFF in Settings, every `title` is moved to
// `data-tip` (kept moved as the UI re-renders) so no tooltip appears on hover. Either
// way titles read as sentence case. ---
const TIPS_KEY = 'lz.tips';
const tipsOn = () => { try { return localStorage.getItem(TIPS_KEY) !== '0'; } catch { return true; } };
// Stash the title (so no native tooltip shows) BUT keep it as an aria-label so
// icon-ONLY interactive controls still have an accessible name (a11y) when tooltips
// are off. Only icon-only interactive elements get the label — adding aria-label to
// plain spans (prohibited) or to controls that already show their text (name
// mismatch) fails Lighthouse, so we skip those.
// Tooltips read as normal sentence case (capitalise the first letter; acronyms like
// MIDI/OSC are already upper-case mid-string and are left alone).
const sentenceCase = (s) => (s && /^[a-z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const stashTip = (el) => {
  const t = sentenceCase(el.getAttribute('title'));
  if (t == null) return;
  el.dataset.tip = t;
  const interactive = el.matches('button, a[href], input, select, textarea, [role], [tabindex]');
  const iconOnly = !el.textContent.trim();
  if (interactive && iconOnly && !el.getAttribute('aria-label')) el.setAttribute('aria-label', t);
  el.removeAttribute('title');
};
const stripTips = (root) => { if (root.nodeType !== 1) return; if (root.hasAttribute('title')) stashTip(root); root.querySelectorAll?.('[title]').forEach(stashTip); };
const restoreTips = (root) => root.querySelectorAll?.('[data-tip]').forEach((el) => { el.setAttribute('title', el.dataset.tip); delete el.dataset.tip; });
// Tips ON: keep native titles but sentence-case them (idempotent — only writes on change).
const normTitle = (el) => { const t = el.getAttribute('title'); const n = sentenceCase(t); if (n && n !== t) el.setAttribute('title', n); };
const normalizeTitles = (root) => { if (root.nodeType !== 1) return; if (root.hasAttribute('title')) normTitle(root); root.querySelectorAll?.('[title]').forEach(normTitle); };
const tipObserver = new MutationObserver((muts) => {
  const on = tipsOn();
  for (const m of muts) {
    if (m.type === 'attributes' && m.target.nodeType === 1 && m.target.hasAttribute('title')) { on ? normTitle(m.target) : stashTip(m.target); }
    for (const n of m.addedNodes) { on ? normalizeTitles(n) : stripTips(n); }
  }
});
function applyTips() {
  if (tipsOn()) { restoreTips(document.body); normalizeTitles(document.body); }
  else { stripTips(document.body); }
  // One observer, mode-aware: normalises (on) or stashes (off) titles as the UI rebuilds.
  tipObserver.disconnect();
  tipObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
}
function setTips(on) { try { localStorage.setItem(TIPS_KEY, on ? '1' : '0'); } catch { /* private */ } applyTips(); }
applyTips();   // on boot

// The mapping surface lives in its own window (a named target → one reused
// window; the click is the user gesture that satisfies the popup blocker).
// (Mapping is now a tab of the Canvas island — embedded via iframe — so there's no
//  separate-window opener anymore.)

// Settings tab: accent colour + audio input (more preferences can join later).
// Async because the audio device list needs enumerateDevices(); re-run whenever
// the Settings subtab is opened so the device list (and any granted labels) refresh.
async function buildSettings(mount) {
  if (!mount) return;
  mount.textContent = '';

  // --- Audio input (the hardware device for the "Audio External" modulator + gain) ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'audio input' }));
  const inputs = await listInputs();
  const curDev = show.composition?.audioDevice || 'default';
  const sel = oel('select', { title: 'hardware input device for the Audio External modulator' });
  const opt = (value, label, on) => { const o = oel('option', { value, textContent: label }); if (on) o.selected = true; sel.append(o); };
  opt('default', 'System default', curDev === 'default');
  inputs.filter((d) => d.deviceId && d.deviceId !== 'default').forEach((d, i) => opt(d.deviceId, d.label || `Input ${i + 1}`, curDev === d.deviceId));
  sel.addEventListener('change', async () => {
    const ok = await enableAudio('external', sel.value);
    snapshotForUndo(show);   // audio-device pick is undoable
    show = { ...show, composition: { ...show.composition, audioDevice: sel.value } };
    saveShow(show);
    sel.title = ok ? 'hardware input device for the Audio External modulator' : 'could not open that input, check permissions';
  });
  mount.append(oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Input' }), sel]));
  mount.append(Slider('Gain', show.composition?.audioGain ?? 1, {
    min: 0, max: 8, step: 0.05, default: 1, commit: 'live',
    onInput: (v) => { snapshotForUndo(show); show = { ...show, composition: { ...show.composition, audioGain: v } }; saveShowSoon(); },
  }));

  // --- Composition file (visuals only — the whole rig saves with the project, ⌘S) ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'composition file' }));
  mount.append(oel('button', { className: 'fx-add', textContent: 'Save composition…', title: 'export just the visuals (layers / clips / effects), without the rig', onclick: saveCompositionToFile }));
  mount.append(oel('div', { className: 'seg-hint', textContent: 'to load: drag a project or composition .json onto the window' }));

  // --- Snap (fixture placement): the grid step + neighbour-align tolerance. The
  // on/off lives on the viewport corner button (a quick toggle while placing). ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'snap' }));
  mount.append(Slider('Grid', SNAP_GRID, {
    min: 2, max: 100, step: 1, default: 20, commit: 'live',
    onInput: (v) => { SNAP_GRID = Math.round(v); saveSnap(); redrawOverlay(); },
  }));
  mount.append(Slider('Distance', SNAP_DIST, {
    min: 1, max: 40, step: 1, default: 10, commit: 'live',
    onInput: (v) => { SNAP_DIST = Math.round(v); saveSnap(); },
  }));

  // --- Output: global framerate cap sent to the daemon (caps the DDP/Art-Net rate). ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'output' }));
  mount.append(Slider('Max FPS', savedOutFps(), {
    min: 1, max: 60, step: 1, default: 42, commit: 'live',
    onInput: (v) => { const n = Math.max(1, Math.min(60, Math.round(v))); try { localStorage.setItem(OUTFPS_KEY, String(n)); } catch { /* ignore */ } bridge?.setOutputFps?.(n); },
  }));

  // (OSC / socket control lives in the Mapping window now — it shows the canonical
  // addresses, the socket JSON example, and the OSC :9000 endpoint there.)

  // --- Preferences as simple label + checkbox rows (the label IS the instruction). ---
  const toggleRow = (label, get, set) => {
    const cb = oel('input', { type: 'checkbox' }); cb.checked = !!get();
    cb.addEventListener('change', () => set(cb.checked));
    // Checkbox FIRST so the label has the full remaining width (no truncation).
    return oel('label', { className: 'fx-field set-toggle' }, [cb, oel('span', { textContent: label })]);
  };
  mount.append(oel('div', { className: 'fx-pts', textContent: 'preferences' }));
  const riffAlways = () => { try { return localStorage.getItem('lz.riff.always') === '1'; } catch { return false; } };
  mount.append(toggleRow('Play riff on every reload', riffAlways, (v) => { try { localStorage.setItem('lz.riff.always', v ? '1' : '0'); } catch { /* private */ } }));
  mount.append(toggleRow('Confirm before deleting', confirmDeletesOn, (v) => setConfirmDeletes(v)));
  mount.append(toggleRow('Show tooltips on hover', tipsOn, (v) => setTips(v)));
  mount.append(toggleRow('Right-click shows the browser menu', nativeCtxOn, (v) => setNativeCtxMenu(v)));

  // (Recording removed — the show CONFIG file (File › Save/Open) is the portable
  // "recording": it re-runs the show live, interactivity intact. MIDI enable +
  // input lives in the Mapping window.)

  // --- Appearance: brightness / accent tint / contrast / text size (all live). ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'appearance' }));
  mount.append(Slider('Brightness', savedBright(), {
    min: -12, max: 20, step: 1, default: 7, commit: 'live',
    onInput: (v) => setBrightness(Math.round(v)),
  }));
  mount.append(Slider('Accent tint %', savedTint(), {
    min: 0, max: 220, step: 5, default: 100, commit: 'live',
    onInput: (v) => setTint(Math.round(v)),
  }));
  mount.append(Slider('Contrast %', savedContrast(), {
    min: 60, max: 130, step: 2, default: 100, commit: 'live',
    onInput: (v) => setContrast(Math.round(v)),
  }));
  mount.append(Slider('Translucency %', savedTranslucency(), {
    min: 0, max: 90, step: 2, default: 38, commit: 'live',
    onInput: (v) => setTranslucency(v),
  }));
  mount.append(Slider('Text size %', Math.round(savedScale() * 100), {
    min: 80, max: 140, step: 5, default: 100, commit: 'live',
    onInput: (v) => setUiScale(v / 100),
  }));

  // --- Accent colour (least priority → last): preset swatches. ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'accent colour' }));
  const cur = savedAccent();
  const swatches = [];
  const mark = (hex) => swatches.forEach((s) => s.classList.toggle('is-on', s.dataset.hex.toLowerCase() === hex.toLowerCase()));
  const row = oel('div', { className: 'accent-swatches' });
  for (const p of ACCENT_PRESETS) {
    const sw = oel('button', { className: 'accent-swatch', title: p });
    sw.dataset.hex = p; sw.style.background = p;
    sw.onclick = () => { setAccent(p); mark(p); };
    swatches.push(sw); row.append(sw);
  }
  mount.append(row);
  mark(cur);
}

// --- Settings: a floating overlay panel off the top-left gear (NOT a separate
// window — buildSettings is wired to live app state; a cross-window settings page
// would need a sync layer that isn't worth it). Rebuilt on every open (the audio
// device list needs a fresh enumerate); closed by outside-click / Esc (kit). ---
const settingsPop = document.getElementById('settings-pop');
const settingsPopBody = document.getElementById('settings-pop-body');
let settingsDismiss = null;
function closeSettingsPop() {
  if (!settingsPop || settingsPop.hidden) return;
  settingsPop.hidden = true;
  document.getElementById('menu-settings')?.classList.remove('open');
  if (settingsDismiss) { settingsDismiss(); settingsDismiss = null; }
}
function openSettingsPop() {
  if (!settingsPop) return;
  if (!settingsPop.hidden) { closeSettingsPop(); return; }   // gear toggles
  buildSettings(settingsPopBody);
  settingsPop.hidden = false;
  document.getElementById('menu-settings')?.classList.add('open');
  // Park it under the gear (top-left), height-capped; the body scrolls.
  const gear = document.getElementById('menu-settings');
  const r = gear?.getBoundingClientRect();
  settingsPop.style.top = `${Math.round((r?.bottom ?? 34) + 6)}px`;
  settingsPop.style.left = `${Math.round(Math.max(8, r?.left ?? 8))}px`;
  // Outside-click + Esc dismissal, hand-rolled (not the kit's dismissOnOutside):
  // the GEAR must count as "inside", or its capture-phase close would race the
  // button's own click and the gear could never toggle the panel shut.
  const onClick = (ev) => { if (!settingsPop.contains(ev.target) && !ev.target.closest?.('#menu-settings')) closeSettingsPop(); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); closeSettingsPop(); } };
  setTimeout(() => document.addEventListener('click', onClick, true), 0);
  document.addEventListener('keydown', onKey, true);
  settingsDismiss = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  };
}
document.getElementById('menu-settings')?.addEventListener('click', openSettingsPop);

// Restore the persisted left-column tab (Composition/Layer/Clip) across reloads.
setInspectorTab((() => { try { return localStorage.getItem('lz.itab'); } catch { return null; } })() || 'composition');

// Show the fixture overlay by default (you see your rig on load) — this also puts
// the dock in fixture-editing (output) mode via setOverlay.
setOverlay(true);

// --- Video clips: a <video> element + GL texture per video clip (runtime only;
// the show stores only the object URL). syncVideos() reconciles the map with the
// show each frame; uploadVideos() pushes the current frame into each texture.
const videoMap = new Map(); // clipId → { url, el, tex }
function syncVideos() {
  const clips = [];
  for (const L of show.composition?.layers || []) for (const c of L.clips || []) {
    if (c && c.generator === 'video' && c.videoUrl) clips.push(c);
  }
  if (!clips.length && !videoMap.size) return;   // no video clips, nothing mapped → nothing to do
  const live = new Set(clips.map((c) => c.id));
  for (const [id, v] of videoMap) {
    if (!live.has(id)) { unregisterMediaElement(v.el); try { v.el.pause(); } catch { /* ignore */ } gl.deleteTexture(v.tex); videoMap.delete(id); }
  }
  for (const c of clips) {
    const existing = videoMap.get(c.id);
    if (existing && existing.url === c.videoUrl) continue;
    if (existing) { unregisterMediaElement(existing.el); try { existing.el.pause(); } catch { /* ignore */ } gl.deleteTexture(existing.tex); }
    const el = document.createElement('video');
    el.src = c.videoUrl; el.loop = true; el.muted = true; el.playsInline = true; el.autoplay = true;
    el.play().catch(() => { /* will play on first user gesture */ });
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    videoMap.set(c.id, { url: c.videoUrl, el, tex });
    registerMediaElement(el);   // so the 'composition' audio source can analyse it
  }
}
function uploadVideos() {
  if (!videoMap.size) return;
  for (const v of videoMap.values()) {
    if (v.el.readyState >= 2 && v.el.videoWidth) {
      gl.bindTexture(gl.TEXTURE_2D, v.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v.el); } catch { /* not ready */ }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
  }
}
const videoTex = (clip) => videoMap.get(clip.id)?.tex || null;

// Compositor is ready immediately (programs compile lazily on first render).
rebuild(show);

let frames = 0, last = 0;
let lastLive = null;   // daemon-connected state last seen by the loop (to refresh scan availability)
// Cap the heavy pipeline (composite → sample → DDP → preview) to WLED's ~42fps
// ceiling — no point rendering/sending faster than the wall can show. The
// accumulator auto-disables when we're compute-bound (frameDue catches up to ts),
// so it never drops frames we could otherwise have made.
const OUTPUT_FPS = 42, FRAME_INTERVAL = 1000 / OUTPUT_FPS;
let frameDue = 0;
// Reused each frame for the merged audio+external+dashboard signal map (avoids a
// fresh object + spread every frame). Filled via Object.assign in loop().
const frameSignals = {};
// Publish the composition aspect (w/h) as a CSS var so the "fit" canvas mode can
// scale the composite to fill its area (CSS can't read canvas attributes). Updated
// only when it changes — no per-frame style churn.
let lastAspect = 0;
function syncCompAspect() {
  const a = (canvas.width || 16) / (canvas.height || 9);
  if (a !== lastAspect) { lastAspect = a; document.documentElement.style.setProperty('--comp-aspect', String(a)); }
}
syncCompAspect();

// The canvas is a bounded flex CELL (#stagewrap, centre of #layout) — flexbox sizes
// it automatically between the deck, the fixture rail and the inspector, so there's
// no inset maths to do. We only re-clamp the camera once the new layout has settled
// (deferred a frame so the flex cell has its final size) whenever a panel toggles,
// the inspector resizes, the UI hides, or the window changes.
function updateStageInsets() {
  cancelAnimationFrame(insetRaf);
  insetRaf = requestAnimationFrame(() => { reflowView?.(); });
}
window.addEventListener('resize', updateStageInsets);

function loopBody(ts) {
  if (!t0) t0 = ts;
  if (ts < frameDue) return;   // throttle to OUTPUT_FPS (before any work)
  if (glLost) return;          // GPU context gone — skip all gl work until it's restored
  frameDue += FRAME_INTERVAL; if (frameDue < ts) frameDue = ts;  // don't bank a backlog
  syncCompAspect();
  lastTs = ts;
  const t = (ts - t0) / 1000;
  // Action bindings (clip triggers, layer opacity/bypass) driven by MIDI/key/OSC
  // channels — applied each frame, rising-edge for triggers/toggles. Non-undoable,
  // debounced save (like external input).
  const chNow = extChannels();   // external channels — read ONCE per frame (reused below)
  {
    const ab = applyBindings(show, chNow, prevBindCh);
    if (ab.show !== show) { show = ab.show; if (!bindSaveTimer) bindSaveTimer = setTimeout(() => { bindSaveTimer = null; saveShow(show); }, 400); if (ab.fired) layerPanel?.refresh?.(); }
    prevBindCh = { ...chNow };
  }
  syncVideos(); uploadVideos();
  // Always composite + draw to the stage, even with NO fixtures/sampler — the
  // sampling + DDP send below are individually guarded on `sampler`. (Gating the
  // whole block on `sampler` left the stage black until a fixture was placed.)
  {
    // When the transport is playing, derive the active clip from the playhead and
    // render a shallow-cloned layer with that activeClipId (the compositor's
    // crossfade picks up the change). Otherwise render the show's layers as-is.
    let renderLayers = show.composition?.layers || [];
    if (transport.isPlaying() && renderLayers.length) {
      const base = renderLayers[0];
      const clips = base.clips || [];
      // Order the walk by direction: forward, backward (reversed), or a stable
      // per-session shuffle.
      let order = clips;
      if (transport.direction === 'backward') order = [...clips].reverse();
      else if (transport.direction === 'shuffle') {
        if (!transport._shuffle || transport._shuffle.length !== clips.length) {
          const idx = clips.map((_, i) => i);
          for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
          transport._shuffle = idx;
        }
        order = transport._shuffle.map((i) => clips[i]);
      }
      const ph = playheadClip(order, ts - transport.startTs, transport.loop);
      if (ph) {
        renderLayers = [{ ...base, activeClipId: ph.clip.id }, ...renderLayers.slice(1)];
        layerPanel.setPlayhead(clips.findIndex((c) => c && c.id === ph.clip.id));   // real deck index
      }
    }
    // Per-parameter animations run on a free-running clock (Timeline), off the
    // live audio bands (Audio), or off a live OSC/socket channel (External);
    // resolve each layer's + clip's animated params to plain numbers before
    // compositing. No-op (same ref) when nothing is animated. The signals map
    // merges audio + external — the four band names are reserved by audio.
    setAudioGain(show.composition?.audioGain ?? 1);
    Object.assign(frameSignals, updateAudio(), chNow, dashboardSignals(show.composition));
    frameSignals.__bpm = show.composition?.bpm ?? 120;
    const signals = frameSignals;
    renderLayers = renderLayers.map((L) => {
      const lp = resolveParams(L.params, L.anim, t, signals, L.id);
      let clips = L.clips;
      if (clips && clips.some((c) => c && c.anim && Object.keys(c.anim).length)) {
        clips = clips.map((c) => {
          const a = c.anim;
          if (!(a && Object.keys(a).length)) return c;
          const params = resolveParams(c.params, a, t, signals, c.id);
          // Animated TRANSFORM (keys tf.x/tf.y/tf.scale/tf.rotation) + OPACITY (tf.opacity).
          let transform = c.transform, opacity = c.opacity;
          if (a['tf.x'] || a['tf.y'] || a['tf.scale'] || a['tf.rotation']) {
            transform = { ...(c.transform || {}) };
            for (const f of ['x', 'y', 'scale', 'rotation']) if (a['tf.' + f]) transform[f] = animatedValue(a['tf.' + f], t, signals);
          }
          if (a['tf.opacity']) opacity = animatedValue(a['tf.opacity'], t, signals);
          return { ...c, params, transform, opacity };
        });
      }
      return (lp === L.params && clips === L.clips) ? L : { ...L, params: lp, clips };
    });
    // Move the inspector's animated sliders live (selected clip + composition).
    layerPanel.updateLive?.(t, signals);
    // Composite all layers into compositor.tex. (The line generator self-animates
    // in-shader via uT — see manifest.js — so the loop no longer mutates params.)
    // env.trigSec drives triggerable sources (Pulse) via the shader's uTrig.
    // Master mute (deck master-row "B") = composition.bypass → blackout.
    const masterOpacity = show.composition?.bypass ? 0 : (show.composition?.opacity ?? 1);
    // Crossfade is PER-LAYER now (layer.transitionMs) — pass no global override so
    // the compositor falls back to each layer's own value.
    compositor.render(renderLayers, t, {
      trigSecs: pulseTrigSecs, videoTex, masterOpacity, transitionMs: undefined,
      compositionEffects: show.composition?.effects, compositionParams: show.composition?.params,
    });

    // A live fixture drag flagged the sampler stale — rebuild it from the dragged
    // positions (throttled to this frame) so the lit content follows in realtime.
    if (samplerDirty) { refreshSampler(); samplerDirty = false; }
    // Sample composited canvas → RGBA8 per output pixel, ship RGB, feed preview.
    // No fixtures ⇒ no sampler; still composite to screen below (don't crash).
    lastRGBA = sampler ? sampler.sample(compositor.tex) : null;
    if (lastRGBA) {
      for (const s of hiddenSpans) lastRGBA.fill(0, s.start * 4, (s.start + s.count) * 4); // hidden → dark on the wall
      if (resolveLayerBindings()) bridge?.setRoute?.(curRoute);   // live layer-bound DMX params
      // PANIC forces dark; the master DIMMER is the composition opacity (compositor stage).
      bridge?.send(panicOn ? scaleOutput(lastRGBA, 0) : lastRGBA);
    }
    // The composition-group "B" mutes all layers (bypass), so a master block reads
    // here naturally — muted layers composite to black, which samples/sends dark.
    // Skip the overlay draw entirely when it's hidden (its canvas is display:none) —
    // no point spending CPU drawing thousands of LEDs you can't see.
    if (overlayVisible) preview?.draw(show, lastRGBA, selectedFixtureIds, showGrid ? SNAP_GRID : 0, snapGuides, marqueeRect);

    // Draw composited output to the real screen so there's something visible.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);          // transparent so the checkerboard shows through
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.useProgram(screenProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, compositor.tex);
    gl.uniform1i(uScreenTex, 0);
    drawFullscreen(gl);
  }
  frames++;
  if (ts - last > 500) {
    const live = bridge?.connected?.();
    // Companion/daemon status (red offline / green live) on the Control subtab.
    document.getElementById('control-subdot')?.classList.toggle('on', !!live);
    // The remote icon jumps to the control surface only while the daemon is up.
    if (remoteBtn) { remoteBtn.disabled = !live; remoteBtn.title = live ? 'Open the control surface (phone remote)' : 'Control surface — start the daemon to enable'; }
    updateHealthBtn(!!live);   // offline chip (belt & braces beside onStatus — covers "bridge never constructed")
    // Daemon came up / went down → refresh the Output list + the scan icon's gate.
    if (!!live !== lastLive) { lastLive = !!live; if (outputTab === 'fixtures') renderOutput(); }   // daemon up/down → refresh scan button state
    frames = 0; last = ts;
  }
}
// Render-loop ERROR BOUNDARY: one bad shader / clip / effect must NEVER kill the rAF loop
// — a dead loop freezes the wall on a stale frame forever (the worst unattended failure).
// Wrap every frame, ALWAYS re-schedule; a successful frame clears the error state.
let loopErrs = 0, lastLoopErrLog = 0;
function loop(ts) {
  try { loopBody(ts); loopErrs = 0; }
  catch (e) {
    loopErrs++;
    if (loopErrs === 1) { try { snapshotForUndo(show); } catch { /* preserve a pre-error state to undo back to */ } }
    if (ts - lastLoopErrLog > 2000) { console.error(`[loop] frame error (${loopErrs}×) — loop kept alive:`, e); lastLoopErrLog = ts; }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Global safety net: surface (don't swallow) any unhandled error / promise rejection so a
// background failure can't silently leave the app in a bad state.
window.addEventListener('error', (e) => console.error('[uncaught]', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandledrejection]', e.reason));

// WebGL CONTEXT-LOSS recovery: on a long-running Pi/kiosk the GPU process resets (driver
// timeout, sleep/wake) and silently kills every GL resource. Pause rendering while lost,
// then rebuild the whole GL stack on restore — turns a permanently dead wall into a blip.
let glLost = false;
function rebuildGL() {
  try {
    const w = canvas.width, h = canvas.height;
    screenProg = program(gl, SCREEN_FS);
    uScreenTex = gl.getUniformLocation(screenProg, 'uTex');
    compositor = makeCompositor(gl, w, h);   // old resources died with the context; don't dispose
    videoMap.clear();                        // video textures are gone → recreated on next upload
    refreshSampler();                        // rebuild the output sampler against the new context
  } catch (e) { console.error('[gl] rebuild after restore failed:', e); }
}
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); glLost = true; console.warn('[gl] context lost — pausing render'); }, false);
canvas.addEventListener('webglcontextrestored', () => { rebuildGL(); glLost = false; console.warn('[gl] context restored — rebuilt'); }, false);

// --- Project file I/O (New / Save / Load / Import) — bound to the File menu ---
// Apply a whole show (open/import): resize the stage to its canvas if it changed,
// then rebuild + persist + refresh panels.
function applyFullShow(next) {
  const c = next.composition?.canvas || { w: 1280, h: 720 };
  const cur = show.composition?.canvas;
  if (c.w !== cur?.w || c.h !== cur?.h) {
    canvas.width = c.w; canvas.height = c.h;
    if (previewCanvas) { previewCanvas.width = c.w; previewCanvas.height = c.h; }
    preview?.setBaseSize?.(c.w, c.h);
    compositor.dispose(); compositor = makeCompositor(gl, c.w, c.h);
  }
  rebuild(next); saveShow(show); panel.refresh(); layerPanel.refresh(); compositionPanel.refresh?.(); renderOutput(); redrawOverlay();
}

// Resize the canvas to fit the placed fixtures (fluid composition — the strips
// decide the dimensions). No-op with a notice if nothing is placed.
function fitToFixtures() {
  if (!show.fixtures?.length) { window.alert('No fixtures placed yet, nothing to fit to.'); return; }
  applyFullShow(fitCanvasToFixtures(show));
}

// New project: confirm, then reset to a sensible STARTER — one controller with a
// single fixture wired to it, lit by a Lines clip. (Not blank, so there's
// something on screen and a patch to build from.)
// A fresh project gets a random LED Zeppelin track as its title (beats "untitled").
const LZ_TRACKS = [
  'Stairway to Heaven', 'Kashmir', 'Whole Lotta Love', 'Black Dog', 'Immigrant Song',
  'Rock and Roll', 'Ramble On', 'Going to California', 'Dazed and Confused', 'Heartbreaker',
  "Since I've Been Loving You", 'When the Levee Breaks', 'The Rain Song', 'Over the Hills and Far Away',
  'No Quarter', 'Trampled Under Foot', 'Achilles Last Stand', 'In My Time of Dying', 'Ten Years Gone',
  'The Ocean', 'Fool in the Rain', 'Gallows Pole', 'Tangerine', 'Thank You', 'Misty Mountain Hop',
  'The Battle of Evermore', 'Good Times Bad Times', 'Communication Breakdown', 'In the Light',
  "Nobody's Fault but Mine", 'All My Love', 'Houses of the Holy', 'The Song Remains the Same',
];
const randomTrackTitle = () => LZ_TRACKS[Math.floor(Math.random() * LZ_TRACKS.length)];

function newProject() {
  if (!window.confirm('Start a new project? This clears the current one (save first if you want to keep it).')) return;
  // Reset to the standard default (Lines + Checkered, Generic Controller, 1280²) —
  // the same show a fresh install loads — with a random LED Zeppelin track as its title.
  const next = normalizeComposition(defaultShow());
  if (next.composition) next.composition.title = randomTrackTitle();
  applyFullShow(next);
}

function saveShowToFile() {
  const blob = new Blob([JSON.stringify(show, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'project.json'; a.click(); URL.revokeObjectURL(a.href);
}

const openShowInput = document.getElementById('open-show-file');
openShowInput?.addEventListener('change', async () => {
  const file = openShowInput.files[0]; if (!file) return;
  try {
    const loaded = JSON.parse(await file.text());
    if (!loaded || !Array.isArray(loaded.fixtures) || !loaded.composition) {
      window.alert(loaded?.instances ? 'That looks like a LEDger file — use “import from LEDger…” in the File menu.' : 'Not a LED Zeppelin project file.');
    } else {
      applyFullShow(normalizeComposition(loaded));
    }
  } catch (e) { window.alert('Load failed: ' + e.message); }
  openShowInput.value = '';
});

// Composition file = just the visuals (canvas + layers/clips/effects), no rig.
function saveCompositionToFile() {
  const blob = new Blob([JSON.stringify(show.composition || {}, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'composition.json'; a.click(); URL.revokeObjectURL(a.href);
}
const openCompInput = oel('input', { type: 'file', accept: '.json,application/json' });
openCompInput.style.display = 'none'; document.body.append(openCompInput);
openCompInput.addEventListener('change', async () => {
  const file = openCompInput.files[0]; if (!file) return;
  try { const c = JSON.parse(await file.text()); if (c && (c.layers || c.canvas)) applyComposition(c); else window.alert('Not a composition file.'); }
  catch (e) { window.alert('Load failed: ' + e.message); }
  openCompInput.value = '';
});

// Import an ISF shader (.fs/.isf) as a new generator clip on the active layer.
// Its INPUTS become animatable, OSC/MIDI-mappable clip params automatically.
// Content-stable id (a hash of the GLSL) so the same shader dedupes and a saved
// clip's id never collides with a fresh import across sessions.
const isfId = (g) => { let h = 5381; for (let i = 0; i < (g || '').length; i++) h = ((h << 5) + h + g.charCodeAt(i)) | 0; return 'isf' + (h >>> 0).toString(36); };
const openISFInput = oel('input', { type: 'file', accept: '.fs,.isf,.frag,.glsl,.txt' });
openISFInput.style.display = 'none'; document.body.append(openISFInput);
// Import an ISF shader. `target` (from a drop) hints WHERE to land it:
// {layerId, clipId} from the deck cell under the cursor — so dropping next to a
// clip lands on THAT layer / applies the filter to THAT clip (not a new layer).
function importISFText(text, filename, target) {
  const r = parseISF(text);
  if (!r.ok) { window.alert(`Not a valid ISF shader: ${r.error}`); return; }
  const layers = show.composition?.layers || [];
  if (!layers.length) { window.alert('Add a layer first.'); return; }
  const isf = {
    id: isfId(r.glsl),
    name: (filename || '').replace(/\.[^.]+$/, '') || r.name,
    glsl: r.glsl, inputs: r.inputs, params: isfParams(r.inputs),
    src: wrapISF(r.glsl, r.inputs),
  };
  const findClip = (cid) => { for (const L of layers) for (const c of (L.clips || [])) if (c && c.id === cid) return { layerId: L.id, clipId: c.id }; return null; };
  if (r.type === 'effect') {
    // A filter (samples inputImage) → the clip under the drop, else the selected/
    // active clip (optionally on the dropped-on layer).
    const hit = (target?.clipId && findClip(target.clipId)) || findClip(layerPanel?.getSelectedClipId?.());
    let layerId = hit?.layerId, clipId = hit?.clipId;
    if (!clipId && target?.layerId) { const L = layers.find((x) => x.id === target.layerId); if (L) { layerId = L.id; clipId = L.activeClipId || L.clips?.[0]?.id; } }
    if (!clipId) { const L = layers.find((x) => x.activeClipId) || layers[0]; layerId = L.id; clipId = L.activeClipId || L.clips?.[0]?.id; }
    if (!clipId) { window.alert('Add/select a clip to apply the ISF effect to.'); return; }
    rebuild(addISFEffect(show, layerId, clipId, isf));
  } else {
    // A generator → the dropped-on layer, else the selected/first layer.
    const layerId = (target?.layerId && layers.some((L) => L.id === target.layerId)) ? target.layerId
      : (layers.find((L) => L.id === layerPanel?.getSelectedLayerId?.()) || layers[0]).id;
    rebuild(addISFClip(show, layerId, isf));
  }
  setSection('design'); layerPanel?.refresh?.();
}
openISFInput.addEventListener('change', async () => {
  const file = openISFInput.files[0]; openISFInput.value = '';
  if (file) importISFText(await file.text(), file.name);
});
// Drag-and-drop an ISF shader (.fs/.isf/.frag/.glsl) onto the window; the deck cell
// under the cursor sets where it lands.
const isISFName = (n) => /\.(fs|isf|frag|glsl)$/i.test(n || '');
window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  const all = [...(e.dataTransfer?.files || [])];
  const isf = all.filter((f) => isISFName(f.name));
  const json = all.filter((f) => /\.json$/i.test(f.name));
  if (!isf.length && !json.length) return;
  e.preventDefault();
  // ISF shaders → a new generator clip under the drop target (layer/clip cell).
  const node = document.elementFromPoint(e.clientX, e.clientY);
  const target = { layerId: node?.closest?.('.deck-layer')?.dataset.layer, clipId: node?.closest?.('.clip-cell')?.dataset.clip };
  for (const f of isf) importISFText(await f.text(), f.name, target);
  // .json → load a LED Zeppelin project (rig + visuals) or a composition (visuals only).
  for (const f of json) {
    try {
      const data = JSON.parse(await f.text());
      if (data && Array.isArray(data.fixtures) && data.composition) applyFullShow(normalizeComposition(data));
      else if (data && (data.layers || data.canvas)) applyComposition(data);
      else if (data && Array.isArray(data.instances)) window.alert('That looks like a LEDger preset — import it from the Library window.');
      else window.alert('Unrecognised .json — expected a LED Zeppelin project or composition.');
    } catch (err) { window.alert('Load failed: ' + err.message); }
  }
});
// Bundled ISF examples (source picker's "ISF" group): fetch one + import it.
function importISFExample(file) {
  fetch('./examples/isf/' + encodeURIComponent(file))
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('not found'))))
    .then((t) => importISFText(t, file))
    .catch(() => window.alert('Could not load ' + file));
}
// Load the example index for the picker (best-effort; absent in some builds).
fetch('./examples/isf/index.json').then((r) => r.json()).then((list) => { if (Array.isArray(list)) isfExamples = list; }).catch(() => {});

// (Project file actions — new/save/load/import — live in the corner File menu
// below; the old Settings-tab file block was removed with that tab.)

// ⌘S save / ⌘O open — kept as shortcuts.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || typingIn(e.target)) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); saveShowToFile(); }
  else if (k === 'o') { e.preventDefault(); openShowInput?.click(); }
});

// --- Corner-cluster dropdown menus (File / Audio) — open UPWARD from the bottom. ---
const menuPop = oel('div', { id: 'menu-pop', hidden: true });
document.body.append(menuPop);
let openMenuBtn = null;
function closeMenu() { menuPop.hidden = true; openMenuBtn?.classList.remove('open'); openMenuBtn = null; }
function openMenu(btn, content) {
  if (openMenuBtn === btn) { closeMenu(); return; }
  closeMenu();
  menuPop.textContent = ''; menuPop.append(content); menuPop.hidden = false;
  const r = btn.getBoundingClientRect();
  menuPop.style.left = r.left + 'px';
  menuPop.style.top = Math.max(6, r.top - menuPop.offsetHeight - 4) + 'px';   // above the button
  btn.classList.add('open'); openMenuBtn = btn;
}
const menuList = (items) => {
  const f = document.createDocumentFragment();
  for (const it of items) {
    if (it.sep) { f.append(oel('div', { className: 'menu-sep' })); continue; }
    if (it.head) { f.append(oel('div', { className: 'menu-title', textContent: it.head })); continue; }
    const row = oel('div', { className: 'menu-item' }, [oel('span', { textContent: it.label })]);
    if (it.key) row.append(oel('span', { className: 'menu-key', textContent: it.key }));
    row.onclick = () => { closeMenu(); it.act?.(); };
    f.append(row);
  }
  return f;
};
// "Install" — open the GitHub releases page (where the notarized app downloads
// live) in a new tab, so users can grab or update the standalone build.
const REPO_URL = 'https://github.com/jonasjohansson/ledzeppelin';
// Project I/O as top-bar icon buttons (no File dropdown). Save / Open are direct;
// Import opens a small menu for the less-common project options.
document.getElementById('menu-install')?.addEventListener('click', () => window.open(`${REPO_URL}/releases`, '_blank', 'noopener'));
// Tiny uppercase caption under each top-bar icon (what it does at a glance; the title
// tooltip still carries the full description). One label per known button id.
const TOPBAR_CAPTIONS = {
  'menu-settings': 'Settings',
  'menu-lock': 'Lock', 'menu-save': 'Save', 'menu-open': 'Open', 'menu-new': 'New',
  'menu-guide': 'Guide',
  'menu-mapping': 'Mapping', 'menu-inventory': 'Library', 'menu-remote': 'Remote', 'menu-align': 'Align',
  'panel-left': 'Left', 'panel-bottom': 'Timeline', 'panel-right': 'Right',
  'overlay-toggle': 'Edit', 'snap-btn': 'Snap', 'grid-btn': 'Grid', 'color-btn': 'Tint', 'wall-btn': 'Preview',
  'mode3d-btn': '3D',
  'daemon-chip': 'Offline', 'menu-refresh': 'Update', 'menu-bug': 'Bug', 'menu-install': 'Install',
};
for (const [id, label] of Object.entries(TOPBAR_CAPTIONS)) {
  const btn = document.getElementById(id);
  if (btn && !btn.querySelector('.g-label')) btn.append(oel('span', { className: 'g-label', textContent: label }));
}
// Force-update / clear cache — a manual debugging escape hatch for when stale cached
// code is suspected. Wipes ONLY the service-worker registration + Cache Storage (the
// app's code/assets), NEVER localStorage — so the saved project + prefs are untouched.
document.getElementById('menu-refresh')?.addEventListener('click', async () => {
  if (!window.confirm('Reload with fresh app files?\n\nThis clears cached app code and reloads. Your saved project and settings are kept; live output pauses briefly during the reload.')) return;
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* SW API unavailable — ignore */ }
  try {
    const keys = (await caches?.keys?.()) || [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* Cache Storage unavailable / quota — ignore */ }
  location.reload();
});
document.getElementById('menu-save')?.addEventListener('click', saveShowToFile);
document.getElementById('menu-open')?.addEventListener('click', () => openShowInput?.click());
// Offline chip: shown ONLY while the daemon/bridge is disconnected (on the hosted
// site — no daemon ever — it stays up as a "no LED output" notice). Clicking opens
// /health, the old health icon's diagnostic (shows the failure directly when down).
const daemonChip = document.getElementById('daemon-chip');
daemonChip?.addEventListener('click', () => window.open('/health', '_blank', 'noopener'));
function updateHealthBtn(live) { if (daemonChip) daemonChip.hidden = !!live; }
document.title = `LED Zeppelin v${VERSION}`;   // build version in the tab title so it's always visible
document.getElementById('menu-bug')?.addEventListener('click', () => window.open(`${REPO_URL}/issues/new?title=${encodeURIComponent(`[bug] v${VERSION}: `)}`, '_blank', 'noopener'));
// New project + LEDger import are their own top-bar icons; the ⤵ menu keeps the rest
// (ISF shader import — drag-drop isn't wired yet — and composition save/load).
document.getElementById('menu-new')?.addEventListener('click', newProject);
// LEDger import lives in the Inventory popout (it hosts the catalog + the import UI).
// Open it and ask it to start the file picker; the popout applies the import and
// broadcasts it back to this window (handled on the 'lz-inventory' channel).
// (LEDger import lives inside the Inventory tab — no separate top-bar button.)
document.getElementById('menu-guide')?.addEventListener('click', () => { try { window.open('guide/', 'lz-guide'); } catch { /* blocked */ } });
// (Import is drag-and-drop now: drop an ISF shader, a project .json, or a composition
// .json onto the window. "Save composition…" lives in Settings; ⌘S saves the project.)
// (Audio input + gain and the snap grid/distance config moved to System ›
// Settings — see buildSettings.) The corner snap button is now a quick on/off
// toggle; it only bites while placing fixtures, so it's disabled with the overlay off.
snapBtn?.addEventListener('click', (e) => {
  if (snapBtn.disabled) return;
  e.stopPropagation();
  setSnapEnabled(!snapEnabled); saveSnap();
});
document.addEventListener('pointerdown', (e) => { if (openMenuBtn && !menuPop.contains(e.target) && e.target !== openMenuBtn) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenuBtn) closeMenu(); });

// A ~6s synthesized full-band hard-rock intro on launch (procedural homage, not a
// sample). Tries to play on load; if autoplay is blocked, fires on first input.
// Pick a style / disable via localStorage 'lz.riff' (see startup-riff.js).
armStartupRiff();

// --- PWA: register the service worker so the editor installs as an app and runs
// offline (cached app shell). Best-effort — needs a secure context (https or
// localhost); a failure or unsupported browser just leaves it as a normal tab. ---
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => { /* offline support unavailable — non-fatal */ });
}

// Boot fade-in: the accent/theme + initial render are applied above during module
// eval; wait for the UI font to load and one paint, then reveal the (initially
// hidden, see index.html) UI in one smooth fade. The head's safety timeout reveals
// it anyway if this never runs.
(document.fonts?.ready ?? Promise.resolve()).then(() => {
  requestAnimationFrame(() => document.documentElement.classList.add('ready'));
});
