export function getGL(canvas) {
  // alpha:true so the on-screen canvas can be transparent where the composite is
  // empty — letting a CSS checkerboard "canvas paper" show through (see ui.css).
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: true });
  if (!gl) throw new Error('WebGL2 not available');
  return gl;
}

export function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
  return sh;
}

// Builds a program from a fragment shader; vertex shader is a fixed full-screen triangle.
const VERT = `#version 300 es
const vec2 P[3] = vec2[](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
out vec2 uv;
void main(){ vec2 p = P[gl_VertexID]; uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

export function program(gl, fragSrc) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  // Flag shaders for deletion: once the program is linked it retains them, so
  // they're freed when the program is deleted. Prevents leaking shader objects.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// A render target: RGBA8 texture + framebuffer at w×h.
export function makeTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
    gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
    gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export function drawFullscreen(gl) { gl.drawArrays(gl.TRIANGLES, 0, 3); }
