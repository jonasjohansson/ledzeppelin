// Canonical OSC address map — EVERY parameter has a predictable, always-active
// address (Resolume-style). Controllers just send to it; no binding step.
// Incoming values are floats normalized 0..1 (clamped) and mapped onto the
// param's [min..max] from the manifest (bool: ≥0.5 = true). 1-BASED indices.
//
//   /layer/<n>/clip/<m>/<paramKey>                       clip SOURCE param
//   /layer/<n>/clip/<m>/tf/<x|y|scale|rotation|opacity>  clip transform
//   /layer/<n>/clip/<m>/trigger                          ≥0.5 activates the clip
//   /layer/<n>/opacity                                   layer opacity
//   /selected/<paramKey> · /selected/tf/<…>              the SELECTED clip (alias)
//
// Addresses that don't match the scheme return null and fall through to the
// existing external-channel store (the per-param binding model) untouched.

import { getEntry } from '../engine/shaders/manifest.js';
import { setClipParam, setClipTransform, setClipOpacity, patchLayer } from './layers.js';

// Transform ranges mirror the UI sliders (ui/layers.js Transform section).
const TF_RANGES = {
  x: { min: -1, max: 1 },
  y: { min: -1, max: 1 },
  scale: { min: 0, max: 3 },
  rotation: { min: -180, max: 180 },
  opacity: { min: 0, max: 1 },
};

// 1-based layer index in DECK order: /layer/1 is the TOP deck row, which is the
// LAST entry of composition.layers (the deck renders array-end first, and new
// layers prepend = bottom — so existing layers keep their numbers).
function layerAt(show, n) {
  const layers = show?.composition?.layers || [];
  if (!Number.isInteger(n) || n < 1 || n > layers.length) return null;
  return layers[layers.length - n];
}

// The canonical address string for a param the UI is rendering (indices known
// at render time). kind: 'param' | 'tf' | 'trigger' | 'layerOpacity'.
export function addressFor({ kind, layerIndex, clipIndex, key }) {
  if (kind === 'layerOpacity') return `/layer/${layerIndex}/opacity`;
  if (kind === 'trigger') return `/layer/${layerIndex}/clip/${clipIndex}/trigger`;
  if (kind === 'tf') return `/layer/${layerIndex}/clip/${clipIndex}/tf/${key}`;
  return `/layer/${layerIndex}/clip/${clipIndex}/${key}`;
}

// Route a clip-scoped tail (['<paramKey>'] | ['tf','<k>'] | ['trigger']) onto
// the resolved layer+clip. `v` is already clamped 0..1.
function routeClip(show, layer, clip, tail, v) {
  if (tail.length === 1 && tail[0] === 'trigger') {
    // ≥0.5 fires (button down); the release (<0.5) is consumed as a no-op so it
    // doesn't leak into the channel store.
    return v >= 0.5 ? { trigger: { layerId: layer.id, clipId: clip.id } } : { show };
  }
  if (tail.length === 2 && tail[0] === 'tf') {
    const r = TF_RANGES[tail[1]];
    if (!r) return null;
    const mapped = r.min + (r.max - r.min) * v;
    if (tail[1] === 'opacity') return { show: setClipOpacity(show, layer.id, clip.id, mapped) };
    return { show: setClipTransform(show, layer.id, clip.id, { [tail[1]]: mapped }) };
  }
  if (tail.length === 1) {
    // A SOURCE param by manifest key, mapped onto THIS clip's generator's range.
    const entry = getEntry(clip.generator);
    const p = entry?.params?.find((q) => q.key === tail[0]);
    if (!p) return null;
    const key = entry.name + '.' + p.key;
    if (p.type === 'bool') return { show: setClipParam(show, layer.id, clip.id, key, v >= 0.5) };
    if (p.type === 'color') return null;   // one float can't address a colour
    const min = p.min ?? 0, max = p.max ?? 1;
    return { show: setClipParam(show, layer.id, clip.id, key, min + (max - min) * v) };
  }
  return null;
}

// Try `address` against the canonical scheme. Returns
//   { show }    — a model-only state change (possibly the same reference = no-op)
//   { trigger } — { layerId, clipId } the caller should activate
//   null        — not canonical; fall through to the channel store.
export function routeOsc(show, selectedClipId, address, value) {
  if (typeof address !== 'string' || address[0] !== '/') return null;
  const v = Math.max(0, Math.min(1, Number(value)));
  if (!Number.isFinite(v)) return null;
  const parts = address.slice(1).split('/');

  if (parts[0] === 'selected') {
    // Alias for the SELECTED clip — resolved at message time, so a controller
    // page can always drive "whatever I'm editing".
    const layers = show?.composition?.layers || [];
    const layer = layers.find((L) => (L.clips || []).some((c) => c.id === selectedClipId));
    const clip = layer?.clips.find((c) => c.id === selectedClipId);
    if (!clip) return null;
    return routeClip(show, layer, clip, parts.slice(1), v);
  }

  if (parts[0] === 'layer') {
    const layer = layerAt(show, Number(parts[1]));
    if (!layer) return null;
    if (parts.length === 3 && parts[2] === 'opacity') {
      return { show: patchLayer(show, layer.id, { opacity: v }) };
    }
    // Master "Block" (B): bypass/un-bypass the layer (≥0.5 = bypassed/muted).
    if (parts.length === 3 && parts[2] === 'bypass') {
      return { show: patchLayer(show, layer.id, { bypass: v >= 0.5 }) };
    }
    if (parts[2] === 'clip') {
      const m = Number(parts[3]);
      const clip = Number.isInteger(m) && m >= 1 ? (layer.clips || [])[m - 1] : null;
      if (!clip) return null;
      return routeClip(show, layer, clip, parts.slice(4), v);
    }
  }
  return null;
}
