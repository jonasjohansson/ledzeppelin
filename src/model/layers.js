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

import { defaultParams, generatorNames } from '../engine/shaders/manifest.js';

const TRANSITION_MS = 500;
const DEFAULT_CANVAS = { w: 1280, h: 720 };

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
      }));
      // Repair a dangling activeClipId (points at a clip that no longer exists)
      // by falling back to the first clip, so downstream always has a valid target.
      const clipIds = new Set(clips.map((c) => c.id));
      const activeClipId = clipIds.has(layer.activeClipId)
        ? layer.activeClipId
        : (clips[0]?.id ?? null);
      return {
        id: layer.id ?? 'l' + (i + 1),
        name: layer.name ?? 'layer ' + (i + 1),
        blend: layer.blend ?? 'add',
        opacity: layer.opacity ?? 1,
        clips,
        activeClipId,
        effects: Array.isArray(layer.effects) ? [...layer.effects] : [],
        params: layer.params ? { ...layer.params } : {},
        transitionMs: layer.transitionMs ?? TRANSITION_MS,
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
    };
    return {
      id: layer.id ?? 'l' + (i + 1),
      name: layer.name ?? 'layer ' + (i + 1),
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
export function makeClip(generator, name = 'clip', id = 'c1') {
  return { id, name, generator, params: prefixedDefaults(generator), effects: [] };
}

// Append a clip (new generator) to a layer. If the layer had no active clip,
// the new clip becomes active.
export function addClip(show, layerId, generator) {
  return updateLayer(show, layerId, (layer) => {
    const id = uniqueId('c', allClipIds(show.composition.layers));
    const n = (layer.clips?.length || 0) + 1;
    const clip = makeClip(generator, 'clip ' + n, id);
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
    return { ...clip, generator, params: { ...kept, ...prefixedDefaults(generator) } };
  });
}

// Set a single (namespaced) param key on a clip.
export function setClipParam(show, layerId, clipId, key, value) {
  return updateClip(show, layerId, clipId, (clip) =>
    ({ ...clip, params: { ...clip.params, [key]: value } }));
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
  const clip = makeClip(generator, 'clip 1', clipId);
  return {
    id,
    name: 'layer',
    blend: 'add',
    opacity: 1,
    clips: [clip],
    activeClipId: clip.id,
    effects: [],
    params: {},
    transitionMs: TRANSITION_MS,
  };
}

// Append a new default layer (one active clip on the first generator).
export function addLayer(show) {
  const layers = show.composition?.layers || [];
  const id = uniqueId('l', layers.map((l) => l.id));
  const layer = makeLayer(id);
  return { ...show, composition: { ...show.composition, layers: [...layers, layer] } };
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
