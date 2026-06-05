import { getGL, program, drawFullscreen } from './engine/gl.js';
import { emptyShow, addDevice, addFixture, validate } from './model/show.js';
import { buildPipelineInputs } from './model/pipeline.js';
import { makeSampler } from './engine/sampler.js';
import { makeCompositor } from './engine/compositor.js';
import { connectBridge } from './bridge.js';
import { createPreview, enableDragPlacement } from './ui/preview.js';
import { createFixturePanel, loadShow, saveShow } from './ui/fixtures.js';
import { createLayerPanel } from './ui/layers.js';
import { createImportPanel } from './ui/import.js';
import { createCompositionPanel } from './ui/composition.js';
import { createSettingsPanel } from './ui/settings.js';
import {
  prefixedDefaults, normalizeComposition, makeClip,
  setCanvasSize as setCanvasSizeModel, clampCanvasSize, playheadClip,
} from './model/layers.js';
import { syncShowFixtures, setFixtureTransform, transformFromPoints, snap90, flipFixture } from './model/fixture-transform.js';
import { addChain, removeChain, patchChain, moveChainMember, chainOf, pruneChains } from './model/chains.js';
import { resolveParams, animatedValue } from './model/anim.js';
import { updateAudio, setAudioGain } from './model/audio.js';
import { renderSourceThumbnails } from './engine/thumbs.js';
import { applyTheme } from './ui/theme.js';

applyTheme();   // restore any saved GUI-colour overrides before the UI paints

const canvas = document.getElementById('stage');
const hud = document.getElementById('hud');
const gl = getGL(canvas);

// Bake a small thumbnail (data URL) per source generator for the library + slots.
const thumbnails = renderSourceThumbnails(gl);

// --- Default show: one device, two fixtures (single-device M2 target). ---
function defaultShow() {
  let show = emptyShow();
  show = addDevice(show, { id: 'c1', name: 'DQ1', ip: '127.0.0.1', colorOrder: 'GRB', port: 4048 });
  show = addFixture(show, {
    id: 'f1', name: 'f1', pixelCount: 150, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 150 },
    input: { points: [[0.05, 0.30], [0.95, 0.30]], samples: 150 },
  });
  show = addFixture(show, {
    id: 'f2', name: 'f2', pixelCount: 150, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 150, pixelCount: 150 },
    input: { points: [[0.05, 0.70], [0.95, 0.70]], samples: 150 },
  });
  // One working composition layer (NEW clip schema) so the first run shows the
  // line. The single active clip carries the line generator + its prefixed
  // manifest defaults; with default speed=1/amp=0.45 the line self-animates
  // in-shader via uT. Layer-level effects/params start empty.
  const clip = { ...makeClip('line', undefined, 'c1'), params: prefixedDefaults('line') };
  show.composition.layers = [
    { id: 'l1', name: 'Layer 1', blend: 'add', opacity: 1,
      clips: [clip], activeClipId: clip.id,
      effects: [], params: {}, transitionMs: 500 },
  ];
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

// Sync fixture geometry on load: ensure every fixture has a pixel-space
// transform + freshly-derived normalized points for the current canvas.
let show = syncShowFixtures(initialShow());

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
  rebuild(s);
  panel?.refresh?.(); layerPanel?.refresh?.(); renderOutput(); redrawOverlay();
  undoSuppress = false;
  undoLastAt = 0;
}
function undo() { if (undoStack.length) { redoStack.push(show); restoreShow(undoStack.pop()); } }
function redo() { if (redoStack.length) { undoStack.push(show); restoreShow(redoStack.pop()); } }

function rebuild(next) {
  snapshotForUndo(show);   // capture the pre-change state for undo
  // Geometry path: ensure fixtures' derived sample points are in sync with their
  // pixel-space transforms + the current canvas before building the sampler.
  show = syncShowFixtures(next);
  const { sampleUVs, route, spans } = buildPipelineInputs(show);
  sampler?.dispose?.(); // free the previous sampler's GL objects before reassigning
  sampler = sampleUVs.length ? makeSampler(gl, sampleUVs) : null;
  // Push the new route over the existing socket (no reconnect blip); only
  // construct a bridge on first build. Keeps output live + stats across edits.
  if (bridge?.setRoute) bridge.setRoute(route);
  else bridge = connectBridge(route);
  lastSpans = spans;
  recomputeHiddenSpans();
  lastRGBA = null;
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
  show = next;
  saveShow(show);
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
const preview = previewCanvas ? createPreview(previewCanvas) : null;

const panel = createFixturePanel({
  getShow: () => show,
  setShow: (next) => rebuild(next),
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
  onClipSelect: () => setInspectorTab('clip'), // clicking a clip focuses the Clip inspector
  onLayerSelect: () => setInspectorTab('layer'), // clicking the layer rectangle focuses the Layer inspector
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
  applyShow: (next) => rebuild(next),
  onApplied: () => { panel.refresh(); layerPanel.refresh(); },
});
// Composition (canvas resolution) is composition-global, so it sits at the top
// of the editor, above Import/Layers/Fixtures.
const compositionPanel = createCompositionPanel({
  getShow: () => show,
  setSize: (w, h) => setCanvasSize(w, h),
});
// Output selection + snap state. Declared here (before the Settings panel, whose
// initial render reads snap state) to avoid a temporal-dead-zone access.
let selectedFixtureIds = new Set();
let SNAP_GRID = 20;     // grid step (px) fixtures snap to when not aligning to a neighbour
let SNAP_DIST = 10;     // px tolerance for aligning to another fixture / centre
let snapEnabled = false;
let snapGuides = [];    // alignment guide lines to draw during a snapped drag
// Global Settings panel — app-wide preferences (theme, audio gain, crossfade,
// snap, composition file I/O). Mounts into its own top-level Settings view.
const settingsPanel = createSettingsPanel({
  getShow: () => show,
  setShow: (next) => setComposition(next), // crossfade / audio gain: composition-only persist
  loadComposition: (comp) => applyComposition(comp),
  snap: {
    enabled: () => snapEnabled,
    setEnabled: (b) => setSnapEnabled(b),
    grid: () => SNAP_GRID,
    setGrid: (n) => { SNAP_GRID = Math.max(1, n); redrawOverlay(); },
    dist: () => SNAP_DIST,
    setDist: (n) => { SNAP_DIST = Math.max(0, n); },
  },
});

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
const fixturesPanels = document.getElementById('fixtures-panels');
compSettings?.append(compositionPanel.el);     // canvas-resolution panel atop the inspector
fixturesPanels?.append(importPanel.el);
fixturesPanels?.append(panel.el);
document.getElementById('settings-panel')?.append(settingsPanel.el);

// (Output selection + snap state are declared earlier, above the Settings panel.)

// Snap a proposed CENTRE (x,y) for fixture `fid`: align its left/centre/right
// EDGES (and top/centre/bottom) to other fixtures' edges/centres and the canvas
// edges/centre — so fixtures sit neatly next to each other. Records guide lines;
// falls back to the grid on any axis that didn't snap.
function snapPoint(x, y, fid, excludeIds) {
  snapGuides = [];
  if (!snapEnabled) return [x, y];
  const ex = new Set(excludeIds || []);
  const cv = show.composition?.canvas || { w: 1280, h: 720 };
  const me = show.fixtures.find((f) => f.id === fid)?.input?.transform || { w: 0, h: 0 };
  const hw = (me.w || 0) / 2, hh = (me.h || 0) / 2;
  // Target edge/centre lines on each axis (canvas + every other fixture).
  const xT = [0, cv.w / 2, cv.w], yT = [0, cv.h / 2, cv.h];
  for (const f of show.fixtures || []) {
    if (ex.has(f.id)) continue;
    const t = f.input?.transform; if (!t) continue;
    xT.push(t.x - t.w / 2, t.x, t.x + t.w / 2);
    yT.push(t.y - t.h / 2, t.y, t.y + t.h / 2);
  }
  // The dragged fixture's own left/centre/right (and top/centre/bottom) offsets.
  let sx = x, sy = y, bestX = SNAP_DIST, bestY = SNAP_DIST, gx = null, gy = null;
  for (const off of [-hw, 0, hw]) for (const tx of xT) {
    const d = Math.abs((x + off) - tx); if (d < bestX) { bestX = d; sx = tx - off; gx = tx; }
  }
  for (const off of [-hh, 0, hh]) for (const ty of yT) {
    const d = Math.abs((y + off) - ty); if (d < bestY) { bestY = d; sy = ty - off; gy = ty; }
  }
  if (gx !== null) snapGuides.push({ axis: 'x', v: gx }); else sx = Math.round(x / SNAP_GRID) * SNAP_GRID;
  if (gy !== null) snapGuides.push({ axis: 'y', v: gy }); else sy = Math.round(y / SNAP_GRID) * SNAP_GRID;
  return [sx, sy];
}
const redrawOverlay = () => preview?.draw(show, lastRGBA, selectedFixtureIds, snapEnabled ? SNAP_GRID : 0, snapGuides);

// Update the selection from a click. shift = toggle; clicking an already-selected
// fixture keeps the group (so it can be dragged); a new one selects just it.
function selectFixture(fxId, ev) {
  if (ev && ev.shiftKey) {
    if (fxId == null) return;
    if (selectedFixtureIds.has(fxId)) selectedFixtureIds.delete(fxId); else selectedFixtureIds.add(fxId);
  } else if (fxId == null) {
    selectedFixtureIds.clear();
  } else if (!selectedFixtureIds.has(fxId)) {
    selectedFixtureIds = new Set([fxId]);
  }
  renderOutput(); redrawOverlay();
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
    enabled: false, // gated by view state below; default tab is Composition
  });
}

// --- Output mapping panel: add / select / position fixtures ------------------
const outputListEl = document.getElementById('output-list');
let outputTab = 'fixtures';   // Output sub-tab: fixtures | chains | devices
const snapToggle = document.getElementById('snap-cb');
// Snap enable lives in two mirrored controls (the Output strip checkbox + the
// Settings panel). setSnapEnabled keeps both in step.
function setSnapEnabled(v) {
  snapEnabled = !!v;
  if (snapToggle) snapToggle.checked = snapEnabled;
  redrawOverlay();
}
snapToggle?.addEventListener('change', () => setSnapEnabled(snapToggle.checked));
const oel = (tag, props = {}, kids = []) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) n.append(k); return n; };
// Output is PLACEMENT only — fixtures are designed/created in the Fixtures tab.

// A px number field (commits on change) for the selected fixture's transform.
function txField(label, value, onCommit) {
  const i = oel('input', { type: 'number', step: '1', value: String(Math.round(value)) });
  i.addEventListener('change', () => onCommit(i.value === '' ? 0 : Number(i.value)));
  return oel('label', { className: 'fx-field' }, [oel('span', { textContent: label }), i]);
}

// Position editor for one selected fixture (inlined under its row): x/y/length/
// rotation° fields + a rotate-90° / flip button row.
function positionEditor(sel) {
  const tf = sel.input.transform || transformFromPoints(sel.input.points, show.composition?.canvas);
  const apply = (next) => { saveShow(next); rebuild(next); panel.refresh(); renderOutput(); redrawOverlay(); };
  const setT = (patch) => apply(setFixtureTransform(show, sel.id, patch));
  return oel('div', { className: 'output-edit' }, [
    oel('div', { className: 'output-grid' }, [
      txField('x', tf.x, (v) => setT({ x: v })),
      txField('y', tf.y, (v) => setT({ y: v })),
      txField('length', tf.w, (v) => setT({ w: v })),
      txField('rotation°', tf.rotation, (v) => setT({ rotation: v })),
    ]),
    oel('div', { className: 'dir-btns out-transform' }, [
      oel('button', { className: 'dir-btn', textContent: '⟳ 90°', title: 'rotate 90°',
        onclick: () => setT({ rotation: (snap90(tf.rotation) + 90) % 360 }) }),
      oel('button', { className: 'dir-btn', textContent: '⇄ flip', title: 'flip pixel direction (which end is pixel 0)',
        onclick: () => apply(flipFixture(show, sel.id)) }),
    ]),
  ]);
}

// "chain selected (stagger)" action shown when 2+ fixtures are selected.
function chainSelectedAction() {
  return oel('div', { className: 'output-edit' }, [
    oel('div', { className: 'fx-pts', textContent: `${selectedFixtureIds.size} fixtures selected — drag to move together` }),
    oel('button', {
      className: 'fx-add', textContent: '⛓ chain selected (stagger)',
      onclick: () => {
        const next = addChain(show, [...selectedFixtureIds]);
        saveShow(next); rebuild(next); renderOutput(); redrawOverlay();
      },
    }),
  ]);
}

// Read-only per-device routing overview (the Devices sub-tab) — pixel + fixture
// totals per controller. A natural home for live health pills later.
function renderDeviceSummary() {
  const devs = show.devices || [];
  if (!devs.length) {
    outputListEl.append(oel('div', { className: 'seg-hint', textContent: 'no devices — add them in the Fixtures tab' }));
    return;
  }
  for (const d of devs) {
    const fxs = (show.fixtures || []).filter((f) => (f.output?.deviceId || '') === d.id);
    const px = fxs.reduce((m, f) => m + (f.pixelCount || 0), 0);
    outputListEl.append(oel('div', { className: 'output-row' }, [
      oel('span', { textContent: d.name || d.id }),
      oel('span', { className: 'output-dev', textContent: d.ip || 'no ip' }),
      oel('span', { className: 'fx-badge', textContent: `${px} px` }),
      oel('span', { className: 'fx-badge', textContent: `${fxs.length} fx` }),
    ]));
  }
}

function renderOutput() {
  if (!outputListEl) return;
  outputListEl.textContent = '';
  const fixtures = show.fixtures || [];
  for (const id of [...selectedFixtureIds]) if (!fixtures.some((f) => f.id === id)) selectedFixtureIds.delete(id);

  if (outputTab === 'devices') { renderDeviceSummary(); return; }
  if (outputTab === 'chains') {
    if (selectedFixtureIds.size > 1) outputListEl.append(chainSelectedAction());
    renderChains();
    return;
  }

  // 'fixtures' sub-tab: selectable rows + inline position editor under the row.
  if (!fixtures.length) {
    outputListEl.append(oel('div', { className: 'seg-hint', textContent: 'no fixtures yet — design them in the Fixtures tab, then place them here' }));
    return;
  }
  for (const f of fixtures) {
    const row = oel('div', { className: 'output-row' + (selectedFixtureIds.has(f.id) ? ' selected' : '') });
    const name = oel('span', { textContent: f.name || f.id });
    const dev = oel('span', { className: 'output-dev', textContent: f.output?.deviceId || '—' });
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
      let n = structuredClone(show); n.fixtures = n.fixtures.filter((x) => x.id !== f.id);
      n = pruneChains(n);   // keep chain stagger indices correct after a deletion
      selectedFixtureIds.delete(f.id); rebuild(n); panel.refresh(); renderOutput();
    };
    row.onclick = (e) => selectFixture(f.id, e);
    row.append(name, dev, eye, del);
    outputListEl.append(row);
    // Inline the position editor directly under the singly-selected fixture.
    if (selectedFixtureIds.size === 1 && selectedFixtureIds.has(f.id)) outputListEl.append(positionEditor(f));
  }

  if (selectedFixtureIds.size > 1) outputListEl.append(chainSelectedAction());
}

// Chains: ordered fixture groups with a stagger offset (cascade a pulse). Each
// card: members (reorderable), a stagger slider, an axis toggle, and delete.
function renderChains() {
  const chains = show.chains || [];
  if (!chains.length) return;
  const commit = (next) => { saveShow(next); rebuild(next); renderOutput(); redrawOverlay(); };
  const fxName = (id) => (show.fixtures.find((f) => f.id === id)?.name || id);

  const wrap = oel('div', { className: 'chains' }, [oel('div', { className: 'fx-pts', textContent: 'chains (stagger)' })]);
  for (const c of chains) {
    const card = oel('div', { className: 'chain-card' });
    const head = oel('div', { className: 'chain-head' }, [
      oel('span', { className: 'chain-name', textContent: c.name }),
      oel('button', { className: 'chain-fire', textContent: '⚡', title: 'fire a pulse to preview the stagger', onclick: () => transport.fire() }),
      oel('button', { className: 'ly-rmfx', textContent: '✕', title: 'remove chain', onclick: () => commit(removeChain(show, c.id)) }),
    ]);
    card.append(head);

    // Ordered members — index drives the stagger; ▲▼ reorder, ✕ removes one.
    const list = oel('div', { className: 'chain-members' });
    c.members.forEach((m, i) => {
      list.append(oel('div', { className: 'chain-member' }, [
        oel('span', { className: 'chain-idx', textContent: String(i) }),
        oel('span', { className: 'chain-mname', textContent: fxName(m) }),
        oel('button', { textContent: '▲', title: 'earlier', disabled: i === 0, onclick: () => commit(moveChainMember(show, c.id, m, -1)) }),
        oel('button', { textContent: '▼', title: 'later', disabled: i === c.members.length - 1, onclick: () => commit(moveChainMember(show, c.id, m, 1)) }),
        oel('button', { className: 'ly-rmfx', textContent: '✕', title: 'remove from chain', onclick: () => commit(patchChain(show, c.id, { members: c.members.filter((x) => x !== m) })) }),
      ]));
    });
    card.append(list);

    // Stagger amount (normalized canvas offset per step) + readout.
    const sOut = oel('span', { className: 'ly-readout', textContent: c.stagger.toFixed(2) });
    const sRange = oel('input', { type: 'range', min: '-0.5', max: '0.5', step: '0.01', value: String(c.stagger) });
    const fillS = () => sRange.style.setProperty('--fill', ((Number(sRange.value) + 0.5) / 1 * 100) + '%');
    fillS();
    sRange.addEventListener('input', () => { sOut.textContent = Number(sRange.value).toFixed(2); fillS(); });
    sRange.addEventListener('change', () => commit(patchChain(show, c.id, { stagger: Number(sRange.value) })));
    sRange.addEventListener('contextmenu', (e) => { e.preventDefault(); commit(patchChain(show, c.id, { stagger: 0.1 })); });
    card.append(oel('label', { className: 'fx-field ly-param ly-row' }, [
      oel('span', { className: 'ly-plabel', textContent: 'stagger' }), sOut, sRange,
    ]));

    // Axis: which way the cascade travels (matches the source's travel axis).
    const axisBtns = oel('div', { className: 'dir-btns chain-axis' }, ['x', 'y'].map((ax) => oel('button', {
      className: 'dir-btn' + (c.axis === ax ? ' on' : ''), textContent: ax.toUpperCase(),
      onclick: () => commit(patchChain(show, c.id, { axis: ax })),
    })));
    card.append(oel('label', { className: 'fx-field ly-param ly-row' }, [
      oel('span', { className: 'ly-plabel', textContent: 'axis' }), axisBtns,
    ]));

    wrap.append(card);
  }
  outputListEl.append(wrap);
}
const renderOutputList = renderOutput; // back-compat alias

// --- Workspace layout: there are NO top-level tabs. The deck, the Clip/Layer/
//     Composition inspector, and the Output/Fixtures column are all visible at
//     once. The fixture overlay (draggable rectangles on the canvas) is a
//     separate toggle, decoupled from any tab. ---
let overlayVisible = false;   // are the fixture rectangles shown over the composite?
const overlayToggleBtn = document.getElementById('overlay-toggle');
function setOverlay(v) {
  overlayVisible = !!v;
  if (previewCanvas) previewCanvas.style.display = overlayVisible ? '' : 'none';
  dragHandle?.setEnabled(overlayVisible);
  overlayToggleBtn?.classList.toggle('on', overlayVisible);
  if (overlayToggleBtn) overlayToggleBtn.textContent = (overlayVisible ? '▣' : '▢') + ' fixtures';
  if (overlayVisible) renderOutput();
  redrawOverlay();
}
overlayToggleBtn?.addEventListener('click', () => setOverlay(!overlayVisible));

// Output / Fixtures column sub-tabs (top level of that column).
const ioTabsEl = document.getElementById('io-tabs');
const ioPanes = {
  output: document.getElementById('io-output'),
  fixtures: document.getElementById('io-fixtures'),
};
function setIoTab(which) {
  ioTabsEl?.querySelectorAll('.subtab').forEach((x) =>
    x.classList.toggle('subtab-active', x.dataset.iotab === which));
  for (const [k, pane] of Object.entries(ioPanes)) if (pane) pane.hidden = k !== which;
}
ioTabsEl?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.subtab');
  if (b) setIoTab(b.dataset.iotab);
});

// --- Settings dialog: a modal opened from the top-bar gear. Refreshes on open
//     so it reads live snap/theme/gain state. ---
const settingsModal = document.getElementById('settings-modal');
function openSettings() { settingsPanel.refresh(); if (settingsModal) settingsModal.hidden = false; }
function closeSettings() { if (settingsModal) settingsModal.hidden = true; }
document.getElementById('g-settings')?.addEventListener('click', openSettings);
settingsModal?.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeSettings(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal && !settingsModal.hidden) { closeSettings(); e.preventDefault(); }
});

const typingIn = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

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
const toggleGui = () => document.body.classList.toggle('gui-hidden');
document.addEventListener('keydown', (e) => {
  if (e.key !== 'h' && e.key !== 'H') return;
  if (typingIn(e.target)) return;
  toggleGui();
});

// --- Chrome: hide / show UI. (Master opacity lives in the Composition inspector
//     tab; the timer-reset button was removed.) ---
document.getElementById('g-hide')?.addEventListener('click', toggleGui);
document.getElementById('show-ui')?.addEventListener('click', toggleGui);

// Delete key removes the current selection: the active clip on Composition, or
// the selected fixture on Output/Fixtures. Ignored while typing in a field.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const t = e.target;
  if (typingIn(t)) return;
  // With everything on one screen, the fixture overlay being visible (mapping
  // mode) + a selected fixture is the signal to delete fixtures; otherwise the
  // Delete acts on the composition (effect → layer → clip).
  if (overlayVisible && selectedFixtureIds.size) {
    const n = structuredClone(show); n.fixtures = n.fixtures.filter((x) => !selectedFixtureIds.has(x.id));
    selectedFixtureIds.clear(); rebuild(n); panel.refresh(); renderOutput(); e.preventDefault();
  } else {
    // Delete priority: a selected effect, else a selected layer, else the clip.
    // (Clicking a layer clears the clip selection, so a layer is the delete
    // target only when no clip is selected.)
    if (!layerPanel.deleteSelectedEffect?.() && !layerPanel.deleteSelectedLayer?.()) layerPanel.deleteActiveClip();
    e.preventDefault();
  }
});

// Arrow-key nudge: move the selected fixture(s) by 1px (10px with Shift). Same
// commit path as a canvas drag. Only while the fixture overlay is up (mapping
// mode) with a selection; ignored while typing in a field.
document.addEventListener('keydown', (e) => {
  if (!overlayVisible || !selectedFixtureIds.size) return;
  if (typingIn(e.target)) return;
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

// Output sub-tabs (Fixtures | Chains | Devices).
const outputTabsEl = document.getElementById('output-tabs');
function setOutputTab(which) {
  outputTab = which;
  outputTabsEl?.querySelectorAll('.subtab').forEach((x) =>
    x.classList.toggle('subtab-active', x.dataset.otab === which));
  renderOutput();
}
outputTabsEl?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.subtab');
  if (b) setOutputTab(b.dataset.otab);
});

// Initial layout: Output column on its Output tab, the fixture overlay SHOWN by
// default (you see your fixture layout on load; the canvas toggle hides it for a
// clean composite preview), and the output list populated.
setIoTab('output');
setOverlay(true);
renderOutput();

// --- Video clips: a <video> element + GL texture per video clip (runtime only;
// the show stores only the object URL). syncVideos() reconciles the map with the
// show each frame; uploadVideos() pushes the current frame into each texture.
const videoMap = new Map(); // clipId → { url, el, tex }
function syncVideos() {
  const clips = [];
  for (const L of show.composition?.layers || []) for (const c of L.clips || []) {
    if (c.generator === 'video' && c.videoUrl) clips.push(c);
  }
  const live = new Set(clips.map((c) => c.id));
  for (const [id, v] of videoMap) {
    if (!live.has(id)) { try { v.el.pause(); } catch { /* ignore */ } gl.deleteTexture(v.tex); videoMap.delete(id); }
  }
  for (const c of clips) {
    const existing = videoMap.get(c.id);
    if (existing && existing.url === c.videoUrl) continue;
    if (existing) { try { existing.el.pause(); } catch { /* ignore */ } gl.deleteTexture(existing.tex); }
    const el = document.createElement('video');
    el.src = c.videoUrl; el.loop = true; el.muted = true; el.playsInline = true; el.autoplay = true;
    el.play().catch(() => { /* will play on first user gesture */ });
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    videoMap.set(c.id, { url: c.videoUrl, el, tex });
  }
}
function uploadVideos() {
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
function loop(ts) {
  if (!t0) t0 = ts;
  lastTs = ts;
  const t = (ts - t0) / 1000;
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
        layerPanel.setPlayhead(clips.findIndex((c) => c.id === ph.clip.id));   // real deck index
      }
    }
    // Per-parameter animations run on a free-running clock (Timeline) or off the
    // live audio bands (Audio); resolve each layer's + clip's animated params to
    // plain numbers before compositing. No-op (same ref) when nothing is animated.
    setAudioGain(show.composition?.audioGain ?? 1);
    const bands = updateAudio();
    renderLayers = renderLayers.map((L) => {
      const lp = resolveParams(L.params, L.anim, t, bands);
      let clips = L.clips;
      if (clips && clips.some((c) => c.anim && Object.keys(c.anim).length)) {
        clips = clips.map((c) => {
          const a = c.anim;
          if (!(a && Object.keys(a).length)) return c;
          const params = resolveParams(c.params, a, t, bands);
          // Animated TRANSFORM (keys tf.x/tf.y/tf.scale/tf.rotation) + OPACITY (tf.opacity).
          let transform = c.transform, opacity = c.opacity;
          if (a['tf.x'] || a['tf.y'] || a['tf.scale'] || a['tf.rotation']) {
            transform = { ...(c.transform || {}) };
            for (const f of ['x', 'y', 'scale', 'rotation']) if (a['tf.' + f]) transform[f] = animatedValue(a['tf.' + f], t, bands);
          }
          if (a['tf.opacity']) opacity = animatedValue(a['tf.opacity'], t, bands);
          return { ...c, params, transform, opacity };
        });
      }
      return (lp === L.params && clips === L.clips) ? L : { ...L, params: lp, clips };
    });
    // Move the inspector's animated sliders live (selected clip + composition).
    layerPanel.updateLive?.(t, bands);
    // Composite all layers into compositor.tex. (The line generator self-animates
    // in-shader via uT — see manifest.js — so the loop no longer mutates params.)
    // env.trigSec drives triggerable sources (Pulse) via the shader's uTrig.
    const masterOpacity = show.composition?.opacity ?? 1;
    const transitionMs = show.composition?.transitionMs ?? 500;   // GLOBAL crossfade (all layers)
    compositor.render(renderLayers, t, {
      trigSecs: pulseTrigSecs, videoTex, masterOpacity, transitionMs,
      compositionEffects: show.composition?.effects, compositionParams: show.composition?.params,
    });

    // Sample composited canvas → RGBA8 per output pixel, ship RGB, feed preview.
    // No fixtures ⇒ no sampler; still composite to screen below (don't crash).
    lastRGBA = sampler ? sampler.sample(compositor.tex) : null;
    if (lastRGBA) {
      for (const s of hiddenSpans) lastRGBA.fill(0, s.start * 4, (s.start + s.count) * 4); // hidden → dark on the wall
      bridge?.send(lastRGBA);
    }
    preview?.draw(show, lastRGBA, selectedFixtureIds, snapEnabled ? SNAP_GRID : 0, snapGuides);

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
    // Surface the real failure instead of a bare "offline" — a swallowed bad IP
    // or dead daemon now reads on the status bar (and tints it).
    const out = live ? 'output live' : `output offline${err ? ` (${err})` : ''}`;
    hud.classList.toggle('hud-offline', !live);
    hud.textContent = `${fps} fps  ·  ${cv.w || '?'}×${cv.h || '?'}  ·  ${nFix} fixture${nFix === 1 ? '' : 's'}  ·  ${out}`;
    frames = 0; last = ts;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
