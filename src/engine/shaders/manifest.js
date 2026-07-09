// Param manifests + shader registry (Task 3.1).
//
// Each entry: { name, type:'generator'|'effect', src:<glsl string>, params:[...] }.
// `src` is an inlined GLSL string (single source of truth — no fetches).
// Generators write a full-screen color from `in vec2 uv`.
// Effects read the previous pass via `uniform sampler2D uTex;` and may use
// `uniform float uT;` (seconds). All shaders are `#version 300 es`.

const LINE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 frag;
uniform float pos;
uniform float width;
uniform float angle;
uniform float uPhase;   // integrated speed·time — continuous across speed changes
uniform float amp;
uniform float numLines; // 1 = the classic single line; N tiles N parallel copies
uniform vec3 color;     // tint (default white = the classic look)
void main(){
  float a = radians(angle);
  // Signed distance from the CANVAS CENTRE along the line normal, so changing
  // the angle pivots the line about the centre (not a corner).
  float coord = (uv.x - 0.5) * cos(a) + (uv.y - 0.5) * sin(a);
  // pos is the BASE position (0.5 = centre); the line sweeps ±amp around it.
  float target = (pos - 0.5) + amp * sin(uPhase);
  float n = max(1.0, floor(numLines + 0.5));
  float d;
  if (n <= 1.0) {
    d = abs(coord - target);   // single line — unchanged from the original
  } else {
    // N parallel copies, evenly spaced 1/N apart along the axis (fract wraps the
    // distance into the repeating cell, so the whole sweep moves as one grille).
    float cell = 1.0 / n;
    d = abs(fract((coord - target) / cell + 0.5) - 0.5) * cell;
  }
  float v = smoothstep(width, 0.0, d);
  frag = vec4(color * v, 1.0);
}`;

// Gradient is a COLOUR ramp: two stops (colorA→colorB) along the angled axis.
// Default black→white reproduces the old grayscale ramp.
const GRADIENT = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float angle; uniform vec3 colorA; uniform vec3 colorB;
void main(){ float a=radians(angle); float g=clamp(uv.x*cos(a)+uv.y*sin(a),0.0,1.0); frag=vec4(mix(colorA,colorB,g),1.0); }`;

// Solid COLOUR × brightness (the go-to wash). Default white × 1 = full white.
// Solid colour × brightness, with an optional Kelvin white-balance mode: when
// `useKelvin` is on, the colour comes from a blackbody temperature (warm→cool)
// instead of the picker. Tanner Helland's blackbody approximation, in-shader.
const SOLID = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform vec3 color; uniform float level; uniform float useKelvin; uniform float kelvin;
vec3 k2rgb(float k){
  float t = clamp(k, 1000.0, 40000.0) / 100.0; float r, g, b;
  if (t <= 66.0) { r = 1.0; g = clamp((99.4708025861*log(t) - 161.1195681661)/255.0, 0.0, 1.0); }
  else { r = clamp((329.698727446*pow(t-60.0,-0.1332047592))/255.0, 0.0, 1.0);
         g = clamp((288.1221695283*pow(t-60.0,-0.0755148492))/255.0, 0.0, 1.0); }
  if (t >= 66.0) b = 1.0; else if (t <= 19.0) b = 0.0;
  else b = clamp((138.5177312231*log(t-10.0) - 305.0447927307)/255.0, 0.0, 1.0);
  return vec3(r, g, b);
}
void main(){ vec3 c = (useKelvin > 0.5) ? k2rgb(kelvin) : color; frag = vec4(c*level, 1.0); }`;

// Colorize: map luminance between two colours (low→high). Drop it on any of the
// grayscale sources (Lines, Pulse, Grid…) to instantly tint the whole look.
const COLORIZE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform vec3 lowColor; uniform vec3 highColor;
void main(){ vec4 s = texture(uTex, uv); float l = dot(s.rgb, vec3(0.299,0.587,0.114)); frag = vec4(mix(lowColor, highColor, l), s.a); }`;

// Sine — a fully definable sine field with frequency MODULATION. The base wave
// runs along `angle`; a second sine (modFreq · modAmt) bends its phase for an
// FM warble. `speed` scrolls it (via uPhase, phase-continuous), `sharp` crisps
// the crests, `amp` scales brightness. modAmt 0 ⇒ a clean sine.
const SINE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float freq; uniform float angle; uniform float phase; uniform float amp;
uniform float modFreq; uniform float modAmt; uniform float sharp; uniform float uPhase;
uniform vec3 color;   // tint (default white = the classic look)
void main(){
  float a = radians(angle);
  float coord = uv.x*cos(a) + uv.y*sin(a);
  float m = sin(coord * modFreq * 6.2831853) * modAmt;                    // FM modulator
  float w = sin((coord * freq + m - uPhase) * 6.2831853 + phase * 6.2831853);
  float v = (w * 0.5 + 0.5) * amp;
  v = pow(clamp(v, 0.0, 1.0), mix(1.0, 5.0, clamp(sharp, 0.0, 1.0)));
  frag = vec4(color * v, 1.0);
}`;

// Checkered test source — set resolution in cols × rows (after Resolume's
// Checkered). Alternating black/white cells; the go-to pattern for verifying the
// fixture mapping over the installation.
const CHECKERS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float cols; uniform float rows;
uniform vec3 color;   // tint (default white = the classic look)
void main(){
  float c = floor(uv.x * max(1.0, cols)) + floor(uv.y * max(1.0, rows));
  frag = vec4(color * mod(c, 2.0), 1.0);
}`;

// Grid test source — cols × rows cells outlined by lines of `thickness`. Useful
// for aligning fixtures to a known canvas grid.
const GRID = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float cols; uniform float rows; uniform float thickness;
uniform vec3 color;   // tint (default white = the classic look)
void main(){
  vec2 g = abs(fract(uv * vec2(max(1.0, cols), max(1.0, rows))) - 0.5);
  float t = 0.5 - clamp(thickness, 0.0, 0.5);
  float line = step(t, g.x) + step(t, g.y);
  frag = vec4(color * clamp(line, 0.0, 1.0), 1.0);
}`;

// Pulse — a triggerable beam (after Resolume's PulseBeam): a head of light that
// travels across the canvas leaving a decaying trail. Fire it with the ⚡ button
// (uTrig = seconds since the last trigger), or enable autoFire to loop on uT.
const PULSE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float uT; uniform float uTrigs[8]; uniform int uTrigCount;
uniform float speed; uniform float headWidth; uniform float trailLength;
uniform float trailSoftness; uniform float autoFire;
uniform vec3 color;   // tint (default white = the classic look)
// One pulse's brightness at this texel given its head progress (0..1+).
float pulseAt(float prog){
  float d = prog - uv.x;                 // distance behind the leading edge
  if (d < 0.0 || prog > 1.0 + trailLength) return 0.0;
  if (d < headWidth) return 1.0;         // solid head band
  float td = (d - headWidth) / max(1e-4, trailLength);
  return (td <= 1.0) ? pow(1.0 - td, mix(1.0, 4.0, trailSoftness)) : 0.0; // decaying trail
}
void main(){
  float sp = max(0.0001, speed);
  float v = 0.0;
  if (autoFire > 0.5) {
    v = pulseAt(fract(uT * sp));
  } else {
    // Each trigger is an independent beam; they STACK (take the brightest).
    // uTrigs[i] = seconds since trigger i (huge until fired).
    for (int i = 0; i < 8; i++) {
      if (i >= uTrigCount) break;
      v = max(v, pulseAt(uTrigs[i] * sp));
    }
  }
  frag = vec4(color * v, 1.0);
}`;

// Radial — a triggerable ring that expands FROM THE CENTRE outward: the in-the-
// round twin of Pulse. A centred fixture layout sampling this lights middle-out.
// Self-animates when autoFire is on (loops on uT); otherwise each ⚡ fires an
// independent ring (uTrigs stack, brightest wins). `count` tiles concentric
// rings; the `aspect` uniform is injected by the compositor as the live canvas
// w/h so rings stay circular on any canvas; centerX/Y move the origin; reverse
// makes rings travel inward.
const RADIAL = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float uT; uniform float uTrigs[8]; uniform int uTrigCount;
uniform float speed; uniform float width; uniform float softness;
uniform float count; uniform float aspect; uniform float centerX; uniform float centerY;
uniform float autoFire; uniform float reverse;
uniform vec3 color;   // tint (default white = the classic look)
float radius(){
  vec2 p = uv - vec2(centerX, centerY);
  p.x *= max(aspect, 1e-4);                       // undo canvas stretch => circular
  float norm = length(vec2(0.5 * max(aspect, 1e-4), 0.5));
  return length(p) / max(norm, 1e-4);             // ~0 at centre, ~1 at the corner
}
float ringAt(float prog, float r){
  float n = max(1.0, count);
  float rr = fract(r * n);
  // reverse ⇒ rings travel INWARD (radius shrinks as prog grows) instead of out.
  float edge = fract((reverse > 0.5 ? -prog : prog) * n);
  float d = edge - rr; if (d < 0.0) d += 1.0;     // distance inside the expanding edge
  if (prog > 1.0 + width) return 0.0;
  float w = max(1e-4, width);
  if (d > w) return 0.0;
  return pow(1.0 - d / w, mix(1.0, 4.0, clamp(softness, 0.0, 1.0)));
}
void main(){
  float r = radius(), sp = max(0.0001, speed), v = 0.0;
  if (autoFire > 0.5) v = ringAt(fract(uT * sp), r);
  // Triggers ALWAYS fire — even with autoFire on — so the trigger button actually
  // works (it used to sit in an else to autoFire, which swallowed every trigger).
  // Each trigger injects a fresh ring expanding from the centre; brightest wins.
  for (int i = 0; i < 8; i++) { if (i >= uTrigCount) break; v = max(v, ringAt(uTrigs[i] * sp, r)); }
  frag = vec4(color * v, 1.0);
}`;

const DISPLACE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float amt; uniform float uT;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){ float n=hash(vec2(uv.y, floor(uT*3.0))); vec2 d=vec2((n-0.5),0.0); frag=texture(uTex, uv + d*amt); }`;

const REPEAT = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float count;
void main(){ vec2 p=uv; p.x=fract(uv.x*count); frag=texture(uTex, vec2(p.x, uv.y)); }`;

const STROBE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float rate; uniform float uT;
void main(){ float g=step(0.5, fract(uT*rate)); frag=texture(uTex, uv)*g; }`;

// FEEDBACK-BUS effects — these declare `uFeedback`, the compositor's persistent
// previous-frame texture for this effect instance (the engine binds it + copies the
// result back each frame; see compositor.js). They are what makes content feel ALIVE.
//
// Trails: bright pixels leave decaying streaks (max-blend with the faded last frame).
const TRAILS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform sampler2D uFeedback; uniform float decay;
void main(){ vec4 cur = texture(uTex, uv); vec4 prev = texture(uFeedback, uv) * decay; frag = max(cur, prev); }`;

// Feedback tunnel: the faded last frame is zoomed/rotated about centre before max-blend —
// gives infinite-tunnel / droste motion. aspect (auto-injected) keeps it square.
const FEEDBACK = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform sampler2D uFeedback; uniform float decay; uniform float zoom; uniform float rotate; uniform float aspect;
void main(){
  vec2 c = uv - 0.5; c.x *= aspect;
  float s = sin(rotate), co = cos(rotate);
  c = mat2(co, -s, s, co) * c / max(0.01, zoom);
  c.x /= aspect; c += 0.5;
  vec4 prev = texture(uFeedback, c) * decay;
  frag = max(texture(uTex, uv), prev);
}`;

// Segmenter (after Resolume's Extra Effect): split the perpendicular axis into N
// equal segments and pass only a chosen range; the rest is transparent. Stack
// several (different sources per clip) to assemble per-segment content — and for
// the tube installation it maps content to physical column groups.
const SEGMENTER = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex;
uniform float count;       // how many segments to split the canvas into (N)
uniform float index;       // first visible segment (0-based)
uniform float endIndex;    // last visible segment (inclusive)
uniform float horizontal;  // 0 = columns (split x), 1 = rows (split y)
void main(){
  float n = max(1.0, floor(count + 0.5));
  float perp = (horizontal < 0.5) ? uv.x : uv.y;
  float seg = floor(clamp(perp, 0.0, 0.999999) * n);
  float a = floor(index + 0.5), b = floor(endIndex + 0.5);
  float lo = min(a, b), hi = max(a, b);
  if (seg < lo || seg > hi) { frag = vec4(0.0); return; }
  frag = texture(uTex, uv);
}`;

// Cascade (the in-visual twin of the fixture-level chains/stagger): split the
// perpendicular axis into N bands and DELAY each band along the travel axis by
// order*offset, so a TRAVELLING pattern (Pulse/Chase/Wave) arrives band-by-band
// — a staircase cascade. A pure texture op (no clock): shifting the sample point
// backwards along travel is equivalent to a time delay for moving content, which
// is exactly the trick chains.js uses at sample time. `offset` is in UV units of
// the travel axis (effective delay ~= offset / source speed), NOT milliseconds.
// `horizontal` picks the SPLIT axis (matches Segmenter: 0=split x, 1=split y);
// travel is then the other axis. Default splits y (bands = stacked rows) so a
// default x-travelling Pulse cascades out of the box.
const CASCADE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex;
uniform float count;       // number of bands (parts) to split into
uniform float offset;      // per-band shift along travel (UV units)
uniform float horizontal;  // 0 = split x (bands are columns), 1 = split y (rows)
uniform float reverse;     // flip the cascade direction
uniform float falloff;     // 0..1 dim later bands (a fading tail across parts)
uniform float wrap;        // wrap the travel coord instead of going dark off-edge
uniform float wave;        // 0 = linear staircase; >0 = offsets follow a sine (cycles across the bands)
void main(){
  float n = max(1.0, floor(count + 0.5));
  float perp = (horizontal < 0.5) ? uv.x : uv.y;          // split axis
  float band = floor(clamp(perp, 0.0, 0.999999) * n);
  float order = (reverse < 0.5) ? band : (n - 1.0 - band);
  float t = order / max(1.0, n - 1.0);                    // 0..1 across the bands
  // Linear ramp, OR (wave>0) a sine so the per-band delay rises and falls.
  float shift = (wave > 0.0)
    ? (sin(t * 6.2831853 * wave) * 0.5 + 0.5) * (n - 1.0) * offset
    : order * offset;
  float tc = (horizontal < 0.5) ? uv.y : uv.x;            // travel coord (other axis)
  tc -= shift;
  if (wrap > 0.5) { tc = fract(tc); }
  else if (tc < 0.0 || tc > 1.0) { frag = vec4(0.0); return; }
  vec2 suv = (horizontal < 0.5) ? vec2(uv.x, tc) : vec2(tc, uv.y);
  vec4 c = texture(uTex, suv);
  float fade = 1.0 - falloff * (order / max(1.0, n - 1.0));
  frag = vec4(c.rgb * fade, c.a);
}`;

// Hue rotate — colour over time. Rotates RGB around the grey (1,1,1) axis
// (Rodrigues). `shift` is a static offset (0..1 = full wheel); `speed` auto-
// cycles via uT, so dropping this on a clip or the composition gives a colour
// sweep without a timeline.
const HUE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float shift; uniform float uPhase;
vec3 hueRot(vec3 c, float a){
  const vec3 k = vec3(0.57735026);            // normalize(vec3(1))
  float cs = cos(a), sn = sin(a);
  return c*cs + cross(k, c)*sn + k*dot(k, c)*(1.0 - cs);
}
void main(){
  vec4 src = texture(uTex, uv);
  float a = (shift + uPhase) * 6.2831853;
  frag = vec4(clamp(hueRot(src.rgb, a), 0.0, 1.0), src.a);
}`;

// --- Colour-adjust effects (a bunch) ---------------------------------------
// Brightness + Contrast in one effect (brightness first, then contrast).
const BRIGHTCONTRAST = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float brightness; uniform float contrast;
void main(){ vec4 s=texture(uTex,uv); vec3 c=s.rgb*brightness; c=(c-0.5)*contrast+0.5; frag=vec4(clamp(c,0.0,1.0), s.a); }`;

const SATURATION = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float amount;
void main(){ vec4 c=texture(uTex,uv); float l=dot(c.rgb,vec3(0.299,0.587,0.114));
  frag=vec4(clamp(mix(vec3(l),c.rgb,amount),0.0,1.0), c.a); }`;

const GAMMA = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float gamma;
void main(){ vec4 c=texture(uTex,uv); frag=vec4(pow(clamp(c.rgb,0.0,1.0), vec3(1.0/max(0.01,gamma))), c.a); }`;

const INVERT = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float amount;
void main(){ vec4 c=texture(uTex,uv); frag=vec4(mix(c.rgb, 1.0-c.rgb, clamp(amount,0.0,1.0)), c.a); }`;

const RGB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float red; uniform float green; uniform float blue;
void main(){ vec4 c=texture(uTex,uv); frag=vec4(clamp(c.rgb*vec3(red,green,blue),0.0,1.0), c.a); }`;

const THRESHOLD = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float level;
void main(){ vec4 c=texture(uTex,uv); float l=dot(c.rgb,vec3(0.299,0.587,0.114));
  frag=vec4(vec3(step(level,l)), c.a); }`;

// Grade — one effect bundling the common level setters (gamma → brightness →
// contrast → saturation), so you don't stack four separate effects. (Internal
// key stays 'color' so saved compositions keep their 'color.*' params.)
const COLOR = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex;
uniform float brightness; uniform float contrast; uniform float saturation; uniform float gamma;
void main(){
  vec4 src = texture(uTex, uv);
  vec3 c = pow(clamp(src.rgb, 0.0, 1.0), vec3(1.0 / max(0.01, gamma)));
  c = c * brightness;
  c = (c - 0.5) * contrast + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, saturation);
  frag = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

// Noise — animated fbm value noise (the "clouds / MadNoise" staple), mapped
// between two colours. `scale` zooms, `speed` drifts it (phase-continuous),
// `contrast` hardens the bands.
const NOISE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float scale; uniform float contrast; uniform float uPhase;
uniform vec3 colorA; uniform vec3 colorB;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
void main(){
  vec2 p = uv*max(0.5,scale) + vec2(uPhase);
  float n=0.0, amp=0.5, fr=1.0;
  for(int i=0;i<5;i++){ n += amp*vnoise(p*fr); fr*=2.0; amp*=0.5; }
  n = clamp((n-0.5)*mix(1.0,3.0,clamp(contrast,0.0,1.0))+0.5, 0.0, 1.0);
  frag = vec4(mix(colorA, colorB, n), 1.0);
}`;

// Spectrum — a rainbow sweep of `bands` hue cycles along `angle`, scrolling via
// uPhase; `sat` blends toward white. (HSV hue → RGB, no branches.)
const SPECTRUM = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float bands; uniform float sat; uniform float angle; uniform float uPhase;
vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0); }
void main(){
  float a=radians(angle); float coord = uv.x*cos(a)+uv.y*sin(a);
  float h = fract(coord*max(1.0,bands) - uPhase);
  frag = vec4(mix(vec3(1.0), hue(h), clamp(sat,0.0,1.0)), 1.0);
}`;

// --- VOLUMETRIC sources ------------------------------------------------------
// Fields f(x, y, z, t) → rgba evaluated at each LED's WORLD position by the GPU
// sampler (src/engine/sampler.js — GLSL twins of src/engine/fields.js). They do
// NOT draw on the 2D canvas: the compositor SKIPS `volumetric: true` entries.
// The `src` below is a THUMBNAIL-ONLY preview shader (used by thumbs.js and the
// picker): it evaluates the field over p = (uv.x, uv.y, uv.y) — z mapped down
// the thumbnail — so z-axis fields still read as a picture.
const VOL_BAND = `
float vband(float d, float th, float so){
  float hw = max(1e-4, th) * 0.5;
  float inner = hw * (1.0 - clamp(so, 0.0, 1.0));
  float t = clamp((abs(d) - inner) / max(hw - inner, 1e-5), 0.0, 1.0);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}
float vaxis(vec3 p, float axis){ return axis < 0.5 ? p.x : (axis < 1.5 ? p.y : p.z); }`;

const PLANESWEEP_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float axis; uniform float pos; uniform float thickness; uniform float softness;
uniform vec3 color;
${VOL_BAND}
void main(){
  vec3 p = vec3(uv.x, uv.y, uv.y);
  float v = vband(vaxis(p, axis) - pos, thickness, softness);
  frag = vec4(color * v, 1.0);
}`;

const AXISGRADIENT_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float axis; uniform float scroll; uniform vec3 colorA; uniform vec3 colorB;
${VOL_BAND}
void main(){
  vec3 p = vec3(uv.x, uv.y, uv.y);
  float g = fract(vaxis(p, axis) - scroll);
  frag = vec4(mix(colorA, colorB, g), 1.0);
}`;

const NOISE3D_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float scale; uniform float speed; uniform float uT; uniform vec3 color;
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
void main(){
  vec3 p = vec3(uv.x, uv.y, uv.y);
  float v = clamp(vfbm3(p * scale + vec3(uT * speed)), 0.0, 1.0);
  frag = vec4(color * v, 1.0);
}`;

const SPHEREPULSE_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float centerX; uniform float centerY; uniform float centerZ;
uniform float radius; uniform float thickness; uniform float softness; uniform vec3 color;
${VOL_BAND}
void main(){
  vec3 p = vec3(uv.x, uv.y, uv.y);
  float v = vband(length(p - vec3(centerX, centerY, centerZ)) - radius, thickness, softness);
  frag = vec4(color * v, 1.0);
}`;

const BODYWAVE_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float axis; uniform float wavelength; uniform float amplitude; uniform float offset;
uniform vec3 color;
${VOL_BAND}
void main(){
  vec3 p = vec3(uv.x, uv.y, uv.y);
  float coord = axis < 0.5 ? p.x : (axis < 1.5 ? p.y : p.z);
  float wave = sin((coord - offset) * 6.2831853 / wavelength) * amplitude;
  float v = vband(wave, amplitude * 0.2, 0.5);
  frag = vec4(color * v, 1.0);
}`;

const PLANEPULSE_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float axis; uniform float thickness; uniform float softness; uniform vec3 color;
${VOL_BAND}
void main(){
  vec3 p = vec3(uv.x, uv.y, uv.y);
  float v = vband(vaxis(p, axis) - 0.5, thickness, softness);
  frag = vec4(color * v, 1.0);
}`;

const FLOWFIELD_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float windX; uniform float windY; uniform float windZ; uniform float speed;
uniform float scale; uniform float turbulence; uniform float thickness; uniform float trail; uniform float seed;
uniform float uT; uniform vec3 color;
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
void main(){
  vec3 p = vec3(uv.x, uv.y, uv.y);
  vec3 wind = vec3(windX, windY, windZ); float wm = length(wind);
  vec3 dir = wm < 1e-5 ? vec3(0.0) : wind / wm;
  float s = seed * 11.0;
  vec3 q = p * scale - dir * (speed * uT) + vec3(s, s * 1.7, s * 0.3);
  vec3 w = vec3(
    vfbm3(q + vec3(19.19, 7.3, 2.7)),
    vfbm3(q + vec3(5.2, 41.7, 13.1)),
    vfbm3(q + vec3(31.3, 9.1, 27.9))) * 2.0 - 1.0;
  q += turbulence * w;
  float k = trail * 0.9; float along = dot(q, dir); q -= dir * along * k;
  float nrm = vfbm3(q);
  float hw = 0.02 + thickness * 0.48;
  float tt = clamp((abs(nrm - 0.5) - hw * 0.5) / max(hw - hw * 0.5, 1e-5), 0.0, 1.0);
  float v = 1.0 - tt * tt * (3.0 - 2.0 * tt);
  frag = vec4(color * v, 1.0);
}`;

const CAUSTICS_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float scale; uniform float speed; uniform float gain; uniform float warp;
uniform float brightness; uniform float uT; uniform vec3 color; uniform vec3 colorB;
float vhash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float x00 = mix(vhash3(i), vhash3(i + vec3(1,0,0)), f.x); float x10 = mix(vhash3(i + vec3(0,1,0)), vhash3(i + vec3(1,1,0)), f.x);
  float x01 = mix(vhash3(i + vec3(0,0,1)), vhash3(i + vec3(1,0,1)), f.x); float x11 = mix(vhash3(i + vec3(0,1,1)), vhash3(i + vec3(1,1,1)), f.x);
  return mix(mix(x00,x10,f.y), mix(x01,x11,f.y), f.z); }
float caust_ridge(float n){ return 1.0 - abs(2.0 * n - 1.0); }
float caust_field(vec3 q, float tm, float warp){ vec3 wv = vec3(vnoise3(q*0.5+vec3(0.0,1.3,tm*0.30)), vnoise3(q*0.5+vec3(4.1,1.7,tm*0.27)), vnoise3(q*0.5+vec3(9.2,5.3,tm*0.33))) - 0.5;
  q += wv * warp; float a = caust_ridge(vnoise3(q + vec3(tm, tm*0.4, 0.0))); float b = caust_ridge(vnoise3(q*1.93 - vec3(tm*0.7, 0.0, tm*0.5))); return max(a,b)*0.6 + a*b*1.4; }
void main(){ vec3 p = vec3(uv.x, uv.y, uv.y); float raw = caust_field(p * scale, uT * speed, warp);
  float v = clamp(pow(clamp(raw,0.0,1.0), gain) * brightness, 0.0, 1.0); frag = vec4(mix(colorB, color, v) * v, 1.0); }`;

const AURORA_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float axis; uniform float speed; uniform float scale; uniform float softness;
uniform float height; uniform float spread; uniform float seed; uniform float uT; uniform vec3 colorA; uniform vec3 colorB;
float vhash3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float vnoise3(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  float x00=mix(vhash3(i),vhash3(i+vec3(1,0,0)),f.x),x10=mix(vhash3(i+vec3(0,1,0)),vhash3(i+vec3(1,1,0)),f.x);
  float x01=mix(vhash3(i+vec3(0,0,1)),vhash3(i+vec3(1,0,1)),f.x),x11=mix(vhash3(i+vec3(0,1,1)),vhash3(i+vec3(1,1,1)),f.x);
  return mix(mix(x00,x10,f.y),mix(x01,x11,f.y),f.z); }
float vfbm3(vec3 p){ float n=0.0,amp=0.5,fr=1.0; for(int i=0;i<4;i++){ n+=amp*vnoise3(p*fr); fr*=2.0; amp*=0.5; } return n; }
float vaxis(vec3 p, float axis){ return axis<0.5?p.x:(axis<1.5?p.y:p.z); }
float aur_wave(float x,float t){ return sin(x+t)+0.5*sin(x*2.13-t*1.31+1.7)+0.25*sin(x*4.31+t*0.73+4.2); }
float aur_layer(float run,float warp,float freq,float ph){ float c=0.5+0.5*cos(run*freq*6.2831853+warp+ph); return c*c*c; }
void main(){ vec3 p=vec3(uv.x,uv.y,uv.y); float run=vaxis(p,axis); float hgt=(axis>0.5&&axis<1.5)?p.x:p.y;
  float t=uT*speed; float sd=seed*17.0;
  float warp=spread*(aur_wave(run*3.0+sd,t)+1.5*(vfbm3(vec3(run*2.0+sd,t*0.3,sd))-0.5));
  float l0=aur_layer(run,warp,scale,sd),l1=aur_layer(run,warp*1.3,scale*1.7,t*0.6+sd*2.0),l2=aur_layer(run,warp*0.7,scale*0.53,-t*0.4+sd*3.0);
  float ribs=1.0-(1.0-l0)*(1.0-l1*0.7)*(1.0-l2*0.5);
  float hg=hgt/max(1e-3,height); float env=(1.0-smoothstep(1.0-max(softness,1e-3),1.0,hg))*smoothstep(0.0,0.12,hg);
  float a=ribs*env*0.85; frag=vec4(mix(colorB,colorA,clamp(hg,0.0,1.0))*a,1.0); }`;

const PACIFICA_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float scale; uniform float speed; uniform float axis; uniform float depth; uniform float crest; uniform float uT; uniform vec3 colorA; uniform vec3 colorB;
float vhash3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float vnoise3(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  float x00=mix(vhash3(i),vhash3(i+vec3(1,0,0)),f.x),x10=mix(vhash3(i+vec3(0,1,0)),vhash3(i+vec3(1,1,0)),f.x);
  float x01=mix(vhash3(i+vec3(0,0,1)),vhash3(i+vec3(1,0,1)),f.x),x11=mix(vhash3(i+vec3(0,1,1)),vhash3(i+vec3(1,1,1)),f.x);
  return mix(mix(x00,x10,f.y),mix(x01,x11,f.y),f.z); }
float vfbm3(vec3 p){ float n=0.0,amp=0.5,fr=1.0; for(int i=0;i<4;i++){ n+=amp*vnoise3(p*fr); fr*=2.0; amp*=0.5; } return n; }
void main(){ vec3 p=vec3(uv.x,uv.y,uv.y);
  vec3 axv = axis<0.5?vec3(1.0,0.0,0.0):(axis<1.5?vec3(0.0,1.0,0.0):vec3(0.0,0.0,1.0)); vec3 b=p-axv*(speed*uT);
  float h=0.50*vfbm3(b*scale+vec3(0.0,uT*0.05,0.0)); h+=0.28*vfbm3(b*(scale*2.0)+vec3(17.0+uT*0.09,17.0,17.0)); h+=0.22*vfbm3(b*(scale*3.7)+vec3(43.0,43.0,43.0+uT*0.07));
  h=clamp(h,0.0,1.0); vec3 water=mix(colorA,colorB,smoothstep(0.35,0.75,h)); float cap=smoothstep(0.72,0.95,h)*crest; vec3 col=water+colorB*cap;
  float v=clamp((0.40+0.60*h)*depth,0.0,1.0); frag=vec4(col*v,1.0); }`;

const SHOCKBURST_THUMB = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float centerX; uniform float centerY; uniform float centerZ; uniform float speed; uniform float thickness; uniform float softness; uniform float ringCount; uniform float spacing; uniform float fade; uniform float uT; uniform vec3 color;
${VOL_BAND}
void main(){ vec3 p=vec3(uv.x,uv.y,uv.y); float d=length(p-vec3(centerX,centerY,centerZ)); int rc=int(ringCount+0.5);
  float front=fract(uT*speed*0.4)*1.4; float env=exp(-front*fade); float v=0.0;
  for(int k=0;k<4;k++){ if(k>=rc) break; float ringR=front-float(k)*spacing; if(ringR<0.0) continue; float soK=clamp(softness+float(k)*0.25,0.0,1.0); v=max(v,pow(0.55,float(k))*env*vband(d-ringR,thickness,soK)); }
  frag=vec4(color*v,1.0); }`;

const DOMAINWARP = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float uPhase;
uniform float aspect;
uniform float scale;
uniform float speed;
uniform float warp;
uniform float contrast;
uniform vec3 colorA;
uniform vec3 colorB;

// --- hash / value noise ---
float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  // smoothstep quintic interpolation
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i + vec2(0.0, 0.0));
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// --- fractal brownian motion (fixed 5 octaves) ---
float fbm(vec2 p){
  float sum = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for(int i = 0; i < 5; i++){
    sum += amp * vnoise(p);
    p = rot * p * 2.02;
    amp *= 0.5;
  }
  return sum;
}

void main(){
  // isotropic, centered coords
  vec2 p = (uv - 0.5);
  p.x *= aspect;
  p *= scale;

  // continuous motion time (prefer pre-integrated phase)
  float t = uPhase * speed;

  // domain warp: two layers of fbm displace the sample position
  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + 0.15 * t),
    fbm(p + vec2(5.2, 1.3) - 0.12 * t)
  );

  vec2 r = vec2(
    fbm(p + warp * q + vec2(1.7, 9.2) + 0.10 * t),
    fbm(p + warp * q + vec2(8.3, 2.8) - 0.13 * t)
  );

  float f = fbm(p + warp * r);

  // shape the field into flowing bands / marble contrast
  f = clamp(f + 0.25 * length(q) + 0.15 * length(r), 0.0, 1.0);
  f = pow(f, max(contrast, 0.001));
  f = clamp(f, 0.0, 1.0);

  vec3 col = mix(colorA, colorB, f);
  frag = vec4(col, 1.0);
}`;

const METABALLS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float uT;
uniform float aspect;
uniform float count;
uniform float radius;
uniform float speed;
uniform float softness;
uniform vec3 color;

void main(){
  // Work in aspect-corrected space so x-distance matches y-distance
  // and blobs stay round on any canvas.
  vec2 p = vec2(uv.x * aspect, uv.y);

  float r2 = radius * radius;
  float field = 0.0;

  for(int i = 0; i < 8; i++){
    if(float(i) >= count) break;
    float fi = float(i);

    // Distinct drift phase per blob; self-animating on uT.
    vec2 c = vec2(
      0.5 + 0.34 * sin(uT * speed + fi * 2.4),
      0.5 + 0.34 * cos(uT * speed * 0.9 + fi * 1.7)
    );
    c.x *= aspect;

    vec2 d = p - c;
    float dist2 = dot(d, d);
    // Inverse-square metaball contribution; == 1.0 at dist == radius.
    field += r2 / (dist2 + 1e-4);
  }

  // Threshold the summed field into a glowing organic mass.
  // softness feathers the edge symmetrically around the 1.0 iso-level.
  float m = smoothstep(1.0 - softness, 1.0 + softness, field);

  // Premultiplied-friendly: alpha == blob intensity, 0 in empty areas.
  frag = vec4(color * m, m);
}`;

const PLASMA = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float scale;   // spatial frequency
uniform float speed;   // motion rate (multiplies phase)
uniform float warp;    // extra domain distortion
uniform float sat;     // color saturation 0..1
uniform float uPhase;  // speed*time from engine
uniform float aspect;  // canvas w/h for isotropic radial term

vec3 hue(float h){
  return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
}

void main(){
  float t = uPhase * speed;
  // centred, aspect-corrected coords so the radial term is isotropic
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * scale;

  // optional domain warp: swirl the coordinates before sampling
  p += warp * vec2(
    sin(p.y * 1.7 + t * 0.9),
    cos(p.x * 1.5 - t * 0.7)
  );

  // layered sine waves: horizontal, diagonal, and radial ripples
  float v = 0.0;
  v += sin(p.x + t);
  v += sin(p.y * 0.9 - t * 1.1);
  v += sin((p.x + p.y) * 0.7 + t * 0.8);
  float r = length(p) + 1.0;
  v += sin(r * 1.3 - t * 1.6);

  // v spans about -4..4; normalise to a hue and cycle it over time
  float h = v * 0.125 + t * 0.05;

  frag = vec4(mix(vec3(1.0), hue(h), clamp(sat, 0.0, 1.0)), 1.0);
}`;

const TUNNEL = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;

uniform float uT;
uniform float uPhase;
uniform float aspect;

uniform float speed;         // fly-in speed (scales the scroll)
uniform float rings;         // ring frequency along depth
uniform float angularBands;  // number of angular stripes around the tunnel
uniform float twist;         // spiral: rotate angle with depth
uniform vec3  colorA;        // fog / edge color
uniform vec3  colorB;        // near / stripe color

const float PI  = 3.14159265359;
const float TAU = 6.28318530718;

void main() {
  // Centered, aspect-corrected coords so the tunnel stays circular.
  vec2 p = uv - 0.5;
  p.x *= aspect;

  // Polar coordinates around center.
  float r = length(p);
  float a = atan(p.y, p.x);

  // Depth: 1/r goes to infinity at the center (the far end of the tunnel),
  // and the scroll (uPhase*speed as a fallback on uT) flies us inward.
  float scroll = uPhase + uT * speed * 0.15;
  float depth  = 1.0 / max(r, 1e-3) + scroll * speed;

  // Spiral: twist the angle as a function of depth.
  float ang = a + depth * twist;

  // Angular coordinate normalized to [0,1) around the tunnel.
  float angC = ang / TAU;

  // Ring pattern along depth + stripe pattern around the tunnel.
  float ringWave   = 0.5 + 0.5 * sin(depth * rings * TAU);
  float stripeWave = 0.5 + 0.5 * sin(angC * angularBands * TAU);

  // Combine into a single tunnel-wall pattern.
  float pattern = ringWave * stripeWave;
  pattern = pow(pattern, 1.5); // crisp up the bright bands

  // Depth fog: center (small r) glows, edges (large r) fade to colorA.
  float fog = smoothstep(0.0, 0.6, r);

  vec3 col = mix(colorA, colorB, pattern);
  col = mix(col, colorA, fog);

  frag = vec4(col, 1.0);
}
`;

const SHOCKWAVE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex;
uniform float uTrigs[8];
uniform int uTrigCount;
uniform float aspect;
uniform float speed;
uniform float amp;
uniform float width;
uniform float rimGain;
uniform float centerX;
uniform float centerY;
uniform vec3 rimColor;

void main(){
  vec2 center = vec2(centerX, centerY);
  vec2 p = uv - center;
  p.x *= aspect;
  float r = length(p);

  // Radial direction in aspect-corrected space (guarded against r == 0).
  vec2 dir = r > 1e-5 ? p / r : vec2(0.0);

  vec2 disp = vec2(0.0);
  float rim = 0.0;

  // Constant loop bound; only 0..uTrigCount-1 are valid triggers.
  for(int i = 0; i < 8; i++){
    if(i >= uTrigCount) break;
    float age = uTrigs[i];
    float ringR = age * speed;
    float d = r - ringR;
    // Narrow Gaussian band of thickness ~width centered on the ring.
    float w = max(width, 1e-4);
    float band = exp(-(d * d) / (w * w));
    // Fade the whole ring out as it ages so old rings vanish.
    float fade = exp(-age * 3.0);
    float env = band * fade;
    // Push the sample outward along the radial normal.
    disp += dir * (amp * env);
    rim += env * rimGain;
  }

  // Displacement was built in aspect-corrected space; undo the x scale for UV.
  vec2 dispUV = vec2(disp.x / aspect, disp.y);

  vec4 base = texture(uTex, uv + dispUV);
  frag = base + vec4(rimColor * rim, 0.0);
}`;

const BASSWARP = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex;
uniform float uT;
uniform float aspect;
uniform float amount;
uniform float scale;
uniform float speed;
uniform float swirl;

void main(){
  // Aspect-corrected working coord so the wobble is isotropic on wide canvases.
  vec2 p = uv;
  p.x *= aspect;

  float t = uT * speed;

  // Two octaves of scrolling sines on BOTH axes -> liquid, not a shear.
  vec2 w;
  w.x  = sin(p.y * scale        + t)        + 0.5 * sin(p.y * scale * 2.03 - t * 1.7 + 1.3);
  w.y  = cos(p.x * scale        - t)        + 0.5 * cos(p.x * scale * 1.97 + t * 1.4 - 0.7);
  // cross-feed the octaves for swirlier, less grid-like flow
  w.x += 0.5 * sin(p.x * scale * 0.75 + t * 0.6);
  w.y += 0.5 * cos(p.y * scale * 0.75 - t * 0.6);

  // Optional rotational component around the image centre.
  vec2 c = uv - 0.5;
  vec2 rot = vec2(-c.y, c.x) * swirl * (0.5 + 0.5 * sin(t + length(c) * scale));

  // All displacement is scaled by amount -> amount == 0 is exact pass-through.
  vec2 disp = (w * 0.1 + rot) * amount;

  frag = texture(uTex, uv + disp);
}`;

// Registry, keyed by name. Order within params is purely documentation.
export const REGISTRY = {
  line: {
    name: 'line', type: 'generator', desc: 'Sweeping lines / bars.', src: LINE,
    params: [
      { key: 'pos', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'width', type: 'float', min: 0, max: 0.5, default: 0.08 },
      { key: 'angle', type: 'float', min: 0, max: 360, default: 90 },
      { key: 'speed', type: 'float', min: 0, max: 5, default: 1 },
      // amp 0.5 sweeps the centre-anchored line edge-to-edge (reaches top & bottom
      // at angle 90); the half-width spills slightly past the edge at the extremes,
      // which is wanted so the edge LEDs fully light.
      { key: 'amp', type: 'float', min: 0, max: 0.5, default: 0.5 },
      // N evenly-spaced parallel copies of the line (1 = classic single line).
      // camelCase key so the auto-derived label reads "Num Lines".
      { key: 'numLines', type: 'float', min: 1, max: 12, default: 1, step: 1 },
      { key: 'color', type: 'color', default: '#ffffff' },
    ],
  },
  gradient: {
    name: 'gradient', type: 'generator', desc: 'A two-colour ramp across the canvas.', src: GRADIENT,
    params: [
      { key: 'angle', type: 'float', min: 0, max: 360, default: 0 },
      { key: 'colorA', type: 'color', default: '#000000' },
      { key: 'colorB', type: 'color', default: '#ffffff' },
    ],
  },
  solid: {
    name: 'solid', type: 'generator', desc: 'A flat colour fill.', src: SOLID,
    params: [
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'useKelvin', type: 'bool', default: false },
      { key: 'kelvin', type: 'float', min: 1800, max: 12000, default: 3200, step: 50 },
      { key: 'level', type: 'float', min: 0, max: 1, default: 1 },
    ],
  },
  sine: {
    name: 'sine', type: 'generator', desc: 'Scrolling sine bands.', src: SINE,
    params: [
      { key: 'freq', type: 'float', min: 0.25, max: 16, default: 3 },
      { key: 'speed', type: 'float', min: 0, max: 5, default: 1 },
      { key: 'angle', type: 'float', min: 0, max: 360, default: 0 },
      { key: 'phase', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'amp', type: 'float', min: 0, max: 1, default: 1 },
      { key: 'modFreq', type: 'float', min: 0, max: 8, default: 0 },
      { key: 'modAmt', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'sharp', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'color', type: 'color', default: '#ffffff' },
    ],
  },
  checkers: {
    name: 'checkers', type: 'generator', desc: 'A checkerboard.', src: CHECKERS,
    params: [
      { key: 'cols', type: 'float', min: 1, max: 64, default: 8 },
      { key: 'rows', type: 'float', min: 1, max: 64, default: 8 },
      { key: 'color', type: 'color', default: '#ffffff' },
    ],
  },
  grid: {
    name: 'grid', type: 'generator', desc: 'A grid of cells.', src: GRID,
    params: [
      { key: 'cols', type: 'float', min: 1, max: 64, default: 8 },
      { key: 'rows', type: 'float', min: 1, max: 64, default: 8 },
      { key: 'thickness', type: 'float', min: 0, max: 0.5, default: 0.06 },
      { key: 'color', type: 'color', default: '#ffffff' },
    ],
  },
  pulse: {
    name: 'pulse', type: 'generator', desc: 'A pulsing radial burst.', src: PULSE, triggerable: true,
    params: [
      { key: 'speed', type: 'float', min: 0.1, max: 4, default: 1 },
      { key: 'headWidth', type: 'float', min: 0, max: 0.3, default: 0.04 },
      { key: 'trailLength', type: 'float', min: 0, max: 1, default: 0.3 },
      { key: 'trailSoftness', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'autoFire', type: 'bool', default: false },
      { key: 'color', type: 'color', default: '#ffffff' },
    ],
  },
  radial: {
    name: 'radial', type: 'generator', desc: 'A radial gradient / rings.', src: RADIAL, triggerable: true,
    params: [
      { key: 'speed', type: 'float', min: 0.1, max: 4, default: 1 },
      { key: 'width', type: 'float', min: 0.01, max: 1, default: 0.25 },
      { key: 'softness', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'count', type: 'float', min: 1, max: 8, default: 1, step: 1 },
      { key: 'centerX', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'centerY', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'reverse', type: 'bool', default: false },
      { key: 'autoFire', type: 'bool', default: true },
      { key: 'color', type: 'color', default: '#ffffff' },
    ],
  },
  noise: {
    name: 'noise', type: 'generator', desc: 'Animated fBm value noise.', src: NOISE,
    params: [
      { key: 'scale', type: 'float', min: 0.5, max: 16, default: 3 },
      { key: 'speed', type: 'float', min: 0, max: 3, default: 0.3 },
      { key: 'contrast', type: 'float', min: 0, max: 1, default: 0.4 },
      { key: 'colorA', type: 'color', default: '#000000' },
      { key: 'colorB', type: 'color', default: '#ffffff' },
    ],
  },
  spectrum: {
    name: 'spectrum', type: 'generator', desc: 'Audio spectrum bars.', src: SPECTRUM,
    params: [
      { key: 'bands', type: 'float', min: 1, max: 12, default: 1, step: 1 },
      { key: 'sat', type: 'float', min: 0, max: 1, default: 1 },
      { key: 'angle', type: 'float', min: 0, max: 360, default: 0 },
      { key: 'speed', type: 'float', min: 0, max: 3, default: 0.3 },
    ],
  },
  // Volumetric fields (per-LED, evaluated in the sampler; max 4 active at once).
  // `axis`: 0 = x, 1 = y, 2 = z (z = height off the canvas plane).
  planesweep: {
    name: 'planesweep', type: 'generator', desc: '3D: a lit plane swept along an axis.', volumetric: true, src: PLANESWEEP_THUMB,
    params: [
      { key: 'axis', type: 'float', min: 0, max: 2, default: 2, step: 1 },
      { key: 'pos', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'thickness', type: 'float', min: 0.01, max: 1, default: 0.25 },
      { key: 'softness', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'fromCanvas', type: 'bool', default: false },
    ],
  },
  axisgradient: {
    name: 'axisgradient', type: 'generator', desc: '3D: a colour ramp along a world axis.', volumetric: true, src: AXISGRADIENT_THUMB,
    params: [
      { key: 'axis', type: 'float', min: 0, max: 2, default: 2, step: 1 },
      { key: 'scroll', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'colorA', type: 'color', default: '#000000' },
      { key: 'colorB', type: 'color', default: '#ffffff' },
    ],
  },
  noise3d: {
    name: 'noise3d', type: 'generator', desc: '3D: volumetric fBm noise with drift.', volumetric: true, src: NOISE3D_THUMB,
    params: [
      { key: 'scale', type: 'float', min: 0.5, max: 16, default: 3 },
      { key: 'speed', type: 'float', min: 0, max: 3, default: 0.3 },
      // Directional drift: the field flows along `axis` at `drift` units/sec
      // (drift 0 = today's field exactly). Drift along z climbs a standing arch.
      { key: 'axis', type: 'float', min: 0, max: 2, default: 2, step: 1 },
      { key: 'drift', type: 'float', min: 0, max: 2, default: 0 },
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'fromCanvas', type: 'bool', default: false },
    ],
  },
  spherepulse: {
    name: 'spherepulse', type: 'generator', desc: '3D: expanding spherical shells (triggerable).', volumetric: true, src: SPHEREPULSE_THUMB, triggerable: true,
    params: [
      { key: 'centerX', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'centerY', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'centerZ', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'radius', type: 'float', min: 0, max: 1.5, default: 0.35 },
      { key: 'thickness', type: 'float', min: 0.01, max: 1, default: 0.15 },
      { key: 'softness', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'speed', type: 'float', min: 0.1, max: 4, default: 1 },
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'fromCanvas', type: 'bool', default: false },
    ],
  },
  bodywave: {
    name: 'bodywave', type: 'generator', desc: '3D: a travelling sine wave along an axis.', volumetric: true, src: BODYWAVE_THUMB,
    params: [
      { key: 'axis', type: 'float', min: 0, max: 2, default: 2, step: 1 },
      { key: 'wavelength', type: 'float', min: 0.1, max: 2, default: 0.5 },
      { key: 'amplitude', type: 'float', min: 0.01, max: 0.5, default: 0.1 },
      { key: 'offset', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'speed', type: 'float', min: 0.1, max: 4, default: 1 },
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'fromCanvas', type: 'bool', default: false },
    ],
  },
  planepulse: {
    name: 'planepulse', type: 'generator', desc: '3D: planes sweeping per trigger.', volumetric: true, src: PLANEPULSE_THUMB, triggerable: true,
    params: [
      { key: 'axis', type: 'float', min: 0, max: 2, default: 2, step: 1 },
      { key: 'thickness', type: 'float', min: 0.01, max: 1, default: 0.15 },
      { key: 'softness', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'speed', type: 'float', min: 0.1, max: 4, default: 1 },
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'fromCanvas', type: 'bool', default: false },
    ],
  },
  flowfield: {
    name: 'flowfield', type: 'generator', desc: '3D: curl-noise filaments streaming on the wind.', volumetric: true, src: FLOWFIELD_THUMB,
    params: [
      { key: 'windX', type: 'float', min: -1, max: 1, default: 0.3 },
      { key: 'windY', type: 'float', min: -1, max: 1, default: 0 },
      { key: 'windZ', type: 'float', min: -1, max: 1, default: 0 },
      { key: 'speed', type: 'float', min: 0, max: 2, default: 0.4 },
      { key: 'scale', type: 'float', min: 0.2, max: 8, default: 2 },
      { key: 'turbulence', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'thickness', type: 'float', min: 0, max: 1, default: 0.4 },
      { key: 'trail', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'seed', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'fromCanvas', type: 'bool', default: false },
    ],
  },
  caustics: { name: 'caustics', type: 'generator', desc: '3D: dancing underwater caustic light — rippling veins.', volumetric: true, src: CAUSTICS_THUMB,
    params: [ { key:'scale',type:'float',min:0.5,max:12,default:4 }, { key:'speed',type:'float',min:0,max:3,default:0.5 }, { key:'gain',type:'float',min:1,max:6,default:2.5 }, { key:'warp',type:'float',min:0,max:2,default:0.6 }, { key:'brightness',type:'float',min:0,max:3,default:1.4 }, { key:'axis',type:'float',min:0,max:2,default:2,step:1 }, { key:'drift',type:'float',min:-1,max:1,default:0 }, { key:'color',type:'color',default:'#5ff0ff' }, { key:'colorB',type:'color',default:'#06264f' }, { key:'fromCanvas',type:'bool',default:false } ] },
  aurora: { name: 'aurora', type: 'generator', desc: '3D: drifting northern-lights curtains.', volumetric: true, src: AURORA_THUMB,
    params: [ {key:'axis',type:'float',min:0,max:2,default:0,step:1}, {key:'speed',type:'float',min:0,max:2,default:0.3}, {key:'scale',type:'float',min:0.5,max:12,default:4}, {key:'softness',type:'float',min:0,max:1,default:0.6}, {key:'height',type:'float',min:0.1,max:2,default:0.7}, {key:'spread',type:'float',min:0,max:3,default:1.2}, {key:'seed',type:'float',min:0,max:1,default:0}, {key:'colorA',type:'color',default:'#33ff88'}, {key:'colorB',type:'color',default:'#ff2e88'}, {key:'fromCanvas',type:'bool',default:false} ] },
  pacifica: { name: 'pacifica', type: 'generator', desc: '3D: a calm luminous ocean — layered swells with occasional crests.', volumetric: true, src: PACIFICA_THUMB,
    params: [ {key:'scale',type:'float',min:0.5,max:8,default:2.5}, {key:'speed',type:'float',min:0,max:2,default:0.25}, {key:'axis',type:'float',min:0,max:2,default:1,step:1}, {key:'depth',type:'float',min:0,max:2,default:1}, {key:'crest',type:'float',min:0,max:1,default:0.5}, {key:'colorA',type:'color',default:'#052a45'}, {key:'colorB',type:'color',default:'#3fdccb'}, {key:'fromCanvas',type:'bool',default:false} ] },
  shockburst: { name: 'shockburst', type: 'generator', desc: '3D: concentric shells bursting per trigger (triggerable).', volumetric: true, src: SHOCKBURST_THUMB, triggerable: true,
    params: [ {key:'centerX',type:'float',min:0,max:1,default:0.5}, {key:'centerY',type:'float',min:0,max:1,default:0.5}, {key:'centerZ',type:'float',min:0,max:1,default:0}, {key:'speed',type:'float',min:0.1,max:4,default:1}, {key:'thickness',type:'float',min:0.01,max:1,default:0.08}, {key:'softness',type:'float',min:0,max:1,default:0.5}, {key:'ringCount',type:'float',min:1,max:4,default:3,step:1}, {key:'spacing',type:'float',min:0.02,max:0.5,default:0.12}, {key:'fade',type:'float',min:0,max:3,default:0.6}, {key:'color',type:'color',default:'#ffffff'}, {key:'fromCanvas',type:'bool',default:false} ] },
  displace: {
    name: 'displace', type: 'effect', src: DISPLACE,
    params: [
      { key: 'amt', type: 'float', min: 0, max: 1, default: 0.2 },
    ],
  },
  repeat: {
    name: 'repeat', type: 'effect', src: REPEAT,
    params: [
      { key: 'count', type: 'float', min: 1, max: 16, default: 2, step: 1 },   // whole tiles only
    ],
  },
  strobe: {
    name: 'strobe', type: 'effect', kind: 'color', src: STROBE,
    params: [
      { key: 'rate', type: 'float', min: 0, max: 20, default: 4 },
    ],
  },
  trails: {
    name: 'trails', type: 'effect', src: TRAILS,
    params: [
      { key: 'decay', type: 'float', min: 0, max: 0.99, default: 0.9 },   // how much of the past persists
    ],
  },
  feedback: {
    name: 'feedback', type: 'effect', src: FEEDBACK,
    params: [
      { key: 'decay', type: 'float', min: 0, max: 0.99, default: 0.92 },
      { key: 'zoom', type: 'float', min: 0.9, max: 1.1, default: 1.02 },
      { key: 'rotate', type: 'float', min: -0.1, max: 0.1, default: 0 },
    ],
  },
  segmenter: {
    name: 'segmenter', type: 'effect', src: SEGMENTER,
    params: [
      { key: 'count', type: 'float', min: 1, max: 32, default: 4, step: 1 },
      { key: 'index', type: 'float', min: 0, max: 31, default: 0, step: 1 },
      { key: 'endIndex', type: 'float', min: 0, max: 31, default: 0, step: 1 },
      { key: 'horizontal', type: 'bool', default: false },
    ],
  },
  cascade: {
    name: 'cascade', type: 'effect', src: CASCADE,
    params: [
      { key: 'count', type: 'float', min: 1, max: 100, default: 8, step: 1 },
      { key: 'offset', type: 'float', min: 0, max: 0.5, default: 0.08 },
      { key: 'horizontal', type: 'bool', default: true },
      { key: 'reverse', type: 'bool', default: false },
      { key: 'falloff', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'wrap', type: 'bool', default: false },
      { key: 'wave', type: 'float', min: 0, max: 8, default: 0 },
    ],
  },
  hue: {
    name: 'hue', type: 'effect', kind: 'color', src: HUE,
    params: [
      { key: 'shift', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'speed', type: 'float', min: 0, max: 2, default: 0 },
    ],
  },
  color: {
    name: 'color', type: 'effect', kind: 'color', src: COLOR,
    params: [
      { key: 'brightness', type: 'float', min: 0, max: 3, default: 1 },
      { key: 'contrast', type: 'float', min: 0, max: 3, default: 1 },
      { key: 'saturation', type: 'float', min: 0, max: 3, default: 1 },
      { key: 'gamma', type: 'float', min: 0.1, max: 3, default: 1 },
    ],
  },
  invert: {
    name: 'invert', type: 'effect', kind: 'color', src: INVERT,
    params: [{ key: 'amount', type: 'float', min: 0, max: 1, default: 1 }],
  },
  rgb: {
    name: 'rgb', type: 'effect', kind: 'color', src: RGB,
    params: [
      { key: 'red', type: 'float', min: 0, max: 2, default: 1 },
      { key: 'green', type: 'float', min: 0, max: 2, default: 1 },
      { key: 'blue', type: 'float', min: 0, max: 2, default: 1 },
    ],
  },
  threshold: {
    name: 'threshold', type: 'effect', kind: 'color', src: THRESHOLD,
    params: [{ key: 'level', type: 'float', min: 0, max: 1, default: 0.5 }],
  },
  colorize: {
    name: 'colorize', type: 'effect', src: COLORIZE,
    params: [
      { key: 'lowColor', type: 'color', default: '#000000' },
      { key: 'highColor', type: 'color', default: '#ffffff' },
    ],
  },
  domainwarp: {
    name: 'domainwarp', type: 'generator', desc: 'Domain-warped liquid noise.', src: DOMAINWARP,
    params: [
      { key: 'scale', type: 'float', min: 0.5, max: 12, default: 3, step: 0.1 },
      { key: 'speed', type: 'float', min: 0, max: 3, default: 0.6, step: 0.01 },
      { key: 'warp', type: 'float', min: 0, max: 4, default: 2.2, step: 0.05 },
      { key: 'contrast', type: 'float', min: 0.3, max: 3, default: 1.1, step: 0.05 },
      { key: 'colorA', type: 'color', default: '#000000' },
      { key: 'colorB', type: 'color', default: '#ffffff' },
    ],
  },
  metaballs: {
    name: 'metaballs', type: 'generator', desc: 'Blobby metaballs.', src: METABALLS,
    params: [
      { key: 'count', type: 'float', min: 1, max: 8, default: 4, step: 1 },
      { key: 'radius', type: 'float', min: 0.04, max: 0.4, default: 0.16, step: 0.005 },
      { key: 'speed', type: 'float', min: 0, max: 2, default: 0.4, step: 0.01 },
      { key: 'softness', type: 'float', min: 0.05, max: 0.9, default: 0.4, step: 0.01 },
      { key: 'color', type: 'color', default: '#ffffff' },
    ],
  },
  plasma: {
    name: 'plasma', type: 'generator', desc: 'Classic flowing plasma.', src: PLASMA,
    params: [
      { key: 'scale', type: 'float', min: 1, max: 24, default: 6, step: 0.1 },
      { key: 'speed', type: 'float', min: 0, max: 4, default: 1, step: 0.01 },
      { key: 'warp', type: 'float', min: 0, max: 3, default: 0.6, step: 0.01 },
      { key: 'sat', type: 'float', min: 0, max: 1, default: 0.9, step: 0.01 },
    ],
  },
  tunnel: {
    name: 'tunnel', type: 'generator', desc: 'An infinite zoom tunnel.', src: TUNNEL,
    params: [
      { key: 'speed', type: 'float', min: 0, max: 4, default: 1, step: 0.01 },
      { key: 'rings', type: 'float', min: 0.5, max: 20, default: 6, step: 0.1 },
      { key: 'angularBands', type: 'float', min: 1, max: 32, default: 8, step: 1 },
      { key: 'twist', type: 'float', min: -2, max: 2, default: 0.25, step: 0.01 },
      { key: 'colorA', type: 'color', default: '#000000' },
      { key: 'colorB', type: 'color', default: '#ffffff' },
    ],
  },
  shockwave: {
    name: 'shockwave', type: 'effect', triggerable: true, src: SHOCKWAVE,
    params: [
      { key: 'speed', type: 'float', min: 0.05, max: 3, default: 0.9, step: 0.01 },
      { key: 'amp', type: 'float', min: 0, max: 0.25, default: 0.04, step: 0.001 },
      { key: 'width', type: 'float', min: 0.005, max: 0.3, default: 0.05, step: 0.005 },
      { key: 'rimGain', type: 'float', min: 0, max: 3, default: 0.6, step: 0.01 },
      { key: 'centerX', type: 'float', min: 0, max: 1, default: 0.5, step: 0.01 },
      { key: 'centerY', type: 'float', min: 0, max: 1, default: 0.5, step: 0.01 },
      { key: 'rimColor', type: 'color', default: '#ffffff' },
    ],
  },
  basswarp: {
    name: 'basswarp', type: 'effect', src: BASSWARP,
    params: [
      { key: 'amount', type: 'float', min: 0, max: 1, default: 0.3, step: 0.01 },
      { key: 'scale', type: 'float', min: 1, max: 40, default: 9, step: 0.5 },
      { key: 'speed', type: 'float', min: 0, max: 6, default: 1.2, step: 0.01 },
      { key: 'swirl', type: 'float', min: 0, max: 2, default: 0.4, step: 0.01 },
    ],
  },
};

// Parse a "#rrggbb" (or "#rgb") string to normalized [r,g,b] in 0..1. Used by the
// compositor to upload `type:'color'` params as vec3 uniforms. Falls back to white.
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return [1, 1, 1];
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Display labels (Resolume-style). The registry `name` stays the stable key
// used by params/routing; this is purely what the UI shows.
const LABELS = {
  line: 'Lines', gradient: 'Gradient', solid: 'Color', sine: 'Sine',
  checkers: 'Checkered', grid: 'Grid', pulse: 'Pulse', radial: 'Radial', video: 'Video',
  planesweep: 'Plane Sweep', axisgradient: 'Axis Gradient', noise3d: 'Noise 3D', spherepulse: 'Sphere Pulse',
  bodywave: 'Body Wave', planepulse: 'Plane Pulse', flowfield: 'Flow Field',
  caustics: 'Caustics', aurora: 'Aurora', pacifica: 'Pacifica', shockburst: 'Shockwave (3D)',
  displace: 'Displace', repeat: 'Repeat', strobe: 'Strobe',
  segmenter: 'Segmenter', cascade: 'Cascade', hue: 'Hue', colorize: 'Colorize',
  color: 'Adjustments', invert: 'Invert', rgb: 'RGB', threshold: 'Threshold',
  domainwarp: 'Domain Warp', metaballs: 'Metaballs', plasma: 'Plasma', tunnel: 'Tunnel',
  shockwave: 'Shockwave', basswarp: 'Bass Warp',
};
export const labelOf = (name) =>
  LABELS[name] || (name ? name[0].toUpperCase() + name.slice(1) : name);

// Look up a generator or effect entry by name.
export function getEntry(name) { return REGISTRY[name] || null; }

// One-line source/effect description for the browser's info line ('' if none).
export const descOf = (name) => REGISTRY[name]?.desc || '';

// Effect class: 'color' (pointwise — works per-LED on a volumetric clip), else
// undefined for spatial effects (coord/resample — 2D only for now).
export const effectKind = (name) => REGISTRY[name]?.kind || null;

// Pure helper: { key: default } for a generator/effect, or {} if unknown.
export function defaultParams(name) {
  const e = REGISTRY[name];
  if (!e) return {};
  const out = {};
  for (const p of e.params) out[p.key] = p.default;
  return out;
}

export const generatorNames = () =>
  Object.values(REGISTRY).filter((e) => e.type === 'generator').map((e) => e.name);
// Volumetric sources (per-LED fields — skipped by the 2D compositor, evaluated
// in the sampler pass). A subset of generatorNames().
export const volumetricNames = () =>
  Object.values(REGISTRY).filter((e) => e.volumetric).map((e) => e.name);
export const effectNames = () =>
  Object.values(REGISTRY).filter((e) => e.type === 'effect').map((e) => e.name);
