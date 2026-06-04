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
import { REGISTRY, getEntry, defaultParams, hexToRgb } from './shaders/manifest.js';

const BLIT_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float opacity;
void main(){ vec4 c=texture(uTex, uv); frag=vec4(c.rgb*opacity, c.a*opacity); }`;

// Per-clip transform + opacity. Maps each output texel back through the inverse
// transform (translate uOffset, uniform uScale, rotate uRot around centre) to
// find the source texel; texels outside [0,1] are transparent. uAspect (w/h)
// keeps rotation/scale square on non-square canvases. Identity (offset 0, scale
// 1, rot 0, opacity 1) reproduces a plain blit exactly — no regression.
const TRANSFORM_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uTex; uniform float opacity;
uniform vec2 uOffset; uniform float uScale; uniform float uRot; uniform float uAspect;
void main(){
  vec2 p = uv - 0.5 - uOffset;
  p.x *= uAspect;
  float c = cos(-uRot), s = sin(-uRot);
  p = mat2(c, -s, s, c) * p;
  p /= max(uScale, 1e-4);
  p.x /= uAspect;
  vec2 suv = p + 0.5;
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) { frag = vec4(0.0); return; }
  vec4 col = texture(uTex, suv);
  frag = vec4(col.rgb * opacity, col.a * opacity);
}`;

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

  // Per-frame env (e.g. { trigSec } for triggerable sources). Set in render().
  let frameEnv = {};

  // Per-instance integrated phase clocks (NOT persisted). Keyed by
  // `<instanceKey>:<entryName>` → { phase, lastT }. For shaders that declare a
  // `uPhase` uniform we feed an accumulated ∫speed·dt rather than uT·speed, so
  // changing the speed param only alters the rate going forward — it never jumps
  // the animation to a new point (which looked like a "restart"). See runEntry.
  const phaseClocks = new Map();

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
  function runEntry(entry, params, dst, srcTex, timeSec, instanceKey) {
    const c = getProgram(entry.name, entry.src);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(c.prog);

    const defaults = defaultParams(entry.name);
    for (const p of entry.params) {
      const l = loc(c, p.key);
      if (l === null) continue;
      const v = paramValue(params, entry.name, p.key, defaults[p.key]);
      if (p.type === 'color') { const [r, g, b] = hexToRgb(v); gl.uniform3f(l, r, g, b); }
      else gl.uniform1f(l, Number(v));
    }
    // uT (seconds) — always try; only set if the shader declares it.
    const uT = loc(c, 'uT');
    if (uT !== null) gl.uniform1f(uT, timeSec);

    // uPhase — integrated ∫speed·dt for a phase-continuous sweep (see phaseClocks).
    // The rate comes from the entry's speed param; speed=0 ⇒ phase frozen.
    const uPhase = loc(c, 'uPhase');
    if (uPhase !== null) {
      const rateKey = entry.phaseParam || 'speed';
      const rate = Number(paramValue(params, entry.name, rateKey, defaults[rateKey] ?? 0)) || 0;
      const ck = (instanceKey || entry.name) + ':' + entry.name;
      let pc = phaseClocks.get(ck);
      if (!pc) { pc = { phase: 0, lastT: timeSec }; phaseClocks.set(ck, pc); }
      let dt = timeSec - pc.lastT;
      if (!(dt > 0) || dt > 1) dt = 0;   // ignore pauses / seeks / backwards jumps
      pc.phase += dt * rate;
      pc.lastT = timeSec;
      gl.uniform1f(uPhase, pc.phase);
    }

    // uTrigs[] — seconds since each recent trigger (from frameEnv.trigSecs),
    // huge (1e6) before a trigger so triggerable sources (Pulse) stay idle. The
    // most recent up-to-8 triggers stack as independent beams.
    const uTrigs = loc(c, 'uTrigs[0]');
    if (uTrigs !== null) {
      const arr = new Float32Array(8).fill(1e6);
      const trigs = frameEnv.trigSecs || [];
      const n = Math.min(trigs.length, 8);
      for (let i = 0; i < n; i++) arr[i] = timeSec - trigs[trigs.length - n + i];
      gl.uniform1fv(uTrigs, arr);
      const cnt = loc(c, 'uTrigCount');
      if (cnt !== null) gl.uniform1i(cnt, n);
    }

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

    let cur = clipA, other = clipB;
    if (clip.generator === 'video') {
      // Video clip: blit the runtime-uploaded video frame (from frameEnv) as the
      // base, instead of running a generator shader.
      const vtex = frameEnv.videoTex ? frameEnv.videoTex(clip) : null;
      if (!vtex) return false;
      blitInto(vtex, cur, 1);
    } else {
      const gen = getEntry(clip.generator);
      if (!gen || gen.type !== 'generator') return false;
      runEntry(gen, clip.params, cur, null, timeSec, clip.id);
    }
    (clip.effects || []).forEach((name, i) => {
      const fx = getEntry(name);
      if (!fx || fx.type !== 'effect') return;
      runEntry(fx, clip.params, other, cur.tex, timeSec, clip.id + ':fx' + i);
      const tmp = cur; cur = other; other = tmp;
    });
    // Place cur → hold applying the clip's transform + opacity. hold is never
    // part of the clip ping-pong, so no feedback loop. During a crossfade each
    // clip is transformed independently before the two holds are mixed.
    transformBlit(cur.tex, hold, clip.transform, clip.opacity);
    return true;
  }

  // Draw srcTex into dst applying a per-clip transform (translate/scale/rotate)
  // and opacity. Identity transform + opacity 1 == a plain blit.
  function transformBlit(srcTex, dst, transform, opacity) {
    const t = transform || {};
    const prog = getProgram('__xform', TRANSFORM_FS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    const uTex = loc(prog, 'uTex'); if (uTex !== null) gl.uniform1i(uTex, 0);
    const uOp = loc(prog, 'opacity'); if (uOp !== null) gl.uniform1f(uOp, opacity == null ? 1 : Number(opacity));
    const uOff = loc(prog, 'uOffset'); if (uOff !== null) gl.uniform2f(uOff, Number(t.x) || 0, Number(t.y) || 0);
    const uSc = loc(prog, 'uScale'); if (uSc !== null) gl.uniform1f(uSc, t.scale == null ? 1 : Number(t.scale));
    const uRot = loc(prog, 'uRot'); if (uRot !== null) gl.uniform1f(uRot, (Number(t.rotation) || 0) * Math.PI / 180);
    const uAsp = loc(prog, 'uAspect'); if (uAsp !== null) gl.uniform1f(uAsp, h > 0 ? w / h : 1);
    drawFullscreen(gl);
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

  // The layer blit emits PREMULTIPLIED colour (rgb already × opacity×alpha), so
  // blend factors must assume premultiplied source — otherwise opacity is applied
  // twice. 'alpha' is premultiplied over; 'multiply' respects source coverage.
  function setBlend(mode) {
    gl.enable(gl.BLEND);
    switch (mode) {
      case 'screen':   gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
      case 'alpha':    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break; // premultiplied over
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
  function resolveTransition(layer, timeSec, globalTransitionMs) {
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

    // Crossfade time is now a GLOBAL composition setting (one fade for all
    // layers); fall back to a per-layer value, then 500ms, for old shows.
    const transitionMs = globalTransitionMs ?? layer.transitionMs ?? 500;
    const progress = transitionProgress(timeSec, tr.startT, transitionMs);
    if (progress >= 1) {
      st.displayed = tr.toClipId;
      st.transition = null;
      return { fromClip: null, toClip, progress: 1 };
    }
    return { fromClip, toClip, progress };
  }

  function render(layers, timeSec, env) {
    const list = layers || [];
    frameEnv = env || {};
    // Master composition fader: scales every layer's contribution. Composited
    // over black, multiplying each layer's blit opacity fades the whole output.
    const master = frameEnv.masterOpacity == null ? 1 : Number(frameEnv.masterOpacity);

    // Drop runtime state for layers/clips that no longer exist (avoid growth).
    if (layerState.size) {
      const live = new Set(list.map((l) => l && l.id));
      for (const id of [...layerState.keys()]) if (!live.has(id)) layerState.delete(id);
    }
    if (phaseClocks.size) {
      const liveIds = new Set();
      for (const l of list) {
        if (!l) continue;
        liveIds.add(l.id);
        for (const cl of (l.clips || [])) if (cl) liveIds.add(cl.id);
      }
      for (const k of [...phaseClocks.keys()]) {
        if (!liveIds.has(k.slice(0, k.indexOf(':')))) phaseClocks.delete(k);
      }
    }

    // 1. Clear accumulator to TRANSPARENT black, no blending. Empty/transparent
    //    regions keep alpha 0 so the on-screen checkerboard backdrop shows through;
    //    sampled RGB is still 0 there (LEDs off), unchanged from opaque-black.
    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Layer B(ypass)/S(olo): a bypassed layer is skipped; if ANY layer is soloed,
    // only soloed layers render.
    const anySolo = list.some((l) => l && l.solo);
    for (const layer of list) {
      if (!layer) continue;
      if (layer.bypass) continue;
      if (anySolo && !layer.solo) continue;

      const { fromClip, toClip, progress } = resolveTransition(layer, timeSec, frameEnv.transitionMs);

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
        fx0.forEach((name, i) => {
          const fx = getEntry(name);
          runEntry(fx, layer.params, other, cur.tex, timeSec, layer.id + ':fx' + i);
          const tmp = cur; cur = other; other = tmp;
        });
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
      if (uOp !== null) gl.uniform1f(uOp, (layer.opacity == null ? 1 : Number(layer.opacity)) * master);
      drawFullscreen(gl);
      gl.disable(gl.BLEND);
    }

    // COMPOSITION effects (3rd tier): run the chain on the FULL composite (accum),
    // ping-ponging via the layer scratch targets, then blit the result back into
    // accum so the output `tex` carries the post-composite look.
    const compFx = (frameEnv.compositionEffects || []).filter((n) => {
      const e = getEntry(n); return e && e.type === 'effect';
    });
    if (compFx.length) {
      let cur = layerA, other = layerB;
      blitInto(accum.tex, cur, 1);
      compFx.forEach((name, i) => {
        const fx = getEntry(name);
        runEntry(fx, frameEnv.compositionParams || {}, other, cur.tex, timeSec, 'comp:fx' + i);
        const tmp = cur; cur = other; other = tmp;
      });
      blitInto(cur.tex, accum, 1);
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
    phaseClocks.clear();
  }

  // Reset all integrated phase clocks so speed-driven sweeps restart from 0.
  function resetPhases() { phaseClocks.clear(); }

  return { get tex() { return accum.tex; }, render, dispose, resetPhases };
}

// Re-export so callers can introspect available shaders without a second import.
export { REGISTRY };
