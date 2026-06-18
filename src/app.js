import { getGL, program, drawFullscreen } from './engine/gl.js';
import { emptyShow, addDevice, addFixture, validate, repackOffsets, syncFixtureTypes, syncDeviceTypes } from './model/show.js';
import { buildPipelineInputs } from './model/pipeline.js';
import { makeSampler } from './engine/sampler.js';
import { makeCompositor } from './engine/compositor.js';
import { connectBridge } from './bridge.js';
import { createPreview, enableDragPlacement } from './ui/preview.js';
import { createFixturePanel, loadShow, saveShow } from './ui/fixtures.js';
import { createLayerPanel } from './ui/layers.js';
import { createImportPanel } from './ui/import.js';
import { createCompositionPanel } from './ui/composition.js';
import { createControlPanel } from './ui/control.js';
import { Slider } from './ui/controls.js';
import { Section } from './ui/section.js';
import { activateTabs } from './ui/kit/tabs.js';
import {
  prefixedDefaults, normalizeComposition, makeClip, setActiveClip, tidyEmptyLayers,
  setCanvasSize as setCanvasSizeModel, clampCanvasSize, playheadClip, setShowBpm, addISFClip, addISFEffect,
} from './model/layers.js';
import { parseISF, isfParams, wrapISF } from './engine/shaders/isf.js';
import { routeOsc } from './model/osc-map.js';
import { listMappables, bindMapping, clearMapping, setMappingMode, applyBindings } from './model/mappings.js';
import { buildRemoteManifest } from './model/remote.js';
import { syncShowFixtures, setFixtureTransform, transformFromPoints, pointsFromTransform, snap90, flipFixture, fixtureLabel, fixtureRange, fitCanvasToFixtures, thicknessOf, isAutoThickness } from './model/fixture-transform.js';
import { chainOf, freePort, pruneChains, wireAfter, wireFirst } from './model/chains.js';
import { DMX_PROFILES, dmxProfile, dmxChannelsOf, isDmxFixture, DMX_CHANNEL_KINDS } from './model/dmx.js';
import { resolveParams, animatedValue } from './model/anim.js';
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
  // A plain "Generic Fixture" (96 px) as the primary definition, plus a spread of
  // density variants (96 / 60 / 30 led/m, in 5 m and 1 m lengths) for variety.
  const genericType = (lpm, m) => ({ id: `g${lpm}_${m}`, name: `${lpm}/m · ${m}m`, ledsPerMeter: lpm, meters: m, pixelCount: lpm * m, colorOrder: 'RGB' });
  show.fixtureTypes = [
    { id: 'gen', name: 'Generic Fixture', ledsPerMeter: 96, meters: 1, pixelCount: 96, colorOrder: 'RGB' },
    genericType(96, 5), genericType(60, 5), genericType(60, 1), genericType(30, 5), genericType(30, 1),
  ];
  // One placed fixture (the Generic Fixture) wired to Controller 1 — a thin upright
  // strip in the middle of the canvas (Width 10 × Height 96, rotation 0).
  const tf = { x: cv.w / 2, y: cv.h / 2, w: 10, h: 96, rotation: 0 };
  show.fixtures = [{
    id: 'f1', typeId: 'gen',
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
    const v = validate(loaded);
    if (!v.ok) {
      console.warn('Loaded show failed validation, using default:', v.errors.join(' · '));
      return defaultShow();
    }
    // Upgrade persisted OLD-shape compositions to the clip schema on load
    // (idempotent — new-shape shows pass through unchanged).
    return normalizeComposition(loaded);
  } catch (e) {
    console.warn('Loaded show is invalid, using default:', e.message);
    return defaultShow();
  }
}

// On load: migrate legacy flat fixtures into definitions + instances (so the
// Library shows definitions immediately), then sync fixture geometry.
let show = tidyEmptyLayers(syncShowFixtures(syncFixtureTypes(syncDeviceTypes(initialShow()))));

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
const screenProg = program(gl, SCREEN_FS);
const uScreenTex = gl.getUniformLocation(screenProg, 'uTex');

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
  const { sampleUVs, route, spans } = buildPipelineInputs(show);
  sampler?.dispose?.(); // free the previous sampler's GL objects before reassigning
  sampler = sampleUVs.length ? makeSampler(gl, sampleUVs) : null;
  // Push the new route over the existing socket (no reconnect blip); only
  // construct a bridge on first build. Keeps output live + stats across edits.
  if (bridge?.setRoute) bridge.setRoute(route);
  else bridge = connectBridge(route, { onExt: handleExt, onManifestReq: () => broadcastManifest(true), onStatus: () => panel?.refresh?.(), fps: savedOutFps() });   // canonical OSC addresses + ext channels; phone asks → publish; status → re-gate scan
  lastSpans = spans;
  recomputeHiddenSpans();
  lastRGBA = null;
  syncWallDim();         // live-view dim follows fixture count (don't blank an empty stage)
  broadcastManifest();   // geometry change can rename/restructure → refresh the phone
}

// Cheap sampler-only rebuild (no route/manifest/bridge churn) — used live during a
// fixture drag so the sampled colours follow the new positions each frame.
function refreshSampler() {
  const { sampleUVs, spans } = buildPipelineInputs(show);
  sampler?.dispose?.();
  sampler = sampleUVs.length ? makeSampler(gl, sampleUVs) : null;
  lastSpans = spans; recomputeHiddenSpans();
}

// Hidden ("eye"-off) fixtures must go DARK on the wall, not just in the preview —
// so we still sample them (to keep DDP indices contiguous) and zero their bytes
// before sending. Recompute when the hidden flag toggles (no full rebuild).
let lastSpans = [];
let hiddenSpans = [];
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
    const sig = manifestSig(data);
    if (now || sig !== lastManifestSig) { lastManifestSig = sig; bridge?.sendJson?.({ type: 'manifest', data }); }
    const cp = document.getElementById('system-control');
    if (controlPanel && cp && !cp.hidden && !cp.closest('#system-pane')?.hidden) controlPanel.refresh();   // structural-gated → cheap
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
  // A device/model row was clicked or edited → refresh the left inspector.
  onSelect: () => updateInspector(),
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
  onClipSelect: () => { setSection('design'); setInspectorTab('clip'); }, // jump to Design › Clip to tweak it
  onLayerSelect: () => { setSection('design'); setInspectorTab('layer'); }, // jump to Design › Layer
  onCompositionSelect: () => { setSection('design'); setInspectorTab('composition'); }, // jump to Design › Composition
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
// Kagora import → assign-IP → apply. The imported show is a GEOMETRY change, so
// applyShow routes through rebuild() (same path as fixture edits); onApplied
// re-renders the fixtures + layers panels against the new show.
const importPanel = createImportPanel({
  getShow: () => show,
  applyShow: (next) => {
    // Adopt the imported composition canvas (it matches the rig's aspect, so the
    // layout isn't stretched) — resize stage/overlay/compositor, then rebuild.
    const c = next.composition?.canvas || { w: 1280, h: 720 };
    const cur = show.composition?.canvas;
    if (c.w !== cur?.w || c.h !== cur?.h) {
      canvas.width = c.w; canvas.height = c.h;
      if (previewCanvas) { previewCanvas.width = c.w; previewCanvas.height = c.h; }
      preview?.setBaseSize?.(c.w, c.h);
      compositor.dispose(); compositor = makeCompositor(gl, c.w, c.h);
    }
    rebuild(next);
  },
  onApplied: () => {
    // Full UI refresh — a (re)import replaces every device + fixture, so the
    // placement list and canvas overlay must redraw, and any selection of
    // now-gone fixtures must clear (else the Output list looks unchanged).
    selectedFixtureIds.clear();
    panel.refresh(); layerPanel.refresh(); compositionPanel.refresh?.();
    renderOutput(); redrawOverlay();
  },
});
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
compSettings?.append(compositionPanel.el);     // canvas-resolution panel atop the inspector
// Fixtures tab = the design editor + Kagora import (placement list is the
// output-list above). Devices tab = the device editor.
const devicesDesignEl = document.getElementById('devices-design');
const libraryDesignEl = document.getElementById('library-design');
devicesDesignEl?.append(panel.devicesEl);          // Devices tab — instances
libraryDesignEl?.append(panel.libraryEl);          // Library tab — model catalog
libraryDesignEl?.append(importPanel.el);           // + Kagora import

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
function selectDevice(id) {
  if (!id) return;
  selectedDeviceId = id;
  selectedFixtureIds.clear();
  expandedDevices.add(id);
  panel.setDevice?.(id);
  renderOutput(); redrawOverlay();
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
  // Picking a single fixture (not a shift multi-select / empty click) jumps to Output
  // › Fixtures, where its editor shows in the #side-2 rail (the rail is Output-only).
  if (fxId != null && !(ev && ev.shiftKey)) {
    setSection('output');
    setOutputTab('fixtures');
    const sf = show.fixtures.find((f) => f.id === fxId);   // keep its controller + group open after deselect
    if (sf) { expandedDevices.add(sf.output?.deviceId || ''); expandedGroups.add(`${sf.output?.deviceId || ''}:${sf.output?.port ?? 1}`); }
    panel.selectFixture?.(fxId);
  }
  renderOutput(); redrawOverlay();
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
// Editor dock at the BOTTOM of the Output pane: a bar (title + minimise) and a body
// that holds the selected fixture/device editor. Collapsible.
// Second sidebar (#side-2): the selected fixture/device/model editor rail.
const side2El = document.getElementById('side-2');
const fxBodyEl = document.getElementById('fxinsp-body');
let outputTab = 'fixtures';   // Output sub-tab: fixtures (merged patch) | library
let selectedDeviceId = null;  // a device picked for editing in the left sidebar (merged Fixtures tab)
let collapsedDevices = new Set();   // controller groups collapsed in the Devices list (empty = all open)
let insetRaf = 0;             // rAF handle for deferred canvas-inset measurement (see updateStageInsets)
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
  if (colorBtn) { colorBtn.classList.toggle('on', controllerTint); colorBtn.textContent = 'color'; }
  preview?.setColorTint?.(controllerTint);
  renderOutput(); redrawOverlay();
}
colorBtn?.addEventListener('click', () => setControllerTint(!controllerTint));
// Initial sync (preview exists; the startup renderOutput reads controllerTint).
if (colorBtn) { colorBtn.classList.toggle('on', controllerTint); colorBtn.textContent = 'color'; }
preview?.setColorTint?.(controllerTint);
// Snap toggle: a viewport corner button (mirrored by the Settings panel).
// setSnapEnabled keeps both in step.
const snapBtn = document.getElementById('snap-btn');
function setSnapEnabled(v) {
  snapEnabled = !!v;
  if (snapBtn) { snapBtn.classList.toggle('on', snapEnabled); snapBtn.textContent = 'snap'; }
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
  if (gridBtn) { gridBtn.classList.toggle('on', showGrid); gridBtn.textContent = 'grid'; }
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
  if (!isHead) devSel.title = 'set by the chain — edit the first fixture in the chain';
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
  return oel('div', { className: 'output-edit' }, [
    Section('Position', 'position', (body) => {
      // X/Y address the bounding-box TOP-LEFT (Figma-style); convert to/from centre.
      const bb = aabbSize(tf, thicknessOf(sel, show.composition?.canvas));
      body.append(
        oel('div', { className: 'output-grid' }, [
          txField('X', tf.x - bb.w / 2, (v) => setT({ x: v + bb.w / 2 })),
          txField('Y', tf.y - bb.h / 2, (v) => setT({ y: v + bb.h / 2 })),
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
          // Rotation field with its ±90° steppers inline on the same row.
          (() => {
            const fld = txField('Rotation°', tf.rotation, (v) => setT({ rotation: v }));
            fld.append(
              oel('button', { className: 'dir-btn rot-step', textContent: '−90°', title: 'rotate −90°',
                onclick: () => setT({ rotation: (snap90(tf.rotation) + 270) % 360 }) }),
              oel('button', { className: 'dir-btn rot-step', textContent: '+90°', title: 'rotate +90°',
                onclick: () => setT({ rotation: (snap90(tf.rotation) + 90) % 360 }) }),
            );
            return fld;
          })(),
        ]),
        // Not a transform flip — it reverses which end of the LED STRIP is pixel 0
        // (the canvas arrow points at pixel 0).
        oel('div', { className: 'dir-btns out-transform' }, [
          oel('button', { className: 'dir-btn' + (sel.input?.reversed ? ' on' : ''), textContent: '⇄ Reverse direction',
            title: 'reverse the LED strip direction (which end is pixel 0)',
            onclick: () => apply(flipFixture(show, sel.id)) }),
        ]),
      );
    }),
    Section('Patch', 'routing', (body) => {
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

  const out = oel('div', {}, [
    Section('Fixture', 'dmx-fixture', (body) => {
      body.append(oel('div', { className: 'output-grid' }, [
        fld('Profile', sel2(DMX_PROFILES.map((p) => ({ value: p.id, label: p.name })), cfg.profileId, (id) => {
          if (id === 'generic') setDmx({ profileId: 'generic', channels: cfg.channels?.length ? cfg.channels : [{ kind: 'fixed', value: 0 }] });
          else setDmx({ profileId: id, channels: undefined });
        })),
        txField('X', tf.x, (v) => setT({ x: v })),
        txField('Y', tf.y, (v) => setT({ y: v })),
      ]));
    }),
    Section('Patch', 'dmx-patch', (body) => {
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

  // Channels: generic gets a kind-picker + remove per channel; any `fixed` channel
  // gets a 0..255 slider. (A pure colour par has neither, so the section is skipped.)
  const hasFixed = channels.some((c) => c.kind === 'fixed');
  if (generic || hasFixed) {
    out.append(Section('Channels', 'dmx-channels', (body) => {
      channels.forEach((c, i) => {
        if (generic) {
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
      if (generic) body.append(oel('button', { className: 'fx-add', textContent: '+ channel',
        onclick: () => patchFix((f) => { f.input.dmx = { ...f.input.dmx, channels: [...liveChannels(), { kind: 'fixed', value: 0 }] }; }) }));
    }));
  }
  return out;
}

// Like txField, but the value may be null = "mixed" across the multi-selection:
// shows a "— mixed —" placeholder and commits only when the user types something.
function txFieldMulti(label, value, onCommit) {
  const i = oel('input', { type: 'number', step: '1', placeholder: '— mixed —' });
  if (value != null) i.value = String(Math.round(value));
  i.addEventListener('change', () => { if (i.value === '') return; onCommit(Number(i.value)); });
  return oel('label', { className: 'fx-field' }, [oel('span', { textContent: label }), i]);
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

  return oel('div', { className: 'output-edit' }, [
    Section('Position', 'position', (body) => {
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
  ]);
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

// Place a new INSTANCE of a definition on the canvas. Spec is cached from the
// type on rebuild (syncFixtureTypes); the offset auto-packs. Default on-canvas
// width = the definition's pixel count, clamped (1px/LED, cosmetic).
function addInstance(typeId) {
  const next = structuredClone(show);
  const t = (next.fixtureTypes || []).find((x) => x.id === typeId) || next.fixtureTypes?.[0];
  if (!t) return;
  let n = next.fixtures.length + 1, id;
  do { id = `f${n}`; n++; } while (next.fixtures.some((x) => x.id === id));
  const cv = next.composition?.canvas || { w: 1280, h: 720 };
  // Drop new strips in the MIDDLE of the canvas as a thin UPRIGHT strip — Width 10,
  // Height = pixel count, Rotation 0. Orientation comes from the box aspect (h > w ⇒
  // vertical), so it reads as a non-rotated vertical strip; widen it past its height
  // to make it horizontal. Cascaded so adds don't overlap; left UNASSIGNED until wired.
  const k = next.fixtures.length;
  const off = (k % 8) * 16 - 56;
  // A matrix (rows>1) drops as a RECTANGLE sized by its cols:rows aspect (≈16px
  // per cell, capped to 60% of the canvas). A strip drops as a thin upright bar.
  const isGrid = (Number(t.rows) || 1) > 1;
  let transform, inputMode;
  if (isGrid) {
    const cell = 16;
    const sc = Math.min(1, (cv.w * 0.6) / (t.cols * cell), (cv.h * 0.6) / (t.rows * cell));
    transform = { x: cv.w / 2 + off, y: cv.h / 2 + off, w: Math.round(t.cols * cell * sc), h: Math.round(t.rows * cell * sc), rotation: 0 };
    inputMode = 'grid';
  } else {
    transform = { x: cv.w / 2 + off, y: cv.h / 2 + off, w: 10, h: t.pixelCount, rotation: 0 };
    inputMode = 'bar';
  }
  // If a controller is selected, the new fixture lands ON it; otherwise it's
  // unassigned. Either way it gets its OWN free output (port) so added strips are
  // NOT auto-chained together — chain them deliberately via the chain action.
  const onDev = selectedDeviceId && next.devices.some((d) => d.id === selectedDeviceId) ? selectedDeviceId : '';
  next.fixtures.push({
    id, typeId: t.id,
    output: { deviceId: onDev, port: freePort(next, onDev), pixelOffset: 0, pixelCount: t.pixelCount },
    input: { mode: inputMode, transform, points: pointsFromTransform(transform, cv), samples: t.pixelCount },
  });
  selectedFixtureIds = new Set([id]);
  expandedDevices.add('');   // keep the Unassigned group open so the new strip shows in the list
  // Commit the new fixture FIRST (rebuild), THEN reveal the overlay — setOverlay
  // re-renders the list, and the list's stale-selection prune would drop the new
  // id if the fixture weren't in `show` yet (leaving it unselected, editor hidden).
  saveShow(next); rebuild(next);
  setOverlay(true);   // reveal the canvas overlay so the new strip is visible
  panel.refresh(); renderOutput(); redrawOverlay();
}

// Add a DMX fixture (default RGB par) at the canvas centre, patched to the selected
// Art-Net controller (or the first one). It samples its centre point for colour.
function addDmxFixture(profileId = 'rgb') {
  const next = structuredClone(show);
  let n = next.fixtures.length + 1, id;
  do { id = `f${n}`; n++; } while (next.fixtures.some((x) => x.id === id));
  const cv = next.composition?.canvas || { w: 1280, h: 720 };
  const off = (next.fixtures.length % 8) * 16 - 56;
  // DMX rides Art-Net; land it on the selected Art-Net controller, else the first one.
  const selDev = next.devices.find((d) => d.id === selectedDeviceId && d.protocol === 'artnet');
  const dev = selDev || next.devices.find((d) => d.protocol === 'artnet');
  const transform = { x: cv.w / 2 + off, y: cv.h / 2 + off, w: 24, h: 24, rotation: 0 };
  next.fixtures.push({
    id, typeId: 'dmx',
    output: { deviceId: dev?.id || '' },
    input: { mode: 'dmx', transform, points: pointsFromTransform(transform, cv),
      dmx: { profileId, universe: dev?.universe ?? 0, address: 1, fixed: {} } },
  });
  selectedFixtureIds = new Set([id]); selectedDeviceId = null;
  if (dev) expandedDevices.add(dev.id); else expandedDevices.add('');
  saveShow(next); rebuild(next); setOverlay(true);
  setSection('output'); setOutputTab('fixtures');
  panel.refresh(); renderOutput(); redrawOverlay();
}

// The "+ fixture" / "+ controller" / "scan" toolbar above the placement list — the
// three actions sit side by side; the fixture-type picker (what "+ fixture" places)
// is a full-width row below them, then any scan results. Definitions live in Inventory.
function addControls() {
  const wrap = oel('div', { className: 'output-tools' });
  const types = show.fixtureTypes || [];
  // ONE type picker for everything you can place: LED strips/matrices (Inventory
  // definitions) AND DMX fixtures (profiles). A DMX entry's value is "dmx:<profileId>".
  const sel = oel('select', { title: 'what to place — an LED strip/matrix or a DMX fixture' });
  if (types.length) {
    const g = oel('optgroup', { label: 'LED' });
    for (const t of types) {
      // Don't re-append the px count when the type's NAME already states it.
      const label = /\d+\s*px/i.test(t.name || '') ? t.name : `${t.name} · ${t.pixelCount}px`;
      g.append(oel('option', { value: t.id, textContent: label }));
    }
    sel.append(g);
  }
  const gd = oel('optgroup', { label: 'DMX' });
  for (const p of DMX_PROFILES) gd.append(oel('option', { value: `dmx:${p.id}`, textContent: p.name }));
  sel.append(gd);
  const addFx = oel('button', { className: 'fx-add', textContent: '+ fixture', title: 'place the selected fixture',
    onclick: () => { const v = sel.value; if (v.startsWith('dmx:')) addDmxFixture(v.slice(4)); else addInstance(v); } });
  // "+ controller" — create a controller right here (a generic one; edit its IP /
  // model / colour order below). New controllers appear as empty containers you drop onto.
  const addDev = oel('button', { className: 'fx-add', textContent: '+ controller', onclick: () => {
    let n = structuredClone(show);
    let k = (n.devices?.length || 0) + 1, id; do { id = `c${k}`; k++; } while (n.devices.some((d) => d.id === id));
    n = addDevice(n, { id, name: `Controller ${n.devices.length + 1}`, typeId: 'generic', ip: '', colorOrder: 'RGB', port: 4048 });
    expandedDevices.add(id); selectDevice(id);
    rebuild(n); panel.refresh(); renderOutput();
  } });
  // "scan" — WLED network discovery, beside the add buttons; its results render
  // below. Only possible when the daemon (node) is running — it serves the scan API.
  const daemonUp = !!bridge?.connected?.();
  const scanBtn = panel.scanButtonEl?.(renderOutput);
  if (scanBtn && !daemonUp) { scanBtn.disabled = true; scanBtn.title = 'start the daemon (npm start) to scan the network'; }
  wrap.append(oel('div', { className: 'output-addrow' }, [addFx, addDev, ...(scanBtn ? [scanBtn] : [])]));
  wrap.append(sel);   // the picker (LED + DMX) — always shown; DMX profiles are always available
  const scanRes = panel.scanResultsEl?.();
  if (scanRes) wrap.append(scanRes);
  return wrap;
}

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

// The #side-2 rail: shows the selected item's properties — a fixture's position
// (Fixtures), a device's settings, or a model (Inventory). Output-mode only; hides
// entirely when nothing's selected or when not in the Output section.
function updateInspector() {
  if (!side2El) return;
  let detail = null;
  // The #side-2 rail is an OUTPUT-mode feature — it only appears while patching, not
  // while compositing in Design/System.
  const inOutput = outputPaneEl && !outputPaneEl.hidden;
  if (inOutput) {
    // Inventory MODEL editor when the Inventory tab is up; otherwise the selected
    // fixture(s)/device editor.
    if (outputTab === 'library') {
      detail = panel.libraryDetailEl?.();
    } else if (selectedFixtureIds.size === 1) {
      const f = (show.fixtures || []).find((x) => x.id === [...selectedFixtureIds][0]);
      if (f) detail = isDmxFixture(f) ? dmxEditor(f) : positionEditor(f);
    } else if (selectedFixtureIds.size > 1) {
      // Several fixtures selected → the multi editor (batch X/Y/W/H/rotation/reverse).
      const ids = [...selectedFixtureIds].filter((id) => (show.fixtures || []).some((f) => f.id === id));
      if (ids.length > 1) detail = multiPositionEditor(ids);
    } else if (selectedDeviceId && (show.devices || []).some((d) => d.id === selectedDeviceId)) {
      detail = panel.deviceDetailEl?.();
    }
  }
  fxBodyEl.textContent = '';
  if (detail) {
    fxBodyEl.append(detail);   // no title bar — the selection is already visible on the canvas/list
    side2El.hidden = false;
  } else {
    side2El.hidden = true;
  }
  updateStageInsets();
  updateAlignBtn();
}

function renderOutput() {
  updateInspector();
  if (!outputListEl) return;
  outputListEl.textContent = '';
  const fixtures = show.fixtures || [];
  for (const id of [...selectedFixtureIds]) if (!fixtures.some((f) => f.id === id)) selectedFixtureIds.delete(id);
  if (selectedDeviceId && !(show.devices || []).some((d) => d.id === selectedDeviceId)) selectedDeviceId = null;   // drop a stale device selection (e.g. after undo/delete)

  if (outputTab === 'library') return;   // Library uses the device + fixture editors, not the placement list

  // 'fixtures' sub-tab: selectable rows + inline position editor under the row.
  // (No early-out for an empty rig — the device containers still render below so
  // they're visible + droppable even before any fixture is placed.)
  // A header/row becomes a drop target: dropping the dragged fixture(s) assigns
  // them to `deviceId` (+ `port` when given; deviceId '' = unassign).
  const dropZone = (el, deviceId, port) => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-hover'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop-hover'); assignFixturesTo(dragFxIds, deviceId, port); dragFxIds = []; });
    return el;
  };
  // A fixture row — same chrome as the Inventory list rows (.output-row + boxed
  // .fx-badge chips) so the two tabs read alike.
  const fixtureRow = (f, i, outLabel) => {
    const row = oel('div', { className: 'output-row' + (selectedFixtureIds.has(f.id) ? ' selected' : '') });
    row.dataset.fxid = f.id;
    // Drag a fixture row onto a device header to assign it (the whole selection drags
    // when this row is part of a multi-select).
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      dragFxIds = (selectedFixtureIds.has(f.id) && selectedFixtureIds.size > 1) ? [...selectedFixtureIds] : [f.id];
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragFxIds.join(',')); } catch { /* some browsers */ }
    });
    const typeName = (show.fixtureTypes || []).find((t) => t.id === f.typeId)?.name;
    const label = typeName ? `${fixtureLabel(f, i)} ${typeName}` : fixtureLabel(f, i);
    row.append(oel('span', { textContent: label }));                            // flex-grow name
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
    const open = !collapsedDevices.has(deviceId);
    const sec = oel('div', { className: 'insp-sec out-sec' + (open ? ' is-open' : '') });
    const tri = oel('span', { className: 'insp-tri' });
    tri.addEventListener('click', (e) => {
      e.stopPropagation();
      collapsedDevices.has(deviceId) ? collapsedDevices.delete(deviceId) : collapsedDevices.add(deviceId);
      renderOutput();
    });
    const head = oel('div', { className: 'insp-sec-head' }, [tri, oel('span', { className: 'insp-sec-title', textContent: (title || '').toUpperCase() })]);
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

  // Add buttons sit ABOVE the list (+ fixture / + device side by side).
  outputListEl.append(addControls());

  for (const dg of devOrder) {
    // UNASSIGNED — a section that's also a drop target: drop here to unassign.
    if (!dg.deviceId) {
      const items = dg.groups.flatMap((g) => g.items);
      const { sec, head, body } = devSection('', 'Unassigned', [`${items.length} fx`]);
      dropZone(head, '', null);   // drop a fixture here → unassign it
      for (const { f, i } of items) body.append(fixtureRow(f, i));
      outputListEl.append(sec);
      continue;
    }
    const gdev = show.devices.find((d) => d.id === dg.deviceId);
    const devName = gdev?.name || dg.deviceId;
    const devPx = dg.groups.reduce((m, g) => m + g.items.reduce((s, it) => s + (it.f.pixelCount || 0), 0), 0);
    const gcap = Number(gdev?.maxPerOutput) || 0;
    const devOver = gcap > 0 && dg.groups.some((g) => g.items.reduce((s, it) => s + (it.f.pixelCount || 0), 0) > gcap);
    const { sec, head, body } = devSection(dg.deviceId, devName, [`${devPx}px${devOver ? ' ⚠' : ''}`],
      () => selectDevice(dg.deviceId));   // click the header → edit the controller
    if (devOver) head.querySelector('.fx-badge')?.classList.add('out-over');
    if (selectedDeviceId === dg.deviceId && !selectedFixtureIds.size) head.classList.add('is-sel');
    dropZone(head, dg.deviceId, null);   // drop a fixture on a controller → assign it there
    // Fixtures as flat rows; a multi-output controller tags each row with its output.
    const multiOut = dg.groups.length > 1;
    for (const g of dg.groups) for (const { f, i } of g.items) body.append(fixtureRow(f, i, multiOut ? `out ${g.port}` : null));
    outputListEl.append(sec);
  }

  if (selectedFixtureIds.size > 1) outputListEl.append(chainSelectedAction());
  // (Scan + its results live in the add-controls row at the top.)
}

const renderOutputList = renderOutput; // back-compat alias

// This is an app surface, not a document — suppress the OS right-click menu
// everywhere EXCEPT editable text fields (where copy/paste is wanted). Sliders
// keep their own right-click-to-reset (that handler still runs).
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest?.('input:not([type=range]), textarea, [contenteditable]')) return;
  e.preventDefault();
});

// --- Workspace layout: there are NO top-level tabs. The deck, the Clip/Layer/
//     Composition inspector, and the Output/Fixtures column are all visible at
//     once. The fixture overlay (draggable rectangles on the canvas) is a
//     separate toggle, decoupled from any tab. ---
let overlayVisible = false;   // are the fixture rectangles shown over the composite?
// Section-switch elements live here (not at their wiring below) because the
// live-view init a few lines down runs updateInspector(), which reads them —
// declaring them later would put that first call in the TDZ.
const sectionSwitchEl = document.getElementById('section-switch');
const designPaneEl = document.getElementById('design-pane');
const outputPaneEl = document.getElementById('output-pane');
const overlayToggleBtn = document.getElementById('overlay-toggle');
const ovlSvg = document.getElementById('ovl');
function setOverlay(v) {
  overlayVisible = !!v;
  if (previewCanvas) previewCanvas.style.display = overlayVisible ? '' : 'none';
  if (ovlSvg) ovlSvg.style.display = overlayVisible ? '' : 'none';   // hide the SVG chrome too
  dragHandle?.setEnabled(overlayVisible);
  overlayToggleBtn?.classList.toggle('on', overlayVisible);
  if (overlayToggleBtn) overlayToggleBtn.textContent = 'fixtures';
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
  if (wallBtn) { wallBtn.classList.toggle('on', wallView); wallBtn.textContent = 'live'; }
  redrawOverlay();
}
wallBtn?.addEventListener('click', () => setWallView(!wallView));

setWallView(wallView);

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
  if (e.target.closest?.('#stagewrap, #side, #side-2, #deckbar, #corner-controls, #show-ui, #menu-pop')) return;
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
let reflowView = null;  // set by the zoom IIFE; re-clamps the view when the viewport (insets) changes
// One button in the corner toggles the whole UI; it stays put (the cluster keeps
// this button visible while hidden) and just relabels hide ⇄ show.
const toggleGui = () => {
  const hidden = document.body.classList.toggle('gui-hidden');
  const b = document.getElementById('g-hide');
  if (b) b.textContent = hidden ? 'Show UI' : 'Hide UI';
  updateStageInsets();   // hiding the UI frees the canvas to span the full window
};
document.addEventListener('keydown', (e) => {
  if (e.key !== 'h' && e.key !== 'H') return;
  if (typingIn(e.target)) return;
  toggleGui();
});

// --- Chrome: hide / show UI. (Master opacity lives in the Composition inspector
//     tab; the timer-reset button was removed.) ---
document.getElementById('g-hide')?.addEventListener('click', toggleGui);

// Delete key removes the current selection: the active clip on Composition, or
// the selected fixture on Output/Fixtures. Ignored while typing in a field.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const t = e.target;
  if (typingIn(t)) return;
  // On the Inventory (library) tab, ⌫ deletes the selected model / definition.
  if (!outputPaneEl?.hidden && outputTab === 'library') {
    if (panel.deleteSelected?.()) { renderOutput(); redrawOverlay(); }
    e.preventDefault();
    return;
  }
  // Merged Fixtures tab: a selected DEVICE (no fixture selected) → delete it
  // (deleteSelected confirms + unroutes its fixtures).
  if (!outputPaneEl?.hidden && !selectedFixtureIds.size && selectedDeviceId) {
    e.preventDefault();
    if (panel.deleteSelected?.()) { selectedDeviceId = null; renderOutput(); redrawOverlay(); }
    return;
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

// ⌘A / Ctrl-A in the Output section selects EVERY fixture (for bulk move /
// chain / delete). Only fires in Output, and never while typing in a field.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return;
  if (typingIn(e.target) || outputPaneEl?.hidden) return;
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
    } else if (Array.isArray(copy.input?.points)) copy.input.points = copy.input.points.map(([x, y]) => [x + 0.02, y + 0.02]);
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
  next.devices.push({ ...structuredClone(srcDev), id, name: `${srcDev.name || srcDev.id} copy` });
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
// The camera references the VIEWPORT (#stagewrap — the inset-aware region between
// the sidebars), NOT the whole window, so the clamp agrees with what you see. The
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
  // (inset-aware) #stagewrap, so its top-left is the wrap centre minus half the box.
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
  const overChrome = (t) => t?.closest?.('#side, #deckbar, #corner-controls, #menu-pop, .pick-pop');
  window.addEventListener('wheel', (e) => {
    if (overChrome(e.target)) return;                        // let panels scroll
    e.preventDefault();
    // Shift = pan instead of zoom — both axes (deltaX from a trackpad; a plain mouse
    // wheel only has deltaY, which pans vertically).
    if (e.shiftKey) { panX -= e.deltaX; panY -= e.deltaY; apply(); return; }
    const z2 = clamp(z * Math.exp(-e.deltaY * 0.0015));
    if (z2 === z) return;
    const rect = inner.getBoundingClientRect();
    const lx = (e.clientX - rect.left) / z, ly = (e.clientY - rect.top) / z;   // content point under cursor
    panX = (e.clientX - lx * z2) - (rect.left - panX);
    panY = (e.clientY - ly * z2) - (rect.top - panY);
    z = z2; apply();
  }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if ((e.key === '0' || e.key === ')') && !typingIn(e.target)) { reset(); e.preventDefault(); }
  });

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

// Inspector sub-tabs (Clip | Composition) — toggle which inspector pane shows.
const inspTabsEl = document.getElementById('insp-tabs');
const inspPanes = {
  clip: document.getElementById('insp-clip'),
  layer: document.getElementById('insp-layer'),
  composition: document.getElementById('insp-composition'),
};
function setInspectorTab(which) {
  try { localStorage.setItem('lz.itab', which); } catch { /* private mode */ }   // restore on reload
  activateTabs(inspTabsEl, 'itab', which);
  for (const [k, pane] of Object.entries(inspPanes)) if (pane) pane.hidden = k !== which;
}
inspTabsEl?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.subtab');
  if (b) setInspectorTab(b.dataset.itab);
});

// IO column tabs — a single flat row: Fixtures · Chains · Library.
//   Fixtures = PLACE them: snap tools + canvas placement list (output-list).
//   Chains   = chains list (output-list).
//   Library  = your inventory: Devices (controllers) + Fixtures (definitions).
const outputTabsEl = document.getElementById('io-tabs');
function setOutputTab(which) {
  outputTab = which;
  try { localStorage.setItem('lz.otab', which); } catch { /* private mode */ }   // restore on reload
  activateTabs(outputTabsEl, 'otab', which);
  // Three tabs: Fixtures = placement list · Devices = instances · Library = models.
  if (outputListEl) outputListEl.hidden = which !== 'fixtures';
  if (devicesDesignEl) devicesDesignEl.hidden = which !== 'devices';
  if (libraryDesignEl) libraryDesignEl.hidden = which !== 'library';
  renderOutput();
  updateStageInsets();
}
outputTabsEl?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.subtab');
  if (b) setOutputTab(b.dataset.otab);
});

// --- Top-level section switch: Design (Clip/Layer/Composition + library) vs
//     Output (Fixtures/Chains/Devices). Only one shows at a time.
//     (Element lookups are hoisted to the overlay section — see note there.) ---
const systemPaneEl = document.getElementById('system-pane');
const systemControlEl = document.getElementById('system-control');
const systemSettingsEl = document.getElementById('system-settings');
// The Control surface URL the QR/link point at. Prefer the daemon's LAN IP (a
// phone can't use localhost); fall back to this page's origin (works if the editor
// was itself opened via the LAN IP).
let companionUrl = `${location.origin}/control/`;
fetch('/api/info').then((r) => r.json()).then((info) => {
  if (info?.lan) { companionUrl = `http://${info.lan}:${info.port}/control/`; if (!systemPaneEl?.hidden) controlPanel.rebuild(); }
}).catch(() => { /* no daemon — keep the origin-based URL */ });

controlPanel = createControlPanel({
  mount: systemControlEl,
  getShow: () => show,
  // Apply a companion command locally (same canonical addresses the phone uses),
  // then reflect it in the panel + on the canvas.
  send: (address, value) => { handleExt(address, value); controlPanel.refresh(); redrawOverlay(); },
  status: () => ({ connected: !!bridge?.connected?.(), url: companionUrl }),
});

function setSection(which) {
  try { localStorage.setItem('lz.section', which); } catch { /* private mode */ }   // restore on reload
  activateTabs(sectionSwitchEl, 'section', which, 'section-active');
  if (designPaneEl) designPaneEl.hidden = which !== 'design';
  if (outputPaneEl) outputPaneEl.hidden = which !== 'output';
  if (systemPaneEl) systemPaneEl.hidden = which !== 'system';
  // The clip deck (layers) stays visible in EVERY section — including Output — so
  // you keep the composition in view while patching fixtures. It floats over the
  // canvas's top-left (it's pointer-transparent except the deck itself), same as in
  // Design. body.output-mode lets the layout dock the editor at the right.
  document.body.classList.toggle('output-mode', which === 'output');
  const leftEl = document.getElementById('left');
  if (leftEl) leftEl.hidden = false;
  updateInspector();   // recompute the #side-2 rail (drops the Inventory editor when leaving Output)
  if (which === 'system' && systemTab === 'control') controlPanel.rebuild();
}
sectionSwitchEl?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.section-tab');
  if (b) setSection(b.dataset.section);
});

// System subtab (declared BEFORE the initial setSection() below, which reads it).
let systemTab = (() => { try { return localStorage.getItem('lz.systab'); } catch { return null; } })();
systemTab = systemTab === 'control' ? 'control' : 'settings';   // default to Settings

// Initial layout: restore the last section (Design/Output/System) across
// reloads, defaulting to Design; IO column on its Fixtures tab; overlay SHOWN by
// default (you see your fixture layout on load; the canvas toggle hides it).
const savedSectionRaw = (() => { try { return localStorage.getItem('lz.section'); } catch { return null; } })();
const savedSection = savedSectionRaw === 'control' ? 'system' : savedSectionRaw;   // migrate old name
setSection(['design', 'output', 'system'].includes(savedSection) ? savedSection : 'design');

// --- Accent colour (user-selectable; persisted; live via CSS vars) -----------
const ACCENT_KEY = 'lz.accent';
const ACCENT_DEFAULT = '#e8a35c';
const ACCENT_PRESETS = ['#e8a35c', '#5cb8e8', '#6ee07d', '#5ce8c8', '#b98cff', '#e85c9e', '#e8d65c', '#ff6b6b'];
const accHexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [232, 163, 92]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const accToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const accMix = (a, b, w) => { const A = accHexToRgb(a), B = accHexToRgb(b); return accToHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };
// --accent cascades (green/amber/cyan + every color-mix(--accent …) follow); the
// soft/line/text variants are fixed values in CSS, so derive + override them here.
function applyAccent(hex) {
  const s = document.documentElement.style;
  s.setProperty('--accent', hex);
  s.setProperty('--accent-soft', accMix(hex, '#0a0a0a', 0.16));
  s.setProperty('--accent-line', accMix(hex, '#0a0a0a', 0.40));
  s.setProperty('--accent-text', accMix(hex, '#ffffff', 0.62));
  preview?.setAccentColor?.(hex);   // fixture chrome on the canvas follows the accent
}
const savedAccent = () => { try { return localStorage.getItem(ACCENT_KEY) || ACCENT_DEFAULT; } catch { return ACCENT_DEFAULT; } };
function setAccent(hex) { applyAccent(hex); try { localStorage.setItem(ACCENT_KEY, hex); } catch { /* private */ } redrawOverlay(); }
applyAccent(savedAccent());   // apply the saved accent on boot

// --- System pane: Settings / Control / Mapping subtabs -----------------------
const VALID_SYSTABS = ['settings', 'control'];
// The mapping surface lives in its own window (a named target → one reused
// window; the click is the user gesture that satisfies the popup blocker).
function openMappingsWindow() { try { return window.open('mappings/', 'lz-mappings', 'width=820,height=920'); } catch { return null; } }
document.getElementById('menu-mapping')?.addEventListener('click', openMappingsWindow);
function setSystemTab(which) {
  systemTab = VALID_SYSTABS.includes(which) ? which : 'settings';
  try { localStorage.setItem('lz.systab', systemTab); } catch { /* private */ }
  activateTabs(document.getElementById('system-tabs'), 'systab', systemTab);
  if (systemControlEl) systemControlEl.hidden = systemTab !== 'control';
  if (systemSettingsEl) systemSettingsEl.hidden = systemTab !== 'settings';
  if (systemTab === 'control' && !systemPaneEl?.hidden) controlPanel.rebuild();
  if (systemTab === 'settings') buildSettings(systemSettingsEl);   // refresh device list / accent state
}
document.getElementById('system-tabs')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.subtab');
  if (b) setSystemTab(b.dataset.systab);
});

// Settings pane: accent colour + audio input (more preferences can join later).
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
    sel.title = ok ? 'hardware input device for the Audio External modulator' : 'could not open that input — check permissions';
  });
  mount.append(oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Input' }), sel]));
  mount.append(Slider('Gain', show.composition?.audioGain ?? 1, {
    min: 0, max: 8, step: 0.05, default: 1, commit: 'live',
    onInput: (v) => { snapshotForUndo(show); show = { ...show, composition: { ...show.composition, audioGain: v } }; saveShowSoon(); },
  }));

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

  // --- Startup sound: the riff greets you on the first visit; opt in to hear it
  // on every reload. ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'startup sound' }));
  const riffAlways = () => { try { return localStorage.getItem('lz.riff.always') === '1'; } catch { return false; } };
  const riffBtn = oel('button', { className: 'fx-add' });
  const paintRiff = () => { riffBtn.textContent = (riffAlways() ? '▣' : '▢') + ' play riff on every reload'; riffBtn.classList.toggle('on', riffAlways()); };
  riffBtn.onclick = () => { try { localStorage.setItem('lz.riff.always', riffAlways() ? '0' : '1'); } catch { /* private */ } paintRiff(); };
  paintRiff();
  mount.append(riffBtn);

  // --- Confirm before deleting fixtures / devices / clips / layers. Default ON. ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'deleting' }));
  const delBtn = oel('button', { className: 'fx-add' });
  const paintDel = () => { delBtn.textContent = (confirmDeletesOn() ? '▣' : '▢') + ' confirm before deleting'; delBtn.classList.toggle('on', confirmDeletesOn()); };
  delBtn.onclick = () => { setConfirmDeletes(!confirmDeletesOn()); paintDel(); };
  paintDel();
  mount.append(delBtn);

  // (Recording removed — the show CONFIG file (File › Save/Open) is the portable
  // "recording": it re-runs the show live, interactivity intact. MIDI enable +
  // input lives in the Mapping window.)

  // --- Accent colour (least priority → last): 8 preset swatches. ---
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
setSystemTab(systemTab);
// Restore the last-used subtabs across reloads (section + systemTab already persist).
const savedOutputTab = (() => { try { return localStorage.getItem('lz.otab'); } catch { return null; } })();
setOutputTab(['fixtures', 'library'].includes(savedOutputTab) ? savedOutputTab : 'fixtures');
const savedInspTab = (() => { try { return localStorage.getItem('lz.itab'); } catch { return null; } })();
setInspectorTab(['clip', 'layer', 'composition'].includes(savedInspTab) ? savedInspTab : 'clip');
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
// Publish the composition aspect (w/h) as a CSS var so the "fit" canvas mode can
// scale the composite to fill its area (CSS can't read canvas attributes). Updated
// only when it changes — no per-frame style churn.
let lastAspect = 0;
function syncCompAspect() {
  const a = (canvas.width || 16) / (canvas.height || 9);
  if (a !== lastAspect) { lastAspect = a; document.documentElement.style.setProperty('--comp-aspect', String(a)); }
}
syncCompAspect();

// Fit the canvas to the left of the right panel (#side) in EVERY section — the
// composite always takes all the space minus the right sidebar (the deck floats
// over its top-left, like a HUD). Measured after layout (rAF) and published as CSS
// insets; only dropped to full-window when the whole UI is hidden.
function updateStageInsets() {
  cancelAnimationFrame(insetRaf);
  insetRaf = requestAnimationFrame(() => {
    const root = document.documentElement;
    const active = !document.body.classList.contains('gui-hidden');
    let right = 0;
    if (active) {
      const vw = window.innerWidth;
      // Only the MAIN inspector (#side) carves out canvas space. The #side-2 fixture
      // rail floats OVER the canvas (like the deck), so opening/closing it never
      // re-fits the composition.
      const side = document.getElementById('side')?.getBoundingClientRect();
      if (side) right = Math.max(0, vw - side.left);
    }
    root.style.setProperty('--inset-left', '0px');
    root.style.setProperty('--inset-right', right + 'px');
    reflowView?.();   // the viewport moved — re-clamp the camera against the new frame
  });
}
window.addEventListener('resize', updateStageInsets);

function loop(ts) {
  syncCompAspect();
  if (!t0) t0 = ts;
  if (ts < frameDue) { requestAnimationFrame(loop); return; }   // throttle to OUTPUT_FPS
  frameDue += FRAME_INTERVAL; if (frameDue < ts) frameDue = ts;  // don't bank a backlog
  lastTs = ts;
  const t = (ts - t0) / 1000;
  // Action bindings (clip triggers, layer opacity/bypass) driven by MIDI/key/OSC
  // channels — applied each frame, rising-edge for triggers/toggles. Non-undoable,
  // debounced save (like external input).
  {
    const chNow = extChannels();
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
    const signals = { ...updateAudio(), ...extChannels(), __bpm: show.composition?.bpm ?? 120 };
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
    const masterOpacity = show.composition?.opacity ?? 1;
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
      bridge?.send(lastRGBA);
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
    // Daemon came up / went down → refresh the Output list so "scan" enables/disables.
    if (!!live !== lastLive) { lastLive = !!live; if (outputPaneEl && !outputPaneEl.hidden && outputTab === 'fixtures') renderOutput(); }
    frames = 0; last = ts;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

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
  if (!show.fixtures?.length) { window.alert('No fixtures placed yet — nothing to fit to.'); return; }
  applyFullShow(fitCanvasToFixtures(show));
}

// New project: confirm, then reset to a sensible STARTER — one controller with a
// single fixture wired to it, lit by a Lines clip. (Not blank, so there's
// something on screen and a patch to build from.)
function newProject() {
  if (!window.confirm('Start a new project? This clears the current one (save first if you want to keep it).')) return;
  // Reset to the standard default (Lines + Checkered, Generic Controller, 1280²) —
  // the same show a fresh install loads.
  applyFullShow(normalizeComposition(defaultShow()));
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
      window.alert(loaded?.instances ? 'That looks like a LEDger file — use “import from LEDger…” in the File menu.' : 'Not a Led Zeppelin project file.');
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
  const files = [...(e.dataTransfer?.files || [])].filter((f) => isISFName(f.name));
  if (!files.length) return;
  e.preventDefault();
  const node = document.elementFromPoint(e.clientX, e.clientY);
  const target = { layerId: node?.closest?.('.deck-layer')?.dataset.layer, clipId: node?.closest?.('.clip-cell')?.dataset.clip };
  for (const f of files) importISFText(await f.text(), f.name, target);
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
document.getElementById('menu-install')?.addEventListener('click', () => window.open(`${REPO_URL}/releases`, '_blank', 'noopener'));
document.getElementById('menu-file')?.addEventListener('click', (e) => {
  e.stopPropagation();
  openMenu(e.currentTarget, menuList([
    { label: 'New project', act: newProject },
    { label: 'Save…', key: '⌘S', act: saveShowToFile },
    { label: 'Load…', key: '⌘O', act: () => openShowInput?.click() },
    { sep: true },
    { label: 'Import from LEDger…', act: () => { setSection('output'); setOutputTab('library'); importPanel.trigger?.(); } },
    { label: 'Import ISF shader…', act: () => openISFInput.click() },
    { sep: true },
    { label: 'Save composition…', act: saveCompositionToFile },
    { label: 'Load composition…', act: () => openCompInput.click() },
    { sep: true },
    // Feedback / bug reports go to GitHub Issues (prefilled with the app version).
    { label: 'Report a bug ↗', act: () => window.open(`${REPO_URL}/issues/new?title=${encodeURIComponent(`[bug] v${VERSION} — `)}`, '_blank', 'noopener') },
  ]));
});
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
