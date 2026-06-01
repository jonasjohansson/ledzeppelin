// Pure, immutable helpers for editing composition layers (Task 3.4 UI half).
//
// These operate on a `layers` array (show.composition.layers) and always return
// a NEW array (and new layer objects where mutated) so callers can swap it in
// without aliasing. They never touch GL or persistence — that's the panel's job.
//
// Param namespacing matches the compositor: keys are `'<name>.<key>'`
// (e.g. 'line.pos', 'displace.amt'). See engine/compositor.js.

import { defaultParams, generatorNames } from '../engine/shaders/manifest.js';

// Prefix a flat { key: value } default map with the entry name → { 'name.key': value }.
export function prefixedDefaults(name) {
  const out = {};
  const d = defaultParams(name);
  for (const k of Object.keys(d)) out[name + '.' + k] = d[k];
  return out;
}

// A fresh default layer: first generator, no effects, add/opacity 1, seeded params.
export function makeLayer(id) {
  const generator = generatorNames()[0] || 'line';
  return {
    id,
    generator,
    effects: [],
    blend: 'add',
    opacity: 1,
    params: prefixedDefaults(generator),
  };
}

// Append a new default layer. `existing` is used only to derive a unique id.
export function addLayer(layers) {
  const n = layers.length + 1;
  const used = new Set(layers.map((l) => l.id));
  let id = 'l' + n, i = n;
  while (used.has(id)) id = 'l' + (++i);
  return [...layers, makeLayer(id)];
}

export function removeLayer(layers, index) {
  if (index < 0 || index >= layers.length) return layers;
  return layers.filter((_, i) => i !== index);
}

// Move the layer at `index` by `delta` positions (clamped). Returns a new array.
export function moveLayer(layers, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= layers.length || to < 0 || to >= layers.length) return layers;
  const next = layers.slice();
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

// Shallow patch a single layer immutably.
export function patchLayer(layers, index, patch) {
  if (index < 0 || index >= layers.length) return layers;
  return layers.map((l, i) => (i === index ? { ...l, ...patch } : l));
}

// Set a single param key on a layer immutably.
export function setLayerParam(layers, index, key, value) {
  if (index < 0 || index >= layers.length) return layers;
  return layers.map((l, i) =>
    i === index ? { ...l, params: { ...l.params, [key]: value } } : l);
}

// Change a layer's generator: reset the generator's params to defaults but KEEP
// effect params (anything whose key prefix is one of the layer's effects). The
// old generator's params are dropped.
export function changeGenerator(layers, index, generator) {
  if (index < 0 || index >= layers.length) return layers;
  const layer = layers[index];
  const effectSet = new Set(layer.effects || []);
  const kept = {};
  for (const k of Object.keys(layer.params || {})) {
    const pfx = k.split('.')[0];
    if (effectSet.has(pfx)) kept[k] = layer.params[k];
  }
  const params = { ...kept, ...prefixedDefaults(generator) };
  return patchLayer(layers, index, { generator, params });
}

// Add an effect to a layer's chain and seed its default params (prefixed).
export function addEffect(layers, index, name) {
  if (index < 0 || index >= layers.length) return layers;
  const layer = layers[index];
  const effects = [...(layer.effects || []), name];
  const params = { ...layer.params, ...prefixedDefaults(name) };
  return patchLayer(layers, index, { effects, params });
}

// Remove the effect at `fxIndex` from a layer. Its params are dropped ONLY if no
// other remaining effect shares that name (effects can repeat).
export function removeEffect(layers, index, fxIndex) {
  if (index < 0 || index >= layers.length) return layers;
  const layer = layers[index];
  const effects = (layer.effects || []).slice();
  if (fxIndex < 0 || fxIndex >= effects.length) return layers;
  const [removed] = effects.splice(fxIndex, 1);
  let params = layer.params;
  if (!effects.includes(removed)) {
    params = {};
    for (const k of Object.keys(layer.params || {})) {
      if (k.split('.')[0] !== removed) params[k] = layer.params[k];
    }
  }
  return patchLayer(layers, index, { effects, params });
}

// Reorder an effect within a layer's chain by `delta` positions (clamped).
export function moveEffect(layers, index, fxIndex, delta) {
  if (index < 0 || index >= layers.length) return layers;
  const layer = layers[index];
  const effects = (layer.effects || []).slice();
  const to = fxIndex + delta;
  if (fxIndex < 0 || fxIndex >= effects.length || to < 0 || to >= effects.length) return layers;
  const [item] = effects.splice(fxIndex, 1);
  effects.splice(to, 0, item);
  return patchLayer(layers, index, { effects });
}
