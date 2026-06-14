// Central control-mapping model — the data behind the Mappings window. Every
// mappable target is a clip parameter (source params + transform/opacity); each
// has a canonical OSC address (always active) and can additionally FOLLOW a
// channel (MIDI cc<n>/note<n>, a keyboard key:<code>, or any OSC/socket channel)
// via its External modulation. "Mapping" = binding that External channel.
//
// IDs are layer/clip/key based (stable across deck reordering) so bindMapping can
// locate the exact target: `c|<layerId>|<clipId>|<animKey>`.

import { getEntry } from '../engine/shaders/manifest.js';
import { setClipAnim } from './layers.js';
import { makeExternalAnim } from './anim.js';
import { addressFor } from './osc-map.js';

const prettyKey = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const TF = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, scale: { min: 0, max: 3 }, rotation: { min: -180, max: 180 }, opacity: { min: 0, max: 1 } };
const chanOf = (spec) => (spec && spec.mode === 'external' ? spec.channel : null);

// Deck order: index 1 = top row = last array entry (mirrors osc-map / remote).
function deckLayers(show) { const ls = show?.composition?.layers || []; return ls.map((_, i) => ls[ls.length - 1 - i]); }

// Every bindable clip parameter, grouped by layer·clip, with its OSC address and
// current bound channel (null if none). Holes (deleted slots) are skipped.
export function listMappables(show) {
  const rows = [];
  const layers = deckLayers(show);
  for (let li = 0; li < layers.length; li++) {
    const n = li + 1, layer = layers[li], clips = layer.clips || [];
    for (let ci = 0; ci < clips.length; ci++) {
      const m = ci + 1, clip = clips[ci];
      if (!clip) continue;
      const group = `${layer.name || 'Layer ' + n} · ${clip.name || clip.id}`;
      const entry = getEntry(clip.generator);
      for (const p of entry?.params || []) {
        if (p.type === 'color') continue;   // a single channel can't drive a colour
        const animKey = entry.name + '.' + p.key;
        rows.push({
          id: `c|${layer.id}|${clip.id}|${animKey}`, scope: 'clip', layerId: layer.id, clipId: clip.id, animKey,
          group, label: prettyKey(p.key), osc: addressFor({ kind: 'param', layerIndex: n, clipIndex: m, key: p.key }),
          min: p.min ?? 0, max: p.max ?? 1, channel: chanOf(clip.anim?.[animKey]),
        });
      }
      for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) {
        const animKey = 'tf.' + k, r = TF[k];
        rows.push({
          id: `c|${layer.id}|${clip.id}|${animKey}`, scope: 'clip', layerId: layer.id, clipId: clip.id, animKey,
          group, label: prettyKey(k), osc: addressFor({ kind: 'tf', layerIndex: n, clipIndex: m, key: k }),
          min: r.min, max: r.max, channel: chanOf(clip.anim?.[animKey]),
        });
      }
    }
  }
  return rows;
}

// Bind target `id` to follow `channel` (or clear when channel is falsy). The
// External sweep maps the channel's 0..1 onto the param's full range.
export function bindMapping(show, id, channel) {
  const row = listMappables(show).find((r) => r.id === id);
  if (!row) return show;
  const spec = channel ? makeExternalAnim(row.min, row.max, channel) : null;
  return setClipAnim(show, row.layerId, row.clipId, row.animKey, spec);
}
export function clearMapping(show, id) { return bindMapping(show, id, null); }
