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
  vec2 c = vec2(suv.x, 1.0 - suv.y);
  // LEDs whose sample point falls OUTSIDE the composition read black, not the
  // smeared edge pixel that CLAMP_TO_EDGE would give — so a fixture pushed past
  // the canvas edge simply goes dark there (per-LED, so a half-off bar is half-lit).
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) { frag = vec4(0.0, 0.0, 0.0, 1.0); return; }
  frag = texture(uCanvas, c);
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

  // ASYNC READBACK via a RING of Pixel-Pack Buffers: `readPixels` into a PBO is
  // non-blocking; a fence guards each one and we only read it back once the GPU has
  // finished, so the CPU never stalls. Costs ~1-2 frames of latency (imperceptible
  // for LED output at ~42fps).
  //
  // Crucially we NEVER issue a new readback into a PBO whose previous readback hasn't
  // been consumed yet — overwriting an in-flight READ buffer is exactly what triggers
  // the "READ-usage buffer written…before being read back" perf warning (and discards
  // the driver's shadow copy). Two buffers gave only ONE frame of slack, so under any
  // GPU hiccup the buffer got reused unread. Three lets a readback stay in flight for
  // a couple of frames; if all are busy we simply skip this frame's readback and reuse
  // the last good result rather than clobber an unread buffer.
  const NUM = 3;
  const pbos = Array.from({ length: NUM }, () => gl.createBuffer());
  for (const b of pbos) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLen, gl.STREAM_READ); }
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const fences = new Array(NUM).fill(null);   // fences[i] != null ⇒ pbo i has an unconsumed readback in flight
  const queue = [];                           // FIFO of pbo indices awaiting readback (oldest first)
  let lastValid = null;

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

      // Retire the OLDEST in-flight readback if its fence has signaled. SYNC_FLUSH_-
      // COMMANDS_BIT flushes so clientWaitSync can actually observe completion.
      let justConsumed = -1;
      if (queue.length) {
        const i = queue[0];
        const s = gl.clientWaitSync(fences[i], gl.SYNC_FLUSH_COMMANDS_BIT, 0);
        if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED) {
          queue.shift();
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbos[i]);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          lastValid = trim(out);
          gl.deleteSync(fences[i]); fences[i] = null;   // free this pbo for reuse
          justConsumed = i;
        }
      }

      // Kick a new readback into a FREE pbo — but NOT the one we just consumed THIS
      // frame: readPixels into it would discard the shadow copy getBufferSubData just
      // made (ANGLE's "discarded shadow copy" perf warning). With 3 pbos there's
      // normally another free one; if not, skip this frame (readback is best-effort).
      let w = -1;
      for (let i = 0; i < NUM; i++) { if (fences[i] === null && i !== justConsumed) { w = i; break; } }
      if (w >= 0) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbos[w]);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0);   // 0 = offset into bound PBO ⇒ async
        fences[w] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        queue.push(w);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return lastValid;   // null on the first frame(s); app.js guards on falsy
    } };
}
