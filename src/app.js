import { getGL, program, makeTarget, drawFullscreen } from './engine/gl.js';
import { emptyShow, addDevice, addFixture, deviceByteRange } from './model/show.js';
import { samplePoints } from './model/sampling.js';
import { makeSampler } from './engine/sampler.js';
import { connectBridge } from './bridge.js';

const canvas = document.getElementById('stage');
const hud = document.getElementById('hud');
const W = 1280, H = 720;
canvas.width = W; canvas.height = H;
const gl = getGL(canvas);

// --- Hand-authored show: one device, two fixtures ---
let show = emptyShow();
show = addDevice(show, { id: 'c1', name: 'DQ1', ip: '127.0.0.1', colorOrder: 'GRB' });
show = addFixture(show, {
  id: 'f1', pixelCount: 150,
  output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 150 },
  input: { points: [[0.05, 0.30], [0.95, 0.30]], samples: 150 },
});
show = addFixture(show, {
  id: 'f2', pixelCount: 150,
  output: { deviceId: 'c1', pixelOffset: 150, pixelCount: 150 },
  input: { points: [[0.05, 0.70], [0.95, 0.70]], samples: 150 },
});

// Build sample UVs ordered by output.pixelOffset ascending so readback order
// matches the daemon's per-device byte layout.
const ordered = [...show.fixtures].sort((a, b) => a.output.pixelOffset - b.output.pixelOffset);
const uvs = [];
for (const f of ordered) {
  for (const [u, v] of samplePoints(f.input.points, f.input.samples)) { uvs.push(u, v); }
}
const sampleUVs = new Float32Array(uvs);

// Build daemon route: one entry per device.
const route = show.devices.map((d) => ({
  ip: d.ip, port: 4048, colorOrder: d.colorOrder, ...deviceByteRange(show, d.id),
}));

const bridge = connectBridge(route);

// --- Line generator ---
const canvasTarget = makeTarget(gl, W, H);
let prog = null, uPos = null, uWidth = null, uAngle = null, sampler = null;

fetch('./src/engine/shaders/generators/line.glsl').then((r) => r.text()).then((src) => {
  prog = program(gl, src);
  uPos = gl.getUniformLocation(prog, 'pos');
  uWidth = gl.getUniformLocation(prog, 'width');
  uAngle = gl.getUniformLocation(prog, 'angle');
  sampler = makeSampler(gl, sampleUVs);
});

let frames = 0, last = 0, t0 = 0;
function loop(ts) {
  if (!t0) t0 = ts;
  const t = (ts - t0) / 1000;
  if (prog && sampler) {
    // Animate the sweeping line.
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

    // Sample composited canvas → RGBA8 per output pixel, then ship RGB.
    const rgba = sampler.sample(canvasTarget.tex);
    bridge.send(rgba);

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
