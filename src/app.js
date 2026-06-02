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
import {
  prefixedDefaults, normalizeComposition, makeClip,
  setCanvasSize as setCanvasSizeModel, clampCanvasSize, playheadClip,
} from './model/layers.js';
import { syncShowFixtures } from './model/fixture-transform.js';
import { resolveParams } from './model/anim.js';

const canvas = document.getElementById('stage');
const hud = document.getElementById('hud');
const gl = getGL(canvas);

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
    { id: 'l1', name: 'layer 1', blend: 'add', opacity: 1,
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
void main(){ frag = vec4(texture(uTex, uv).rgb, 1.0); }`;
const screenProg = program(gl, SCREEN_FS);
const uScreenTex = gl.getUniformLocation(screenProg, 'uTex');

function rebuild(next) {
  // Geometry path: ensure fixtures' derived sample points are in sync with their
  // pixel-space transforms + the current canvas before building the sampler.
  show = syncShowFixtures(next);
  const { sampleUVs, route } = buildPipelineInputs(show);
  sampler?.dispose?.(); // free the previous sampler's GL objects before reassigning
  sampler = sampleUVs.length ? makeSampler(gl, sampleUVs) : null;
  if (bridge?.close) bridge.close();
  bridge = connectBridge(route);
  lastRGBA = null;
}

// Composition-only edit path (layers/effects/params): the compositor reads
// show.composition.layers every frame, so we only need to swap in the new show
// and persist it — NO sampler/route/bridge rebuild (that's expensive and only
// fixture/device GEOMETRY changes require it).
function setComposition(next) {
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
  compositor.dispose();
  compositor = makeCompositor(gl, c.w, c.h);
  rebuild(next);          // syncs fixtures to the new canvas + rebuilds sampler
  saveShow(show);
  panel.refresh();
}

// --- Preview overlay + editor panel wiring ---
const previewCanvas = document.getElementById('preview');
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
let pulseTrigSec = -1e6; // seconds of the last ⚡ trigger (huge-negative = never)
const nowSec = () => (lastTs - t0) / 1000;
const transport = {
  playing: false, loop: true, startTs: 0,
  isPlaying() { return this.playing; },
  getLoop() { return this.loop; },
  setLoop(b) { this.loop = !!b; },
  toggle() { this.playing = !this.playing; if (this.playing) this.startTs = lastTs; },
  fire() { pulseTrigSec = nowSec(); }, // ⚡ trigger for Pulse-style sources
};

// The composer renders into the Resolume-style shell's three regions: the DECK
// strip above the canvas, the INSPECTOR column, and the LIBRARY column.
const layerPanel = createLayerPanel({
  getShow: () => show,
  setShow: (next) => setComposition(next), // composition-only: persist, no rebuild
  transport,
  mounts: {
    deck: document.getElementById('deckbar'),
    inspectorClip: document.getElementById('insp-clip'),
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
  setShow: (next) => setComposition(next), // crossfade: composition-only persist
});
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

let dragHandle = null;
if (previewCanvas) {
  dragHandle = enableDragPlacement(previewCanvas, {
    getShow: () => show,
    onEdit: (next) => { show = next; preview?.draw(show, lastRGBA); }, // live, no rebuild churn
    onCommit: (next) => { saveShow(next); rebuild(next); panel.refresh(); renderOutputList(); },
    enabled: false, // gated by view state below; default tab is Composition
  });
}

// --- Output mapping panel: add fixtures onto the canvas, list/remove them ----
const outputListEl = document.getElementById('output-list');
const addFixtureBtn = document.getElementById('add-fixture');

function addFixtureCentered() {
  const next = structuredClone(show);
  const id = `f${next.fixtures.length + 1}`;
  const devId = next.devices[0]?.id ?? '';
  // Offset must be contiguous-from-0 PER DEVICE (validate()): take the running
  // end of the chosen device's fixtures.
  const off = next.fixtures
    .filter((x) => x.output?.deviceId === devId)
    .reduce((m, x) => Math.max(m, (x.output?.pixelOffset || 0) + (x.output?.pixelCount || 0)), 0);
  const px = 150;
  const c = next.composition?.canvas || { w: 1280, h: 720 };
  next.fixtures.push({
    id, name: id, pixelCount: px, colorOrder: 'GRB',
    output: { deviceId: devId, pixelOffset: off, pixelCount: px },
    input: { transform: { x: c.w / 2, y: c.h / 2, w: c.w * 0.6, h: 8, rotation: 0 }, samples: px },
  });
  rebuild(next); panel.refresh(); renderOutputList();
}
addFixtureBtn?.addEventListener('click', addFixtureCentered);

function renderOutputList() {
  if (!outputListEl) return;
  outputListEl.textContent = '';
  for (const f of show.fixtures || []) {
    const row = document.createElement('div');
    row.className = 'output-row';
    const name = document.createElement('span'); name.textContent = f.name || f.id;
    const dev = document.createElement('span'); dev.className = 'output-dev';
    dev.textContent = f.output?.deviceId || '—';
    const del = document.createElement('button'); del.textContent = '✕'; del.className = 'ly-rmfx';
    del.title = 'remove fixture';
    del.onclick = () => {
      const n = structuredClone(show); n.fixtures = n.fixtures.filter((x) => x.id !== f.id);
      rebuild(n); panel.refresh(); renderOutputList();
    };
    row.append(name, dev, del);
    outputListEl.append(row);
  }
}

// Runtime UI view state (NOT persisted). applyView only toggles DOM visibility,
// the preview overlay, and drag interactivity — the render/sampler/output run
// regardless of which tab is shown.
const view = { activeTab: 'composition' };
const tabsEl = document.getElementById('tabs');
const deckbarEl = document.getElementById('deckbar');
const inspectorColEl = document.getElementById('inspector-col');
const libraryColEl = document.getElementById('library-col');
const outputViewEl = document.getElementById('output-view');
const fixturesViewEl = document.getElementById('fixtures-view');

function applyView() {
  const tab = view.activeTab;
  const onComposition = tab === 'composition';
  const onOutput = tab === 'output';
  const onFixtures = tab === 'fixtures';

  tabsEl?.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('tab-active', b.dataset.tab === tab);
  });

  if (deckbarEl) deckbarEl.hidden = !onComposition;
  if (inspectorColEl) inspectorColEl.hidden = !onComposition;
  if (libraryColEl) libraryColEl.hidden = !onComposition;
  if (outputViewEl) outputViewEl.hidden = !onOutput;
  if (fixturesViewEl) fixturesViewEl.hidden = !onFixtures;

  // Fixture overlay shows on Output + Fixtures (so you see/position fixtures),
  // hidden on Composition for a clean composite. Drag is enabled wherever the
  // overlay shows.
  const overlay = onOutput || onFixtures;
  if (previewCanvas) previewCanvas.style.display = overlay ? '' : 'none';
  dragHandle?.setEnabled(overlay);
  if (overlay) renderOutputList();
}

tabsEl?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.tab');
  if (!b) return;
  view.activeTab = b.dataset.tab;
  applyView();
});

// Inspector sub-tabs (Clip | Composition) — toggle which inspector pane shows.
const inspTabsEl = document.getElementById('insp-tabs');
const inspClipEl = document.getElementById('insp-clip');
const inspCompEl = document.getElementById('insp-composition');
inspTabsEl?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.subtab');
  if (!b) return;
  const which = b.dataset.itab;
  inspTabsEl.querySelectorAll('.subtab').forEach((x) =>
    x.classList.toggle('subtab-active', x.dataset.itab === which));
  if (inspClipEl) inspClipEl.hidden = which !== 'clip';
  if (inspCompEl) inspCompEl.hidden = which !== 'composition';
});

applyView();

// Compositor is ready immediately (programs compile lazily on first render).
rebuild(show);

let frames = 0, last = 0;
function loop(ts) {
  if (!t0) t0 = ts;
  lastTs = ts;
  const t = (ts - t0) / 1000;
  if (sampler) {
    // When the transport is playing, derive the active clip from the playhead and
    // render a shallow-cloned layer with that activeClipId (the compositor's
    // crossfade picks up the change). Otherwise render the show's layers as-is.
    let renderLayers = show.composition?.layers || [];
    if (transport.playing && renderLayers.length) {
      const base = renderLayers[0];
      const ph = playheadClip(base.clips || [], ts - transport.startTs, transport.loop);
      if (ph) {
        renderLayers = [{ ...base, activeClipId: ph.clip.id }, ...renderLayers.slice(1)];
        layerPanel.setPlayhead(ph.index);
      }
    }
    // Per-parameter animations run on a free-running clock (independent of the
    // clip transport): resolve each layer's + clip's animated params to plain
    // numbers at time t before compositing. resolveParams is a no-op (same ref)
    // when nothing is animated, so this is cheap in the common case.
    renderLayers = renderLayers.map((L) => {
      const lp = resolveParams(L.params, L.anim, t);
      let clips = L.clips;
      if (clips && clips.some((c) => c.anim && Object.keys(c.anim).length)) {
        clips = clips.map((c) => (c.anim && Object.keys(c.anim).length)
          ? { ...c, params: resolveParams(c.params, c.anim, t) } : c);
      }
      return (lp === L.params && clips === L.clips) ? L : { ...L, params: lp, clips };
    });
    // Move the inspector's animated sliders live (selected clip + composition).
    layerPanel.updateLive?.(t);
    // Composite all layers into compositor.tex. (The line generator self-animates
    // in-shader via uT — see manifest.js — so the loop no longer mutates params.)
    // env.trigSec drives triggerable sources (Pulse) via the shader's uTrig.
    compositor.render(renderLayers, t, { trigSec: pulseTrigSec });

    // Sample composited canvas → RGBA8 per output pixel, ship RGB, feed preview.
    lastRGBA = sampler.sample(compositor.tex);
    bridge?.send(lastRGBA);
    preview?.draw(show, lastRGBA);

    // Draw composited output to the real screen so there's something visible.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
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
    hud.textContent = `${fps} fps · ${bridge?.connected?.() ? 'output live' : 'output offline (no daemon)'}`;
    frames = 0; last = ts;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
