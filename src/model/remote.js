// Companion remote — the curated set of controls exposed to the phone app.
//
// The MAIN editor tags individual parameters (via the ⚙ modulator menu's
// "Companion" tick) to publish them to a lightweight phone page anyone on the
// network can open. The phone ALSO always gets the MASTER controls — every
// layer's opacity + bypass ("B") and the clip-trigger grid — so it works as a
// speed-dial even before anything is ticked.
//
// Exposed custom params live in show.remote.controls as an ORDERED list of
// canonical OSC addresses (see osc-map.js). The phone drives everything by
// sending those addresses back through the same channel relay → routeOsc, so
// there is no separate command protocol.

import { getEntry } from '../engine/shaders/manifest.js';

// Title-case a manifest key for display ('headWidth' → 'Head Width').
const prettyKey = (k) => String(k)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/^./, (c) => c.toUpperCase());

const TF_RANGES = {
  x: { min: -1, max: 1 }, y: { min: -1, max: 1 },
  scale: { min: 0, max: 3 }, rotation: { min: -180, max: 180 }, opacity: { min: 0, max: 1 },
};

// Layers in DECK order (index 1 = top row = last array entry), mirroring
// osc-map.js so the addresses line up.
function deckLayers(show) {
  const layers = show?.composition?.layers || [];
  return layers.map((_, i) => layers[layers.length - 1 - i]); // [top, …, bottom]
}

// Is `address` currently exposed to the companion?
export function hasRemoteControl(show, address) {
  return !!(show?.remote?.controls || []).includes(address);
}

// Toggle a canonical address in/out of the exposed set (immutable). Appends to
// the end so the phone order follows the order things were ticked.
export function toggleRemoteControl(show, address) {
  const cur = show?.remote?.controls || [];
  const next = cur.includes(address) ? cur.filter((a) => a !== address) : [...cur, address];
  return { ...show, remote: { ...(show?.remote || {}), controls: next } };
}

// Walk the show and index every addressable custom param → its display entry.
// (Source params + transform params; triggers/opacity/bypass are master, handled
// separately on the phone.)
function indexParams(show) {
  const map = new Map();
  const layers = deckLayers(show);
  for (let li = 0; li < layers.length; li++) {
    const n = li + 1, layer = layers[li];
    const clips = layer.clips || [];
    for (let ci = 0; ci < clips.length; ci++) {
      const m = ci + 1, clip = clips[ci];
      if (!clip) continue;   // deleted slot (hole)
      const entry = getEntry(clip.generator);
      for (const p of entry?.params || []) {
        if (p.type === 'color') continue;        // a single float can't drive a colour
        const key = entry.name + '.' + p.key;
        const min = p.min ?? 0, max = p.max ?? 1;
        const value = clip.params?.[key] ?? p.default ?? min;
        map.set(`/layer/${n}/clip/${m}/${p.key}`, {
          label: `${clip.name || clip.id} · ${prettyKey(p.key)}`,
          kind: p.type === 'bool' ? 'bool' : 'param', min, max, value, def: p.default ?? min,
        });
      }
      const t = clip.transform || {};
      for (const k of ['x', 'y', 'scale', 'rotation']) {
        const r = TF_RANGES[k], dflt = k === 'scale' ? 1 : 0;
        map.set(`/layer/${n}/clip/${m}/tf/${k}`, {
          label: `${clip.name || clip.id} · ${prettyKey(k)}`, kind: 'param', min: r.min, max: r.max,
          value: t[k] ?? dflt, def: dflt,
        });
      }
      map.set(`/layer/${n}/clip/${m}/tf/opacity`, {
        label: `${clip.name || clip.id} · Opacity`, kind: 'param', min: 0, max: 1, value: clip.opacity ?? 1, def: 1,
      });
    }
  }
  return map;
}

// The full manifest the editor broadcasts to the phone:
//   master: every layer's opacity + bypass and its clips (for the trigger grid)
//   controls: the ticked custom params, in tick order, resolved to label/range
// `thumbs` (optional, generator → dataURL) lets the phone show deck-style clip
// thumbnails; the in-editor Control pane doesn't need them.
export function buildRemoteManifest(show, thumbs) {
  const layers = deckLayers(show);
  const master = layers
    .map((layer, li) => ({
      n: li + 1,
      name: layer.name || `Layer ${li + 1}`,
      opacity: layer.opacity ?? 1,
      bypass: !!layer.bypass,
      // 1-based slot index `m` stays stable across holes; holes (deleted slots)
      // aren't sent to the phone.
      clips: (layer.clips || []).map((c, ci) => (c ? {
        m: ci + 1, name: c.name || c.id, active: c.id === layer.activeClipId,
        thumb: thumbs?.[c.generator] || null,
      } : null)).filter(Boolean),
    }))
    .filter((L) => L.clips.length);   // the phone skips layers with no clips

  const idx = indexParams(show);
  const controls = (show?.remote?.controls || [])
    .map((address) => { const e = idx.get(address); return e ? { address, ...e } : null; })
    .filter(Boolean);
  return { layers: master, controls };
}
