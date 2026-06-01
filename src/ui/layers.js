// Clip-deck layer UI (Task 4 — "Resolume clips"). Reworks the old single-
// generator-per-layer panel into a clip deck: each layer holds a deck of clips,
// one of which is ACTIVE ("playing"); clicking a clip triggers it (the
// compositor crossfades over the layer's transitionMs). You edit whichever clip
// is active. Clip effects live on the active clip; layer effects apply to the
// whole layer — the schema's param split made visible.
//
// createLayerPanel({ getShow, setShow, onChange }) → { el, refresh() }
//   getShow():   returns the current show
//   setShow(s):  persist the (whole) edited show (composition-only — no rebuild)
//   onChange():  optional, called after every edit
//
// "TOP" CONVENTION (unchanged): the compositor iterates
// show.composition.layers in array order, blitting each onto the accumulator, so
// the LAST array element renders ON TOP. This panel lists layers visually
// top-first: the topmost card is the last array element. "▲" moves a layer
// toward the front (higher array index); "▼" toward the back.
//
// All edits go through the id-based model helpers (which take the WHOLE show and
// return a NEW show), then through setShow — immutability is preserved end to end.

import {
  generatorNames, effectNames, getEntry,
} from '../engine/shaders/manifest.js';
import {
  addLayer, removeLayer, moveLayer, patchLayer, setLayerParam,
  addLayerEffect, removeLayerEffect, moveLayerEffect,
  addClip, removeClip, moveClip, setActiveClip, changeClipGenerator,
  setClipParam, addClipEffect, removeClipEffect, moveClipEffect,
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

const fmt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

// A range slider with a live numeric readout, writing back on every input.
// The readout updates locally so slider drags do not require a re-render.
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

// Build a control for one manifest param, defensive about future types.
// Slider/number drags call onInput live (no re-render) — only the readout
// changes in place, so focus is never lost. Structural edits re-render.
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

  // Persist a whole new show (composition-only edit — no geometry rebuild) and
  // re-render. Helpers return the SAME show reference on no-op edits; we still
  // call setShow (cheap) so the contract stays simple. Used for STRUCTURAL edits
  // (add/remove/reorder, trigger, generator change) which require a re-render.
  function commit(nextShow) {
    setShow(nextShow);
    onChange?.();
    render();
  }

  // LIVE edit: persist without re-rendering (so a focused slider keeps focus).
  // Used for param slider/number/color/bool drags — the compositor reads
  // show.composition.layers each frame, so the change is visible immediately.
  function commitLive(nextShow) {
    setShow(nextShow);
    onChange?.();
  }

  const show = () => getShow();
  const layersOf = () => getShow().composition?.layers || [];

  function render() {
    root.textContent = '';
    root.append(el('div', { className: 'fx-title', textContent: 'Layers' }));
    root.append(el('div', { className: 'ly-hint', textContent: 'top of list = rendered on top' }));

    const layers = layersOf();
    const genOpts = generatorNames();
    const fxOpts = effectNames();

    // Display top-first: last array element at the top of the panel.
    for (let i = layers.length - 1; i >= 0; i--) {
      root.append(layerCard(layers[i], i, layers.length, genOpts, fxOpts));
    }

    root.append(el('button', {
      className: 'fx-add', textContent: '+ layer',
      onclick: () => commit(addLayer(show())),
    }));
  }

  function layerCard(layer, i, count, genOpts, fxOpts) {
    const card = el('div', { className: 'fx-card ly-card' });
    const id = layer.id;

    // --- header: editable name + reorder/delete --------------------------
    const isTop = i === count - 1, isBottom = i === 0;
    const nameInput = el('input', {
      className: 'ly-nameedit', value: layer.name ?? layer.id ?? `layer ${i}`,
      title: 'layer name',
    });
    nameInput.addEventListener('change',
      () => commit(patchLayer(show(), id, { name: nameInput.value })));
    const ctrls = el('div', { className: 'ly-btns' });
    ctrls.append(
      el('button', { textContent: '▲', title: 'move up (toward front)', disabled: isTop,
        onclick: () => commit(moveLayer(show(), id, +1)) }),
      el('button', { textContent: '▼', title: 'move down (toward back)', disabled: isBottom,
        onclick: () => commit(moveLayer(show(), id, -1)) }),
      el('button', { textContent: '✕', title: 'delete layer', className: 'ly-rmfx',
        onclick: () => commit(removeLayer(show(), id)) }),
    );
    card.append(el('div', { className: 'ly-head' }, [nameInput, ctrls]));

    // --- blend / opacity / transition ------------------------------------
    card.append(field('blend', selectInput(BLEND_MODES, layer.blend ?? 'add',
      (x) => commit(patchLayer(show(), id, { blend: x })))));
    card.append(sliderField('opacity', layer.opacity == null ? 1 : layer.opacity, 0, 1,
      (v) => commitLive(patchLayer(show(), id, { opacity: v }))));
    card.append(sliderField('transition (ms)', layer.transitionMs ?? 500, 0, 5000,
      (v) => commitLive(patchLayer(show(), id, { transitionMs: Math.round(v) }))));

    // --- clip deck -------------------------------------------------------
    card.append(el('div', { className: 'fx-pts', textContent: 'clips' }));
    card.append(clipDeck(layer, id, genOpts));

    // --- active-clip editor ----------------------------------------------
    const active = (layer.clips || []).find((c) => c.id === layer.activeClipId);
    if (active) card.append(activeClipEditor(layer, id, active, genOpts, fxOpts));

    // --- layer effects (distinct from clip effects) ----------------------
    card.append(el('div', { className: 'fx-pts ly-fxlabel ly-fxlabel-layer',
      textContent: 'layer FX (whole layer)' }));
    const layerFx = layer.effects || [];
    for (let fx = 0; fx < layerFx.length; fx++) {
      card.append(layerEffectBlock(layer, id, fx, layerFx, fxOpts));
    }
    card.append(el('div', { className: 'ly-addfx' }, [
      selectInput([{ value: '', label: '+ add layer FX…' }, ...fxOpts], '', (x) => {
        if (x) commit(addLayerEffect(show(), id, x));
      }),
    ]));

    return card;
  }

  // The clip deck: a row of cells, the active one lit. Click a cell to trigger
  // (= setActiveClip; the compositor crossfades). Each cell carries reorder
  // (◀/▶) + remove (×) affordances, plus an "add clip" cell with a generator picker.
  function clipDeck(layer, id, genOpts) {
    const deck = el('div', { className: 'clip-deck' });
    const clips = layer.clips || [];
    for (let ci = 0; ci < clips.length; ci++) {
      const clip = clips[ci];
      const isActive = clip.id === layer.activeClipId;
      const cell = el('div', {
        className: 'clip-cell' + (isActive ? ' clip-active' : ''),
        title: isActive ? 'active (playing) — click another to trigger' : 'click to trigger',
      });
      // Trigger on cell click (but not when an inner affordance was clicked).
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.clip-aff')) return;
        if (!isActive) commit(setActiveClip(show(), id, clip.id));
      });
      cell.append(
        el('div', { className: 'clip-name', textContent: clip.name || clip.id }),
        el('div', { className: 'clip-gen', textContent: clip.generator || '—' }),
      );
      const aff = el('div', { className: 'clip-aff' });
      aff.append(
        el('button', { textContent: '◀', title: 'move clip earlier', disabled: ci === 0,
          onclick: () => commit(moveClip(show(), id, clip.id, -1)) }),
        el('button', { textContent: '▶', title: 'move clip later', disabled: ci === clips.length - 1,
          onclick: () => commit(moveClip(show(), id, clip.id, +1)) }),
        el('button', { textContent: '✕', title: 'remove clip', className: 'ly-rmfx',
          onclick: () => commit(removeClip(show(), id, clip.id)) }),
      );
      cell.append(aff);
      if (isActive) cell.append(el('span', { className: 'clip-badge', textContent: '●' }));
      deck.append(cell);
    }
    // Add-clip cell: a generator picker that appends a new clip.
    const addCell = el('div', { className: 'clip-cell clip-add' }, [
      el('div', { className: 'clip-name', textContent: '+ add clip' }),
      selectInput([{ value: '', label: 'generator…' }, ...genOpts], '', (x) => {
        if (x) commit(addClip(show(), id, x));
      }),
    ]);
    deck.append(addCell);
    return deck;
  }

  // Editor for the layer's ACTIVE clip: generator select, generator params, and
  // the clip's own effect chain. Generator/effect params write clip.params via
  // setClipParam; live slider drags persist without re-render (commitLive).
  function activeClipEditor(layer, id, clip, genOpts, fxOpts) {
    const box = el('div', { className: 'clip-editor' });
    box.append(el('div', { className: 'clip-editor-head',
      textContent: `editing: ${clip.name || clip.id}` }));

    // Generator select (changing it resets that generator's params).
    box.append(field('generator', selectInput(genOpts, clip.generator,
      (x) => commit(changeClipGenerator(show(), id, clip.id, x)))));

    // Generator params (auto-generated from manifest).
    const gen = getEntry(clip.generator);
    if (gen && gen.params.length) {
      box.append(el('div', { className: 'fx-pts', textContent: `${gen.name} params` }));
      for (const p of gen.params) {
        const key = gen.name + '.' + p.key;
        box.append(paramControl(p, clip.params?.[key],
          (v) => commitLive(setClipParam(show(), id, clip.id, key, v))));
      }
    }

    // Clip effects (on the active clip only).
    box.append(el('div', { className: 'fx-pts ly-fxlabel ly-fxlabel-clip',
      textContent: 'clip FX (this clip)' }));
    const fxs = clip.effects || [];
    for (let fx = 0; fx < fxs.length; fx++) {
      box.append(clipEffectBlock(layer, id, clip, fx, fxs));
    }
    box.append(el('div', { className: 'ly-addfx' }, [
      selectInput([{ value: '', label: '+ add clip FX…' }, ...fxOpts], '', (x) => {
        if (x) commit(addClipEffect(show(), id, clip.id, x));
      }),
    ]));
    return box;
  }

  // One CLIP effect block: header (name + reorder/remove) + its param controls.
  // Params write clip.params['fx.key'] via setClipParam.
  function clipEffectBlock(layer, id, clip, fx, effects) {
    const name = effects[fx];
    const entry = getEntry(name);
    const block = el('div', { className: 'ly-fx ly-fx-clip' });

    const btns = el('div', { className: 'ly-btns' });
    btns.append(
      el('button', { textContent: '▲', title: 'effect earlier', disabled: fx === 0,
        onclick: () => commit(moveClipEffect(show(), id, clip.id, fx, -1)) }),
      el('button', { textContent: '▼', title: 'effect later', disabled: fx === effects.length - 1,
        onclick: () => commit(moveClipEffect(show(), id, clip.id, fx, +1)) }),
      el('button', { textContent: '✕', title: 'remove effect', className: 'ly-rmfx',
        onclick: () => commit(removeClipEffect(show(), id, clip.id, fx)) }),
    );
    block.append(el('div', { className: 'ly-fxhead' }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${name}` }), btns,
    ]));

    if (entry) {
      for (const p of entry.params) {
        const key = entry.name + '.' + p.key;
        block.append(paramControl(p, clip.params?.[key],
          (v) => commitLive(setClipParam(show(), id, clip.id, key, v))));
      }
    }
    return block;
  }

  // One LAYER effect block: header (name + reorder/remove) + its param controls.
  // Params write layer.params['fx.key'] via setLayerParam (distinct namespace
  // from clip effects — see the schema's param split).
  function layerEffectBlock(layer, id, fx, effects, _fxOpts) {
    const name = effects[fx];
    const entry = getEntry(name);
    const block = el('div', { className: 'ly-fx ly-fx-layer' });

    const btns = el('div', { className: 'ly-btns' });
    btns.append(
      el('button', { textContent: '▲', title: 'effect earlier', disabled: fx === 0,
        onclick: () => commit(moveLayerEffect(show(), id, fx, -1)) }),
      el('button', { textContent: '▼', title: 'effect later', disabled: fx === effects.length - 1,
        onclick: () => commit(moveLayerEffect(show(), id, fx, +1)) }),
      el('button', { textContent: '✕', title: 'remove effect', className: 'ly-rmfx',
        onclick: () => commit(removeLayerEffect(show(), id, fx)) }),
    );
    block.append(el('div', { className: 'ly-fxhead' }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${name}` }), btns,
    ]));

    if (entry) {
      for (const p of entry.params) {
        const key = entry.name + '.' + p.key;
        block.append(paramControl(p, layer.params?.[key],
          (v) => commitLive(setLayerParam(show(), id, key, v))));
      }
    }
    return block;
  }

  render();
  return { el: root, refresh: render };
}
