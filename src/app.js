import { getGL, program, makeTarget, drawFullscreen } from './engine/gl.js';
import { emptyShow, addDevice, addFixture } from './model/show.js';
import { buildPipelineInputs } from './model/pipeline.js';
import { makeSampler } from './engine/sampler.js';
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
  return show;
}

let show = loadShow() ?? defaultShow();

// --- Pipeline (rebuildable on every show edit) ---
const canvasTarget = makeTarget(gl, W, H);
let prog = null, uPos = null, uWidth = null, uAngle = null;
let sampler = null, bridge = null, lastRGBA = null;

function rebuild(next) {
  show = next;
  const { sampleUVs, route } = buildPipelineInputs(show);
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

// --- Line generator ---
fetch('./src/engine/shaders/generators/line.glsl').then((r) => r.text()).then((src) => {
  prog = program(gl, src);
  uPos = gl.getUniformLocation(prog, 'pos');
  uWidth = gl.getUniformLocation(prog, 'width');
  uAngle = gl.getUniformLocation(prog, 'angle');
  rebuild(show);
});

let frames = 0, last = 0, t0 = 0;
function loop(ts) {
  if (!t0) t0 = ts;
  const t = (ts - t0) / 1000;
  if (prog && sampler) {
    const pos = 0.5 + 0.45 * Math.sin(t);
    // Render into the canvas target FBO.
    gl.bindFramebuffer(gl.FRAMEBUFFER, canvasTarget.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    gl.uniform1f(uPos, pos);
    gl.uniform1f(uWidth, 0.08);
    gl.uniform1f(uAngle, 0);
    drawFullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Sample composited canvas → RGBA8 per output pixel, ship RGB, feed preview.
    lastRGBA = sampler.sample(canvasTarget.tex);
    bridge?.send(lastRGBA);
    preview?.draw(show, lastRGBA);

    // Draw to the real screen so there's something visible.
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    gl.uniform1f(uPos, pos);
    gl.uniform1f(uWidth, 0.08);
    gl.uniform1f(uAngle, 0);
    drawFullscreen(gl);
  }
  frames++;
  if (ts - last > 500) { hud.textContent = `${(frames * 1000 / (ts - last)).toFixed(0)} fps`; frames = 0; last = ts; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
