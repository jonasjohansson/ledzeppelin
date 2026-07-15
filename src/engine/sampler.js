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
// The sampler fragment shader is split into three verbatim GLSL pieces so that
// fieldColor's id-chain can be built with ONLY the field blocks actually in use:
//   FS_PRE      — uniforms + all helper funcs + the fieldColor signature.
//   FIELD_BLOCKS — id → that field's `if (id == N) { … }` block.
//   FS_POST     — fieldColor's default return + close, then colorFx() + main().
// The full 12-field chain overflows the Raspberry Pi's V3D GPU (every `if (id==N)`
// is reachable because id is a runtime uniform, so nothing is dead-stripped) and
// crashes the WebGL context in a loop; compiling only the live fields keeps the
// shader small. Uncalled helpers in FS_PRE are dead-stripped by the compiler.
const FS_PRE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uCanvas;
uniform sampler2D uMap;
uniform sampler2D uPos;      // per-LED world xyz (same W×H layout as uMap)
uniform sampler2D uBand;     // per-LED audio band index 0/1/2 (same W×H layout) — audiobars
uniform vec3 uAudioBands;    // live mic band levels (bass, mid, high) 0..1 — audiobars
uniform sampler2D uCtl;      // per-LED controller index 0..31 (same W×H layout) — exclusifier
uniform float uCanvasCtl[32];// per-controller CANVAS attenuation (2D clip mask; 1 = show)
uniform int uVolCtlMask[4];  // per-volumetric-clip controller bitmask (bit k = controller k; -1 = all)
uniform int uVolCount;       // active volumetric clips (0 = plain pass-through)
uniform float uT;            // seconds (noise3d drift)
uniform float uVolTrigs[32];   // 4 slots × 8 — seconds since each trigger, per volumetric clip
uniform int uVolTrigCount[4];
uniform vec4 uVolMeta[4];
uniform vec4 uVolA[4];
uniform vec4 uVolB[4];
uniform vec3 uVolColA[4];
uniform vec3 uVolColB[4];
uniform float uFxId[16];   // 4 clips × 4 colour-effect slots (0 = none)
uniform vec4 uFxP[16];     // per-slot params

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
// caustics (id 7)
float caust_ridge(float n){ return 1.0 - abs(2.0 * n - 1.0); }
float caust_field(vec3 q, float tm, float warp){
  vec3 wv = vec3(
    vnoise3(q * 0.5 + vec3(0.0, 1.3, tm * 0.30)),
    vnoise3(q * 0.5 + vec3(4.1, 1.7, tm * 0.27)),
    vnoise3(q * 0.5 + vec3(9.2, 5.3, tm * 0.33))) - 0.5;
  q += wv * warp;
  float a = caust_ridge(vnoise3(q        + vec3(tm,       tm * 0.4, 0.0)));
  float b = caust_ridge(vnoise3(q * 1.93 - vec3(tm * 0.7, 0.0,      tm * 0.5)));
  return max(a, b) * 0.6 + a * b * 1.4;
}
// aurora (id 8)
float aur_wave(float x, float t){ return sin(x + t) + 0.5 * sin(x * 2.13 - t * 1.31 + 1.7) + 0.25 * sin(x * 4.31 + t * 0.73 + 4.2); }
float aur_layer(float run, float warp, float freq, float ph){ float c = 0.5 + 0.5 * cos(run * freq * 6.2831853 + warp + ph); return c * c * c; }
// shockburst (id 10)
float shock_burst(float d, float front, float th, float so, int rc, float sp, float fade){
  float v = 0.0; float env = exp(-front * fade);
  for (int k = 0; k < 4; k++){ if (k >= rc) break; float ringR = front - float(k) * sp; if (ringR < 0.0) continue;
    float soK = clamp(so + float(k) * 0.25, 0.0, 1.0); v = max(v, pow(0.55, float(k)) * env * vband(d - ringR, th, soK)); }
  return v;
}

// From-Canvas tint: when uVolMeta[i].w is set, colour the field's intensity with
// the composited 2D canvas at this LED's UV instead of the flat param colour.
vec3 volTint(int i, vec2 cuv, vec3 flatCol) { return uVolMeta[i].w > 0.5 ? texture(uCanvas, cuv).rgb : flatCol; }

// One packed clip's field at world point p -> PREMULTIPLIED rgba. bnd is this
// LED's audio band index (0/1/2), used only by the audiobars field.
vec4 fieldColor(int i, vec3 p, vec2 cuv, float bnd){
  int id = int(uVolMeta[i].x + 0.5);
`;

// id → the field's exact GLSL block, copied verbatim from the original monolithic
// shader (keep each a GLSL twin of fields.js). buildSampleFS splices in only the
// blocks for the fields in use. Spherepulse (id 3) was the trailing fallthrough
// (no `if`) — wrapped here in `if (id == 3) { … }` so it can be omitted like any
// other block; the default `return vec4(0.0)` now lives in FS_POST.
const FIELD_BLOCKS = {
  11: `  if (id == 11) {          // audiobars: A=(gain, floor, -, -); colA=bass, colB=high, mid=mix.
    int band = int(bnd + 0.5);
    float level = band == 0 ? uAudioBands.x : (band == 2 ? uAudioBands.z : uAudioBands.y);
    float v = clamp(uVolA[i].y + level * uVolA[i].x, 0.0, 1.0);
    vec3 col = band == 0 ? uVolColA[i] : (band == 2 ? uVolColB[i] : mix(uVolColA[i], uVolColB[i], 0.5));
    return vec4(col * v, v);
  }`,
  0: `  if (id == 0) {           // plane sweep: A = (axis, pos, thickness, softness)
    float v = vband(vaxis(p, uVolA[i].x) - uVolA[i].y, uVolA[i].z, uVolA[i].w);
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }`,
  1: `  if (id == 1) {           // axis gradient: A = (axis, scroll, -, -)
    float g = fract(vaxis(p, uVolA[i].x) - uVolA[i].y);
    return vec4(mix(uVolColA[i], uVolColB[i], g), 1.0);
  }`,
  2: `  if (id == 2) {           // noise 3d: A = (scale, speed, axis, drift)
    // Directional drift (twin of fields.js noise3d): sample at p − axisVec·(t·drift).
    // drift 0 subtracts an exact 0 → byte-identical to the pre-drift field.
    vec3 ax = uVolA[i].z < 0.5 ? vec3(1.0, 0.0, 0.0) : (uVolA[i].z < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
    float v = clamp(vfbm3((p - ax * (uT * uVolA[i].w)) * uVolA[i].x + vec3(uT * uVolA[i].y)), 0.0, 1.0);
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }`,
  4: `  if (id == 4) {           // body wave: A = (axis, wavelength, amplitude, offset), B = (speed, -, -, -)
    float coord = vaxis(p, uVolA[i].x);
    float wave = sin((coord - uVolA[i].w + uT * uVolB[i].x) * 6.2831853 / uVolA[i].y) * uVolA[i].z;
    float v = vband(wave, uVolA[i].z * 0.2, 0.5);
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }`,
  5: `  if (id == 5) {           // plane pulse: A=(axis,thickness,softness,reverse), B=(speed,-,-,-); a plane sweeps per trigger
    float coord = uVolA[i].w > 0.5 ? (1.0 - vaxis(p, uVolA[i].x)) : vaxis(p, uVolA[i].x);
    float v = 0.0;
    for (int k = 0; k < 8; k++) { if (k >= uVolTrigCount[i]) break; v = max(v, vband(coord - uVolTrigs[i*8+k] * uVolB[i].x, uVolA[i].y, uVolA[i].z)); }
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }`,
  6: `  if (id == 6) {           // flow field: A=(windX,windY,windZ,scale), B=(turbulence,thickness,trail,seed), colB.x=speed
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
  }`,
  7: `  if (id == 7) {        // caustics
    float scale = uVolA[i].x, speed = uVolA[i].y, gain = uVolA[i].z, warp = uVolA[i].w;
    float bright = uVolB[i].x, axis = uVolB[i].y, drift = uVolB[i].z;
    vec3 ax = axis < 0.5 ? vec3(1.0, 0.0, 0.0) : (axis < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
    vec3 q = (p - ax * (uT * drift)) * scale;
    float raw = caust_field(q, uT * speed, warp);
    float v = clamp(pow(clamp(raw, 0.0, 1.0), gain) * bright, 0.0, 1.0);
    vec3 col = mix(uVolColB[i], volTint(i, cuv, uVolColA[i]), v);
    return vec4(col * v, v);
  }`,
  8: `  if (id == 8) {           // aurora
    float run  = vaxis(p, uVolA[i].x);
    float hgt  = (uVolA[i].x > 0.5 && uVolA[i].x < 1.5) ? p.x : p.y;
    float t    = uT * uVolA[i].y; float sc = uVolA[i].z; float soft = uVolA[i].w;
    float height = uVolB[i].x; float spread = uVolB[i].y; float seed = uVolB[i].z * 17.0;
    float warp = spread * (aur_wave(run * 3.0 + seed, t) + 1.5 * (vfbm3(vec3(run * 2.0 + seed, t * 0.3, seed)) - 0.5));
    float l0 = aur_layer(run, warp, sc, seed);
    float l1 = aur_layer(run, warp * 1.3, sc * 1.7, t * 0.6 + seed * 2.0);
    float l2 = aur_layer(run, warp * 0.7, sc * 0.53, -t * 0.4 + seed * 3.0);
    float ribs = 1.0 - (1.0 - l0) * (1.0 - l1 * 0.7) * (1.0 - l2 * 0.5);
    float hg  = hgt / max(1e-3, height);
    float env = (1.0 - smoothstep(1.0 - max(soft, 1e-3), 1.0, hg)) * smoothstep(0.0, 0.12, hg);
    float a = ribs * env * 0.85;
    vec3 col = volTint(i, cuv, mix(uVolColB[i], uVolColA[i], clamp(hg, 0.0, 1.0)));
    return vec4(col * a, a);
  }`,
  9: `  if (id == 9) {           // pacifica
    float sc = uVolA[i].x, sp = uVolA[i].y, dep = uVolA[i].w, cr = uVolB[i].x;
    vec3 axv = uVolA[i].z < 0.5 ? vec3(1.0,0.0,0.0) : (uVolA[i].z < 1.5 ? vec3(0.0,1.0,0.0) : vec3(0.0,0.0,1.0));
    vec3 b = p - axv * (sp * uT);
    float h = 0.50 * vfbm3(b * sc + vec3(0.0, uT * 0.05, 0.0));
    h += 0.28 * vfbm3(b * (sc * 2.0) + vec3(17.0 + uT * 0.09, 17.0, 17.0));
    h += 0.22 * vfbm3(b * (sc * 3.7) + vec3(43.0, 43.0, 43.0 + uT * 0.07));
    h = clamp(h, 0.0, 1.0);
    vec3 water = mix(uVolColA[i], uVolColB[i], smoothstep(0.35, 0.75, h));
    float cap = smoothstep(0.72, 0.95, h) * cr; vec3 col = water + uVolColB[i] * cap;
    float v = clamp((0.40 + 0.60 * h) * dep, 0.0, 1.0);
    return vec4(volTint(i, cuv, col) * v, v);
  }`,
  10: `  if (id == 10) {  // shockburst
    float d = length(p - uVolA[i].xyz);
    float th = uVolB[i].x, so = uVolB[i].y; int rc = int(uVolB[i].z + 0.5); float sp = uVolB[i].w;
    float fade = uVolColB[i].x; float speed = uVolA[i].w; float v = 0.0;
    for (int k = 0; k < 8; k++) { if (k >= uVolTrigCount[i]) break; v = max(v, shock_burst(d, uVolTrigs[i*8+k] * speed, th, so, rc, sp, fade)); }
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }`,
  3: `  // sphere pulse: A = (cx, cy, cz, radius), B = (thickness, softness, speed, 0).
  // The static shell at A.w, plus one expanding shell per recent trigger
  // (radius = age·speed — the same field re-evaluated, brightest wins).
  if (id == 3) {
    float d = length(p - uVolA[i].xyz);
    float v = vband(d - uVolA[i].w, uVolB[i].x, uVolB[i].y);
    for (int k = 0; k < 8; k++) {
      if (k >= uVolTrigCount[i]) break;
      v = max(v, vband(d - uVolTrigs[i*8+k] * uVolB[i].z, uVolB[i].x, uVolB[i].y));
    }
    return vec4(volTint(i, cuv, uVolColA[i]) * v, v);
  }`,
};

const FS_POST = `  return vec4(0.0);
}

// Per-LED colour-effect chain for volumetric clip 'clip' (4 slots). Operates on a
// STRAIGHT (un-premultiplied) colour. GLSL twin of fields.js evalColorFx.
vec3 colorFx(vec3 s, int clip){
  for (int j = 0; j < 4; j++) {
    int id = int(uFxId[clip * 4 + j] + 0.5);
    if (id == 0) continue;
    vec4 p = uFxP[clip * 4 + j];
    if (id == 1) {                       // hue (Rodrigues about grey axis — matches 2D hueRot)
      float a = (p.x + p.y * uT) * 6.2831853; vec3 k = vec3(0.57735026); float cs = cos(a), sn = sin(a);
      s = s * cs + cross(k, s) * sn + k * dot(k, s) * (1.0 - cs);
    } else if (id == 2) {                // Adjustments: gamma→bright→contrast→sat
      s = pow(clamp(s, 0.0, 1.0), vec3(1.0 / max(0.01, p.w))) * p.x;
      s = (s - 0.5) * p.y + 0.5;
      float l = dot(s, vec3(0.299, 0.587, 0.114)); s = mix(vec3(l), s, p.z);
    } else if (id == 3) {                // invert
      s = mix(s, 1.0 - s, clamp(p.x, 0.0, 1.0));
    } else if (id == 4) {                // rgb gain
      s = s * p.xyz;
    } else if (id == 5) {                // threshold (luminance binarise)
      s = vec3(step(p.x, dot(s, vec3(0.299, 0.587, 0.114))));
    } else if (id == 6) {                // strobe (time gate)
      s *= step(0.5, fract(uT * p.x));
    }
    s = clamp(s, 0.0, 1.0);
  }
  return s;
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
  vec3 ledPos = texelFetch(uPos, t, 0).xyz;   // per-LED world xyz — fetch once, not per clip
  float ledBand = texelFetch(uBand, t, 0).r;  // per-LED audio band index (audiobars)
  int ledCtl = int(texelFetch(uCtl, t, 0).r + 0.5) & 31;   // per-LED controller index
  rgb *= uCanvasCtl[ledCtl];                  // 2D controller mask (exclusifier on the active canvas clip)
  for (int i = 0; i < 4; i++) {
    if (i >= uVolCount) break;
    if ((uVolCtlMask[i] & (1 << ledCtl)) == 0) continue;   // this clip excludes this LED's controller
    vec4 f = fieldColor(i, ledPos, c, ledBand);
    // Phase-1 colour effects: fold the clip's chain over the STRAIGHT colour, re-premult.
    if (f.a > 0.0) { vec3 s = colorFx(f.rgb / f.a, i); f.rgb = s * f.a; }
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

// Assemble the sampler fragment shader for a specific set of field ids: FS_PRE +
// the id-chain blocks for exactly those fields + FS_POST. An empty set yields a
// shader whose fieldColor just returns vec4(0.0) — a fraction of the full 12-field
// program, which is what keeps the V3D GPU from crashing. Unknown ids are skipped.
export function buildSampleFS(ids) {
  return FS_PRE + ids.map((id) => FIELD_BLOCKS[id] || '').join('\n') + FS_POST;
}

// The sampler program is expensive to compile+link, and during a live fixture DRAG
// the sampler is rebuilt every frame (positions move) — so we compile ONCE per GL
// context PER FIELD SET and share it across sampler instances (mirrors the
// compositor's program cache). Keyed by the sorted, de-duped field-id list; a
// `gl.isProgram` guard recompiles automatically after WebGL context-loss (the old
// program handle is invalidated by the driver, so isProgram → false ⇒ fresh
// compile). Because programs are shared, dispose() must NOT delete them — they
// outlive any one sampler.
const SAMPLE_PROGRAMS = new WeakMap();   // gl → Map<fieldKey, linked program>
function fieldKeyOf(ids) { return [...new Set(ids)].sort((a, b) => a - b).join(','); }
function samplerProgram(gl, ids = []) {
  let byKey = SAMPLE_PROGRAMS.get(gl);
  if (!byKey) { byKey = new Map(); SAMPLE_PROGRAMS.set(gl, byKey); }
  const key = fieldKeyOf(ids);
  let p = byKey.get(key);
  if (!p || !gl.isProgram(p)) {
    p = program(gl, buildSampleFS(key ? key.split(',').map(Number) : []));
    byKey.set(key, p);
  }
  return p;
}

// samplePositions (optional, Float32Array len 3N — xyz per LED, same order as
// the uv pairs) feeds the volumetric field pass; absent/empty falls back to a
// canvas-plane position derived from nothing (all zeros) and volumetric clips
// simply read the origin — callers should always pass it (see pipeline.js).
export function makeSampler(gl, sampleUVs /* Float32Array len 2N */, samplePositions, sampleBands, fieldIds = [], sampleControllers = null) {
  const n = sampleUVs.length / 2;
  const fieldKey = fieldKeyOf(fieldIds);   // sorted+deduped key; app.js diffs it to detect field-set changes
  // Wrap the LED list into a 2D grid so very large rigs don't blow past the GPU's
  // max texture WIDTH (a 1-row n-wide texture fails once n exceeds it). Width is
  // capped well under MAX_TEXTURE_SIZE; height grows as needed.
  const maxw = Math.max(1, Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096));
  const W = Math.max(1, Math.min(n || 1, maxw));
  const H = Math.max(1, Math.ceil((n || 1) / W));
  // Pad the UV / position data to the full W×H grid (a partial last row when n
  // isn't a whole multiple of W). Shared by the initial build and in-place update.
  const packUVs = (src) => (W * H === n) ? src : (() => { const a = new Float32Array(W * H * 2); a.set(src); return a; })();
  const packPos = (src) => { const a = new Float32Array(W * H * 3); if (src?.length) a.set(src.subarray(0, Math.min(src.length, a.length))); return a; };
  // Per-LED audio band index (scalar) for the audiobars field — one channel,
  // padded to the full W×H grid; a missing array reads as band 0 (bass).
  const packBand = (src) => { const a = new Float32Array(W * H); if (src?.length) a.set(src.subarray(0, Math.min(src.length, a.length))); return a; };

  const map = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, map);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, W, H, 0, gl.RG, gl.FLOAT, packUVs(sampleUVs));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // Per-LED WORLD xyz for the volumetric field pass — same W×H layout as the uv
  // map. Padded like the uvs; a missing/short positions array reads as origin.
  const posTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, posTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, W, H, 0, gl.RGB, gl.FLOAT, packPos(samplePositions));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // Per-LED audio band index — a one-channel R32F texture, same W×H layout as
  // uMap/uPos (audiobars reads it to pick this LED's frequency band).
  const bandTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, bandTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, packBand(sampleBands));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // Per-LED controller index — same one-channel layout as uBand (exclusifier mask).
  const ctlTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ctlTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, packBand(sampleControllers));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const target = makeTarget(gl, W, H);
  const prog = samplerProgram(gl, fieldIds);   // shared, compiled once per GL context PER FIELD SET (see samplerProgram)
  const locCanvas = gl.getUniformLocation(prog, 'uCanvas');
  const locMap = gl.getUniformLocation(prog, 'uMap');
  const locPos = gl.getUniformLocation(prog, 'uPos');
  const locBand = gl.getUniformLocation(prog, 'uBand');
  const locCtl = gl.getUniformLocation(prog, 'uCtl');
  const locCanvasCtl = gl.getUniformLocation(prog, 'uCanvasCtl[0]');
  const locVolCtlMask = gl.getUniformLocation(prog, 'uVolCtlMask[0]');
  const locAudioBands = gl.getUniformLocation(prog, 'uAudioBands');
  const locVolCount = gl.getUniformLocation(prog, 'uVolCount');
  const locT = gl.getUniformLocation(prog, 'uT');
  const locVolTrigs = gl.getUniformLocation(prog, 'uVolTrigs[0]');
  const locVolTrigCount = gl.getUniformLocation(prog, 'uVolTrigCount[0]');
  const locVolMeta = gl.getUniformLocation(prog, 'uVolMeta[0]');
  const locVolA = gl.getUniformLocation(prog, 'uVolA[0]');
  const locVolB = gl.getUniformLocation(prog, 'uVolB[0]');
  const locVolColA = gl.getUniformLocation(prog, 'uVolColA[0]');
  const locVolColB = gl.getUniformLocation(prog, 'uVolColB[0]');
  const locFxId = gl.getUniformLocation(prog, 'uFxId[0]');
  const locFxP = gl.getUniformLocation(prog, 'uFxP[0]');
  const VOL_TRIG_SCRATCH = new Float32Array(32);   // 4 slots × 8
  const VOL_TRIG_COUNT_SCRATCH = new Int32Array(4);
  const FX_ID_ZERO = new Float32Array(16);
  const FX_P_ZERO = new Float32Array(64);
  const CANVAS_CTL_ONES = new Float32Array(32).fill(1);   // no 2D mask → every controller shows
  const VOL_CTL_ALL = new Int32Array(4).fill(-1);          // no vol mask → all bits set
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

  return { n, fieldKey,
    dispose() {
      gl.deleteTexture(map);
      gl.deleteTexture(posTex);
      gl.deleteTexture(bandTex);
      gl.deleteTexture(ctlTex);
      gl.deleteTexture(target.tex);
      gl.deleteFramebuffer(target.fbo);
      // NB: `prog` is the SHARED, cached SAMPLE_FS program (samplerProgram) — it
      // outlives this instance, so it is deliberately NOT deleted here.
      for (const b of pbos) gl.deleteBuffer(b);
      for (const s of fences) if (s) gl.deleteSync(s);
    },
    // In-place refresh for when only the per-LED UV/position data changed but the
    // LED COUNT is unchanged (the live fixture-DRAG path). Re-uploads the map and
    // position textures WITHOUT touching the render target, the 3-PBO readback
    // ring, its fences, the queue, or lastValid — so the ring stays WARM and
    // sample() keeps returning valid frames every frame of the drag (no dark wall).
    // texSubImage2D reuses the existing W×H storage (same n ⇒ same W/H). Callers
    // MUST only invoke this when the new n equals this sampler's n (see app.js);
    // a mismatch is rejected so a stale caller can fall back to a full rebuild.
    update(uvs /* Float32Array len 2N */, positions, bands, controllers) {
      if ((uvs.length / 2) !== n) return false;
      gl.bindTexture(gl.TEXTURE_2D, map);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RG, gl.FLOAT, packUVs(uvs));
      gl.bindTexture(gl.TEXTURE_2D, posTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGB, gl.FLOAT, packPos(positions));
      gl.bindTexture(gl.TEXTURE_2D, bandTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.FLOAT, packBand(bands));
      gl.bindTexture(gl.TEXTURE_2D, ctlTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.FLOAT, packBand(controllers));
      gl.bindTexture(gl.TEXTURE_2D, null);
      return true;
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
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, bandTex);
      gl.uniform1i(locBand, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ctlTex);
      gl.uniform1i(locCtl, 4);
      gl.uniform1fv(locCanvasCtl, (vol && vol.canvasCtl) || CANVAS_CTL_ONES);   // 2D exclusifier
      gl.uniform1iv(locVolCtlMask, (vol && vol.ctlMasks) || VOL_CTL_ALL);       // per-vol-clip masks
      const ab = vol?.audioBands;
      gl.uniform3f(locAudioBands, ab ? ab[0] : 0, ab ? ab[1] : 0, ab ? ab[2] : 0);
      const n2 = vol?.count || 0;
      gl.uniform1i(locVolCount, n2);
      if (n2 > 0) {
        gl.uniform1f(locT, vol.time || 0);
        gl.uniform4fv(locVolMeta, vol.meta);
        gl.uniform4fv(locVolA, vol.a);
        gl.uniform4fv(locVolB, vol.b);
        gl.uniform3fv(locVolColA, vol.colA);
        gl.uniform3fv(locVolColB, vol.colB);
        gl.uniform1fv(locFxId, vol.fxId || FX_ID_ZERO);
        gl.uniform4fv(locFxP, vol.fxParam || FX_P_ZERO);
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
        // Orphan (re-allocate) the PBO before readPixels: this discards the stale
        // getBufferSubData shadow copy explicitly, so ANGLE stops logging the per-frame
        // "READ-usage buffer written…before being read back / discarded shadow copy" warning.
        gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLen, gl.STREAM_READ);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0);   // 0 = offset into bound PBO ⇒ async
        fences[w] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        queue.push(w);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return lastValid;   // null on the first frame(s); app.js guards on falsy
    } };
}
