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
import {
  prefixedDefaults, normalizeComposition, makeClip, setActiveClip,
  setCanvasSize as setCanvasSizeModel, clampCanvasSize, playheadClip, setShowBpm,
} from './model/layers.js';
import { routeOsc } from './model/osc-map.js';
import { listMappables, bindMapping, clearMapping, setMappingMode, applyBindings } from './model/mappings.js';
import { buildRemoteManifest } from './model/remote.js';
import { syncShowFixtures, setFixtureTransform, transformFromPoints, pointsFromTransform, snap90, flipFixture, fixtureLabel, fixtureRange, fitCanvasToFixtures, thicknessOf, isAutoThickness } from './model/fixture-transform.js';
import { chainOf, freePort, pruneChains, wireAfter, wireFirst, controllerColorMap } from './model/chains.js';
import { resolveParams, animatedValue } from './model/anim.js';
import { updateAudio, setAudioGain, enableAudio, listInputs, registerMediaElement, unregisterMediaElement } from './model/audio.js';
import { enableMidi, midiEnabled, midiInputs, setBpmCallback } from './model/midi.js';
import { extSet, extChannels } from './model/external.js';
import { renderSourceThumbnails } from './engine/thumbs.js';
// Appearance/theme overrides removed — the app ships one curated base design
// (the :root tokens in ui.css). No saved colour overrides are applied.

const canvas = document.getElementById('stage');
const hud = document.getElementById('hud');
const gl = getGL(canvas);

// Bake a small thumbnail (data URL) per source generator for the library + slots.
const thumbnails = renderSourceThumbnails(gl);

// --- Default show: one device, two fixtures (single-device M2 target). ---
function defaultShow() {
  let show = emptyShow();
  const cv = show.composition.canvas;
  cv.w = 1024; cv.h = 1024;        // square default canvas
  // Generic placeholder hardware so the first run shows SOMETHING on the wall —
  // the user reconfigures (or scans) these to match their real rig.
  show = addDevice(show, { id: 'c1', name: 'Generic Controller', typeId: 'generic', ip: '', colorOrder: 'RGB', port: 4048 });   // blank IP — no false "offline" alarm; set/scan to go live
  // ONE generic fixture DEFINITION available in the library — but NO instances
  // placed on the canvas (an empty stage; the user maps their own rig).
  show.fixtureTypes = [{ id: 't1', name: 'Generic Fixture', ledsPerMeter: 60, meters: 1.6, pixelCount: 96, colorOrder: 'RGB' }];
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
let show = syncShowFixtures(syncFixtureTypes(syncDeviceTypes(initialShow())));

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
  else bridge = connectBridge(route, { onExt: handleExt, onManifestReq: () => broadcastManifest(true), fps: savedOutFps() });   // canonical OSC addresses + ext channels; phone asks → publish
  lastSpans = spans;
  recomputeHiddenSpans();
  lastRGBA = null;
  broadcastManifest();   // geometry change can rename/restructure → refresh the phone
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

// Count (device, port) outputs whose summed pixels exceed the controller's
// maxPerOutput. Over-capacity isn't invalid (the route still builds) — it just
// underruns the hardware framerate, so it's a warning, not a load-blocking error.
function overCapacityOutputs(s) {
  let n = 0;
  for (const d of s.devices || []) {
    const cap = Number(d.maxPerOutput) || 0;
    if (cap <= 0) continue;
    const byPort = new Map();
    for (const f of s.fixtures || []) {
      if ((f.output?.deviceId || '') !== d.id) continue;
      const p = f.output?.port ?? 1;
      byPort.set(p, (byPort.get(p) || 0) + (f.pixelCount || 0));
    }
    for (const px of byPort.values()) if (px > cap) n++;
  }
  return n;
}

// Composition-only edit path (layers/effects/params): the compositor reads
// show.composition.layers every frame, so we only need to swap in the new show
// and persist it — NO sampler/route/bridge rebuild (that's expensive and only
// fixture/device GEOMETRY changes require it).
function setComposition(next) {
  snapshotForUndo(show);   // capture the pre-change state for undo (coalesced)
  show = next;
  saveShow(show);
  broadcastManifest();
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
const layerPanel = createLayerPanel({
  getShow: () => show,
  setShow: (next) => setComposition(next), // composition-only: persist, no rebuild
  transport,
  thumbnails,
  onClipSelect: () => { setSection('design'); setInspectorTab('clip'); }, // jump to Design › Clip to tweak it
  onLayerSelect: () => { setSection('design'); setInspectorTab('layer'); }, // jump to Design › Layer
  onCompositionSelect: () => { setSection('design'); setInspectorTab('composition'); }, // jump to Design › Composition
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
  setBpm: (b) => { show = setShowBpm(show, b); saveShow(show); },
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
  const next = normalizeComposition({ ...show, composition: comp });
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
const redrawOverlay = () => preview?.draw(show, lastRGBA, selectedFixtureIds, (showGrid || snapEnabled) ? SNAP_GRID : 0, snapGuides, marqueeRect);

// Update the selection from a click. shift = toggle; clicking an already-selected
// fixture keeps the group (so it can be dragged); a new one selects just it.
function selectFixture(fxId, ev, opts = {}) {
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
  // Picking a single fixture (not a shift multi-select / empty click) jumps
  // straight to its editor — to the Output › Fixtures view, opened on that
  // fixture — so selecting on the canvas or placement list shows its properties.
  if (fxId != null && !(ev && ev.shiftKey)) {
    setSection('output');
    setOutputTab('fixtures');
    const sf = show.fixtures.find((f) => f.id === fxId);   // keep its controller + group open after deselect
    if (sf) { expandedDevices.add(sf.output?.deviceId || ''); expandedGroups.add(`${sf.output?.deviceId || ''}:${sf.output?.port ?? 1}`); }
    panel.selectFixture?.(fxId);
  }
  renderOutput(); redrawOverlay();
  // Scroll the picked fixture's row into view in the placement list.
  if (fxId != null) outputListEl?.querySelector(`.output-row[data-fxid="${fxId}"]`)?.scrollIntoView({ block: 'nearest' });
}

let dragHandle = null;
if (previewCanvas) {
  dragHandle = enableDragPlacement(previewCanvas, {
    getShow: () => show,
    getSelected: () => selectedFixtureIds,
    onSelect: (fxId, ev) => selectFixture(fxId, ev),
    onEdit: (next) => { show = next; redrawOverlay(); },         // live, no rebuild churn
    onCommit: (next) => { snapGuides = []; saveShow(next); rebuild(next); panel.refresh(); renderOutput(); },
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
  });
}

// --- Output mapping panel: add / select / position fixtures ------------------
const outputListEl = document.getElementById('output-list');
const outputInspectorEl = document.getElementById('output-inspector');   // left sidebar — selected item's editor
let outputTab = 'fixtures';   // Output sub-tab: fixtures | devices | library
const expandedGroups = new Set();    // device:output groups the user has OPENED (default = collapsed)
const expandedDevices = new Set();   // controllers the user has OPENED (default = collapsed)
// Controller-colour tint for the UI (preview chrome + placement-list swatches).
// Toggled from the corner "▢ color" button; persisted. Default ON.
let controllerTint = (() => { try { return localStorage.getItem('lz.tint') !== '0'; } catch { return true; } })();
const colorBtn = document.getElementById('color-btn');
function setControllerTint(on) {
  controllerTint = !!on;
  try { localStorage.setItem('lz.tint', controllerTint ? '1' : '0'); } catch { /* ignore */ }
  if (colorBtn) { colorBtn.classList.toggle('on', controllerTint); colorBtn.textContent = (controllerTint ? '▣' : '▢') + ' color'; }
  preview?.setColorTint?.(controllerTint);
  renderOutput(); redrawOverlay();
}
colorBtn?.addEventListener('click', () => setControllerTint(!controllerTint));
// Initial sync (preview exists; the startup renderOutput reads controllerTint).
if (colorBtn) { colorBtn.classList.toggle('on', controllerTint); colorBtn.textContent = (controllerTint ? '▣' : '▢') + ' color'; }
preview?.setColorTint?.(controllerTint);
// Snap toggle: a viewport corner button (mirrored by the Settings panel).
// setSnapEnabled keeps both in step.
const snapBtn = document.getElementById('snap-btn');
function setSnapEnabled(v) {
  snapEnabled = !!v;
  if (snapBtn) { snapBtn.classList.toggle('on', snapEnabled); snapBtn.textContent = (snapEnabled ? '▣' : '▢') + ' snap'; }
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
  if (gridBtn) { gridBtn.classList.toggle('on', showGrid); gridBtn.textContent = (showGrid ? '▣' : '▢') + ' grid'; }
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
      show = m.type === 'bind' ? bindMapping(show, m.id, m.channel, m.slot) : clearMapping(show, m.id, m.slot);
      saveShow(show); layerPanel?.refresh?.(); postMapParams();
    }
    else if (m.type === 'mode') { show = setMappingMode(show, m.id, m.mode); saveShow(show); postMapParams(); }
  };
  setInterval(pushMapChannels, 100);   // stream live channel values @10Hz
  setInterval(postMapParams, 2000);    // catch structural show changes (clips added/removed)
}
const oel = (tag, props = {}, kids = []) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) n.append(k); return n; };
// Output is PLACEMENT only — fixtures are designed/created in the Fixtures tab.

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
  const devSel = oel('select');
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
    const o = oel('option', { value: String(p), textContent: `output ${p}` });
    if (p === (sel.output?.port ?? 1)) o.selected = true;
    portSel.append(o);
  }
  portSel.disabled = !isHead;
  portSel.addEventListener('change', () => moveRun({ port: Number(portSel.value) }));
  // Two collapsible groups (same accent-header + rule + chevron as the Clip
  // inspector, so the two read as one instrument): POSITION = on-canvas geometry;
  // PATCH = which controller/output it's wired to + its pixel range + the chain.
  return oel('div', { className: 'output-edit' }, [
    Section('Position', 'position', (body) => {
      body.append(
        oel('div', { className: 'output-grid' }, [
          txField('X', tf.x, (v) => setT({ x: v })),
          txField('Y', tf.y, (v) => setT({ y: v })),
          txField('Length', tf.w, (v) => setT({ w: v })),
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
          txField('Rotation°', tf.rotation, (v) => setT({ rotation: v })),
        ]),
        oel('div', { className: 'dir-btns out-transform' }, [
          oel('button', { className: 'dir-btn', textContent: '⟳ 90°', title: 'rotate 90°',
            onclick: () => setT({ rotation: (snap90(tf.rotation) + 90) % 360 }) }),
          oel('button', { className: 'dir-btn' + (sel.input?.reversed ? ' on' : ''), textContent: '⇄ flip',
            title: 'reverse pixel direction (which end is pixel 0) — the canvas arrow points at pixel 0',
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

const applyShow = (next) => { saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay(); };

// Wiring for the selected fixture: its INPUT comes FROM another fixture's output
// (or straight from the controller = first on its output), and its OUTPUT goes TO
// the next fixture. Picking a "from" fixture moves this one onto that fixture's
// output, right after it — the node-graph edge. "to" is the derived successor.
function chainStatusRow(sel) {
  const ch = chainOf(show, sel.id);
  const idxOf = (id) => show.fixtures.findIndex((x) => x.id === id);
  const nameOf = (id) => { const i = idxOf(id); return i >= 0 ? fixtureLabel(show.fixtures[i], i) : id; };
  const tag = (id) => { const f = show.fixtures[idxOf(id)]; return `${nameOf(id)} (${f?.output?.deviceId || '?'}·o${f?.output?.port ?? 1})`; };
  const dev = show.devices.find((d) => d.id === sel.output?.deviceId);
  const devName = dev?.name || dev?.id || 'controller';
  // Pixel load + capacity on this fixture's output (0 max = unlimited).
  const runKeyOf = (f) => `${f.output?.deviceId || ''}:${f.output?.port ?? 1}`;
  const key = runKeyOf(sel);
  const runPx = show.fixtures.filter((f) => runKeyOf(f) === key).reduce((m, f) => m + (f.pixelCount || 0), 0);
  const cap = Number(dev?.maxPerOutput) || 0;
  const full = cap > 0 && runPx >= cap;
  // FROM picker: the controller (=first on its output) + every other fixture.
  const fromSel = oel('select');
  fromSel.append(oel('option', { value: '', textContent: `${devName} (controller)` }));
  for (const f of show.fixtures) if (f.id !== sel.id) fromSel.append(oel('option', { value: f.id, textContent: tag(f.id) }));
  fromSel.value = ch && ch.index > 0 ? ch.members[ch.index - 1] : '';
  fromSel.addEventListener('change', () => applyShow(fromSel.value ? wireAfter(show, sel.id, fromSel.value) : wireFirst(show, sel.id)));
  // TO picker: which fixture follows this one. Greyed when the output is FULL
  // (can't drive more pixels on a single output → end of chain).
  const next = ch && ch.index < ch.members.length - 1 ? ch.members[ch.index + 1] : null;
  const toSel = oel('select');
  toSel.append(oel('option', { value: '', textContent: full ? '— end (output full)' : '— end of chain' }));
  for (const f of show.fixtures) if (f.id !== sel.id) toSel.append(oel('option', { value: f.id, textContent: tag(f.id) }));
  toSel.value = next || '';
  toSel.disabled = full && !next;
  if (full) toSel.title = `${devName} output ${sel.output?.port ?? 1} is full (${runPx}/${cap}px)`;
  toSel.addEventListener('change', () => { if (toSel.value) applyShow(wireAfter(show, toSel.value, sel.id)); });
  const capTxt = cap > 0 ? ` · ${runPx}/${cap}px${full ? ' ⚠ full' : ''}` : '';
  return oel('div', {}, [
    oel('div', { className: 'fx-pts' + (full ? ' fx-err' : ''), textContent: (ch ? `⛓ ${ch.name} · ${ch.index + 1}/${ch.members.length}` : '⋈ first on its output') + capTxt }),
    oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Input ←' }), fromSel]),
    oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Output →' }), toSel]),
  ]);
}

// Multi-select action: put the selected fixtures on ONE shared output (a fresh
// port on the first one's device) so they become a chain.
function chainSelectedAction() {
  return oel('div', { className: 'output-edit' }, [
    oel('div', { className: 'fx-pts', textContent: `${selectedFixtureIds.size} fixtures selected — drag to move together` }),
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
  // Drop new strips at the TOP-LEFT (cascaded so successive adds don't fully
  // overlap) so they're easy to spot, and leave them UNASSIGNED (no device) — they
  // land in the "Unassigned" group until you wire them to an output. A thin
  // VERTICAL strip: thickness 10 px, run = pixel count (rotation 90° stands it up).
  const k = next.fixtures.length;
  const transform = { x: 30 + (k % 10) * 14, y: t.pixelCount / 2 + 24, w: t.pixelCount, h: 0, rotation: 90 };
  next.fixtures.push({
    id, typeId: t.id,
    output: { deviceId: '', port: 1, pixelOffset: 0, pixelCount: t.pixelCount },
    input: { mode: 'bar', transform, points: pointsFromTransform(transform, cv), samples: t.pixelCount },
  });
  selectedFixtureIds = new Set([id]);
  expandedDevices.add('');   // keep the Unassigned group open so the new strip shows in the list
  setOverlay(true);   // reveal the canvas overlay so the new strip is visible
  saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay();
}

// "+ fixture" control for the placement list: pick a definition to place. The
// definitions themselves are created/edited in the Library tab.
function addFixtureControl() {
  const wrap = oel('div', { className: 'output-tools' });
  const types = show.fixtureTypes || [];
  if (!types.length) {
    wrap.append(oel('span', { className: 'seg-hint', textContent: 'define a fixture type in the Inventory tab first' }));
    return wrap;
  }
  const sel = oel('select', { title: 'fixture type to place (defined in the Inventory tab)' });
  for (const t of types) {
    // Don't re-append the px count when the type's NAME already states it —
    // the default type is literally named "1.6m · 96px", so it rendered as the
    // baffling "1.6m · 96px · 96px".
    const label = /\d+\s*px/i.test(t.name || '') ? t.name : `${t.name} · ${t.pixelCount}px`;
    sel.append(oel('option', { value: t.id, textContent: label }));
  }
  wrap.append(
    oel('button', { className: 'fx-add', textContent: '+ fixture', onclick: () => addInstance(sel.value) }),
    oel('span', { className: 'seg-hint', textContent: 'type' }),
    sel
  );
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
  return window.confirm(msg);
}

// The LEFT sidebar editor: shows the selected item's properties for the active
// Output tab — a fixture's position (Fixtures), a device's settings (Devices),
// or a model/definition (Library). Hidden when nothing's selected / not Output.
function updateInspector() {
  if (!outputInspectorEl) return;
  let detail = null;
  if (outputPaneEl && !outputPaneEl.hidden) {
    if (outputTab === 'fixtures') {
      if (selectedFixtureIds.size === 1) {
        const f = (show.fixtures || []).find((x) => x.id === [...selectedFixtureIds][0]);
        if (f) detail = positionEditor(f);
      }
    } else if (outputTab === 'devices') detail = panel.deviceDetailEl?.();
    else if (outputTab === 'library') detail = panel.libraryDetailEl?.();
  }
  outputInspectorEl.textContent = '';
  if (detail) { outputInspectorEl.append(detail); outputInspectorEl.hidden = false; }
  else outputInspectorEl.hidden = true;
}

function renderOutput() {
  updateInspector();
  if (!outputListEl) return;
  outputListEl.textContent = '';
  const fixtures = show.fixtures || [];
  for (const id of [...selectedFixtureIds]) if (!fixtures.some((f) => f.id === id)) selectedFixtureIds.delete(id);

  if (outputTab === 'library') return;   // Library uses the device + fixture editors, not the placement list

  // 'fixtures' sub-tab: selectable rows + inline position editor under the row.
  if (!fixtures.length) {
    outputListEl.append(oel('div', { className: 'seg-hint', textContent: 'no fixtures placed yet — pick a definition to add' }));
    outputListEl.append(addFixtureControl());
    return;
  }
  const fixtureRow = (f, i) => {
    const row = oel('div', { className: 'output-row' + (selectedFixtureIds.has(f.id) ? ' selected' : '') });
    row.dataset.fxid = f.id;
    const name = oel('span', { textContent: fixtureLabel(f, i) });
    const rng = oel('span', { className: 'fx-badge', textContent: fixtureRange(f) });
    const eye = oel('button', {
      className: 'output-eye' + (f.hidden ? ' off' : ''), textContent: f.hidden ? '◌' : '●',
      title: f.hidden ? 'show fixture' : 'hide fixture',
    });
    eye.onclick = (e) => {
      e.stopPropagation();
      const n = structuredClone(show); const ff = n.fixtures.find((x) => x.id === f.id);
      ff.hidden = !ff.hidden; show = n; saveShow(n); recomputeHiddenSpans(); renderOutput(); redrawOverlay();
    };
    const del = oel('button', { textContent: '✕', className: 'ly-rmfx', title: 'remove fixture' });
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirmDeleteFixtures([f.id])) return;
      let n = structuredClone(show); n.fixtures = n.fixtures.filter((x) => x.id !== f.id);
      n = pruneChains(n);
      selectedFixtureIds.delete(f.id); rebuild(n); panel.refresh(); renderOutput();
    };
    row.onclick = (e) => selectFixture(f.id, e, { isolate: true });   // list click → just this fixture
    row.append(name, rng, eye, del);
    return row;
  };
  // GROUP the placement list by CONTROLLER → output. Two levels: a controller
  // header (collapsible), and under it each output (a chain, in wiring order).
  // Colour ties to the canvas — a base hue per controller, a tint per output.
  const cmap = controllerColorMap(show);
  // Controller-tint toggle (corner button): off ⇒ one neutral grey for all swatches.
  const NEUTRAL = 'rgba(150,156,166,.85)';
  const runColor = (d, p) => (controllerTint ? cmap.runColor(d, p) : NEUTRAL);
  const deviceColor = (d) => (controllerTint ? cmap.deviceColor(d) : NEUTRAL);
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
  const swatch = (color) => { const s = oel('span', { className: 'out-swatch' }); s.style.background = color; return s; };
  // Unassigned fixtures (no device) sort to the TOP so freshly-added strips are
  // obvious and easy to find before you wire them.
  devOrder.sort((a, b) => (a.deviceId === '' ? 0 : 1) - (b.deviceId === '' ? 0 : 1));

  for (const dg of devOrder) {
    const gdev = show.devices.find((d) => d.id === dg.deviceId);
    const devName = gdev?.name || dg.deviceId || 'Unassigned';
    const devFx = dg.groups.reduce((m, g) => m + g.items.length, 0);
    const devPx = dg.groups.reduce((m, g) => m + g.items.reduce((s, it) => s + (it.f.pixelCount || 0), 0), 0);
    const gcap = Number(gdev?.maxPerOutput) || 0;
    const devOver = gcap > 0 && dg.groups.some((g) => g.items.reduce((s, it) => s + (it.f.pixelCount || 0), 0) > gcap);
    const devOpen = expandedDevices.has(dg.deviceId);   // caret is authoritative; selecting a fixture adds it to the set (auto-reveal) but you can still collapse
    // Controller header. Clicking the NAME selects every fixture on the device;
    // clicking elsewhere on the header expands/collapses it.
    const devNameEl = oel('span', { className: 'out-group-dev', textContent: devName, title: `select all fixtures on ${devName}` });
    devNameEl.onclick = (ev) => {
      ev.stopPropagation();
      expandedDevices.add(dg.deviceId);   // selecting all reveals the group
      selectedFixtureIds = new Set(show.fixtures.filter((f) => (f.output?.deviceId || '') === dg.deviceId).map((f) => f.id));
      renderOutput(); redrawOverlay();
    };
    const dhead = oel('div', { className: 'out-group out-dev', title: `${devName} · ${dg.groups.length} out · ${devFx} fx · ${devPx}px` }, [
      oel('span', { className: 'out-caret', textContent: devOpen ? '▾' : '▸' }),
      swatch(deviceColor(dg.deviceId)),
      devNameEl,
      // One number — the controller's pixel load. Out/fx counts live on the
      // hover title; the outputs themselves appear when you expand.
      oel('span', { className: 'fx-badge' + (devOver ? ' out-over' : ''), textContent: `${devPx}px${devOver ? ' ⚠' : ''}` }),
    ]);
    dhead.onclick = () => { expandedDevices.has(dg.deviceId) ? expandedDevices.delete(dg.deviceId) : expandedDevices.add(dg.deviceId); renderOutput(); };
    outputListEl.append(dhead);
    if (!devOpen) continue;

    const singleOut = dg.groups.length === 1;   // one output → skip the redundant "out N" sub-header
    for (const g of dg.groups) {
      if (singleOut) { for (const { f, i } of g.items) outputListEl.append(fixtureRow(f, i)); continue; }
      const totalPx = g.items.reduce((m, it) => m + (it.f.pixelCount || 0), 0);
      const over = gcap > 0 && totalPx > gcap;
      const collapsed = !expandedGroups.has(g.key);
      const ohead = oel('div', { className: 'out-group out-sub', title: `${devName} · output ${g.port}${g.items.length > 1 ? ' · chained' : ''}` }, [
        oel('span', { className: 'out-caret', textContent: collapsed ? '▸' : '▾' }),
        swatch(runColor(g.deviceId, g.port)),
        oel('span', { className: 'out-group-port', textContent: `out ${g.port}` }),
        // Pixels only show the capacity when the output is OVER it (the common
        // case isn't); the ⛓ "chain" tag is dropped — multiple fixtures under one
        // output already mean a chain.
        oel('span', { className: 'fx-badge' + (over ? ' out-over' : ''), textContent: `${g.items.length} fx · ${over ? totalPx + '/' + gcap : totalPx}px${over ? ' ⚠' : ''}` }),
      ]);
      ohead.onclick = () => { expandedGroups.has(g.key) ? expandedGroups.delete(g.key) : expandedGroups.add(g.key); renderOutput(); };
      outputListEl.append(ohead);
      if (collapsed) continue;
      for (const { f, i } of g.items) outputListEl.append(fixtureRow(f, i));   // editor is in the left sidebar
    }
  }

  outputListEl.append(addFixtureControl());
  if (selectedFixtureIds.size > 1) outputListEl.append(chainSelectedAction());
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
  if (overlayToggleBtn) overlayToggleBtn.textContent = (overlayVisible ? '▣' : '▢') + ' fixtures';
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
function setWallView(v) {
  wallView = !!v;
  try { localStorage.setItem('lz.wall', wallView ? '1' : '0'); } catch { /* ignore */ }
  if (wallView && !overlayVisible) setOverlay(true);
  document.body.classList.toggle('wall-view', wallView);
  if (wallBtn) { wallBtn.classList.toggle('on', wallView); wallBtn.textContent = (wallView ? '▣' : '▢') + ' live'; }
}
wallBtn?.addEventListener('click', () => setWallView(!wallView));
setWallView(wallView);

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
  selectedFixtureIds.clear(); renderOutput(); redrawOverlay(); return true;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || typingIn(e.target)) return;
  if (clearFixtureSelection()) e.preventDefault();
});
document.addEventListener('pointerdown', (e) => {
  if (!selectedFixtureIds.size) return;
  if (e.target.closest?.('#stageinner, #side, #output-inspector, #deckbar, #corner-controls, #show-ui')) return;
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
// One button in the corner toggles the whole UI; it stays put (the cluster keeps
// this button visible while hidden) and just relabels hide ⇄ show.
const toggleGui = () => {
  const hidden = document.body.classList.toggle('gui-hidden');
  const b = document.getElementById('g-hide');
  if (b) b.textContent = hidden ? 'Show UI' : 'Hide UI';
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
  // On the Devices / Library tabs, ⌫ deletes the selected device / model /
  // definition (deleteSelected confirms before removing a device).
  if (!outputPaneEl?.hidden && (outputTab === 'devices' || outputTab === 'library')) {
    if (panel.deleteSelected?.()) { renderOutput(); redrawOverlay(); }
    e.preventDefault();
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
let fixtureClipboard = [];
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  if (typingIn(e.target)) return;
  const k = e.key.toLowerCase();
  if (k === 'c') {
    if (!selectedFixtureIds.size) return;
    fixtureClipboard = show.fixtures.filter((f) => selectedFixtureIds.has(f.id)).map((f) => structuredClone(f));
    e.preventDefault();
  } else if (k === 'v') {
    if (!fixtureClipboard.length) return;
    if (!overlayVisible) setOverlay(true);   // reveal the pasted copies
    e.preventDefault();
    const next = structuredClone(show);
    const devEnd = (devId) => next.fixtures
      .filter((x) => (x.output?.deviceId || '') === devId)
      .reduce((m, x) => Math.max(m, (x.output?.pixelOffset || 0) + (x.output?.pixelCount || 0)), 0);
    const newIds = [];
    for (const src of fixtureClipboard) {
      const copy = structuredClone(src);
      const base = (src.id || 'f').replace(/-copy\d*$/, '');
      let n = 1; do { copy.id = `${base}-copy${n > 1 ? n : ''}`; n++; } while (next.fixtures.some((x) => x.id === copy.id));
      copy.output.pixelOffset = devEnd(copy.output?.deviceId || '');   // contiguous append
      const tf = copy.input?.transform;
      if (tf) { tf.x = (tf.x || 0) + 20; tf.y = (tf.y || 0) + 20; }      // nudge off the original
      else if (Array.isArray(copy.input?.points)) copy.input.points = copy.input.points.map(([x, y]) => [x + 0.02, y + 0.02]);
      next.fixtures.push(copy);
      newIds.push(copy.id);
    }
    selectedFixtureIds.clear(); newIds.forEach((id) => selectedFixtureIds.add(id));
    saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay();
  }
});

// --- Stage zoom (scroll-wheel, zoom-to-cursor) + pan. A CSS transform on
// #stageinner scales BOTH the WebGL stage and the #preview overlay together;
// because preview.js maps pointer coords via getBoundingClientRect(), dragging
// and hit-testing stay correct at any zoom with no extra math. Shift+wheel pans
// vertically (wheel+drag-free); '0' resets. ---
(() => {
  const inner = document.getElementById('stageinner');
  if (!inner) return;
  // The view ALWAYS starts at 100% / centred on (re)load — it isn't persisted, so
  // a reload is a clean slate (Jonas). Zoom/pan live only for the session.
  let z = 1, panX = 0, panY = 0;
  const clamp = (v) => Math.max(0.25, Math.min(10, v));
  // Track the last-applied transform so clampPan() can back out the canvas's
  // (pan/zoom-invariant) layout box from a single getBoundingClientRect.
  let appliedX = 0, appliedY = 0, appliedZ = 1;
  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Keep the composite CONTAINED in the window: you can't shove it off into the
  // pasteboard. When the scaled content is larger than the viewport on an axis it
  // must cover it (edges no further in than the window); when smaller it must sit
  // fully inside. transformOrigin is 0 0, so the layout top-left maps to
  // (baseL+panX, baseT+panY) and the box is Lw·z × Lh·z.
  const clampPan = () => {
    const rect = inner.getBoundingClientRect();        // reflects appliedX/Y/Z
    const Lw = rect.width / (appliedZ || 1), Lh = rect.height / (appliedZ || 1);
    const baseL = rect.left - appliedX, baseT = rect.top - appliedY;   // layout origin (invariant)
    const cw = Lw * z, ch = Lh * z, winW = window.innerWidth, winH = window.innerHeight;
    panX = cw >= winW ? clampNum(panX, winW - cw - baseL, -baseL) : clampNum(panX, -baseL, winW - cw - baseL);
    panY = ch >= winH ? clampNum(panY, winH - ch - baseT, -baseT) : clampNum(panY, -baseT, winH - ch - baseT);
  };
  // A reset/zoom-% pill in the corner cluster — appears only when zoomed/panned.
  const resetBtn = document.createElement('button');
  resetBtn.className = 'g-btn'; resetBtn.title = 'reset view (0)'; resetBtn.textContent = '⤢ 100%';
  // Insert the zoom pill before the telemetry (#hud) so order reads: …buttons · zoom% · fps.
  document.getElementById('corner-controls')?.insertBefore(resetBtn, document.getElementById('hud'));
  const apply = () => {
    clampPan();
    inner.style.transformOrigin = '0 0';
    inner.style.transform = `translate(${panX}px,${panY}px) scale(${z})`;
    appliedX = panX; appliedY = panY; appliedZ = z;
    preview?.setRenderScale?.(z); redrawOverlay();      // re-render overlay crisp at the new zoom
    // Always-visible zoom readout (click to reset); 'on' accent only when zoomed/panned.
    const idle = z === 1 && panX === 0 && panY === 0;
    resetBtn.classList.toggle('on', !idle); resetBtn.textContent = `⤢ ${Math.round(z * 100)}%`;
  };
  apply();   // 100% / centred on startup
  const reset = () => { z = 1; panX = 0; panY = 0; apply(); };
  resetView = reset;          // expose to the top menu (View › Reset zoom)
  resetBtn.onclick = reset;
  // Wheel-zoom / Shift-pan work ANYWHERE over the canvas — bound to the window so
  // they fire over the pasteboard and even when the (transformed) canvas has been
  // panned out from under the cursor. Skipped over the scrollable chrome so the
  // sidebar / deck / menus still scroll normally.
  const overChrome = (t) => t?.closest?.('#side, #deckbar, #output-inspector, #corner-controls, #menu-pop, .pick-pop');
  window.addEventListener('wheel', (e) => {
    if (overChrome(e.target)) return;                        // let panels scroll
    e.preventDefault();
    if (e.shiftKey) { panX -= e.deltaY; apply(); return; }   // Shift = pan instead of zoom
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

  // --- HAND pan: MIDDLE-mouse drag to move the view, anywhere on the page. ---
  let panDrag = null;
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 1) return;                          // middle button only
    e.preventDefault();
    panDrag = { x: e.clientX, y: e.clientY };
    document.body.style.cursor = 'grabbing';
  }, { capture: true });
  window.addEventListener('pointermove', (e) => {
    if (!panDrag) return;
    panX += e.clientX - panDrag.x; panY += e.clientY - panDrag.y;
    panDrag.x = e.clientX; panDrag.y = e.clientY; apply();
  });
  const endPan = () => { if (!panDrag) return; panDrag = null; document.body.style.cursor = ''; };
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
  inspTabsEl?.querySelectorAll('.subtab').forEach((x) =>
    x.classList.toggle('subtab-active', x.dataset.itab === which));
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
  outputTabsEl?.querySelectorAll('.subtab').forEach((x) =>
    x.classList.toggle('subtab-active', x.dataset.otab === which));
  // Three tabs: Fixtures = placement list · Devices = instances · Library = models.
  if (outputListEl) outputListEl.hidden = which !== 'fixtures';
  if (devicesDesignEl) devicesDesignEl.hidden = which !== 'devices';
  if (libraryDesignEl) libraryDesignEl.hidden = which !== 'library';
  renderOutput();
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
// The companion URL the QR/link point at. Prefer the daemon's LAN IP (a phone
// can't use localhost); fall back to this page's origin (works if the editor was
// itself opened via the LAN IP).
let companionUrl = `${location.origin}/remote/`;
fetch('/api/info').then((r) => r.json()).then((info) => {
  if (info?.lan) { companionUrl = `http://${info.lan}:${info.port}/remote/`; if (!systemPaneEl?.hidden) controlPanel.rebuild(); }
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
  sectionSwitchEl?.querySelectorAll('.section-tab').forEach((x) =>
    x.classList.toggle('section-active', x.dataset.section === which));
  if (designPaneEl) designPaneEl.hidden = which !== 'design';
  if (outputPaneEl) outputPaneEl.hidden = which !== 'output';
  if (systemPaneEl) systemPaneEl.hidden = which !== 'system';
  // The clip deck stays visible in Design AND System (you keep the composition
  // in view while tweaking params); only Output hides it to give the canvas +
  // fixture editor the room. body.output-mode also lets CSS react.
  document.body.classList.toggle('output-mode', which === 'output');
  document.body.classList.toggle('deck-hidden', which === 'output');   // pin #side right only when the deck is gone
  const leftEl = document.getElementById('left');
  if (leftEl) leftEl.hidden = which === 'output';
  updateInspector();   // left sidebar only shows in Output
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
  document.querySelectorAll('#system-tabs .subtab').forEach((b) => b.classList.toggle('subtab-active', b.dataset.systab === systemTab));
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
    show = { ...show, composition: { ...show.composition, audioDevice: sel.value } };
    saveShow(show);
    sel.title = ok ? 'hardware input device for the Audio External modulator' : 'could not open that input — check permissions';
  });
  mount.append(oel('label', { className: 'fx-field' }, [oel('span', { textContent: 'Input' }), sel]));
  mount.append(Slider('Gain', show.composition?.audioGain ?? 1, {
    min: 0, max: 8, step: 0.05, default: 1, commit: 'live',
    onInput: (v) => { show = { ...show, composition: { ...show.composition, audioGain: v } }; saveShow(show); },
  }));

  // --- Snap (fixture placement): the grid step + neighbour-align tolerance. The
  // on/off lives on the viewport corner button (a quick toggle while placing). ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'snap' }));
  mount.append(Slider('Grid (px)', SNAP_GRID, {
    min: 2, max: 100, step: 1, default: 20, commit: 'live',
    onInput: (v) => { SNAP_GRID = Math.round(v); saveSnap(); redrawOverlay(); },
  }));
  mount.append(Slider('Distance (px)', SNAP_DIST, {
    min: 1, max: 40, step: 1, default: 10, commit: 'live',
    onInput: (v) => { SNAP_DIST = Math.round(v); saveSnap(); },
  }));

  // --- Output: global framerate cap sent to the daemon (caps the DDP/Art-Net rate). ---
  mount.append(oel('div', { className: 'fx-pts', textContent: 'output' }));
  mount.append(Slider('Max FPS', savedOutFps(), {
    min: 1, max: 60, step: 1, default: 42, commit: 'live',
    onInput: (v) => { const n = Math.max(1, Math.min(60, Math.round(v))); try { localStorage.setItem(OUTFPS_KEY, String(n)); } catch { /* ignore */ } bridge?.setOutputFps?.(n); },
  }));

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
setOutputTab('fixtures');
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
// Cap the heavy pipeline (composite → sample → DDP → preview) to WLED's ~42fps
// ceiling — no point rendering/sending faster than the wall can show. The
// accumulator auto-disables when we're compute-bound (frameDue catches up to ts),
// so it never drops frames we could otherwise have made.
const OUTPUT_FPS = 42, FRAME_INTERVAL = 1000 / OUTPUT_FPS;
let frameDue = 0;
function loop(ts) {
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
  if (sampler) {
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
      const lp = resolveParams(L.params, L.anim, t, signals);
      let clips = L.clips;
      if (clips && clips.some((c) => c && c.anim && Object.keys(c.anim).length)) {
        clips = clips.map((c) => {
          const a = c.anim;
          if (!(a && Object.keys(a).length)) return c;
          const params = resolveParams(c.params, a, t, signals);
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
    if (overlayVisible) preview?.draw(show, lastRGBA, selectedFixtureIds, (showGrid || snapEnabled) ? SNAP_GRID : 0, snapGuides, marqueeRect);

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
    const fps = (frames * 1000 / (ts - last)).toFixed(0);
    const cv = show.composition?.canvas || {};
    const nFix = (show.fixtures || []).length;
    const live = bridge?.connected?.();
    const err = bridge?.lastError?.();
    // 3-state output status. Only alarm (amber) when output is actually INTENDED —
    // i.e. a device has a real IP — but the daemon is unreachable. With no IPs set
    // (e.g. a fresh Kagora import) it reads a calm "output idle", not a red error.
    const configured = (show.devices || []).some((d) => d.ip && d.ip.trim());
    const out = live ? '● output live' : configured ? '◐ output offline — start the daemon' : '○ output idle';
    // Over-capacity outputs underrun the controller's framerate — surface a count
    // here so it's visible without expanding the Output list (rows are badged ⚠).
    const over = overCapacityOutputs(show);
    hud.classList.toggle('hud-offline', (!live && configured) || over > 0);
    hud.classList.toggle('hud-live', !!live);
    // Companion/daemon status (red offline / green live) on the Control subtab.
    document.getElementById('control-subdot')?.classList.toggle('on', !!live);
    if (err && !live && configured) hud.title = err; else hud.removeAttribute('title');
    hud.textContent = `${fps} fps  ·  ${cv.w || '?'}×${cv.h || '?'}  ·  ${nFix} fixture${nFix === 1 ? '' : 's'}  ·  ${out}`
      + (over > 0 ? `  ·  ⚠ ${over} over cap` : '');
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
  let next = emptyShow();
  const cv = next.composition.canvas;   // 1280×720
  next = addDevice(next, { id: 'c1', name: 'Controller 1', ip: '', colorOrder: 'GRB', port: 4048, typeId: 'digquad' });
  next.fixtureTypes = [{ id: 't1', name: '1m · 60px', ledsPerMeter: 60, meters: 1, pixelCount: 60, colorOrder: 'GRB' }];
  const transform = { x: cv.w / 2, y: cv.h / 2, w: 240, h: 0, rotation: 0 };
  next = addFixture(next, {
    id: 'f1', typeId: 't1',
    output: { deviceId: 'c1', port: 1, pixelOffset: 0, pixelCount: 60 },
    input: { mode: 'bar', transform, points: pointsFromTransform(transform, cv), samples: 60 },
  });
  const clip = { ...makeClip('line', undefined, 'clip1'), params: prefixedDefaults('line') };
  next.composition.layers = [
    { id: 'l1', name: 'Layer 1', blend: 'add', opacity: 1, clips: [clip], activeClipId: clip.id, effects: [], params: {}, transitionMs: 500 },
  ];
  applyFullShow(normalizeComposition(next));
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
    const row = oel('div', { className: 'menu-item' }, [oel('span', { textContent: it.label })]);
    if (it.key) row.append(oel('span', { className: 'menu-key', textContent: it.key }));
    row.onclick = () => { closeMenu(); it.act?.(); };
    f.append(row);
  }
  return f;
};
document.getElementById('menu-file')?.addEventListener('click', (e) => {
  e.stopPropagation();
  openMenu(e.currentTarget, menuList([
    { label: 'New project', act: newProject },
    { label: 'Save…', key: '⌘S', act: saveShowToFile },
    { label: 'Load…', key: '⌘O', act: () => openShowInput?.click() },
    { sep: true },
    { label: 'Import from LEDger…', act: () => { setSection('output'); setOutputTab('library'); importPanel.trigger?.(); } },
    { sep: true },
    { label: 'Save composition…', act: saveCompositionToFile },
    { label: 'Load composition…', act: () => openCompInput.click() },
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
