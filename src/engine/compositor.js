// Multi-layer compositor (Task 3.2).
//
// makeCompositor(gl, w, h) → { tex, render(layers, timeSec), dispose() }
//
// Renders show.composition.layers into a single output texture (`tex`).
// Each layer = one generator pass, then a ping-pong chain of effect passes,
// then a blended blit onto the accumulator using the layer's blend mode/opacity.
//
// PARAM NAMESPACING CONVENTION (prefixed): a uniform `key` for entry `name`
// is read from layer.params in this priority order:
//   1. layer.params[name + '.' + key]   (e.g. 'line.pos', 'displace.amt')
//   2. layer.params[key]                 (unprefixed fallback)
//   3. manifest default for that param
// Prefixed keys are preferred because a generator and an effect on the same
// layer can share a key name (e.g. both having 'angle').

import { program, makeTarget, drawFullscreen } from './gl.js';
import { REGISTRY, getEntry, defaultParams } from './shaders/manifest.js';

const BLIT_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float opacity;
void main(){ vec4 c=texture(uTex, uv); frag=vec4(c.rgb*opacity, c.a*opacity); }`;

export function makeCompositor(gl, w, h) {
  const accum = makeTarget(gl, w, h);   // composited result
  const scratchA = makeTarget(gl, w, h);
  const scratchB = makeTarget(gl, w, h);

  // Lazily-compiled programs, keyed by registry name (+ a reserved blit key).
  // Each cached entry: { prog, uniforms: Map<string, WebGLUniformLocation|null> }.
  const cache = new Map();

  function getProgram(name, src) {
    let c = cache.get(name);
    if (!c) {
      c = { prog: program(gl, src), uniforms: new Map() };
      cache.set(name, c);
    }
    return c;
  }
  // Cache uniform locations per program (null is cached too, to avoid re-querying).
  function loc(c, key) {
    if (!c.uniforms.has(key)) c.uniforms.set(key, gl.getUniformLocation(c.prog, key));
    return c.uniforms.get(key);
  }

  // Resolve a param value for entry `name`/`key` from a layer's params (see convention above).
  function paramValue(layerParams, name, key, fallback) {
    const pfx = name + '.' + key;
    if (layerParams && pfx in layerParams) return layerParams[pfx];
    if (layerParams && key in layerParams) return layerParams[key];
    return fallback;
  }

  // Run one entry (generator or effect) into `dst`, reading `srcTex` as uTex if effect.
  function runEntry(entry, layer, dst, srcTex, timeSec) {
    const c = getProgram(entry.name, entry.src);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(c.prog);

    const defaults = defaultParams(entry.name);
    for (const p of entry.params) {
      const l = loc(c, p.key);
      if (l === null) continue;
      const v = paramValue(layer.params, entry.name, p.key, defaults[p.key]);
      gl.uniform1f(l, Number(v));
    }
    // uT (seconds) — always try; only set if the shader declares it.
    const uT = loc(c, 'uT');
    if (uT !== null) gl.uniform1f(uT, timeSec);

    if (srcTex != null) {
      const uTex = loc(c, 'uTex');
      if (uTex !== null) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform1i(uTex, 0);
      }
    }
    drawFullscreen(gl);
  }

  function setBlend(mode) {
    gl.enable(gl.BLEND);
    switch (mode) {
      case 'screen':   gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ZERO); break;
      case 'alpha':    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); break;
      case 'add':
      default:         gl.blendFunc(gl.ONE, gl.ONE); break; // default to add
    }
  }

  function render(layers, timeSec) {
    // 1. Clear accumulator to black, no blending.
    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const layer of (layers || [])) {
      const gen = getEntry(layer.generator);
      if (!gen || gen.type !== 'generator') continue;

      // 2a. Generator → scratchA.
      let cur = scratchA, other = scratchB;
      runEntry(gen, layer, cur, null, timeSec);

      // 2b. Effects: ping-pong cur → other.
      for (const name of (layer.effects || [])) {
        const fx = getEntry(name);
        if (!fx || fx.type !== 'effect') continue;
        runEntry(fx, layer, other, cur.tex, timeSec);
        const tmp = cur; cur = other; other = tmp;
      }

      // 2c. Blit final scratch onto accumulator with blend + opacity.
      const blit = getProgram('__blit', BLIT_FS);
      gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(blit.prog);
      setBlend(layer.blend);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cur.tex);
      const uTex = loc(blit, 'uTex');
      if (uTex !== null) gl.uniform1i(uTex, 0);
      const uOp = loc(blit, 'opacity');
      if (uOp !== null) gl.uniform1f(uOp, layer.opacity == null ? 1 : Number(layer.opacity));
      drawFullscreen(gl);
      gl.disable(gl.BLEND);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function dispose() {
    for (const c of cache.values()) gl.deleteProgram(c.prog);
    cache.clear();
    for (const t of [accum, scratchA, scratchB]) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
  }

  return { get tex() { return accum.tex; }, render, dispose };
}

// Re-export so callers can introspect available shaders without a second import.
export { REGISTRY };
