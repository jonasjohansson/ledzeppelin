import { getGL, program, drawFullscreen } from './engine/gl.js';
import { emptyShow, addDevice, addFixture, validate } from './model/show.js';
import { buildPipelineInputs } from './model/pipeline.js';
import { makeSampler } from './engine/sampler.js';
import { makeCompositor } from './engine/compositor.js';
import { connectBridge } from './bridge.js';
import { createPreview, enableDragPlacement } from './ui/preview.js';
import { createFixturePanel, loadShow, saveShow } from './ui/fixtures.js';

const canvas = document.getElementById('stage');
const hud = document.getElementById('hud');
const W = 1280, H = 720;
canvas.width = W; canvas.height = H;
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
  // One working composition layer so the first run shows the line.
  show.composition.layers = [
    { id: 'l1', generator: 'line', effects: [], blend: 'add', opacity: 1,
      params: { 'line.pos': 0.5, 'line.width': 0.08, 'line.angle': 90 } },
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
    return loaded;
  } catch (e) {
    console.warn('Loaded show is invalid, using default:', e.message);
    return defaultShow();
  }
}

let show = initialShow();

// --- Pipeline (rebuildable on every show edit) ---
// The compositor is created once; it caches programs by name and reads the
// current show's layers each frame, so show edits don't require recreating it.
const compositor = makeCompositor(gl, W, H);
let sampler = null, bridge = null, lastRGBA = null;

// On-screen blit so the composited output is visible on the real framebuffer.
const SCREEN_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex;
void main(){ frag = vec4(texture(uTex, uv).rgb, 1.0); }`;
const screenProg = program(gl, SCREEN_FS);
const uScreenTex = gl.getUniformLocation(screenProg, 'uTex');

function rebuild(next) {
  show = next;
  const { sampleUVs, route } = buildPipelineInputs(show);
  sampler?.dispose?.(); // free the previous sampler's GL objects before reassigning
  sampler = sampleUVs.length ? makeSampler(gl, sampleUVs) : null;
  if (bridge?.close) bridge.close();
  bridge = connectBridge(route);
  lastRGBA = null;
}

// --- Preview overlay + editor panel wiring ---
const previewCanvas = document.getElementById('preview');
const preview = previewCanvas ? createPreview(previewCanvas) : null;

const panel = createFixturePanel({
  getShow: () => show,
  setShow: (next) => rebuild(next),
});
document.getElementById('editor')?.append(panel.el);

if (previewCanvas) {
  enableDragPlacement(previewCanvas, {
    getShow: () => show,
    onEdit: (next) => { show = next; preview?.draw(show, lastRGBA); }, // live, no rebuild churn
    onCommit: (next) => { saveShow(next); rebuild(next); panel.refresh(); },
  });
}

// Compositor is ready immediately (programs compile lazily on first render).
rebuild(show);

let frames = 0, last = 0, t0 = 0;
function loop(ts) {
  if (!t0) t0 = ts;
  const t = (ts - t0) / 1000;
  if (sampler) {
    // Drive line.pos from time so the preview is clearly alive (the generator's
    // own params stay otherwise static; this keeps equivalent motion to before).
    const l0 = show.composition?.layers?.[0];
    if (l0 && l0.generator === 'line' && l0.params) {
      l0.params['line.pos'] = 0.5 + 0.45 * Math.sin(t);
    }

    // Composite all layers into compositor.tex.
    compositor.render(show.composition?.layers || [], t);

    // Sample composited canvas → RGBA8 per output pixel, ship RGB, feed preview.
    lastRGBA = sampler.sample(compositor.tex);
    bridge?.send(lastRGBA);
    preview?.draw(show, lastRGBA);

    // Draw composited output to the real screen so there's something visible.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(screenProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, compositor.tex);
    gl.uniform1i(uScreenTex, 0);
    drawFullscreen(gl);
  }
  frames++;
  if (ts - last > 500) { hud.textContent = `${(frames * 1000 / (ts - last)).toFixed(0)} fps`; frames = 0; last = ts; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
