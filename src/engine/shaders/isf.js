// ISF (Interactive Shader Format) support — parse a .fs/.isf shader into:
//   • a PARAM SCHEMA matching our clip-param model (so the inputs become sliders /
//     toggles / colour pickers and are OSC/MIDI-mappable for free), and
//   • a WebGL2 (#version 300 es) fragment shader, by shimming ISF's GLSL-ES-1.0
//     conventions (gl_FragColor, isf_FragNormCoord, texture2D, IMG_* macros).
//
// ISF spec: https://github.com/mrRay/ISF_Spec — a fragment shader prefixed with a
// JSON header in a /* … */ comment declaring INPUTS / PASSES / metadata. This is
// the PURE part (parse + transpile-by-shim); the engine wiring (compositor uniform
// upload, multi-pass, image inputs) builds on top of it.

// ISF input TYPE → our param type. 'long' (an enum/index) becomes a stepped float;
// 'event'/'audio'/'audioFFT' are not supported here (skipped).
const TYPE_MAP = {
  float: 'float', bool: 'bool', long: 'long', color: 'color', point2D: 'point2D', image: 'image',
};

// Extract the leading JSON header + the GLSL body from an ISF file. The header is
// the FIRST /* … */ comment (the spec puts the JSON blob at the very top).
export function parseISF(text) {
  const src = String(text || '');
  const m = src.match(/\/\*([\s\S]*?)\*\//);
  if (!m) return { ok: false, error: 'no ISF /* … */ header found' };
  let header;
  try { header = JSON.parse(m[1]); } catch (e) { return { ok: false, error: `bad ISF JSON header: ${e.message}` }; }
  const glsl = src.slice(m.index + m[0].length).replace(/^\s+/, '');
  const inputs = Array.isArray(header.INPUTS) ? header.INPUTS : [];
  const passes = Array.isArray(header.PASSES) ? header.PASSES : [];
  return {
    ok: true, header, glsl, inputs, passes,
    name: header.DESCRIPTION ? header.DESCRIPTION : (header.CREDIT || 'ISF shader'),
    // A generator has no image inputs to chain from; an effect samples its input.
    type: inputs.some((i) => i.TYPE === 'image' && /inputImage/i.test(i.NAME)) ? 'effect' : 'generator',
  };
}

// ISF INPUTS → our param schema (the same shape manifest.js uses: {key,label,type,
// min,max,default,…}). Unsupported types (event/audio) are dropped.
export function isfParams(inputs) {
  const out = [];
  for (const inp of inputs || []) {
    const type = TYPE_MAP[inp.TYPE];
    if (!type || type === 'image') continue;   // image inputs aren't user params
    const p = { key: inp.NAME, label: inp.LABEL || inp.NAME, type };
    if (type === 'float' || type === 'long') {
      p.min = Number(inp.MIN ?? 0); p.max = Number(inp.MAX ?? 1);
      p.default = Number(inp.DEFAULT ?? p.min);
      if (type === 'long') { p.step = 1; if (Array.isArray(inp.VALUES)) { p.values = inp.VALUES; p.labels = inp.LABELS; p.min = 0; p.max = inp.VALUES.length - 1; } }
    } else if (type === 'bool') {
      p.default = !!(inp.DEFAULT ?? false);
    } else if (type === 'color') {
      p.default = rgbaToHex(inp.DEFAULT) || '#ffffff';
    } else if (type === 'point2D') {
      const d = Array.isArray(inp.DEFAULT) ? inp.DEFAULT : [0.5, 0.5];
      p.default = { x: Number(d[0]) || 0, y: Number(d[1]) || 0 };
      p.min = Number(inp.MIN?.[0] ?? 0); p.max = Number(inp.MAX?.[0] ?? 1);
    }
    out.push(p);
  }
  return out;
}

// ISF colours are [r,g,b,a] 0..1 → our #rrggbb hex (alpha dropped for the picker).
function rgbaToHex(c) {
  if (!Array.isArray(c)) return null;
  const h = (v) => Math.max(0, Math.min(255, Math.round((Number(v) || 0) * 255))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

// The GLSL uniform declaration for one ISF input (matched to how the compositor
// will upload it): float/long→float/int, bool→bool, color→vec4, point2D→vec2,
// image→sampler2D.
function uniformDecl(inp) {
  switch (inp.TYPE) {
    case 'float': return `uniform float ${inp.NAME};`;
    case 'long': return `uniform int ${inp.NAME};`;
    case 'bool': return `uniform bool ${inp.NAME};`;
    case 'color': return `uniform vec4 ${inp.NAME};`;
    case 'point2D': return `uniform vec2 ${inp.NAME};`;
    case 'image': return `uniform sampler2D ${inp.NAME};`;
    default: return '';
  }
}

// Wrap an ISF GLSL body into a complete WebGL2 fragment shader. ISF authors target
// GLSL ES 1.0 (gl_FragColor, texture2D, isf_FragNormCoord); we shim those onto our
// #version 300 es harness (out `frag`, `in vec2 uv`). Single-pass; PASSES/persistent
// buffers are a later phase.
export function wrapISF(glsl, inputs = []) {
  const decls = (inputs || []).map(uniformDecl).filter(Boolean).join('\n');
  return `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
out vec4 isf_outColor;
// --- ISF builtins (host-provided) ---
uniform float TIME;
uniform float TIMEDELTA;
uniform int FRAMEINDEX;
uniform vec2 RENDERSIZE;
uniform sampler2D inputImage;
${decls}
// --- ISF compatibility shims (GLSL ES 1.0 → 3.0) ---
#define gl_FragColor isf_outColor
#define isf_FragNormCoord uv
#define texture2D texture
#define IMG_SIZE(img) RENDERSIZE
#define IMG_NORM_PIXEL(img, nc) texture(img, nc)
#define IMG_PIXEL(img, pc) texture(img, (pc) / RENDERSIZE)
#define IMG_THIS_NORM_PIXEL(img) texture(img, uv)
#define IMG_THIS_PIXEL(img) texture(img, uv)
// --- ISF shader body (brings its own entry point) ---
${glsl}
`;
}

export { TYPE_MAP as ISF_TYPE_MAP };
