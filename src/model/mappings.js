// Central control-mapping model — the data behind the Mapping window.
//
// Each row is a target with a canonical OSC address (always active) plus, where
// it makes sense, a MIDI binding and/or a KEY binding:
//  - PARAMETERS (clip source + transform): follow ONE channel via External
//    modulation. Continuous params take MIDI only (a key can't sweep a value);
//    boolean params can take MIDI or a key. id = `c|L|C|key`.
//  - ACTIONS (clip trigger, layer opacity, layer bypass): channel→action in
//    composition.bindings; triggers/bypass are on/off so they can take BOTH a
//    MIDI and a key (fire on either). ids: `t|L|C`, `lo|L`, `lb|L`.
//
// A channel is MIDI cc<n>/note<n>, a keyboard key:<code>, or any OSC/socket name.

import { getEntry } from '../engine/shaders/manifest.js';
import { setClipAnim, setActiveClip, patchLayer } from './layers.js';
import { makeExternalAnim } from './anim.js';
import { addressFor } from './osc-map.js';

const prettyKey = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const TF = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, scale: { min: 0, max: 3 }, rotation: { min: -180, max: 180 }, opacity: { min: 0, max: 1 } };
const chanOf = (spec) => (spec && spec.mode === 'external' ? spec.channel : null);
const isKeyChan = (c) => typeof c === 'string' && c.startsWith('key:');
const clamp01 = (v) => { v = Number(v) || 0; return v < 0 ? 0 : v > 1 ? 1 : v; };
const layerById = (show, id) => (show?.composition?.layers || []).find((L) => L.id === id) || null;

// Deck order: index 1 = top row = last array entry (mirrors osc-map / remote).
function deckLayers(show) { const ls = show?.composition?.layers || []; return ls.map((_, i) => ls[ls.length - 1 - i]); }

// One target's MIDI + KEY channels from its single param-anim channel.
function paramSlots(ch) { return { midi: isKeyChan(ch) ? null : (ch || null), key: isKeyChan(ch) ? ch : null }; }

// Every mappable target, grouped by layer·clip, with OSC + MIDI + key bindings.
export function listMappables(show) {
  const rows = [];
  const layers = deckLayers(show);
  const B = show?.composition?.bindings || {};
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]; if (!layer) continue;   // skip null layer holes
    const n = li + 1, clips = layer.clips || [];
    const lgroup = layer.name || 'Layer ' + n;
    rows.push({ id: `lo|${layer.id}`, kind: 'opacity', keyable: false, group: lgroup, label: 'Layer Opacity', osc: `/layer/${n}/opacity`, midi: B[`lo|${layer.id}`]?.midi || null, key: null, mode: 'absolute' });
    rows.push({ id: `lb|${layer.id}`, kind: 'bypass', keyable: true, group: lgroup, label: 'Layer Bypass', osc: `/layer/${n}/bypass`, midi: B[`lb|${layer.id}`]?.midi || null, key: B[`lb|${layer.id}`]?.key || null, mode: B[`lb|${layer.id}`]?.mode || 'toggle' });
    for (let ci = 0; ci < clips.length; ci++) {
      const m = ci + 1, clip = clips[ci];
      if (!clip) continue;
      const group = `${lgroup} · ${clip.name || clip.id}`;
      const tid = `t|${layer.id}|${clip.id}`;
      rows.push({ id: tid, kind: 'trigger', keyable: true, group, label: '▶ Trigger', osc: addressFor({ kind: 'trigger', layerIndex: n, clipIndex: m }), midi: B[tid]?.midi || null, key: B[tid]?.key || null, mode: 'trigger' });
      const entry = getEntry(clip.generator);
      for (const p of entry?.params || []) {
        if (p.type === 'color') continue;
        const animKey = entry.name + '.' + p.key;
        const ch = chanOf(clip.anim?.[animKey]);
        rows.push({ id: `c|${layer.id}|${clip.id}|${animKey}`, kind: 'param', keyable: p.type === 'bool', scope: 'clip', layerId: layer.id, clipId: clip.id, animKey,
          group, label: prettyKey(p.key), osc: addressFor({ kind: 'param', layerIndex: n, clipIndex: m, key: p.key }), min: p.min ?? 0, max: p.max ?? 1, ...paramSlots(ch) });
      }
      for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) {
        const animKey = 'tf.' + k, r = TF[k]; const ch = chanOf(clip.anim?.[animKey]);
        rows.push({ id: `c|${layer.id}|${clip.id}|${animKey}`, kind: 'param', keyable: false, scope: 'clip', layerId: layer.id, clipId: clip.id, animKey,
          group, label: prettyKey(k), osc: addressFor({ kind: 'tf', layerIndex: n, clipIndex: m, key: k }), min: r.min, max: r.max, ...paramSlots(ch) });
      }
    }
  }
  return rows;
}

function setActionBinding(show, id, patch) {
  const comp = show.composition || {};
  const cur = { ...(comp.bindings || {}) };
  if (patch === null) delete cur[id];
  else {
    const next = { ...(cur[id] || {}), ...patch };
    if (!next.midi && !next.key) delete cur[id]; else cur[id] = next;   // drop empty bindings
  }
  return { ...show, composition: { ...comp, bindings: cur } };
}

// Bind target `id`'s `slot` ('midi' | 'key') to `channel` (null clears that slot).
export function bindMapping(show, id, channel, slot) {
  const row = listMappables(show).find((r) => r.id === id);
  if (!row) return show;
  slot = slot || (isKeyChan(channel) ? 'key' : 'midi');
  if (channel && slot === 'key' && !row.keyable) return show;            // keys only on on/off targets
  if (row.kind === 'param') {                                            // one External channel (slot picks the column)
    return setClipAnim(show, row.layerId, row.clipId, row.animKey, channel ? makeExternalAnim(row.min, row.max, channel) : null);
  }
  if (!channel) return setActionBinding(show, id, { [slot]: undefined });
  const mode = id.startsWith('lb|') ? (show.composition?.bindings?.[id]?.mode || 'toggle') : id.startsWith('t|') ? 'trigger' : 'absolute';
  return setActionBinding(show, id, { [slot]: channel, mode });
}
export function clearMapping(show, id, slot) {
  const row = listMappables(show).find((r) => r.id === id);
  if (row && row.kind === 'param') return setClipAnim(show, row.layerId, row.clipId, row.animKey, null);
  if (!slot) return setActionBinding(show, id, null);
  return setActionBinding(show, id, { [slot]: undefined });
}
export function setMappingMode(show, id, mode) {
  if (!show.composition?.bindings?.[id]) return show;
  return setActionBinding(show, id, { mode });
}

// Apply action bindings for this frame (`channels`/`prev` = channel→value maps;
// prev = last frame, for rising-edge detection). Triggers/bypass fire on a rising
// edge of EITHER their MIDI or key channel. Returns { show, fired }.
export function applyBindings(show, channels, prev) {
  const bindings = show?.composition?.bindings;
  if (!bindings) return { show, fired: false };
  let s = show, fired = false;
  const val = (c) => clamp01(channels[c]);
  const rose = (c) => clamp01(prev?.[c]) < 0.5 && clamp01(channels[c]) >= 0.5;
  for (const id of Object.keys(bindings)) {
    const b = bindings[id]; const chans = [b.midi, b.key].filter(Boolean);
    if (!chans.length) continue;
    const [kind, lid, cid] = id.split('|');
    if (kind === 't') { if (chans.some(rose)) { s = setActiveClip(s, lid, cid); fired = true; } }
    else if (kind === 'lo') { const L = layerById(s, lid); const v = val(b.midi); if (L && b.midi && Math.abs((L.opacity ?? 1) - v) > 1e-4) s = patchLayer(s, lid, { opacity: v }); }
    else if (kind === 'lb') {
      const L = layerById(s, lid); if (!L) continue;
      if (b.mode === 'momentary') { const want = chans.some((c) => val(c) >= 0.5); if (!!L.bypass !== want) { s = patchLayer(s, lid, { bypass: want }); fired = true; } }
      else if (chans.some(rose)) { s = patchLayer(s, lid, { bypass: !L.bypass }); fired = true; }
    }
  }
  return { show: s, fired };
}
