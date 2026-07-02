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
  frag = vec4(vec3(v), 1.0);
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
void main(){
  float a = radians(angle);
  float coord = uv.x*cos(a) + uv.y*sin(a);
  float m = sin(coord * modFreq * 6.2831853) * modAmt;                    // FM modulator
  float w = sin((coord * freq + m - uPhase) * 6.2831853 + phase * 6.2831853);
  float v = (w * 0.5 + 0.5) * amp;
  v = pow(clamp(v, 0.0, 1.0), mix(1.0, 5.0, clamp(sharp, 0.0, 1.0)));
  frag = vec4(vec3(v), 1.0);
}`;

// Checkered test source — set resolution in cols × rows (after Resolume's
// Checkered). Alternating black/white cells; the go-to pattern for verifying the
// fixture mapping over the installation.
const CHECKERS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float cols; uniform float rows;
void main(){
  float c = floor(uv.x * max(1.0, cols)) + floor(uv.y * max(1.0, rows));
  frag = vec4(vec3(mod(c, 2.0)), 1.0);
}`;

// Grid test source — cols × rows cells outlined by lines of `thickness`. Useful
// for aligning fixtures to a known canvas grid.
const GRID = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float cols; uniform float rows; uniform float thickness;
void main(){
  vec2 g = abs(fract(uv * vec2(max(1.0, cols), max(1.0, rows))) - 0.5);
  float t = 0.5 - clamp(thickness, 0.0, 0.5);
  float line = step(t, g.x) + step(t, g.y);
  frag = vec4(vec3(clamp(line, 0.0, 1.0)), 1.0);
}`;

// Pulse — a triggerable beam (after Resolume's PulseBeam): a head of light that
// travels across the canvas leaving a decaying trail. Fire it with the ⚡ button
// (uTrig = seconds since the last trigger), or enable autoFire to loop on uT.
const PULSE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float uT; uniform float uTrigs[8]; uniform int uTrigCount;
uniform float speed; uniform float headWidth; uniform float trailLength;
uniform float trailSoftness; uniform float autoFire;
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
  frag = vec4(vec3(v), 1.0);
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
  frag = vec4(vec3(v), 1.0);
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

// Registry, keyed by name. Order within params is purely documentation.
export const REGISTRY = {
  line: {
    name: 'line', type: 'generator', src: LINE,
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
    ],
  },
  gradient: {
    name: 'gradient', type: 'generator', src: GRADIENT,
    params: [
      { key: 'angle', type: 'float', min: 0, max: 360, default: 0 },
      { key: 'colorA', type: 'color', default: '#000000' },
      { key: 'colorB', type: 'color', default: '#ffffff' },
    ],
  },
  solid: {
    name: 'solid', type: 'generator', src: SOLID,
    params: [
      { key: 'color', type: 'color', default: '#ffffff' },
      { key: 'useKelvin', type: 'bool', default: false },
      { key: 'kelvin', type: 'float', min: 1800, max: 12000, default: 3200, step: 50 },
      { key: 'level', type: 'float', min: 0, max: 1, default: 1 },
    ],
  },
  sine: {
    name: 'sine', type: 'generator', src: SINE,
    params: [
      { key: 'freq', type: 'float', min: 0.25, max: 16, default: 3 },
      { key: 'speed', type: 'float', min: 0, max: 5, default: 1 },
      { key: 'angle', type: 'float', min: 0, max: 360, default: 0 },
      { key: 'phase', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'amp', type: 'float', min: 0, max: 1, default: 1 },
      { key: 'modFreq', type: 'float', min: 0, max: 8, default: 0 },
      { key: 'modAmt', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'sharp', type: 'float', min: 0, max: 1, default: 0 },
    ],
  },
  checkers: {
    name: 'checkers', type: 'generator', src: CHECKERS,
    params: [
      { key: 'cols', type: 'float', min: 1, max: 64, default: 8 },
      { key: 'rows', type: 'float', min: 1, max: 64, default: 8 },
    ],
  },
  grid: {
    name: 'grid', type: 'generator', src: GRID,
    params: [
      { key: 'cols', type: 'float', min: 1, max: 64, default: 8 },
      { key: 'rows', type: 'float', min: 1, max: 64, default: 8 },
      { key: 'thickness', type: 'float', min: 0, max: 0.5, default: 0.06 },
    ],
  },
  pulse: {
    name: 'pulse', type: 'generator', src: PULSE, triggerable: true,
    params: [
      { key: 'speed', type: 'float', min: 0.1, max: 4, default: 1 },
      { key: 'headWidth', type: 'float', min: 0, max: 0.3, default: 0.04 },
      { key: 'trailLength', type: 'float', min: 0, max: 1, default: 0.3 },
      { key: 'trailSoftness', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'autoFire', type: 'bool', default: false },
    ],
  },
  radial: {
    name: 'radial', type: 'generator', src: RADIAL, triggerable: true,
    params: [
      { key: 'speed', type: 'float', min: 0.1, max: 4, default: 1 },
      { key: 'width', type: 'float', min: 0.01, max: 1, default: 0.25 },
      { key: 'softness', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'count', type: 'float', min: 1, max: 8, default: 1, step: 1 },
      { key: 'centerX', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'centerY', type: 'float', min: 0, max: 1, default: 0.5 },
      { key: 'reverse', type: 'bool', default: false },
      { key: 'autoFire', type: 'bool', default: true },
    ],
  },
  noise: {
    name: 'noise', type: 'generator', src: NOISE,
    params: [
      { key: 'scale', type: 'float', min: 0.5, max: 16, default: 3 },
      { key: 'speed', type: 'float', min: 0, max: 3, default: 0.3 },
      { key: 'contrast', type: 'float', min: 0, max: 1, default: 0.4 },
      { key: 'colorA', type: 'color', default: '#000000' },
      { key: 'colorB', type: 'color', default: '#ffffff' },
    ],
  },
  spectrum: {
    name: 'spectrum', type: 'generator', src: SPECTRUM,
    params: [
      { key: 'bands', type: 'float', min: 1, max: 12, default: 1, step: 1 },
      { key: 'sat', type: 'float', min: 0, max: 1, default: 1 },
      { key: 'angle', type: 'float', min: 0, max: 360, default: 0 },
      { key: 'speed', type: 'float', min: 0, max: 3, default: 0.3 },
    ],
  },
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
    name: 'strobe', type: 'effect', src: STROBE,
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
    name: 'hue', type: 'effect', src: HUE,
    params: [
      { key: 'shift', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'speed', type: 'float', min: 0, max: 2, default: 0 },
    ],
  },
  color: {
    name: 'color', type: 'effect', src: COLOR,
    params: [
      { key: 'brightness', type: 'float', min: 0, max: 3, default: 1 },
      { key: 'contrast', type: 'float', min: 0, max: 3, default: 1 },
      { key: 'saturation', type: 'float', min: 0, max: 3, default: 1 },
      { key: 'gamma', type: 'float', min: 0.1, max: 3, default: 1 },
    ],
  },
  invert: {
    name: 'invert', type: 'effect', src: INVERT,
    params: [{ key: 'amount', type: 'float', min: 0, max: 1, default: 1 }],
  },
  rgb: {
    name: 'rgb', type: 'effect', src: RGB,
    params: [
      { key: 'red', type: 'float', min: 0, max: 2, default: 1 },
      { key: 'green', type: 'float', min: 0, max: 2, default: 1 },
      { key: 'blue', type: 'float', min: 0, max: 2, default: 1 },
    ],
  },
  threshold: {
    name: 'threshold', type: 'effect', src: THRESHOLD,
    params: [{ key: 'level', type: 'float', min: 0, max: 1, default: 0.5 }],
  },
  colorize: {
    name: 'colorize', type: 'effect', src: COLORIZE,
    params: [
      { key: 'lowColor', type: 'color', default: '#000000' },
      { key: 'highColor', type: 'color', default: '#ffffff' },
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
  displace: 'Displace', repeat: 'Repeat', strobe: 'Strobe',
  segmenter: 'Segmenter', cascade: 'Cascade', hue: 'Hue', colorize: 'Colorize',
  color: 'Adjustments', invert: 'Invert', rgb: 'RGB', threshold: 'Threshold',
};
export const labelOf = (name) =>
  LABELS[name] || (name ? name[0].toUpperCase() + name.slice(1) : name);

// Look up a generator or effect entry by name.
export function getEntry(name) { return REGISTRY[name] || null; }

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
export const effectNames = () =>
  Object.values(REGISTRY).filter((e) => e.type === 'effect').map((e) => e.name);
