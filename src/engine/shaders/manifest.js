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
uniform float uT;
uniform float speed;
uniform float amp;
void main(){
  float a = radians(angle);
  float coord = uv.x*cos(a) + uv.y*sin(a);
  // pos is the BASE position; the line sweeps around it. speed=0 ⇒ static.
  float sweptPos = pos + amp * sin(uT * speed);
  float d = abs(coord - sweptPos);
  float v = smoothstep(width, 0.0, d);
  frag = vec4(vec3(v), 1.0);
}`;

const GRADIENT = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float angle;
void main(){ float a=radians(angle); float g=clamp(uv.x*cos(a)+uv.y*sin(a),0.0,1.0); frag=vec4(vec3(g),1.0); }`;

const SOLID = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform float level;
void main(){ frag=vec4(vec3(level),1.0); }`;

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

// Segmenter (after Resolume's Extra Effect): split the perpendicular axis into N
// equal segments and pass only a chosen range; the rest is transparent. Stack
// several (different sources per clip) to assemble per-segment content — and for
// the tube installation it maps content to physical column groups.
const SEGMENTER = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex;
uniform float count;       // number of segments (N)
uniform float index;       // first visible segment (0-based)
uniform float span;        // how many consecutive segments are visible
uniform float horizontal;  // 0 = columns (split x), 1 = rows (split y)
void main(){
  float n = max(1.0, floor(count + 0.5));
  float perp = (horizontal < 0.5) ? uv.x : uv.y;
  float seg = floor(clamp(perp, 0.0, 0.999999) * n);
  float lo = floor(index + 0.5);
  float hi = lo + max(1.0, floor(span + 0.5)) - 1.0;
  if (seg < lo || seg > hi) { frag = vec4(0.0); return; }
  frag = texture(uTex, uv);
}`;

// Hue rotate — colour over time. Rotates RGB around the grey (1,1,1) axis
// (Rodrigues). `shift` is a static offset (0..1 = full wheel); `speed` auto-
// cycles via uT, so dropping this on a clip or the composition gives a colour
// sweep without a timeline.
const HUE = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float shift; uniform float speed; uniform float uT;
vec3 hueRot(vec3 c, float a){
  const vec3 k = vec3(0.57735026);            // normalize(vec3(1))
  float cs = cos(a), sn = sin(a);
  return c*cs + cross(k, c)*sn + k*dot(k, c)*(1.0 - cs);
}
void main(){
  vec4 src = texture(uTex, uv);
  float a = (shift + uT*speed) * 6.2831853;
  frag = vec4(clamp(hueRot(src.rgb, a), 0.0, 1.0), src.a);
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
      { key: 'amp', type: 'float', min: 0, max: 0.5, default: 0.45 },
    ],
  },
  gradient: {
    name: 'gradient', type: 'generator', src: GRADIENT,
    params: [
      { key: 'angle', type: 'float', min: 0, max: 360, default: 0 },
    ],
  },
  solid: {
    name: 'solid', type: 'generator', src: SOLID,
    params: [
      { key: 'level', type: 'float', min: 0, max: 1, default: 1 },
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
      { key: 'count', type: 'float', min: 1, max: 16, default: 2 },
    ],
  },
  strobe: {
    name: 'strobe', type: 'effect', src: STROBE,
    params: [
      { key: 'rate', type: 'float', min: 0, max: 20, default: 4 },
    ],
  },
  segmenter: {
    name: 'segmenter', type: 'effect', src: SEGMENTER,
    params: [
      { key: 'count', type: 'float', min: 1, max: 16, default: 4 },
      { key: 'index', type: 'float', min: 0, max: 15, default: 0 },
      { key: 'span', type: 'float', min: 1, max: 16, default: 1 },
      { key: 'horizontal', type: 'bool', default: false },
    ],
  },
  hue: {
    name: 'hue', type: 'effect', src: HUE,
    params: [
      { key: 'shift', type: 'float', min: 0, max: 1, default: 0 },
      { key: 'speed', type: 'float', min: 0, max: 2, default: 0 },
    ],
  },
};

// Display labels (Resolume-style). The registry `name` stays the stable key
// used by params/routing; this is purely what the UI shows.
const LABELS = {
  line: 'Lines', gradient: 'Gradient', solid: 'Solid Color',
  displace: 'Displace', repeat: 'Repeat', strobe: 'Strobe',
  segmenter: 'Segmenter', hue: 'Hue',
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
