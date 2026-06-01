import { getGL, program, drawFullscreen } from './engine/gl.js';

const canvas = document.getElementById('stage');
const hud = document.getElementById('hud');
canvas.width = 1280; canvas.height = 720;
const gl = getGL(canvas);

const prog = program(gl, `#version 300 es
precision highp float; in vec2 uv; out vec4 frag; uniform float uT;
void main(){ float g = 0.5+0.5*sin(uv.x*6.2831 + uT); frag = vec4(vec3(g),1.); }`);
const uT = gl.getUniformLocation(prog, 'uT');

let frames = 0, last = 0, t0 = 0;
function loop(ts) {
  if (!t0) t0 = ts;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(prog);
  gl.uniform1f(uT, (ts - t0) / 1000);
  drawFullscreen(gl);
  frames++;
  if (ts - last > 500) { hud.textContent = `${(frames * 1000 / (ts - last)).toFixed(0)} fps`; frames = 0; last = ts; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
