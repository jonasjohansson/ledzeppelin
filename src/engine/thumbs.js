// Render a small thumbnail PNG (data URL) for each GENERATOR source by drawing
// its shader once into a tiny framebuffer with default params, then reading the
// pixels back into a 2D canvas. Used in the Sources library and the clip slots.
//
// Thumbnails are baked once at startup (representative of the source's default
// look). They don't track a clip's custom params — they identify the source.

import { program, makeTarget, drawFullscreen } from './gl.js';
import { REGISTRY, defaultParams, hexToRgb } from './shaders/manifest.js';

export function renderSourceThumbnails(gl, w = 80, h = 50, timeSec = 0.6) {
  const target = makeTarget(gl, w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const pixels = new Uint8Array(w * h * 4);
  const out = {};

  for (const [name, entry] of Object.entries(REGISTRY)) {
    if (entry.type !== 'generator') continue;
    const prog = program(gl, entry.src);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);

    const defs = defaultParams(name);
    for (const p of entry.params) {
      const l = gl.getUniformLocation(prog, p.key);
      if (l === null) continue;
      if (p.type === 'color') { const [r, g, b] = hexToRgb(defs[p.key]); gl.uniform3f(l, r, g, b); }
      else gl.uniform1f(l, Number(defs[p.key]));
    }
    const uT = gl.getUniformLocation(prog, 'uT'); if (uT !== null) gl.uniform1f(uT, timeSec);
    const uTrig = gl.getUniformLocation(prog, 'uTrig'); if (uTrig !== null) gl.uniform1f(uTrig, timeSec);
    // `aspect` is normally injected by the compositor (live canvas w/h) so radial
    // shapes stay circular; without it the x-axis collapses and Radial renders as
    // flat bands. Feed the thumbnail's own aspect so it reads as actual rings.
    const uAspect = gl.getUniformLocation(prog, 'aspect'); if (uAspect !== null) gl.uniform1f(uAspect, w / h);
    const uPhase = gl.getUniformLocation(prog, 'uPhase'); if (uPhase !== null) gl.uniform1f(uPhase, timeSec);

    drawFullscreen(gl);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // readPixels is bottom-up; flip into the ImageData (top-down) and force opaque.
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const sy = h - 1 - y;
      for (let x = 0; x < w; x++) {
        const si = (sy * w + x) * 4, di = (y * w + x) * 4;
        img.data[di] = pixels[si];
        img.data[di + 1] = pixels[si + 1];
        img.data[di + 2] = pixels[si + 2];
        img.data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    out[name] = canvas.toDataURL('image/png');
    gl.deleteProgram(prog);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteTexture(target.tex);
  gl.deleteFramebuffer(target.fbo);
  return out;
}
