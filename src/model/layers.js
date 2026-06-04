// Pure, immutable helpers for the clip-based composition layer schema.
//
// SCHEMA (NEW — "Resolume clips"):
//   composition: {
//     canvas: { w, h },
//     layers: [{
//       id, name, blend, opacity,
//       clips: [ { id, name, generator, params, effects:[fxName…] } ],
//       activeClipId,           // id of the active clip (or null if none)
//       effects: [fxName…],     // LAYER effects
//       params: { 'name.key':v },// namespaced params for the LAYER effects ONLY
//       transitionMs,           // crossfade duration (default 500)
//     }]
//   }
//
// PARAM SPLIT: a CLIP's `params` holds namespaced defaults for its `generator`
// plus its clip `effects` (e.g. {'line.pos':0.5,'displace.amt':0.2}). A LAYER's
// `params` holds namespaced params for the LAYER `effects` only. This keeps a
// clip's `displace` and a layer's `displace` from colliding.
//
// Every helper takes the WHOLE show, addresses layers/clips by id, and returns
// a NEW show (never mutating the input). They never touch GL or persistence.
//
// Param keys are namespaced `'<name>.<key>'` (e.g. 'line.pos', 'displace.amt').

import { defaultParams, generatorNames, labelOf } from '../engine/shaders/manifest.js';

const TRANSITION_MS = 500;
const DEFAULT_CANVAS = { w: 1280, h: 720 };

// Per-clip transform + playback defaults (a clip = a timeline slot).
// transform: x/y in canvas fractions (0 = centred), scale (1 = fit), rotation°.
// opacity 0..1. durationMs is how long the transport holds this slot.
const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0 };
const DEFAULT_OPACITY = 1;
const DEFAULT_DURATION_MS = 4000;

// Normalize a transform object to all four numeric fields.
function normTransform(t) {
  const s = t && typeof t === 'object' ? t : {};
  return {
    x: Number(s.x) || 0,
    y: Number(s.y) || 0,
    scale: s.scale == null ? 1 : Number(s.scale),
    rotation: Number(s.rotation) || 0,
  };
}

// --- canvas resolution -------------------------------------------------------

// Bounds for the composition canvas (source render + on-screen stage). The
// canvas resolution affects ONLY source render detail/aspect — it does NOT
// touch fixtures/pipeline/routing/sampler (which work in normalized 0–1 space).
export const CANVAS_MIN = 16;
export const CANVAS_MAX = 4096;

// Clamp a width/height pair to integer pixels within [CANVAS_MIN, CANVAS_MAX].
// Non-finite / non-numeric inputs fall back to the bound minimum. Pure.
export function clampCanvasSize(w, h) {
  const clamp1 = (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return CANVAS_MIN;
    return Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, n));
  };
  return { w: clamp1(w), h: clamp1(h) };
}

// Aspect-ratio presets for the composition panel. Each `set` is a clamped size.
export const CANVAS_PRESETS = [
  { label: '16:9', w: 1280, h: 720 },
  { label: '1:1', w: 1024, h: 1024 },
  { label: '4:3', w: 1024, h: 768 },
];

// Return a new show with composition.canvas set to the clamped size (immutable).
export function setCanvasSize(show, w, h) {
  const canvas = clampCanvasSize(w, h);
  const comp = show.composition || {};
  return { ...show, composition: { ...comp, canvas } };
}

// Master composition opacity (0..1) — a final fader scaling the whole output.
export function setCompositionOpacity(show, opacity) {
  const comp = show.composition || {};
  const o = Math.max(0, Math.min(1, Number(opacity)));
  return { ...show, composition: { ...comp, opacity: Number.isFinite(o) ? o : 1 } };
}

// GLOBAL crossfade time (ms) — one transition for every layer's clip changes.
export function setCompositionTransition(show, ms) {
  const comp = show.composition || {};
  const v = Math.max(0, Math.round(Number(ms) || 0));
  return { ...show, composition: { ...comp, transitionMs: Number.isFinite(v) ? v : TRANSITION_MS } };
}

// Global gain applied to the audio input before it drives Audio-mode params.
export function setShowAudioGain(show, gain) {
  const comp = show.composition || {};
  const g = Math.max(0, Number(gain));
  return { ...show, composition: { ...comp, audioGain: Number.isFinite(g) ? g : 1 } };
}

// Prefix a flat { key: value } default map with the entry name → { 'name.key': value }.
export function prefixedDefaults(name) {
  const out = {};
  const d = defaultParams(name);
  for (const k of Object.keys(d)) out[name + '.' + k] = d[k];
  return out;
}

// --- id generation -----------------------------------------------------------

// Generate an id with `prefix` that is not already in `used` (a Set/array of ids).
function uniqueId(prefix, used) {
  const set = used instanceof Set ? used : new Set(used);
  let i = set.size + 1;
  let id = prefix + i;
  while (set.has(id)) id = prefix + ++i;
  return id;
}

function allClipIds(layers) {
  const ids = new Set();
  for (const l of layers) for (const c of l.clips || []) ids.add(c.id);
  return ids;
}

// --- migration: normalizeComposition (idempotent) ----------------------------

// Upgrade an OLD-shape (or partial new-shape) composition to the clip schema.
// - clip-layers pass through, with missing defaults filled (idempotent).
// - old layers ({generator,effects,params}) become a single-clip layer.
// - composition.canvas is ensured.
// Returns a NEW show; safe to run repeatedly and on an empty composition.
export function normalizeComposition(show) {
  const src = show && typeof show === 'object' ? show : {};
  const comp = src.composition && typeof src.composition === 'object' ? src.composition : {};
  const inLayers = Array.isArray(comp.layers) ? comp.layers : [];

  const layers = inLayers.map((layer, i) => {
    if (Array.isArray(layer.clips)) {
      // Already new-shape: fill any missing defaults.
      const clips = layer.clips.map((c) => ({
        id: c.id,
        name: c.name ?? 'clip',
        generator: c.generator,
        params: c.params ? { ...c.params } : {},
        effects: Array.isArray(c.effects) ? [...c.effects] : [],
        transform: normTransform(c.transform),
        opacity: c.opacity == null ? DEFAULT_OPACITY : Number(c.opacity),
        durationMs: c.durationMs == null ? DEFAULT_DURATION_MS : Number(c.durationMs),
        ...(c.anim ? { anim: { ...c.anim } } : {}),       // preserve per-param animations across reloads
        ...(c.videoUrl ? { videoUrl: c.videoUrl } : {}),  // keep video clip reference too
      }));
      // Repair a dangling activeClipId (points at a clip that no longer exists)
      // by falling back to the first clip, so downstream always has a valid target.
      const clipIds = new Set(clips.map((c) => c.id));
      const activeClipId = clipIds.has(layer.activeClipId)
        ? layer.activeClipId
        : (clips[0]?.id ?? null);
      return {
        id: layer.id ?? 'l' + (i + 1),
        name: layer.name ?? 'Layer ' + (i + 1),
        blend: layer.blend ?? 'add',
        opacity: layer.opacity ?? 1,
        clips,
        activeClipId,
        effects: Array.isArray(layer.effects) ? [...layer.effects] : [],
        params: layer.params ? { ...layer.params } : {},
        transitionMs: layer.transitionMs ?? TRANSITION_MS,
        ...(layer.anim ? { anim: { ...layer.anim } } : {}),   // preserve layer-FX animations
        ...(layer.minimized ? { minimized: true } : {}),      // preserve collapsed state
      };
    }
    // OLD shape → one clip carrying the generator/params/effects.
    const clipId = 'c1';
    const clip = {
      id: clipId,
      name: 'clip 1',
      generator: layer.generator,
      params: layer.params ? { ...layer.params } : {},
      effects: Array.isArray(layer.effects) ? [...layer.effects] : [],
      transform: { ...DEFAULT_TRANSFORM },
      opacity: DEFAULT_OPACITY,
      durationMs: DEFAULT_DURATION_MS,
    };
    return {
      id: layer.id ?? 'l' + (i + 1),
      name: layer.name ?? 'Layer ' + (i + 1),
      blend: layer.blend ?? 'add',
      opacity: layer.opacity ?? 1,
      clips: [clip],
      activeClipId: clipId,
      effects: [],
      params: {},
      transitionMs: TRANSITION_MS,
    };
  });

  const canvas = comp.canvas && typeof comp.canvas === 'object'
    ? { ...comp.canvas }
    : { ...DEFAULT_CANVAS };

  return { ...src, composition: { ...comp, canvas, layers } };
}

// --- internal: locate + immutably replace a layer / clip ---------------------

function layerIndex(show, layerId) {
  return (show.composition?.layers || []).findIndex((l) => l.id === layerId);
}

// Replace the layer with id `layerId` via `fn(layer) → newLayer`. If `fn`
// returns the SAME layer reference (or layer not found), the show is returned
// unchanged (same reference) so callers can no-op cheaply.
function updateLayer(show, layerId, fn) {
  const layers = show.composition?.layers || [];
  const idx = layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return show;
  const next = fn(layers[idx]);
  if (next === layers[idx]) return show;
  const nextLayers = layers.slice();
  nextLayers[idx] = next;
  return { ...show, composition: { ...show.composition, layers: nextLayers } };
}

// Replace the clip with id `clipId` inside layer `layerId` via `fn(clip)`.
function updateClip(show, layerId, clipId, fn) {
  return updateLayer(show, layerId, (layer) => {
    const idx = (layer.clips || []).findIndex((c) => c.id === clipId);
    if (idx < 0) return layer;
    const next = fn(layer.clips[idx]);
    if (next === layer.clips[idx]) return layer;
    const clips = layer.clips.slice();
    clips[idx] = next;
    return { ...layer, clips };
  });
}

// Drop a removed entry's params from `params` ONLY if no surviving entry in
// `remaining` shares its name (entries can repeat and SHARE params).
function dropParams(params, removed, remaining) {
  if (remaining.includes(removed)) return params;
  const out = {};
  for (const k of Object.keys(params || {})) {
    if (k.split('.')[0] !== removed) out[k] = params[k];
  }
  return out;
}

// --- clips -------------------------------------------------------------------

// A fresh clip for `generator`, with seeded prefixed params and no effects.
export function makeClip(generator, name, id = 'c1') {
  return {
    id, name: name ?? labelOf(generator), generator,
    params: prefixedDefaults(generator), effects: [],
    transform: { ...DEFAULT_TRANSFORM }, opacity: DEFAULT_OPACITY,
    durationMs: DEFAULT_DURATION_MS,
  };
}

// Append a clip (new generator) to a layer. If the layer had no active clip,
// the new clip becomes active.
export function addClip(show, layerId, generator) {
  return updateLayer(show, layerId, (layer) => {
    const id = uniqueId('c', allClipIds(show.composition.layers));
    const clip = makeClip(generator, undefined, id); // named after its source (labelOf)
    const clips = [...(layer.clips || []), clip];
    const activeClipId = layer.activeClipId == null ? id : layer.activeClipId;
    return { ...layer, clips, activeClipId };
  });
}

// Append a VIDEO clip (generator 'video' + a videoUrl). The video element +
// GL texture are managed at runtime (app.js) keyed by clip id; the show only
// stores the url/name.
export function addVideoClip(show, layerId, name, url) {
  return updateLayer(show, layerId, (layer) => {
    const id = uniqueId('c', allClipIds(show.composition.layers));
    const clip = { ...makeClip('video', name || 'Video', id), videoUrl: url };
    const clips = [...(layer.clips || []), clip];
    const activeClipId = layer.activeClipId == null ? id : layer.activeClipId;
    return { ...layer, clips, activeClipId };
  });
}

// Remove a clip. If it was active, reassign activeClipId to a surviving clip
// (or null if none remain). Safe to call on the last clip.
export function removeClip(show, layerId, clipId) {
  return updateLayer(show, layerId, (layer) => {
    const clips = (layer.clips || []).filter((c) => c.id !== clipId);
    if (clips.length === (layer.clips || []).length) return layer; // not found
    let activeClipId = layer.activeClipId;
    if (activeClipId === clipId) activeClipId = clips[0]?.id ?? null;
    return { ...layer, clips, activeClipId };
  });
}

// Duplicate a clip: a deep-ish copy (new id, "<name> copy") inserted right after
// the original in the same layer. Returns the new clip id via the 2nd arg holder.
export function duplicateClip(show, layerId, clipId) {
  return updateLayer(show, layerId, (layer) => {
    const clips = layer.clips || [];
    const idx = clips.findIndex((c) => c.id === clipId);
    if (idx < 0) return layer;
    const src = clips[idx];
    const newId = uniqueId('c', allClipIds(show.composition?.layers || []));
    const copy = {
      ...src, id: newId, name: `${src.name || src.id} copy`,
      params: { ...(src.params || {}) }, effects: [...(src.effects || [])],
      ...(src.anim ? { anim: { ...src.anim } } : {}),
      ...(src.transform ? { transform: { ...src.transform } } : {}),
    };
    return { ...layer, clips: [...clips.slice(0, idx + 1), copy, ...clips.slice(idx + 1)] };
  });
}

// Reorder a clip within the deck. `delta` is a signed step (e.g. -1/+1).
// Out-of-range → unchanged (same show reference).
export function moveClip(show, layerId, clipId, delta) {
  return updateLayer(show, layerId, (layer) => {
    const clips = (layer.clips || []).slice();
    const from = clips.findIndex((c) => c.id === clipId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= clips.length) return layer;
    const [item] = clips.splice(from, 1);
    clips.splice(to, 0, item);
    return { ...layer, clips };
  });
}

// The "trigger": set the layer's active clip (crossfade timing is the
// compositor's job later). Pass null to clear.
export function setActiveClip(show, layerId, clipId) {
  return updateLayer(show, layerId, (layer) => {
    if (layer.activeClipId === clipId) return layer;
    return { ...layer, activeClipId: clipId };
  });
}

// Change a clip's generator: reset that generator's params to defaults but KEEP
// the clip's effect params (anything whose prefix is one of the clip's effects).
export function changeClipGenerator(show, layerId, clipId, generator) {
  return updateClip(show, layerId, clipId, (clip) => {
    const effectSet = new Set(clip.effects || []);
    const kept = {};
    for (const k of Object.keys(clip.params || {})) {
      if (effectSet.has(k.split('.')[0])) kept[k] = clip.params[k];
    }
    // Rename to the new source unless the user gave the clip a custom name (i.e.
    // it still carries the previous source's auto-name, or a legacy "clip N").
    const autoNamed = !clip.name || clip.name === labelOf(clip.generator) || /^clip\s*\d+$/i.test(clip.name);
    const name = autoNamed ? labelOf(generator) : clip.name;
    return { ...clip, generator, name, params: { ...kept, ...prefixedDefaults(generator) } };
  });
}

// Merge a batch of (namespaced) params into a clip (e.g. loading a preset).
export function mergeClipParams(show, layerId, clipId, patch) {
  return updateClip(show, layerId, clipId, (clip) =>
    ({ ...clip, params: { ...clip.params, ...patch } }));
}

// Merge a batch of params into a layer (composition FX presets).
export function mergeLayerParams(show, layerId, patch) {
  return updateLayer(show, layerId, (layer) =>
    ({ ...layer, params: { ...layer.params, ...patch } }));
}

// Set (or clear, when spec is null) a per-parameter animation on a clip. The
// anim is keyed by the same namespaced param key as clip.params.
export function setClipAnim(show, layerId, clipId, key, spec) {
  return updateClip(show, layerId, clipId, (clip) => {
    const anim = { ...(clip.anim || {}) };
    if (spec) anim[key] = spec; else delete anim[key];
    return { ...clip, anim };
  });
}

// Set (or clear) a per-parameter animation on a layer (composition FX params).
export function setLayerAnim(show, layerId, key, spec) {
  return updateLayer(show, layerId, (layer) => {
    const anim = { ...(layer.anim || {}) };
    if (spec) anim[key] = spec; else delete anim[key];
    return { ...layer, anim };
  });
}

// Set a single (namespaced) param key on a clip.
export function setClipParam(show, layerId, clipId, key, value) {
  return updateClip(show, layerId, clipId, (clip) =>
    ({ ...clip, params: { ...clip.params, [key]: value } }));
}

// Patch a clip's transform (merges; missing fields keep their current value).
export function setClipTransform(show, layerId, clipId, patch) {
  return updateClip(show, layerId, clipId, (clip) =>
    ({ ...clip, transform: normTransform({ ...clip.transform, ...patch }) }));
}

// Set a clip's opacity (clamped 0..1).
export function setClipOpacity(show, layerId, clipId, value) {
  const v = Math.max(0, Math.min(1, Number(value)));
  return updateClip(show, layerId, clipId, (clip) => ({ ...clip, opacity: v }));
}

// Reset a clip's TRANSFORM group: identity transform, full opacity, and clear
// any transform (tf.*) animations. Used by the Transform section's group reset.
export function resetClipTransform(show, layerId, clipId) {
  return updateClip(show, layerId, clipId, (clip) => {
    const anim = { ...(clip.anim || {}) };
    for (const k of Object.keys(anim)) if (k.startsWith('tf.')) delete anim[k];
    return { ...clip, transform: normTransform({ x: 0, y: 0, scale: 1, rotation: 0 }), opacity: 1, anim };
  });
}

// Set a clip's transport hold duration (ms, floored at 0).
export function setClipDuration(show, layerId, clipId, ms) {
  const v = Math.max(0, Math.round(Number(ms) || 0));
  return updateClip(show, layerId, clipId, (clip) => ({ ...clip, durationMs: v }));
}

// --- transport (the clip deck played as a timeline) --------------------------

// Pure playhead resolver: which clip is active at `elapsedMs` when the deck is
// played left→right, each clip held for its durationMs. With loop, time wraps
// over the total; without loop it clamps to the last clip. Returns
// { clip, index, intoMs } or null if there are no clips. A clip with
// durationMs ≤ 0 is given a 1ms floor so the playhead can never stall on it.
export function playheadClip(clips, elapsedMs, loop = true) {
  const list = Array.isArray(clips) ? clips : [];
  if (!list.length) return null;
  const dur = list.map((c) => Math.max(1, Number(c.durationMs) || 0));
  const total = dur.reduce((a, b) => a + b, 0);
  let t = Number(elapsedMs) || 0;
  if (t < 0) t = 0;
  if (loop) {
    t = t % total;
  } else if (t >= total) {
    const i = list.length - 1;
    return { clip: list[i], index: i, intoMs: dur[i] };
  }
  let acc = 0;
  for (let i = 0; i < list.length; i++) {
    if (t < acc + dur[i]) return { clip: list[i], index: i, intoMs: t - acc };
    acc += dur[i];
  }
  const i = list.length - 1;
  return { clip: list[i], index: i, intoMs: dur[i] };
}

// Append a clip effect and seed its default params (prefixed).
export function addClipEffect(show, layerId, clipId, name) {
  return updateClip(show, layerId, clipId, (clip) => ({
    ...clip,
    effects: [...(clip.effects || []), name],
    params: { ...clip.params, ...prefixedDefaults(name) },
  }));
}

// Remove the clip effect at `fxIndex`. Its params are dropped ONLY if no other
// remaining effect shares that name (effects can repeat).
export function removeClipEffect(show, layerId, clipId, fxIndex) {
  return updateClip(show, layerId, clipId, (clip) => {
    const effects = (clip.effects || []).slice();
    if (fxIndex < 0 || fxIndex >= effects.length) return clip;
    const [removed] = effects.splice(fxIndex, 1);
    return { ...clip, effects, params: dropParams(clip.params, removed, effects) };
  });
}

// Reorder a clip effect by `delta` positions (clamped → unchanged).
export function moveClipEffect(show, layerId, clipId, fxIndex, delta) {
  return updateClip(show, layerId, clipId, (clip) => {
    const effects = (clip.effects || []).slice();
    const to = fxIndex + delta;
    if (fxIndex < 0 || fxIndex >= effects.length || to < 0 || to >= effects.length) return clip;
    const [item] = effects.splice(fxIndex, 1);
    effects.splice(to, 0, item);
    return { ...clip, effects };
  });
}

// --- layers ------------------------------------------------------------------

// A fresh default layer: one active clip on the first generator, no layer
// effects, add/opacity 1, default crossfade.
export function makeLayer(id, clipId = 'c1') {
  const generator = generatorNames()[0] || 'line';
  const clip = makeClip(generator, undefined, clipId);
  return {
    id,
    name: 'Layer 1',
    blend: 'add',
    opacity: 1,
    clips: [clip],
    activeClipId: clip.id,
    effects: [],
    params: {},
    transitionMs: TRANSITION_MS,
  };
}

// Append a new default layer (one active clip on the first generator), auto-named
// "Layer N" with a clip id unique across the whole show.
export function addLayer(show) {
  const layers = show.composition?.layers || [];
  const id = uniqueId('l', layers.map((l) => l.id));
  const maxN = layers.reduce((m, l) => {
    const match = /(\d+)\s*$/.exec(l.name || '');
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  // New layer starts EMPTY (no clips, nothing active) and goes UNDERNEATH the
  // stack — the deck renders array-end as the TOP row, so prepend = bottom.
  const layer = {
    id, name: `Layer ${maxN + 1}`, blend: 'add', opacity: 1, transitionMs: TRANSITION_MS,
    clips: [], activeClipId: null, effects: [], params: {},
  };
  return { ...show, composition: { ...show.composition, layers: [layer, ...layers] } };
}

// Remove the layer with id `layerId`. Unknown id → unchanged.
export function removeLayer(show, layerId) {
  const layers = show.composition?.layers || [];
  if (!layers.some((l) => l.id === layerId)) return show;
  return {
    ...show,
    composition: { ...show.composition, layers: layers.filter((l) => l.id !== layerId) },
  };
}

// Move the layer with id `layerId` by `delta` positions (clamped → unchanged).
export function moveLayer(show, layerId, delta) {
  const layers = (show.composition?.layers || []).slice();
  const from = layers.findIndex((l) => l.id === layerId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= layers.length) return show;
  const [item] = layers.splice(from, 1);
  layers.splice(to, 0, item);
  return { ...show, composition: { ...show.composition, layers } };
}

// Shallow-patch a layer (blend/opacity/name/transitionMs).
export function patchLayer(show, layerId, patch) {
  return updateLayer(show, layerId, (layer) => ({ ...layer, ...patch }));
}

// Set a single (namespaced) LAYER-effect param key.
export function setLayerParam(show, layerId, key, value) {
  return updateLayer(show, layerId, (layer) =>
    ({ ...layer, params: { ...layer.params, [key]: value } }));
}

// --- COMPOSITION effects (the 3rd FX tier): applied to the FINAL composite of
//     all layers, after each layer's own chain. Stored on composition.effects /
//     composition.params (namespaced), mirroring the clip/layer chains. ---
const updateComp = (show, fn) => ({ ...show, composition: fn(show.composition || {}) });
export function addCompositionEffect(show, name) {
  return updateComp(show, (c) => ({ ...c, effects: [...(c.effects || []), name], params: { ...c.params, ...prefixedDefaults(name) } }));
}
export function removeCompositionEffect(show, fxIndex) {
  return updateComp(show, (c) => {
    const effects = (c.effects || []).slice();
    if (fxIndex < 0 || fxIndex >= effects.length) return c;
    const [removed] = effects.splice(fxIndex, 1);
    return { ...c, effects, params: dropParams(c.params, removed, effects) };
  });
}
export function moveCompositionEffect(show, fxIndex, delta) {
  return updateComp(show, (c) => {
    const effects = (c.effects || []).slice();
    const to = fxIndex + delta;
    if (fxIndex < 0 || fxIndex >= effects.length || to < 0 || to >= effects.length) return c;
    const [item] = effects.splice(fxIndex, 1); effects.splice(to, 0, item);
    return { ...c, effects };
  });
}
export function setCompositionParam(show, key, value) {
  return updateComp(show, (c) => ({ ...c, params: { ...c.params, [key]: value } }));
}
export function mergeCompositionParams(show, patch) {
  return updateComp(show, (c) => ({ ...c, params: { ...c.params, ...patch } }));
}
export function setCompositionAnim(show, key, spec) {
  return updateComp(show, (c) => {
    const anim = { ...(c.anim || {}) };
    if (spec) anim[key] = spec; else delete anim[key];
    return { ...c, anim };
  });
}

// Append a LAYER effect and seed its default params on layer.params.
export function addLayerEffect(show, layerId, name) {
  return updateLayer(show, layerId, (layer) => ({
    ...layer,
    effects: [...(layer.effects || []), name],
    params: { ...layer.params, ...prefixedDefaults(name) },
  }));
}

// Remove the LAYER effect at `fxIndex`; drop orphan params (duplicate-survivor rule).
export function removeLayerEffect(show, layerId, fxIndex) {
  return updateLayer(show, layerId, (layer) => {
    const effects = (layer.effects || []).slice();
    if (fxIndex < 0 || fxIndex >= effects.length) return layer;
    const [removed] = effects.splice(fxIndex, 1);
    return { ...layer, effects, params: dropParams(layer.params, removed, effects) };
  });
}

// Reorder a LAYER effect by `delta` positions (clamped → unchanged).
export function moveLayerEffect(show, layerId, fxIndex, delta) {
  return updateLayer(show, layerId, (layer) => {
    const effects = (layer.effects || []).slice();
    const to = fxIndex + delta;
    if (fxIndex < 0 || fxIndex >= effects.length || to < 0 || to >= effects.length) return layer;
    const [item] = effects.splice(fxIndex, 1);
    effects.splice(to, 0, item);
    return { ...layer, effects };
  });
}
