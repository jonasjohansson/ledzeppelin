// Layer-stack UI (Task 3.4). Mirrors fixtures.js conventions/style.
//
// createLayerPanel({ getShow, setShow, onChange }) → { el, refresh() }
//   getShow():   returns the current show
//   setShow(s):  persist the composition-only edit (NO sampler/geometry rebuild)
//   onChange():  optional, called after every edit (e.g. to refresh siblings)
//
// "TOP" CONVENTION: the compositor (engine/compositor.js) iterates
// show.composition.layers in array order and blits each onto the accumulator, so
// the LAST array element renders ON TOP. This panel lists layers visually
// top-first: the topmost card is the last array element (renders on top), the
// bottom card is index 0 (the base layer). "up" in the UI moves a layer toward
// the front (higher array index); "down" moves it toward the back.

import {
  generatorNames, effectNames, getEntry,
} from '../engine/shaders/manifest.js';
import {
  addLayer, removeLayer, moveLayer, patchLayer, setLayerParam,
  changeGenerator, addEffect, removeEffect, moveEffect,
} from '../model/layers.js';

const BLEND_MODES = ['add', 'screen', 'multiply', 'alpha'];

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};

const selectInput = (options, value, onInput) => {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', { value: o.value ?? o, textContent: o.label ?? o });
    if ((o.value ?? o) === value) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => onInput(s.value));
  return s;
};

const field = (label, control) =>
  el('label', { className: 'fx-field' }, [el('span', { textContent: label }), control]);

// A range slider with a live numeric readout, writing back on input.
const sliderField = (label, value, min, max, onInput) => {
  const step = (max - min) <= 2 ? 0.001 : (max - min) <= 50 ? 0.01 : 1;
  const out = el('span', { className: 'ly-readout', textContent: fmt(value) });
  const range = el('input', {
    type: 'range', min: String(min), max: String(max),
    step: String(step), value: String(value ?? 0),
  });
  range.addEventListener('input', () => {
    const v = Number(range.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  const head = el('span', { className: 'ly-pkey' }, [
    el('span', { textContent: label }), out,
  ]);
  return el('label', { className: 'fx-field ly-param' }, [head, range]);
};

const fmt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

// Build a control for one manifest param, defensive about future types.
function paramControl(p, value, onInput) {
  if (p.type === 'color') {
    const i = el('input', { type: 'color', value: value || '#ffffff' });
    i.addEventListener('input', () => onInput(i.value));
    return field(p.key, i);
  }
  if (p.type === 'bool') {
    const i = el('input', { type: 'checkbox', checked: !!value });
    i.addEventListener('change', () => onInput(i.checked));
    return field(p.key, i);
  }
  // float (and unknown → treat as numeric slider)
  const min = p.min ?? 0, max = p.max ?? 1;
  const v = value == null ? (p.default ?? min) : value;
  return sliderField(p.key, v, min, max, onInput);
}

// createLayerPanel({ getShow, setShow, onChange })
export function createLayerPanel({ getShow, setShow, onChange }) {
  const root = el('div', { className: 'fx-panel ly-panel' });

  // Persist a new layers array (composition-only edit — no geometry rebuild).
  function commit(layers) {
    const show = getShow();
    const next = structuredClone(show);
    next.composition = next.composition || {};
    next.composition.layers = layers;
    setShow(next);
    onChange?.();
    render();
  }

  const layersOf = () => getShow().composition?.layers || [];

  function render() {
    root.textContent = '';
    root.append(el('div', { className: 'fx-title', textContent: 'Layers' }));
    root.append(el('div', { className: 'ly-hint', textContent: 'top of list = rendered on top' }));

    const layers = layersOf();
    const genOpts = generatorNames();
    const fxOpts = effectNames();

    // Display top-first: last array element at the top of the panel.
    for (let disp = layers.length - 1; disp >= 0; disp--) {
      const i = disp;
      const layer = layers[i];
      root.append(layerCard(layer, i, layers.length, genOpts, fxOpts));
    }

    root.append(el('button', {
      className: 'fx-add', textContent: '+ layer',
      onclick: () => commit(addLayer(layersOf())),
    }));
  }

  function layerCard(layer, i, count, genOpts, fxOpts) {
    const card = el('div', { className: 'fx-card ly-card' });

    // Header: title + reorder/delete.
    const isTop = i === count - 1, isBottom = i === 0;
    const head = el('div', { className: 'ly-head' }, [
      el('span', { className: 'ly-name', textContent: layer.id || `layer ${i}` }),
    ]);
    const ctrls = el('div', { className: 'ly-btns' });
    ctrls.append(
      el('button', { textContent: '▲', title: 'move up (toward front)', disabled: isTop,
        onclick: () => commit(moveLayer(layersOf(), i, +1)) }),
      el('button', { textContent: '▼', title: 'move down (toward back)', disabled: isBottom,
        onclick: () => commit(moveLayer(layersOf(), i, -1)) }),
    );
    head.append(ctrls);
    card.append(head);

    // Generator / blend / opacity.
    card.append(field('generator', selectInput(genOpts, layer.generator,
      (x) => commit(changeGenerator(layersOf(), i, x)))));
    card.append(field('blend', selectInput(BLEND_MODES, layer.blend ?? 'add',
      (x) => commit(patchLayer(layersOf(), i, { blend: x })))));
    card.append(sliderField('opacity', layer.opacity == null ? 1 : layer.opacity, 0, 1,
      (v) => commit(patchLayer(layersOf(), i, { opacity: v }))));

    // Generator params (auto-generated from manifest).
    const gen = getEntry(layer.generator);
    if (gen && gen.params.length) {
      card.append(el('div', { className: 'fx-pts', textContent: `${gen.name} params` }));
      for (const p of gen.params) {
        const key = gen.name + '.' + p.key;
        card.append(paramControl(p, layer.params?.[key],
          (v) => commit(setLayerParam(layersOf(), i, key, v))));
      }
    }

    // Effects chain.
    card.append(el('div', { className: 'fx-pts', textContent: 'effects' }));
    const effects = layer.effects || [];
    for (let fx = 0; fx < effects.length; fx++) {
      card.append(effectBlock(layer, i, fx, effects, fxOpts));
    }
    card.append(el('div', { className: 'ly-addfx' }, [
      selectInput([{ value: '', label: '+ add effect…' }, ...fxOpts], '', (x) => {
        if (x) commit(addEffect(layersOf(), i, x));
      }),
    ]));

    // Delete layer.
    card.append(el('button', {
      className: 'fx-del', textContent: 'delete layer',
      onclick: () => commit(removeLayer(layersOf(), i)),
    }));
    return card;
  }

  function effectBlock(layer, i, fx, effects, fxOpts) {
    const name = effects[fx];
    const entry = getEntry(name);
    const block = el('div', { className: 'ly-fx' });

    const head = el('div', { className: 'ly-fxhead' }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${name}` }),
    ]);
    const btns = el('div', { className: 'ly-btns' });
    btns.append(
      el('button', { textContent: '▲', title: 'effect earlier', disabled: fx === 0,
        onclick: () => commit(moveEffect(layersOf(), i, fx, -1)) }),
      el('button', { textContent: '▼', title: 'effect later', disabled: fx === effects.length - 1,
        onclick: () => commit(moveEffect(layersOf(), i, fx, +1)) }),
      el('button', { textContent: '✕', title: 'remove effect', className: 'ly-rmfx',
        onclick: () => commit(removeEffect(layersOf(), i, fx)) }),
    );
    head.append(btns);
    block.append(head);

    if (entry) {
      for (const p of entry.params) {
        const key = entry.name + '.' + p.key;
        block.append(paramControl(p, layer.params?.[key],
          (v) => commit(setLayerParam(layersOf(), i, key, v))));
      }
    }
    return block;
  }

  render();
  return { el: root, refresh: render };
}
