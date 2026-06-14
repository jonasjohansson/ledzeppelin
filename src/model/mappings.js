// Central control-mapping model — the data behind the Mapping window.
//
// TWO kinds of mappable target:
//  - PARAMETERS (clip source + transform): bound by making the param FOLLOW a
//    channel via its External modulation (continuous/absolute). id = `c|L|C|key`.
//  - ACTIONS (clip trigger, layer opacity, layer bypass): bound as channel →
//    action in composition.bindings, applied each frame by applyBindings(). ids:
//    `t|L|C` (trigger), `lo|L` (layer opacity), `lb|L` (layer bypass).
//
// A channel is MIDI cc<n>/note<n>, a keyboard key:<code>, or any OSC/socket name.

import { getEntry } from '../engine/shaders/manifest.js';
import { setClipAnim, setActiveClip, patchLayer } from './layers.js';
import { makeExternalAnim } from './anim.js';
import { addressFor } from './osc-map.js';

const prettyKey = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const TF = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, scale: { min: 0, max: 3 }, rotation: { min: -180, max: 180 }, opacity: { min: 0, max: 1 } };
const chanOf = (spec) => (spec && spec.mode === 'external' ? spec.channel : null);
const clamp01 = (v) => { v = Number(v) || 0; return v < 0 ? 0 : v > 1 ? 1 : v; };
const layerById = (show, id) => (show?.composition?.layers || []).find((L) => L.id === id) || null;

// Deck order: index 1 = top row = last array entry (mirrors osc-map / remote).
function deckLayers(show) { const ls = show?.composition?.layers || []; return ls.map((_, i) => ls[ls.length - 1 - i]); }

// Every mappable target, grouped by layer·clip, with OSC address + current binding.
export function listMappables(show) {
  const rows = [];
  const layers = deckLayers(show);
  const bindings = show?.composition?.bindings || {};
  for (let li = 0; li < layers.length; li++) {
    const n = li + 1, layer = layers[li], clips = layer.clips || [];
    const lgroup = layer.name || 'Layer ' + n;
    // Layer master actions.
    rows.push({ id: `lo|${layer.id}`, kind: 'opacity', group: lgroup, label: 'Layer Opacity', osc: `/layer/${n}/opacity`, channel: bindings[`lo|${layer.id}`]?.channel || null, mode: 'absolute' });
    rows.push({ id: `lb|${layer.id}`, kind: 'bypass', group: lgroup, label: 'Layer Bypass', osc: `/layer/${n}/bypass`, channel: bindings[`lb|${layer.id}`]?.channel || null, mode: bindings[`lb|${layer.id}`]?.mode || 'toggle' });
    for (let ci = 0; ci < clips.length; ci++) {
      const m = ci + 1, clip = clips[ci];
      if (!clip) continue;
      const group = `${lgroup} · ${clip.name || clip.id}`;
      // Clip trigger (fire the clip).
      rows.push({ id: `t|${layer.id}|${clip.id}`, kind: 'trigger', group, label: '▶ Trigger', osc: addressFor({ kind: 'trigger', layerIndex: n, clipIndex: m }), channel: bindings[`t|${layer.id}|${clip.id}`]?.channel || null, mode: 'trigger' });
      const entry = getEntry(clip.generator);
      for (const p of entry?.params || []) {
        if (p.type === 'color') continue;
        const animKey = entry.name + '.' + p.key;
        rows.push({ id: `c|${layer.id}|${clip.id}|${animKey}`, kind: 'param', scope: 'clip', layerId: layer.id, clipId: clip.id, animKey,
          group, label: prettyKey(p.key), osc: addressFor({ kind: 'param', layerIndex: n, clipIndex: m, key: p.key }),
          min: p.min ?? 0, max: p.max ?? 1, channel: chanOf(clip.anim?.[animKey]) });
      }
      for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) {
        const animKey = 'tf.' + k, r = TF[k];
        rows.push({ id: `c|${layer.id}|${clip.id}|${animKey}`, kind: 'param', scope: 'clip', layerId: layer.id, clipId: clip.id, animKey,
          group, label: prettyKey(k), osc: addressFor({ kind: 'tf', layerIndex: n, clipIndex: m, key: k }),
          min: r.min, max: r.max, channel: chanOf(clip.anim?.[animKey]) });
      }
    }
  }
  return rows;
}

// --- binding (param via External anim; action via composition.bindings) -------
function setActionBinding(show, id, patch) {
  const comp = show.composition || {};
  const bindings = { ...(comp.bindings || {}) };
  if (patch === null) delete bindings[id]; else bindings[id] = { ...(bindings[id] || {}), ...patch };
  return { ...show, composition: { ...comp, bindings } };
}

export function bindMapping(show, id, channel) {
  if (id.startsWith('c|')) {
    const row = listMappables(show).find((r) => r.id === id);
    if (!row) return show;
    return setClipAnim(show, row.layerId, row.clipId, row.animKey, channel ? makeExternalAnim(row.min, row.max, channel) : null);
  }
  if (!channel) return setActionBinding(show, id, null);
  const mode = id.startsWith('lb|') ? (show.composition?.bindings?.[id]?.mode || 'toggle') : id.startsWith('t|') ? 'trigger' : 'absolute';
  return setActionBinding(show, id, { channel, mode });
}
export function clearMapping(show, id) {
  if (id.startsWith('c|')) return bindMapping(show, id, null);
  return setActionBinding(show, id, null);
}
// Bypass binding can be toggle (flip on press) or momentary (held).
export function setMappingMode(show, id, mode) {
  if (!show.composition?.bindings?.[id]) return show;
  return setActionBinding(show, id, { mode });
}

// Apply the action bindings for this frame. `channels`/`prev` are channel→value
// maps (prev = last frame, for rising-edge detection). Returns { show, fired }
// where fired flags a structural change (trigger / bypass toggle) so the caller
// can refresh the deck UI; continuous opacity does not set it.
export function applyBindings(show, channels, prev) {
  const bindings = show?.composition?.bindings;
  if (!bindings) return { show, fired: false };
  let s = show, fired = false;
  for (const id of Object.keys(bindings)) {
    const b = bindings[id]; if (!b?.channel) continue;
    const v = clamp01(channels[b.channel]), pv = clamp01(prev?.[b.channel]);
    const rising = pv < 0.5 && v >= 0.5;
    const [kind, lid, cid] = id.split('|');
    if (kind === 't') { if (rising) { s = setActiveClip(s, lid, cid); fired = true; } }
    else if (kind === 'lo') { const L = layerById(s, lid); if (L && Math.abs((L.opacity ?? 1) - v) > 1e-4) s = patchLayer(s, lid, { opacity: v }); }
    else if (kind === 'lb') {
      const L = layerById(s, lid); if (!L) continue;
      if (b.mode === 'momentary') { const want = v >= 0.5; if (!!L.bypass !== want) { s = patchLayer(s, lid, { bypass: want }); fired = true; } }
      else if (rising) { s = patchLayer(s, lid, { bypass: !L.bypass }); fired = true; }
    }
  }
  return { show: s, fired };
}
