// Multi-layer, clip-based compositor (Task 3 — "clips").
//
// makeCompositor(gl, w, h) → { tex, render(layers, timeSec), dispose() }
//
// Renders show.composition.layers into a single output texture (`tex`).
// Each layer holds a deck of CLIPS; one is active (layer.activeClipId).
//
//   active clip:       generator → clip.effects chain ─┐
//                                                       ├─ crossfade(from,to,p)
//   (during xfade)     prev clip: generator → clip fx ─┘     → layer.effects
//                                                              → blend/opacity
//                                                              → accumulator
//
// PARAM SPLIT: a CLIP's generator + clip effects read from clip.params; the
// LAYER effects read from layer.params. (Keeps a clip's `displace` from
// colliding with a layer's `displace`.)
//
// PARAM NAMESPACING (prefixed): a uniform `key` for entry `name` resolves from
// the relevant params map in this priority order:
//   1. params[name + '.' + key]   (e.g. 'line.pos', 'displace.amt')
//   2. params[key]                 (unprefixed fallback)
//   3. manifest default for that param
//
// TRANSITIONS: per-layer runtime crossfade state lives in a Map keyed by layer
// id (NOT in the show JSON). See transitionProgress() for the timing math.

import { program, makeTarget, drawFullscreen } from './gl.js';
import { REGISTRY, getEntry, defaultParams } from './shaders/manifest.js';

const BLIT_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float opacity;
void main(){ vec4 c=texture(uTex, uv); frag=vec4(c.rgb*opacity, c.a*opacity); }`;

// Crossfade two textures: mix(from, to, t).
const XFADE_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uA; uniform sampler2D uB; uniform float t;
void main(){ frag = mix(texture(uA, uv), texture(uB, uv), t); }`;

// Pure timing helper (the one testable bit). progress ∈ [0,1].
// transitionMs ≤ 0 ⇒ instant (1). elapsed = timeSec - startT (both seconds).
export function transitionProgress(timeSec, startT, transitionMs) {
  if (!(transitionMs > 0)) return 1;
  const p = (timeSec - startT) / (transitionMs / 1000);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function makeCompositor(gl, w, h) {
  const accum = makeTarget(gl, w, h);   // composited result (output `tex`)

  // Clip-render ping-pong (a clip's generator + its effect chain).
  const clipA = makeTarget(gl, w, h);
  const clipB = makeTarget(gl, w, h);
  // Holding targets for the `from` and `to` clip results during a crossfade —
  // must be distinct so one clip's final texture survives while the other renders.
  const fromHold = makeTarget(gl, w, h);
  const toHold = makeTarget(gl, w, h);
  // Layer-effects ping-pong (operates on the clip/crossfade base texture).
  const layerA = makeTarget(gl, w, h);
  const layerB = makeTarget(gl, w, h);

  const allTargets = [accum, clipA, clipB, fromHold, toHold, layerA, layerB];

  // Per-layer runtime transition state (NOT persisted):
  //   layerId → { displayed:<clipId>, transition:{ fromClipId, toClipId, startT }|null }
  const layerState = new Map();

  // Lazily-compiled programs, keyed by registry name (+ reserved blit/xfade keys).
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

  // Resolve a param value for entry `name`/`key` from a params map (see convention).
  function paramValue(params, name, key, fallback) {
    const pfx = name + '.' + key;
    if (params && pfx in params) return params[pfx];
    if (params && key in params) return params[key];
    return fallback;
  }

  // Run one entry (generator or effect) into `dst`, reading `srcTex` as uTex if set,
  // resolving its params from `params`.
  function runEntry(entry, params, dst, srcTex, timeSec) {
    const c = getProgram(entry.name, entry.src);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(c.prog);

    const defaults = defaultParams(entry.name);
    for (const p of entry.params) {
      const l = loc(c, p.key);
      if (l === null) continue;
      const v = paramValue(params, entry.name, p.key, defaults[p.key]);
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

  // Render a clip (generator → clip.effects chain) into `hold`. Uses clipA/clipB
  // as the ping-pong scratch, then copies the final result into `hold` (a stable
  // target that won't be clobbered while we render the OTHER clip of a crossfade).
  // Returns true if anything was drawn, false if the clip is unrenderable.
  function renderClipInto(clip, hold, timeSec) {
    if (!clip || !clip.generator) return false;
    const gen = getEntry(clip.generator);
    if (!gen || gen.type !== 'generator') return false;

    let cur = clipA, other = clipB;
    runEntry(gen, clip.params, cur, null, timeSec);
    for (const name of (clip.effects || [])) {
      const fx = getEntry(name);
      if (!fx || fx.type !== 'effect') continue;
      runEntry(fx, clip.params, other, cur.tex, timeSec);
      const tmp = cur; cur = other; other = tmp;
    }
    // Copy cur → hold via the blit program (opacity 1). hold is never part of the
    // clip ping-pong, so no feedback loop.
    blitInto(cur.tex, hold, 1);
    return true;
  }

  // Draw srcTex into dst (no blending) with the given opacity, using the blit prog.
  function blitInto(srcTex, dst, opacity) {
    const blit = getProgram('__blit', BLIT_FS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(blit.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    const uTex = loc(blit, 'uTex');
    if (uTex !== null) gl.uniform1i(uTex, 0);
    const uOp = loc(blit, 'opacity');
    if (uOp !== null) gl.uniform1f(uOp, opacity);
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

  const findClip = (layer, id) =>
    (layer.clips || []).find((c) => c && c.id === id) || null;

  // Advance + resolve a layer's transition state machine for this frame.
  // Returns { fromClip, toClip, progress } where:
  //   - progress === 1 ⇒ no crossfade, render only toClip
  //   - progress  < 1 ⇒ crossfade fromClip→toClip by progress
  // fromClip may be null (snap), toClip may be null (nothing to show).
  function resolveTransition(layer, timeSec) {
    const target = layer.activeClipId ?? null;
    let st = layerState.get(layer.id);

    // First time we see this layer: adopt the target as displayed, no fade-in.
    if (!st) {
      st = { displayed: target, transition: null };
      layerState.set(layer.id, st);
    }

    // Start a transition if the target changed and we're not already heading there.
    if (target !== st.displayed &&
        (!st.transition || st.transition.toClipId !== target)) {
      st.transition = { fromClipId: st.displayed, toClipId: target, startT: timeSec };
    }
    // If a transition's target no longer matches the layer's target, retarget.
    // (Handles re-trigger mid-fade: settle is keyed off the current target below.)

    const tr = st.transition;
    if (!tr) {
      return { fromClip: findClip(layer, st.displayed), toClip: findClip(layer, st.displayed), progress: 1 };
    }

    const toClip = findClip(layer, tr.toClipId);
    const fromClip = findClip(layer, tr.fromClipId);

    // Deleted `from` clip mid-transition (or no real fade): snap to target.
    if (!fromClip) {
      st.displayed = tr.toClipId;
      st.transition = null;
      return { fromClip: null, toClip, progress: 1 };
    }

    const progress = transitionProgress(timeSec, tr.startT, layer.transitionMs);
    if (progress >= 1) {
      st.displayed = tr.toClipId;
      st.transition = null;
      return { fromClip: null, toClip, progress: 1 };
    }
    return { fromClip, toClip, progress };
  }

  function render(layers, timeSec) {
    const list = layers || [];

    // Drop runtime state for layers that no longer exist (avoid unbounded growth).
    if (layerState.size) {
      const live = new Set(list.map((l) => l && l.id));
      for (const id of [...layerState.keys()]) if (!live.has(id)) layerState.delete(id);
    }

    // 1. Clear accumulator to black, no blending.
    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const layer of list) {
      if (!layer) continue;

      const { fromClip, toClip, progress } = resolveTransition(layer, timeSec);

      // Determine the layer's BASE texture (pre-layer-effects), held in fromHold/toHold.
      // base.tex is what we feed into the layer-effects chain.
      let base = null;
      if (progress >= 1 || !fromClip) {
        // No crossfade: just the `to` (active) clip.
        if (renderClipInto(toClip, toHold, timeSec)) base = toHold;
      } else {
        // Crossfade: render both clips to distinct holds, then mix into clipA.
        const okFrom = renderClipInto(fromClip, fromHold, timeSec);
        const okTo = renderClipInto(toClip, toHold, timeSec);
        if (okFrom && okTo) {
          // Mix fromHold + toHold → clipA (clipA is free here; not aliasing a hold).
          const xf = getProgram('__xfade', XFADE_FS);
          gl.bindFramebuffer(gl.FRAMEBUFFER, clipA.fbo);
          gl.viewport(0, 0, w, h);
          gl.disable(gl.BLEND);
          gl.useProgram(xf.prog);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fromHold.tex);
          const uA = loc(xf, 'uA'); if (uA !== null) gl.uniform1i(uA, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, toHold.tex);
          const uB = loc(xf, 'uB'); if (uB !== null) gl.uniform1i(uB, 1);
          const uTm = loc(xf, 't'); if (uTm !== null) gl.uniform1f(uTm, progress);
          drawFullscreen(gl);
          gl.activeTexture(gl.TEXTURE0); // restore default active unit
          base = clipA;
        } else if (okTo) {
          base = toHold;
        } else if (okFrom) {
          base = fromHold;
        }
      }

      // Active clip unrenderable (missing/no generator) and no crossfade output:
      // render NOTHING for this layer (skip its blit) — be defensive.
      if (!base) continue;

      // 2. Layer effects: ping-pong over layerA/layerB, reading LAYER params.
      //    Seed by copying base into layerA (base may be a hold or clipA; copying
      //    keeps the chain independent and avoids feedback against base).
      let cur = layerA, other = layerB;
      const fx0 = (layer.effects || []).filter((n) => {
        const e = getEntry(n); return e && e.type === 'effect';
      });
      if (fx0.length === 0) {
        // No layer effects: base IS the final texture.
        cur = base;
      } else {
        blitInto(base.tex, cur, 1); // base → layerA
        for (const name of fx0) {
          const fx = getEntry(name);
          runEntry(fx, layer.params, other, cur.tex, timeSec);
          const tmp = cur; cur = other; other = tmp;
        }
      }

      // 3. Blit final layer texture onto accumulator with blend + opacity.
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
    for (const t of allTargets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    layerState.clear();
  }

  return { get tex() { return accum.tex; }, render, dispose };
}

// Re-export so callers can introspect available shaders without a second import.
export { REGISTRY };
