import { normDashboard } from './dashboard.js';

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
  { label: '1:1', w: 1280, h: 1280 },
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

// Global musical tempo (beats per minute). Drives beat-synced Timeline modulation
// (a spec's `beats` count → seconds via 60000/bpm). Clamped to a sane range.
export const BPM_MIN = 20, BPM_MAX = 300, BPM_DEFAULT = 120;
export function setShowBpm(show, bpm) {
  const comp = show.composition || {};
  const b = Math.round(Number(bpm));
  return { ...show, composition: { ...comp, bpm: Number.isFinite(b) ? Math.max(BPM_MIN, Math.min(BPM_MAX, b)) : BPM_DEFAULT } };
}

// Prefix a flat { key: value } default map with the entry name → { 'name.key': value }.
export function prefixedDefaults(name) {
  const out = {};
  const d = defaultParams(name);
  for (const k of Object.keys(d)) out[name + '.' + k] = d[k];
  return out;
}

// --- id generation -----------------------------------------------------------

// Name for a duplicate: strip any trailing " N" / " copy" run from the base, then
// return the first free "Base N" (N from 2) against `existing` names — so copies
// read "Name 2", "Name 3", … instead of "Name copy copy".
export function copyName(base, existing) {
  const taken = new Set([...existing].map((s) => String(s || '').toLowerCase()));
  let core = String(base || '').trim();
  for (;;) {
    const next = core.replace(/\s+(copy|\d+)$/i, '');
    if (next === core) break;
    core = next;
  }
  if (!core) core = 'Untitled';
  let n = 2; let name = `${core} ${n}`;
  while (taken.has(name.toLowerCase())) name = `${core} ${++n}`;
  return name;
}

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
  for (const l of layers) for (const c of l.clips || []) if (c) ids.add(c.id);
  return ids;
}

// --- migration: normalizeComposition (idempotent) ----------------------------

// Upgrade an OLD-shape (or partial new-shape) composition to the clip schema.
// - clip-layers pass through, with missing defaults filled (idempotent).
// - old layers ({generator,effects,params}) become a single-clip layer.
// - composition.canvas is ensured.
// Returns a NEW show; safe to run repeatedly and on an empty composition.
// Generator migration: the standalone 'kelvin' source was merged into 'solid'
// (Color) as a temperature option. Old shows referencing it map to solid with
// useKelvin on. Returns { generator, params }.
function migrateGenerator(generator, params) {
  const p = params ? { ...params } : {};
  if (generator === 'kelvin') {
    return { generator: 'solid', params: { useKelvin: true, kelvin: p.kelvin ?? 3200, level: p.level ?? 1 } };
  }
  return { generator, params: p };
}

export function normalizeComposition(show) {
  const src = show && typeof show === 'object' ? show : {};
  const comp = src.composition && typeof src.composition === 'object' ? src.composition : {};
  const inLayers = Array.isArray(comp.layers) ? comp.layers : [];

  // One-time blend migration: the old default was 'add' (light sums, never
  // occludes). The new default is 'alpha' (a full-opacity layer covers below).
  // On the first load after this change, flip legacy 'add' → 'alpha'; afterwards
  // (blendV2 set) an explicit 'add' is respected.
  const migrateBlend = !comp.blendV2;
  const blendOf = (b) => { const v = b ?? 'alpha'; return migrateBlend && v === 'add' ? 'alpha' : v; };
  // Companion one-time migration: with Alpha blend, a 100% layer fully covers
  // below. Default layers now START at 50% so the layers beneath show through;
  // flip existing full-opacity (1) layers to 0.5 once, preserving any opacity
  // someone deliberately set to a non-default value.
  const migrateOpacity = !comp.opacityV2;
  const opacityOf = (layer) => { const o = layer.opacity ?? 1; return migrateOpacity && o === 1 ? 0.5 : o; };

  const layers = inLayers.filter(Boolean).map((layer, i) => {
    if (Array.isArray(layer.clips)) {
      // Already new-shape: fill any missing defaults. `null` entries are HOLES
      // (deleted grid slots) — preserved so positions stay stable across reload.
      let clips = layer.clips.map((c) => (!c ? null : {
        id: c.id,
        name: c.name ?? 'clip',
        ...migrateGenerator(c.generator, c.params),
        effects: Array.isArray(c.effects) ? [...c.effects] : [],
        transform: normTransform(c.transform),
        opacity: c.opacity == null ? DEFAULT_OPACITY : Number(c.opacity),
        durationMs: c.durationMs == null ? DEFAULT_DURATION_MS : Number(c.durationMs),
        ...(c.anim ? { anim: { ...c.anim } } : {}),       // preserve per-param animations across reloads
        // Video clips reference a file via an object URL. blob: URLs are
        // session-only — dead after a reload — so drop them and flag the clip as
        // missing (the deck shows a re-pick badge instead of a silent dead clip).
        ...(c.videoUrl && !c.videoUrl.startsWith('blob:') ? { videoUrl: c.videoUrl } : {}),
        ...(c.generator === 'video' && (!c.videoUrl || c.videoUrl.startsWith('blob:')) ? { videoMissing: true } : {}),
      }));
      while (clips.length && clips[clips.length - 1] == null) clips.pop();   // never persist trailing holes
      // Resolve activeClipId:
      //   null  → intentional "nothing playing" (e.g. the live clip was deleted) — keep it.
      //   valid → respected.
      //   dangling / legacy-undefined → fall back to the first real clip.
      const clipIds = new Set(clips.filter(Boolean).map((c) => c.id));
      const activeClipId = layer.activeClipId === null
        ? null
        : (clipIds.has(layer.activeClipId) ? layer.activeClipId : (clips.find((c) => c)?.id ?? null));
      return {
        id: layer.id ?? 'l' + (i + 1),
        name: layer.name ?? 'Layer ' + (i + 1),
        blend: blendOf(layer.blend),
        opacity: opacityOf(layer),
        clips,
        activeClipId,
        effects: Array.isArray(layer.effects) ? [...layer.effects] : [],
        params: layer.params ? { ...layer.params } : {},
        transitionMs: layer.transitionMs ?? TRANSITION_MS,
        ...(layer.anim ? { anim: { ...layer.anim } } : {}),   // preserve layer-FX animations
      };
    }
    // OLD shape → one clip carrying the generator/params/effects.
    const clipId = 'c1';
    const clip = {
      id: clipId,
      name: 'clip 1',
      ...migrateGenerator(layer.generator, layer.params),
      effects: Array.isArray(layer.effects) ? [...layer.effects] : [],
      transform: { ...DEFAULT_TRANSFORM },
      opacity: DEFAULT_OPACITY,
      durationMs: DEFAULT_DURATION_MS,
    };
    return {
      id: layer.id ?? 'l' + (i + 1),
      name: layer.name ?? 'Layer ' + (i + 1),
      blend: blendOf(layer.blend),
      opacity: opacityOf(layer),
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

  const bpm = Number.isFinite(Number(comp.bpm)) ? Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(Number(comp.bpm)))) : BPM_DEFAULT;
  // `...comp` is what carries `view3d` (the composition's 3D projection state:
  // { mode, projectionCamera, orbit }) through the normalizer untouched. Absent
  // view3d stays absent → the pipeline's cameraFromView3d falls back to the flat
  // camera, i.e. byte-identical 2D. Do NOT switch this to an explicit field
  // whitelist without preserving view3d, or existing 3D shows would silently
  // downgrade to 2D on load.
  return { ...src, composition: { ...comp, canvas, layers, bpm, dashboard: normDashboard(comp.dashboard), blendV2: true, opacityV2: true } };
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
    const idx = (layer.clips || []).findIndex((c) => c && c.id === clipId);
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

// An ISF generator clip: carries the parsed+wrapped shader on `clip.isf`
// ({ id, name, glsl, src, inputs, params }) and seeds clip.params from its INPUT
// schema (keyed by input NAME). The compositor renders it via runISF.
export function makeISFClip(isf, id = 'c1') {
  const params = {};
  for (const p of isf.params || []) params[p.key] = p.default;
  return {
    id, name: isf.name || 'ISF', isf, params, effects: [],
    transform: { ...DEFAULT_TRANSFORM }, opacity: DEFAULT_OPACITY,
    durationMs: DEFAULT_DURATION_MS,
  };
}

export function addISFClip(show, layerId, isf) {
  return updateLayer(show, layerId, (layer) => {
    const id = uniqueId('c', allClipIds(show.composition.layers));
    const clip = makeISFClip(isf, id);
    const clips = [...(layer.clips || []), clip];
    const activeClipId = layer.activeClipId == null ? id : layer.activeClipId;
    return { ...layer, clips, activeClipId };
  });
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

// Remove a clip. The deck is a positional GRID (Resolume-style): deleting a clip
// leaves a HOLE (null) at its slot so the clips after it don't shift up; only
// trailing holes are trimmed. If it was active, reassign to a surviving clip.
export function removeClip(show, layerId, clipId) {
  return updateLayer(show, layerId, (layer) => {
    const cur = layer.clips || [];
    const idx = cur.findIndex((c) => c && c.id === clipId);
    if (idx < 0) return layer; // not found
    let clips = cur.slice();
    clips[idx] = null;                                   // leave the slot blank
    while (clips.length && clips[clips.length - 1] == null) clips.pop();   // trim trailing holes
    let activeClipId = layer.activeClipId;
    // Deleting the live clip leaves the layer with NOTHING playing — don't promote
    // a sibling into the active slot (the output just goes blank for that layer).
    if (activeClipId === clipId) activeClipId = null;
    return { ...layer, clips, activeClipId };
  });
}

// Duplicate a clip: a deep-ish copy (new id, numbered "<name> 2") inserted right
// after the original in the same layer. Returns the new clip id via the 2nd arg holder.
export function duplicateClip(show, layerId, clipId) {
  return updateLayer(show, layerId, (layer) => {
    const clips = layer.clips || [];
    const idx = clips.findIndex((c) => c && c.id === clipId);
    if (idx < 0) return layer;
    const src = clips[idx];
    const newId = uniqueId('c', allClipIds(show.composition?.layers || []));
    const copy = {
      ...src, id: newId, name: copyName(src.name || src.id, clips.map((c) => c?.name || '')),
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
    const from = clips.findIndex((c) => c && c.id === clipId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= clips.length) return layer;
    const [item] = clips.splice(from, 1);
    clips.splice(to, 0, item);
    return { ...layer, clips };
  });
}

// Trim trailing holes + keep activeClipId pointing at a real clip.
function tidyClips(layer, clips) {
  const t = clips.slice();
  while (t.length && t[t.length - 1] == null) t.pop();
  let activeClipId = layer.activeClipId;
  if (!t.some((c) => c && c.id === activeClipId)) activeClipId = t.find((c) => c)?.id ?? null;
  return { ...layer, clips: t, activeClipId };
}

// Add a clip at a SPECIFIC slot: fill a hole there if present, else append. Used
// when clicking an empty (deleted) slot in the deck.
export function addClipAt(show, layerId, index, generator) {
  return updateLayer(show, layerId, (layer) => {
    const id = uniqueId('c', allClipIds(show.composition.layers));
    const clip = makeClip(generator, undefined, id);
    const clips = (layer.clips || []).slice();
    if (Number.isInteger(index) && index >= 0) {
      while (clips.length < index) clips.push(null);          // pad with holes up to the target column
      if (index >= clips.length || clips[index] == null) clips[index] = clip;   // land on an empty column
      else clips.push(clip);                                  // occupied → append (legacy contract)
    } else clips.push(clip);
    const activeClipId = layer.activeClipId == null ? id : layer.activeClipId;
    return { ...layer, clips, activeClipId };
  });
}

// Move a clip from one layer to another, inserting at `toIndex` (a clip slot;
// -1 / past the end = append). Same source and target layer collapses to a plain
// reorder. The clip keeps its id (still unique — removed from the source before
// it's added to the target). It becomes the destination's active clip if it was
// active in the source, or if the destination had no active clip yet.
export function moveClipToLayer(show, fromLayerId, clipId, toLayerId, toIndex = -1) {
  const layers = show?.composition?.layers || [];
  const src = layers.find((l) => l.id === fromLayerId);
  const from = src ? (src.clips || []).findIndex((c) => c && c.id === clipId) : -1;
  if (from < 0) return show;
  const clip = src.clips[from];
  const wasActive = src.activeClipId === clipId;
  const nextLayers = layers.map((l) => {
    if (l.id === fromLayerId && l.id === toLayerId) {
      // Same layer: dropping onto an EMPTY column (a hole, or a column past the
      // end) places the clip there and vacates the source slot — so you can move a
      // clip into any grid cell, leaving a gap. Dropping onto an occupied clip
      // reorders before it. Either way slots stay positional.
      const clips = (l.clips || []).slice();
      let to = toIndex;
      if (to >= 0 && to !== from) {
        while (clips.length <= to) clips.push(null);          // pad to reach the target column
        if (clips[to] == null) { clips[to] = clip; clips[from] = null; }   // land on an empty column
        else {                                                // occupied → reorder before it
          clips.splice(from, 1);
          let at = to > from ? to - 1 : to; if (at > clips.length) at = clips.length;
          clips.splice(at, 0, clip);
        }
      } else if (to < 0) { clips.splice(from, 1); clips.push(clip); }   // append
      return tidyClips(l, clips);
    }
    if (l.id === fromLayerId) {
      const clips = (l.clips || []).slice(); clips[from] = null;   // leave a hole behind
      return tidyClips(l, clips);
    }
    if (l.id === toLayerId) {
      const clips = (l.clips || []).slice();
      let to = toIndex;
      if (to >= 0) {
        while (clips.length < to) clips.push(null);            // pad with holes up to the target column
        if (to >= clips.length || clips[to] == null) clips[to] = clip;   // land on an empty column
        else clips.splice(to, 0, clip);                       // occupied → insert before it
      } else clips.push(clip);                                 // append
      const activeClipId = wasActive || l.activeClipId == null ? clip.id : l.activeClipId;
      const t = clips.slice(); while (t.length && t[t.length - 1] == null) t.pop();
      return { ...l, clips: t, activeClipId };
    }
    return l;
  });
  return { ...show, composition: { ...show.composition, layers: nextLayers } };
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
// Also resets the source params' ANIMATIONS back to basic (keeping transform `tf.*`
// and effect-param anims) — so "reset" on the Source group also clears timeline/
// audio modulation on those params.
export function changeClipGenerator(show, layerId, clipId, generator) {
  return updateClip(show, layerId, clipId, (clip) => {
    const effectSet = new Set(clip.effects || []);
    const kept = {};
    for (const k of Object.keys(clip.params || {})) {
      if (effectSet.has(k.split('.')[0])) kept[k] = clip.params[k];
    }
    // Keep only transform + effect-param anims; the source's own param anims reset.
    const anim = {};
    for (const k of Object.keys(clip.anim || {})) {
      const prefix = k.split('.')[0];
      if (prefix === 'tf' || effectSet.has(prefix)) anim[k] = clip.anim[k];
    }
    // Rename to the new source unless the user gave the clip a custom name (i.e.
    // it still carries the previous source's auto-name, or a legacy "clip N").
    const autoNamed = !clip.name || clip.name === labelOf(clip.generator) || /^clip\s*\d+$/i.test(clip.name);
    const name = autoNamed ? labelOf(generator) : clip.name;
    return { ...clip, generator, name, params: { ...kept, ...prefixedDefaults(generator) }, anim };
  });
}

// Merge a batch of (namespaced) params into a clip (e.g. loading a preset). When
// `clearAnim` is set (a group RESET), also drop any animation on the patched keys
// so those params return to basic.
export function mergeClipParams(show, layerId, clipId, patch, clearAnim = false) {
  return updateClip(show, layerId, clipId, (clip) => {
    const next = { ...clip, params: { ...clip.params, ...patch } };
    if (clearAnim && clip.anim) { const anim = { ...clip.anim }; for (const k of Object.keys(patch)) delete anim[k]; next.anim = anim; }
    return next;
  });
}

// Merge a batch of params into a layer (composition FX presets). `clearAnim` (a
// group RESET) also drops animation on the patched keys.
export function mergeLayerParams(show, layerId, patch, clearAnim = false) {
  return updateLayer(show, layerId, (layer) => {
    const next = { ...layer, params: { ...layer.params, ...patch } };
    if (clearAnim && layer.anim) { const anim = { ...layer.anim }; for (const k of Object.keys(patch)) delete anim[k]; next.anim = anim; }
    return next;
  });
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
  const list = (Array.isArray(clips) ? clips : []).filter(Boolean);   // skip deleted-slot holes
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

// An ISF EFFECT in a clip's chain: an object item { isf, params } (manifest effects
// are plain string names). It samples the chain below via the shader's inputImage.
export function makeISFEffect(isf) {
  const params = {};
  for (const p of isf.params || []) params[p.key] = p.default;
  return { isf, params };
}
export function addISFEffect(show, layerId, clipId, isf) {
  return updateClip(show, layerId, clipId, (clip) => ({
    ...clip, effects: [...(clip.effects || []), makeISFEffect(isf)],
  }));
}
// Set one param of the ISF effect at fxIndex (its params live on the effect item,
// keyed by input NAME — distinct from manifest effects' prefixed clip.params).
export function setClipEffectParam(show, layerId, clipId, fxIndex, key, value) {
  return updateClip(show, layerId, clipId, (clip) => {
    const effects = (clip.effects || []).slice();
    const item = effects[fxIndex];
    if (!item || !item.isf) return clip;
    effects[fxIndex] = { ...item, params: { ...item.params, [key]: value } };
    return { ...clip, effects };
  });
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
    blend: 'alpha',
    opacity: 0.5,
    clips: [clip],
    activeClipId: clip.id,
    effects: [],
    params: {},
    transitionMs: TRANSITION_MS,
  };
}

// Keep EXACTLY ONE empty layer, at the BOTTOM of the stack (deck index 0, since
// addLayer prepends) — there's always a fresh layer ready to drop a clip into, so
// no manual "+ layer" button is needed, and blank layers never pile up (extras
// from moving clips away are collapsed). Idempotent.
export function tidyEmptyLayers(show) {
  const comp = show?.composition;
  if (!comp) return show;
  const layers = Array.isArray(comp.layers) ? comp.layers : [];
  const isEmpty = (L) => L && (!L.clips || L.clips.filter(Boolean).length === 0);
  const empties = layers.filter(isEmpty);
  if (empties.length === 1 && isEmpty(layers[0])) return show;   // already exactly one, at the bottom
  const content = layers.filter((L) => !isEmpty(L));
  // Reuse an existing empty layer (keep its id) when there is one; else add one.
  if (empties.length) return { ...show, composition: { ...comp, layers: [empties[0], ...content] } };
  return addLayer({ ...show, composition: { ...comp, layers: content } });
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
    id, name: `Layer ${maxN + 1}`, blend: 'alpha', opacity: 0.5, transitionMs: TRANSITION_MS,
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
// --- Dashboard links (global modulation knobs) -------------------------------
export function setDashboardLinkValue(show, id, value) {
  return updateComp(show, (c) => {
    const links = (c.dashboard?.links || []).map((l) => (l.id === id ? { ...l, value: Math.max(0, Math.min(1, Number(value) || 0)) } : l));
    return { ...c, dashboard: { ...c.dashboard, links } };
  });
}
export function setDashboardLinkName(show, id, name) {
  return updateComp(show, (c) => {
    const links = (c.dashboard?.links || []).map((l) => (l.id === id ? { ...l, name: String(name || l.id) } : l));
    return { ...c, dashboard: { ...c.dashboard, links } };
  });
}
// (The dashboard is a fixed bank — links are not added or removed; see normDashboard.)
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
export function mergeCompositionParams(show, patch, clearAnim = false) {
  return updateComp(show, (c) => {
    const next = { ...c, params: { ...c.params, ...patch } };
    if (clearAnim && c.anim) { const anim = { ...c.anim }; for (const k of Object.keys(patch)) delete anim[k]; next.anim = anim; }
    return next;
  });
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
