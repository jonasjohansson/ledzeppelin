import { makeTarget, program } from './gl.js';

// Each fragment maps its (x,y) cell to a linear LED index and samples the canvas
// at that LED's UV. The map texture + the output target share one W×H layout, so
// reading back row-major yields the LEDs in linear index order (i = y*W + x).
const SAMPLE_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uCanvas;
uniform sampler2D uMap;
void main(){
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec2 suv = texelFetch(uMap, t, 0).rg;
  // Flip v: the GL texture's v=0 is the BOTTOM row, but fixture points (and the
  // preview/stage) treat v=0 as the TOP — so sample the matching-display row.
  frag = texture(uCanvas, vec2(suv.x, 1.0 - suv.y));
}`;

export function makeSampler(gl, sampleUVs /* Float32Array len 2N */) {
  const n = sampleUVs.length / 2;
  // Wrap the LED list into a 2D grid so very large rigs don't blow past the GPU's
  // max texture WIDTH (a 1-row n-wide texture fails once n exceeds it). Width is
  // capped well under MAX_TEXTURE_SIZE; height grows as needed.
  const maxw = Math.max(1, Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096));
  const W = Math.max(1, Math.min(n || 1, maxw));
  const H = Math.max(1, Math.ceil((n || 1) / W));
  // Pad the UV data (and readback buffer) to the full W×H grid.
  const uvs = (W * H === n) ? sampleUVs : (() => { const a = new Float32Array(W * H * 2); a.set(sampleUVs); return a; })();

  const map = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, map);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, W, H, 0, gl.RG, gl.FLOAT, uvs);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const target = makeTarget(gl, W, H);
  const prog = program(gl, SAMPLE_FS);
  const locCanvas = gl.getUniformLocation(prog, 'uCanvas');
  const locMap = gl.getUniformLocation(prog, 'uMap');
  const byteLen = W * H * 4;
  const out = new Uint8Array(byteLen);
  const trim = (buf) => (W * H === n ? buf : buf.subarray(0, n * 4));   // drop grid padding

  // ASYNC READBACK via double-buffered Pixel-Pack Buffers: `readPixels` into a PBO
  // is non-blocking, and we fetch the PREVIOUS frame's PBO (already finished) — so
  // the CPU never stalls waiting on the GPU. Costs +1 frame of latency (~24ms at
  // 42fps, imperceptible for LED output). A fence guards the read; if the GPU is
  // momentarily behind we reuse the last good frame rather than block.
  const pbos = [gl.createBuffer(), gl.createBuffer()];
  for (const b of pbos) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLen, gl.STREAM_READ); }
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const fences = [null, null];
  let widx = 0, primed = false, lastValid = null;

  return { n,
    dispose() {
      gl.deleteTexture(map);
      gl.deleteTexture(target.tex);
      gl.deleteFramebuffer(target.fbo);
      gl.deleteProgram(prog);
      for (const b of pbos) gl.deleteBuffer(b);
      for (const s of fences) if (s) gl.deleteSync(s);
    },
    sample(canvasTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, W, H);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, canvasTex);
      gl.uniform1i(locCanvas, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, map);
      gl.uniform1i(locMap, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Kick off this frame's readback into the write-PBO (async).
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbos[widx]);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0);   // 0 = offset into bound PBO ⇒ async
      if (fences[widx]) gl.deleteSync(fences[widx]);
      fences[widx] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Fetch the OTHER PBO (last frame's, already complete) if its fence signaled.
      const ridx = widx ^ 1;
      widx = ridx;
      if (primed && fences[ridx]) {
        // SYNC_FLUSH_COMMANDS_BIT flushes the fence so clientWaitSync can actually
        // observe completion — without it the fence may never read as signaled, the
        // read is skipped every frame, and the PBO gets overwritten unread (that's
        // the "READ-usage buffer written…before being read back" perf warning).
        const s = gl.clientWaitSync(fences[ridx], gl.SYNC_FLUSH_COMMANDS_BIT, 0);
        if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED) {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbos[ridx]);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          lastValid = trim(out);
          gl.deleteSync(fences[ridx]); fences[ridx] = null;   // consumed → don't re-check/overwrite unread
        }
      }
      primed = true;
      return lastValid;   // null on the first frame(s); app.js guards on falsy
    } };
}
