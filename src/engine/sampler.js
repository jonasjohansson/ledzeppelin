import { makeTarget, program } from './gl.js';

// Each fragment maps its (x,y) cell to a linear LED index and samples the canvas
// at that LED's UV. The map texture + the output target share one W×H layout, so
// reading back row-major yields the LEDs in linear index order (i = y*W + x).
//
// VOLUMETRIC FIELD PASS: after the canvas sample, up to 4 active volumetric
// clips are evaluated at this LED's WORLD xyz (uPos — see pipeline.js) and
// blended onto the sampled colour with the clip's layer blend + opacity (the
// same premultiplied math the compositor uses for layer blits). The field
// functions are GLSL twins of src/engine/fields.js (the unit-tested JS
// reference — keep them in lockstep). With uVolCount == 0 the loop body never
// runs and the output is byte-identical to the plain sampler.
//
// Uniform packing per clip i (see packVolumetrics in fields.js):
//   uVolMeta[i] = (fieldId, blendMode, opacity, 0)
//   uVolA/B[i]  = field params   uVolColA/B[i] = colours
const SAMPLE_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uCanvas;
uniform sampler2D uMap;
uniform sampler2D uPos;      // per-LED world xyz (same W×H layout as uMap)
uniform int uVolCount;       // active volumetric clips (0 = plain pass-through)
uniform float uT;            // seconds (noise3d drift)
uniform float uVolTrigs[32];   // 4 slots × 8 — seconds since each trigger, per volumetric clip
uniform int uVolTrigCount[4];
uniform vec4 uVolMeta[4];
uniform vec4 uVolA[4];
uniform vec4 uVolB[4];
uniform vec3 uVolColA[4];
uniform vec3 uVolColB[4];

// --- field kit (twins of fields.js) ---
float vband(float d, float th, float so){
  float hw = max(1e-4, th) * 0.5;
  float inner = hw * (1.0 - clamp(so, 0.0, 1.0));
  float t = clamp((abs(d) - inner) / max(hw - inner, 1e-5), 0.0, 1.0);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}
float vaxis(vec3 p, float axis){ return axis < 0.5 ? p.x : (axis < 1.5 ? p.y : p.z); }
float vhash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float x00 = mix(vhash3(i), vhash3(i + vec3(1, 0, 0)), f.x);
  float x10 = mix(vhash3(i + vec3(0, 1, 0)), vhash3(i + vec3(1, 1, 0)), f.x);
  float x01 = mix(vhash3(i + vec3(0, 0, 1)), vhash3(i + vec3(1, 0, 1)), f.x);
  float x11 = mix(vhash3(i + vec3(0, 1, 1)), vhash3(i + vec3(1, 1, 1)), f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}
float vfbm3(vec3 p){ float n = 0.0, amp = 0.5, fr = 1.0;
  for (int i = 0; i < 4; i++){ n += amp * vnoise3(p * fr); fr *= 2.0; amp *= 0.5; } return n; }

// From-Canvas tint: when uVolMeta[i].w is set, colour the field's intensity with
// the composited 2D canvas at this LED's UV instead of the flat param colour.
vec3 volTint(int i, vec2 cuv, vec3 flatCol) { return uVolMeta[i].w > 0.5 ? texture(uCanvas, cuv).rgb : flatCol; }

// One packed clip's field at world point p → PREMULTIPLIED rgba.
vec4 fieldColor(int i, vec3 p, vec2 cuv){
  int id = int(uVolMeta[i].x + 0.5);
  if (id == 0) {           // plane sweep: A = (axis, pos, thickness, softness)
    float v = vband(vaxis(p, uVolA[i].x) - uVolA[i].y, uVolA[i].z, uVolA[i].w);
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }
  if (id == 1) {           // axis gradient: A = (axis, scroll, -, -)
    float g = fract(vaxis(p, uVolA[i].x) - uVolA[i].y);
    return vec4(mix(uVolColA[i], uVolColB[i], g), 1.0);
  }
  if (id == 2) {           // noise 3d: A = (scale, speed, axis, drift)
    // Directional drift (twin of fields.js noise3d): sample at p − axisVec·(t·drift).
    // drift 0 subtracts an exact 0 → byte-identical to the pre-drift field.
    vec3 ax = uVolA[i].z < 0.5 ? vec3(1.0, 0.0, 0.0) : (uVolA[i].z < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
    float v = clamp(vfbm3((p - ax * (uT * uVolA[i].w)) * uVolA[i].x + vec3(uT * uVolA[i].y)), 0.0, 1.0);
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }
  if (id == 4) {           // body wave: A = (axis, wavelength, amplitude, offset), B = (speed, -, -, -)
    float coord = vaxis(p, uVolA[i].x);
    float wave = sin((coord - uVolA[i].w + uT * uVolB[i].x) * 6.2831853 / uVolA[i].y) * uVolA[i].z;
    float v = vband(wave, uVolA[i].z * 0.2, 0.5);
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }
  if (id == 5) {           // plane pulse: A=(axis,thickness,softness,-), B=(speed,-,-,-); a plane sweeps per trigger
    float coord = vaxis(p, uVolA[i].x);
    float v = 0.0;
    for (int k = 0; k < 8; k++) { if (k >= uVolTrigCount[i]) break; v = max(v, vband(coord - uVolTrigs[i*8+k] * uVolB[i].x, uVolA[i].y, uVolA[i].z)); }
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }
  if (id == 6) {           // flow field: A=(windX,windY,windZ,scale), B=(turbulence,thickness,trail,seed), colB.x=speed
    vec3 wind = uVolA[i].xyz; float wm = length(wind);
    vec3 dir = wm < 1e-5 ? vec3(0.0) : wind / wm;
    float s = uVolB[i].w * 11.0;   // seed
    vec3 q = p * uVolA[i].w - dir * (uVolColB[i].x * uT) + vec3(s, s * 1.7, s * 0.3);
    vec3 w = vec3(
      vfbm3(q + vec3(19.19, 7.3, 2.7)),
      vfbm3(q + vec3(5.2, 41.7, 13.1)),
      vfbm3(q + vec3(31.3, 9.1, 27.9))) * 2.0 - 1.0;
    q += uVolB[i].x * w;                       // turbulence
    float k = uVolB[i].z * 0.9; float along = dot(q, dir); q -= dir * along * k;   // trail
    float nrm = vfbm3(q);
    float hw = 0.02 + uVolB[i].y * 0.48;       // thickness
    float tt = clamp((abs(nrm - 0.5) - hw * 0.5) / max(hw - hw * 0.5, 1e-5), 0.0, 1.0);
    float v = 1.0 - tt * tt * (3.0 - 2.0 * tt);
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }
  // sphere pulse: A = (cx, cy, cz, radius), B = (thickness, softness, speed, 0).
  // The static shell at A.w, plus one expanding shell per recent trigger
  // (radius = age·speed — the same field re-evaluated, brightest wins).
  float d = length(p - uVolA[i].xyz);
  float v = vband(d - uVolA[i].w, uVolB[i].x, uVolB[i].y);
  for (int k = 0; k < 8; k++) {
    if (k >= uVolTrigCount[i]) break;
    v = max(v, vband(d - uVolTrigs[i*8+k] * uVolB[i].z, uVolB[i].x, uVolB[i].y));
  }
  return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
}

void main(){
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec2 suv = texelFetch(uMap, t, 0).rg;
  // Flip v: the GL texture's v=0 is the BOTTOM row, but fixture points (and the
  // preview/stage) treat v=0 as the TOP — so sample the matching-display row.
  vec2 c = vec2(suv.x, 1.0 - suv.y);
  // LEDs whose sample point falls OUTSIDE the composition read black, not the
  // smeared edge pixel that CLAMP_TO_EDGE would give — so a fixture pushed past
  // the canvas edge simply goes dark there (per-LED, so a half-off bar is half-lit).
  // (No early return: volumetric fields still light off-canvas LEDs — they live
  // in world space, not on the canvas.)
  vec4 base = vec4(0.0, 0.0, 0.0, 1.0);
  if (!(c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0)) base = texture(uCanvas, c);
  vec3 rgb = base.rgb;
  for (int i = 0; i < 4; i++) {
    if (i >= uVolCount) break;
    vec4 f = fieldColor(i, texelFetch(uPos, t, 0).xyz, c);
    float op = uVolMeta[i].z;
    vec3 src = f.rgb * op; float sa = f.a * op;
    int mode = int(uVolMeta[i].y + 0.5);
    // Premultiplied blends — factor-for-factor the compositor's setBlend():
    // 0 alpha (over) · 1 add · 2 screen · 3 multiply.
    if (mode == 0) rgb = src + rgb * (1.0 - sa);
    else if (mode == 2) rgb = src + rgb * (1.0 - src);
    else if (mode == 3) rgb = rgb * (src + vec3(1.0 - sa));
    else rgb = rgb + src;
    rgb = clamp(rgb, 0.0, 1.0);
  }
  frag = vec4(rgb, base.a);
}`;

// samplePositions (optional, Float32Array len 3N — xyz per LED, same order as
// the uv pairs) feeds the volumetric field pass; absent/empty falls back to a
// canvas-plane position derived from nothing (all zeros) and volumetric clips
// simply read the origin — callers should always pass it (see pipeline.js).
export function makeSampler(gl, sampleUVs /* Float32Array len 2N */, samplePositions) {
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
  // Per-LED WORLD xyz for the volumetric field pass — same W×H layout as the uv
  // map. Padded like the uvs; a missing/short positions array reads as origin.
  const posData = (() => {
    const a = new Float32Array(W * H * 3);
    if (samplePositions?.length) a.set(samplePositions.subarray(0, Math.min(samplePositions.length, a.length)));
    return a;
  })();
  const posTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, posTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, W, H, 0, gl.RGB, gl.FLOAT, posData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const target = makeTarget(gl, W, H);
  const prog = program(gl, SAMPLE_FS);
  const locCanvas = gl.getUniformLocation(prog, 'uCanvas');
  const locMap = gl.getUniformLocation(prog, 'uMap');
  const locPos = gl.getUniformLocation(prog, 'uPos');
  const locVolCount = gl.getUniformLocation(prog, 'uVolCount');
  const locT = gl.getUniformLocation(prog, 'uT');
  const locVolTrigs = gl.getUniformLocation(prog, 'uVolTrigs[0]');
  const locVolTrigCount = gl.getUniformLocation(prog, 'uVolTrigCount[0]');
  const locVolMeta = gl.getUniformLocation(prog, 'uVolMeta[0]');
  const locVolA = gl.getUniformLocation(prog, 'uVolA[0]');
  const locVolB = gl.getUniformLocation(prog, 'uVolB[0]');
  const locVolColA = gl.getUniformLocation(prog, 'uVolColA[0]');
  const locVolColB = gl.getUniformLocation(prog, 'uVolColB[0]');
  const VOL_TRIG_SCRATCH = new Float32Array(32);   // 4 slots × 8
  const VOL_TRIG_COUNT_SCRATCH = new Int32Array(4);
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
      gl.deleteTexture(posTex);
      gl.deleteTexture(target.tex);
      gl.deleteFramebuffer(target.fbo);
      gl.deleteProgram(prog);
      for (const b of pbos) gl.deleteBuffer(b);
      for (const s of fences) if (s) gl.deleteSync(s);
    },
    // `vol` (optional): the active volumetric clips for this frame —
    // { count, meta, a, b, colA, colB } from packVolumetrics (fields.js) plus
    // { time, trigSecs } for noise drift / spherepulse trigger shells. Absent
    // or count 0 ⇒ the field loop is skipped and output is byte-identical to
    // the plain sampler.
    sample(canvasTex, vol) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, W, H);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, canvasTex);
      gl.uniform1i(locCanvas, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, map);
      gl.uniform1i(locMap, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, posTex);
      gl.uniform1i(locPos, 2);
      const n2 = vol?.count || 0;
      gl.uniform1i(locVolCount, n2);
      if (n2 > 0) {
        gl.uniform1f(locT, vol.time || 0);
        gl.uniform4fv(locVolMeta, vol.meta);
        gl.uniform4fv(locVolA, vol.a);
        gl.uniform4fv(locVolB, vol.b);
        gl.uniform3fv(locVolColA, vol.colA);
        gl.uniform3fv(locVolColB, vol.colB);
        // uVolTrigs = seconds since each recent ⚡ trigger, per slot (compositor convention).
        // Prefer per-slot vol.volTrigs[s]; fall back to replicating the global vol.trigSecs
        // into every active slot so a single-bus caller behaves identically.
        VOL_TRIG_SCRATCH.fill(1e6);
        for (let s = n2; s < 4; s++) VOL_TRIG_COUNT_SCRATCH[s] = 0;   // clear unused slots
        for (let s = 0; s < Math.min(n2, 4); s++) {
          const trigs = (vol.volTrigs && vol.volTrigs[s]) || vol.trigSecs || [];
          const tn = Math.min(trigs.length, 8);
          for (let k = 0; k < tn; k++) VOL_TRIG_SCRATCH[s * 8 + k] = (vol.time || 0) - trigs[trigs.length - tn + k];
          VOL_TRIG_COUNT_SCRATCH[s] = tn;
        }
        gl.uniform1fv(locVolTrigs, VOL_TRIG_SCRATCH); gl.uniform1iv(locVolTrigCount, VOL_TRIG_COUNT_SCRATCH);
      }
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
