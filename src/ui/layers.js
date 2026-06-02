// Single-layer clip composer (Resolume-flavoured, simplified). The old multi-
// layer stack is gone: the composition is ONE layer holding a deck of clips.
// A clip is a source (generator) + params + an effect chain.
//
// Interaction model (matches the reference, minus the layer stack):
//   - A right RAIL lists draggable SOURCES and EFFECTS.
//   - Drag a SOURCE onto a clip cell → replaces that clip's source (and triggers
//     it so the change is visible). Drag a source onto the "+" cell → new clip.
//   - Drag an EFFECT onto a clip cell, or onto the selected clip's "drop effect"
//     zone → appends it to that clip's effect chain.
//   - Click a clip cell → trigger it (the compositor crossfades over the layer's
//     transition time).
//
// The model is unchanged and still stores `composition.layers` (length 1 here),
// so save/load and the compositor keep working. All edits route through the
// id-based model helpers (whole-show in, new-show out) → setShow.
//
// createLayerPanel({ getShow, setShow, onChange }) → { el, refresh() }  (name
// kept for app.js compatibility).

import {
  generatorNames, effectNames, getEntry, labelOf,
} from '../engine/shaders/manifest.js';
import {
  addClip, removeClip, moveClip, setActiveClip, changeClipGenerator,
  setClipParam, addClipEffect, removeClipEffect, moveClipEffect,
  addLayerEffect, removeLayerEffect, moveLayerEffect, setLayerParam,
  setClipTransform, setClipOpacity, setClipDuration,
  setClipAnim, setLayerAnim, patchLayer,
  mergeClipParams, mergeLayerParams, prefixedDefaults,
} from '../model/layers.js';
import { DIRECTIONS, makeAnim, animatedValue } from '../model/anim.js';
import { listPresets, savePreset, loadPreset, deletePreset } from '../model/presets.js';

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
const sliderField = (label, value, min, max, onInput, defaultValue, stepOverride) => {
  const step = stepOverride ?? ((max - min) <= 2 ? 0.001 : (max - min) <= 50 ? 0.01 : 1);
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
  // Right-click resets to the default value.
  if (defaultValue != null) {
    range.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      range.value = String(defaultValue);
      out.textContent = fmt(defaultValue);
      onInput(defaultValue);
    });
  }
  // Single row: name left, value, slider fills the rest (Resolume-style, compact).
  const row = el('label', { className: 'fx-field ly-param ly-row' + (defaultValue != null ? ' resettable' : '') }, [
    el('span', { className: 'ly-plabel', textContent: label }), out, range,
  ]);
  return row;
};

// Build a control for one manifest param.
function paramControl(p, value, onInput) {
  if (p.type === 'color') {
    const i = el('input', { type: 'color', value: value || '#ffffff' });
    i.addEventListener('input', () => onInput(i.value));
    return field(p.key, i);
  }
  if (p.type === 'bool') {
    const i = el('input', { type: 'checkbox', checked: !!value });
    i.addEventListener('change', () => onInput(i.checked));
    // Inline row: label left, checkbox right (matches the slider params).
    return el('label', { className: 'fx-field bool-row' }, [
      el('span', { className: 'ly-plabel', textContent: p.key }), i,
    ]);
  }
  const min = p.min ?? 0, max = p.max ?? 1;
  const v = value == null ? (p.default ?? min) : value;
  return sliderField(p.key, v, min, max, onInput, p.default ?? min, p.step);
}

// A numeric param that can be BASIC (static slider) or TIMELINE (animated). The
// "T" toggle flips modes; in Timeline mode the slider is tagged data-animkey so
// the render loop can move it live, and a compact controls row appears
// (direction · in · out · duration). Bool/colour params aren't animatable.
//   onValue(v): set the static value · onAnim(spec|null): set/clear the animation
function animatableParam({ key, p, value, anim, onValue, onAnim }) {
  if (p.type === 'color' || p.type === 'bool') return paramControl(p, value, onValue);
  const min = p.min ?? 0, max = p.max ?? 1;
  const animated = !!anim;
  const shown = animated ? anim.from : (value == null ? (p.default ?? min) : value);
  const wrap = el('div', { className: 'anim-param' });
  const row = sliderField(p.key, shown, min, max, onValue, p.default ?? min, p.step);
  if (animated) {
    const r = row.querySelector('input[type=range]');
    if (r) r.dataset.animkey = key;
    row.classList.add('is-animated');
  }
  row.append(el('button', {
    className: 'anim-toggle' + (animated ? ' on' : ''), textContent: 'T',
    title: animated ? 'animated (Timeline) — click for Basic' : 'animate (Timeline)',
    onclick: (e) => { e.preventDefault(); onAnim(animated ? null : makeAnim(shown, max, 4000, 'forward')); },
  }));
  wrap.append(row);
  if (animated) wrap.append(animControls(anim, onAnim));
  return wrap;
}

// Compact Timeline controls: direction · in · out · duration(s).
function animControls(anim, onAnim) {
  const mini = (label, val, commit) => {
    const i = el('input', { type: 'number', value: String(val), step: 'any', className: 'anim-num' });
    i.addEventListener('change', () => commit(i.value === '' ? 0 : Number(i.value)));
    return el('label', { className: 'anim-mini' }, [el('span', { textContent: label }), i]);
  };
  return el('div', { className: 'anim-ctrls' }, [
    selectInput(DIRECTIONS, anim.direction, (d) => onAnim({ ...anim, direction: d })),
    mini('in', anim.from, (v) => onAnim({ ...anim, from: v })),
    mini('out', anim.to, (v) => onAnim({ ...anim, to: v })),
    mini('s', anim.durationMs / 1000, (v) => onAnim({ ...anim, durationMs: Math.max(0, Math.round(v * 1000)) })),
  ]);
}

// Module-level drag payload. HTML5 dataTransfer.getData isn't readable during
// `dragover` (only on `drop`), but we need the kind there to decide whether a
// target accepts the drag — so we stash it here on dragstart and clear on
// dragend. dataTransfer still carries the payload for completeness.
let drag = null; // { kind: 'source' | 'effect', name }

// transport (optional): { isPlaying(), toggle(), getLoop(), setLoop(bool) } —
// drives the play-through of the clip deck as a timeline. The panel renders a
// play/stop + loop bar and exposes setPlayhead(i) so app.js can move the
// highlight as the playhead advances (cheap class toggle, no re-render).
export function createLayerPanel({ getShow, setShow, onChange, transport, mounts, thumbnails = {}, onClipSelect }) {
  const root = el('div', { className: 'fx-panel cmp2-panel' });
  let deckCells = [];        // clip cells by deck index (for the playhead highlight)
  let playheadIndex = -1;
  let selectedClipId = null; // inspector target — SELECT (click) is decoupled from ACTIVE (trigger)

  function setPlayhead(i) {
    if (i === playheadIndex) return;
    playheadIndex = i;
    deckCells.forEach((cell, idx) => cell.classList.toggle('clip-playhead', idx === i));
  }

  // Move animated sliders to their live value at time t (selected clip + the
  // composition FX). Cheap: only touches sliders tagged data-animkey.
  function applyLive(container, anim, t) {
    if (!anim || !container) return;
    for (const k of Object.keys(anim)) {
      const r = container.querySelector(`input[data-animkey="${k}"]`);
      if (!r) continue;
      const v = animatedValue(anim[k], t);
      r.value = String(v);
      const out = r.closest('.ly-param')?.querySelector('.ly-readout');
      if (out) out.textContent = fmt(v);
    }
  }
  function updateLive(t) {
    const layer = firstLayer();
    if (!layer) return;
    const sel = (layer.clips || []).find((c) => c.id === selectedClipId);
    applyLive(mounts?.inspectorClip || root, sel?.anim, t);
    applyLive(mounts?.inspectorComposition || root, layer.anim, t);
  }

  // STRUCTURAL edit: persist + re-render (add/remove/reorder, trigger, source swap).
  function commit(nextShow) {
    setShow(nextShow);
    onChange?.();
    render();
  }
  // LIVE edit: persist without re-render so a focused slider keeps focus.
  function commitLive(nextShow) {
    setShow(nextShow);
    onChange?.();
  }

  const show = () => getShow();
  const firstLayer = () => getShow().composition?.layers?.[0] || null;
  // Live clip lookup (presets read CURRENT params, not the captured render-time clip).
  const liveClip = (cid) => (firstLayer()?.clips || []).find((c) => c.id === cid) || null;

  // Compact preset widget for a source/effect TYPE — a small load dropdown +
  // save + reset, meant to sit in a header corner.
  //   getParams(): current params to save · applyParams(p): load · onReset(): defaults
  function presetWidget(kind, name, getParams, applyParams, onReset) {
    const names = listPresets(kind, name);
    const sel = el('select', { className: 'preset-mini', title: 'load / delete preset' });
    sel.append(el('option', { value: '', textContent: 'preset' }));
    for (const n of names) sel.append(el('option', { value: n, textContent: n }));
    sel.addEventListener('change', () => {
      if (sel.value) { const p = loadPreset(kind, name, sel.value); if (p) applyParams(p); }
    });
    const save = el('button', {
      className: 'preset-mini-btn', textContent: '＋', title: 'save current as a preset',
      onclick: () => { const pn = window.prompt(`Save ${name} preset as:`); if (pn && pn.trim()) { savePreset(kind, name, pn.trim(), getParams()); render(); } },
    });
    const reset = el('button', {
      className: 'preset-mini-btn', textContent: '↺', title: 'reset to defaults',
      onclick: () => onReset?.(),
    });
    return el('div', { className: 'preset-widget' }, [sel, save, reset]);
  }

  // The param subset of `params` whose keys are prefixed by `name + '.'`.
  const paramsForPrefix = (params, name) => {
    const out = {}; const pfx = name + '.';
    for (const k of Object.keys(params || {})) if (k.startsWith(pfx)) out[k] = params[k];
    return out;
  };

  // A single "⋯" options button for an EFFECT: a popover menu with preset load,
  // save, reset and remove. Replaces the row of arrow/preset/✕ buttons.
  function fxMenu({ presetName, getParams, applyParams, onReset, onRemove }) {
    const wrap = el('div', { className: 'fx-menu-wrap' });
    const menu = el('div', { className: 'fx-menu', hidden: true });
    const close = () => { menu.hidden = true; };
    const item = (label, onClick, cls = '') => el('button', {
      className: 'fx-menu-item ' + cls, textContent: label,
      onclick: (e) => { e.stopPropagation(); onClick(); },
    });
    const names = listPresets('effect', presetName);
    if (names.length) {
      menu.append(el('div', { className: 'fx-menu-label', textContent: 'presets' }));
      for (const n of names) menu.append(item(n, () => { const p = loadPreset('effect', presetName, n); if (p) applyParams(p); close(); }));
      menu.append(el('div', { className: 'fx-menu-sep' }));
    }
    menu.append(item('Save preset…', () => {
      const pn = window.prompt(`Save ${presetName} preset as:`);
      if (pn && pn.trim()) { savePreset('effect', presetName, pn.trim(), getParams()); render(); }
    }));
    menu.append(item('Reset', () => onReset()));        // commits → re-renders
    menu.append(item('Remove', () => onRemove(), 'fx-menu-danger'));
    const btn = el('button', { className: 'fx-menu-btn', textContent: '⋯', title: 'effect options' });
    btn.onclick = (e) => {
      e.stopPropagation();
      const opening = menu.hidden;
      menu.hidden = !opening;
      if (opening) setTimeout(() => {
        const off = (ev) => { if (!wrap.contains(ev.target)) { close(); document.removeEventListener('click', off); } };
        document.addEventListener('click', off);
      }, 0);
    };
    wrap.append(btn, menu);
    return wrap;
  }

  // Mount points (Resolume-style shell). The panel renders its regions into
  // separate containers: DECK (clip-slot strip + transport), the CLIP inspector
  // (selected-clip source/transform/opacity/effects), the COMPOSITION inspector
  // (composition FX — sits under the general settings in the Composition tab),
  // and the LIBRARY (Sources/Effects). When omitted, everything falls back to a
  // single self-contained tree in `root`.
  const deckEl = mounts?.deck || root;
  const clipEl = mounts?.inspectorClip || root;
  const layerEl = mounts?.inspectorLayer || root;
  const compEl = mounts?.inspectorComposition || root;
  const libraryEl = mounts?.library || root;

  function render() {
    const layer = firstLayer();
    // Clear each distinct container once.
    const seen = new Set();
    for (const c of [deckEl, clipEl, layerEl, compEl, libraryEl]) {
      if (!seen.has(c)) { c.textContent = ''; seen.add(c); }
    }

    if (!layer) {
      deckEl.append(el('div', { className: 'ly-hint', textContent: 'no composition layer' }));
      return;
    }
    const id = layer.id;

    // --- DECK region: transport + a layer row (header + clip-slot grid) -------
    if (transport) deckEl.append(el('div', { className: 'composer-deckhead' }, [transportBar()]));
    // A Resolume-style layer row: a header (name · opacity) on the left,
    // then the slot grid (filled clips + empty placeholder slots).
    deckEl.append(el('div', { className: 'deck-layer' }, [
      layerHead(layer, id),
      clipDeck(layer, id),
    ]));

    // --- CLIP inspector: the SELECTED clip (defaults to the active one) -------
    const clips = layer.clips || [];
    if (!clips.some((c) => c.id === selectedClipId)) selectedClipId = layer.activeClipId;
    const selClip = clips.find((c) => c.id === selectedClipId);
    if (selClip) clipEl.append(selectedClipEditor(id, selClip));
    else clipEl.append(el('div', { className: 'ly-hint', textContent: 'no clip selected' }));

    // --- LAYER inspector: layer settings -------------------------------------
    layerEl.append(layerSettings(layer, id));

    // --- COMPOSITION inspector: composition FX -------------------------------
    compEl.append(compositionEffects(layer, id));

    // --- LIBRARY region: draggable Sources + Effects -------------------------
    libraryEl.append(composerRail());
  }

  // Composition-level effect chain: effects applied to the WHOLE composition
  // (the single layer's output), AFTER the active clip + its own effects. Use
  // these for global colour-over-time, segmenting, etc. Drop an effect on the
  // zone, or reorder/remove with the per-block controls.
  function compositionEffects(layer, id) {
    const box = el('div', { className: 'comp-fx' });
    box.append(el('div', { className: 'composer-label composer-label-fx',
      textContent: 'COMPOSITION FX' }));
    box.append(el('div', { className: 'ly-hint', textContent: 'applied to the whole composition' }));

    const fxs = layer.effects || [];
    for (let fx = 0; fx < fxs.length; fx++) {
      box.append(layerEffectBlock(id, fx, fxs));
    }
    const dropZone = el('div', { className: 'composer-drop', textContent: '▸ drop effect here' });
    makeDropTarget(dropZone, (payload) => {
      if (payload.kind === 'effect') commit(addLayerEffect(show(), id, payload.name));
    });
    box.append(dropZone);
    return box;
  }

  // One composition (layer) effect block — drag-reorder + "⋯" menu. Params write
  // layer.params via setLayerParam (a distinct namespace from clip effects).
  function layerEffectBlock(id, fx, effects) {
    const name = effects[fx];
    const entry = getEntry(name);
    const layer = firstLayer();
    const block = el('div', { className: 'ly-fx ly-fx-layer' });
    makeDropTarget(block, (payload) => {
      if (payload.kind === 'fx-layer' && payload.index !== fx) {
        commit(moveLayerEffect(show(), id, payload.index, fx - payload.index));
      }
    });

    const head = el('div', { className: 'ly-fxhead', draggable: true }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${labelOf(name)}` }),
    ]);
    head.addEventListener('dragstart', (e) => {
      drag = { kind: 'fx-layer', index: fx };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'fx');
    });
    head.addEventListener('dragend', () => { drag = null; });
    head.append(fxMenu({
      presetName: entry?.name || name,
      getParams: () => paramsForPrefix(firstLayer()?.params, name),
      applyParams: (p) => commit(mergeLayerParams(show(), id, p)),
      onReset: () => commit(mergeLayerParams(show(), id, prefixedDefaults(name))),
      onRemove: () => commit(removeLayerEffect(show(), id, fx)),
    }));
    block.append(head);

    if (entry) {
      for (const p of entry.params) {
        const key = entry.name + '.' + p.key;
        block.append(animatableParam({
          key, p, value: layer?.params?.[key], anim: layer?.anim?.[key],
          onValue: (v) => commitLive(setLayerParam(show(), id, key, v)),
          onAnim: (spec) => commit(setLayerAnim(show(), id, key, spec)),
        }));
      }
    }
    return block;
  }

  // Play/stop + loop bar. Toggling re-renders so the label flips and (on stop)
  // the playhead highlight clears.
  function transportBar() {
    const bar = el('div', { className: 'transport' });
    const playing = transport.isPlaying();
    bar.append(el('button', {
      className: 'transport-play' + (playing ? ' is-playing' : ''),
      textContent: playing ? '■ stop' : '▶ play',
      onclick: () => { transport.toggle(); if (!transport.isPlaying()) setPlayhead(-1); render(); },
    }));
    const loopCb = el('input', { type: 'checkbox', checked: transport.getLoop() });
    loopCb.addEventListener('change', () => transport.setLoop(loopCb.checked));
    bar.append(el('label', { className: 'transport-loop' }, [loopCb, el('span', { textContent: 'loop' })]));
    if (transport.fire) {
      bar.append(el('button', {
        className: 'transport-fire', textContent: '⚡ trigger',
        title: 'fire triggerable sources (Pulse)',
        onclick: () => transport.fire(),
      }));
    }
    return bar;
  }

  // The clip deck. Each cell: click = trigger; accepts a dragged SOURCE (replace
  // + trigger) or EFFECT (append to that clip). The "+" cell accepts a SOURCE to
  // create a new clip, with a generator <select> as a no-drag fallback.
  function clipDeck(layer, id) {
    const deck = el('div', { className: 'clip-deck' });
    deckCells = [];
    const clips = layer.clips || [];
    for (let ci = 0; ci < clips.length; ci++) {
      const clip = clips[ci];
      const isActive = clip.id === layer.activeClipId;
      const isSelected = clip.id === selectedClipId;
      const cell = el('div', {
        className: 'clip-cell' + (isActive ? ' clip-active' : '') + (isSelected ? ' clip-selected' : ''),
        title: 'click to select · double-click to trigger · drag to reorder',
        draggable: true,
      });
      // Click = SELECT (edit in inspector) without activating; double-click = trigger.
      // Selecting also focuses the Clip inspector tab (onClipSelect).
      const selectThis = () => { selectedClipId = clip.id; onClipSelect?.(); };
      cell.addEventListener('click', () => { selectThis(); render(); });
      cell.addEventListener('dblclick', () => { selectThis(); commit(setActiveClip(show(), id, clip.id)); });
      // Drag this clip to reorder it (drop on another clip / empty slot).
      cell.addEventListener('dragstart', (e) => {
        drag = { kind: 'clip', clipId: clip.id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'clip:' + clip.id);
      });
      cell.addEventListener('dragend', () => { drag = null; });
      makeDropTarget(cell, (payload) => {
        if (payload.kind === 'source') {
          // Replace the source AND select it (no auto-trigger).
          selectThis();
          commit(changeClipGenerator(show(), id, clip.id, payload.name));
        } else if (payload.kind === 'effect') {
          commit(addClipEffect(show(), id, clip.id, payload.name));
        } else if (payload.kind === 'clip' && payload.clipId !== clip.id) {
          // Reorder: move the dragged clip to this clip's position.
          const cur = (firstLayer()?.clips || []);
          const from = cur.findIndex((c) => c.id === payload.clipId);
          const to = cur.findIndex((c) => c.id === clip.id);
          if (from >= 0 && to >= 0) commit(moveClip(show(), id, payload.clipId, to - from));
        }
      });
      // Thumbnail (top) + a label bar UNDERNEATH (Resolume-style).
      const thumbWrap = el('div', { className: 'clip-thumbwrap' });
      const thumb = thumbnails[clip.generator];
      if (thumb) thumbWrap.append(el('img', { className: 'clip-thumb', src: thumb, alt: '', draggable: false }));
      const fxCount = (clip.effects || []).length;
      if (fxCount) thumbWrap.append(el('div', { className: 'clip-fxcount', textContent: `${fxCount} fx` }));
      cell.append(thumbWrap);
      cell.append(el('div', { className: 'clip-label-bar', textContent: clip.name || clip.id }));
      if (ci === playheadIndex) cell.classList.add('clip-playhead');
      deckCells.push(cell);
      deck.append(cell);
    }

    // Empty placeholder slots (Resolume-style): pad the row so there are always
    // a few empty slots after the clips. They are pure DROP TARGETS — drag a
    // source from the library onto one to add a clip there.
    const MIN_SLOTS = 8;
    const emptyCount = Math.max(2, MIN_SLOTS - clips.length);
    for (let e = 0; e < emptyCount; e++) {
      const slot = el('div', { className: 'clip-cell clip-empty', title: 'drag a source here' }, [
        el('div', { className: 'clip-empty-plus', textContent: '+' }),
      ]);
      makeDropTarget(slot, (payload) => {
        if (payload.kind === 'source') commit(addClip(show(), id, payload.name));
        else if (payload.kind === 'clip') {
          // Move the dragged clip to the end of the deck.
          const cur = firstLayer()?.clips || [];
          const from = cur.findIndex((c) => c.id === payload.clipId);
          if (from >= 0) commit(moveClip(show(), id, payload.clipId, (cur.length - 1) - from));
        }
      });
      deck.append(slot);
    }
    return deck;
  }

  // Layer inspector tab: name · opacity · blend · crossfade (layer-level props).
  function layerSettings(layer, id) {
    const box = el('div', { className: 'clip-editor' });
    const name = el('input', { className: 'ly-nameedit', value: layer.name ?? 'Layer 1', title: 'layer name' });
    name.addEventListener('change', () => commit(patchLayer(show(), id, { name: name.value })));
    box.append(el('div', { className: 'clip-editor-head' }, [name]));
    box.append(sliderField('opacity', layer.opacity ?? 1, 0, 1,
      (v) => commitLive(patchLayer(show(), id, { opacity: v })), 1));
    box.append(sliderField('crossfade (ms)', layer.transitionMs ?? 500, 0, 5000,
      (v) => commitLive(patchLayer(show(), id, { transitionMs: Math.round(v) })), 500));
    return box;
  }

  // Resolume-style layer control block: a vertical opacity fader (the "V"),
  // clear/eject + blend controls, and the layer name bar at the bottom.
  function layerHead(layer, id) {
    const pct = (v) => Math.round((v ?? 1) * 100) + '%';
    const head = el('div', { className: 'layer-head-box' });
    const body = el('div', { className: 'lh-body' });

    // Vertical opacity fader.
    const opCol = el('div', { className: 'lh-op' });
    const opOut = el('span', { className: 'lh-op-val', textContent: pct(layer.opacity ?? 1) });
    const opRange = el('input', {
      type: 'range', min: '0', max: '1', step: '0.001', value: String(layer.opacity ?? 1),
      className: 'lh-op-range', title: 'layer opacity',
    });
    opRange.addEventListener('input', () => {
      opOut.textContent = pct(Number(opRange.value));
      commitLive(patchLayer(show(), id, { opacity: Number(opRange.value) }));
    });
    opCol.append(opOut, opRange);
    body.append(opCol);

    // Clear (eject active clip).
    const ctrls = el('div', { className: 'lh-ctrls' });
    ctrls.append(el('button', {
      className: 'lh-clear', textContent: '✕', title: 'clear (eject active clip)',
      onclick: () => commit(setActiveClip(show(), id, null)),
    }));
    body.append(ctrls);
    head.append(body);

    // Layer name bar (Resolume highlights the active layer's name bar).
    const name = el('input', { className: 'lh-name', value: layer.name ?? 'Layer 1', title: 'layer name' });
    name.addEventListener('change', () => commit(patchLayer(show(), id, { name: name.value })));
    head.append(name);
    return head;
  }

  // Editor for the layer's active clip: rename, source params, and its effect
  // chain (with a drop zone). Source is changed by dragging onto a clip cell.
  function selectedClipEditor(id, clip) {
    const box = el('div', { className: 'clip-editor' });

    const nameInput = el('input', {
      className: 'ly-nameedit', value: clip.name || clip.id, title: 'clip name',
    });
    nameInput.addEventListener('change',
      () => commit(patchClipName(show(), id, clip.id, nameInput.value)));

    // Source params (auto-generated from the manifest), shown directly — no
    // "source: X" / "X params" meta (the slot already shows the source).
    const gen = getEntry(clip.generator);

    // Header: clip name + a compact SOURCE preset widget (presets · save · reset)
    // in the corner. Reset re-applies the generator's manifest defaults.
    const head = el('div', { className: 'clip-editor-head' }, [nameInput]);
    if (gen && gen.params.length) {
      head.append(presetWidget('source', gen.name,
        () => paramsForPrefix(liveClip(clip.id)?.params, gen.name),
        (p) => commit(mergeClipParams(show(), id, clip.id, p)),
        () => commit(changeClipGenerator(show(), id, clip.id, clip.generator))));
    }
    box.append(head);

    // Triggerable sources (Pulse) get a prominent Trigger button here.
    if (gen?.triggerable && transport?.fire) {
      box.append(el('button', {
        className: 'clip-trigger', textContent: '⚡ Trigger',
        title: 'fire the pulse', onclick: () => transport.fire(),
      }));
    }

    // Transport: how long the timeline transport holds this slot (Resolume names
    // this section "Transport").
    box.append(el('div', { className: 'fx-pts', textContent: 'transport' }));
    box.append(sliderField('duration (s)', (clip.durationMs ?? 4000) / 1000, 0.1, 30,
      (v) => commitLive(setClipDuration(show(), id, clip.id, Math.round(v * 1000))), 4));
    if (gen && gen.params.length) {
      for (const p of gen.params) {
        const key = gen.name + '.' + p.key;
        box.append(animatableParam({
          key, p, value: clip.params?.[key], anim: clip.anim?.[key],
          onValue: (v) => commitLive(setClipParam(show(), id, clip.id, key, v)),
          onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, key, spec)),
        }));
      }
    }
    // Transform + opacity (the clip's placement on the canvas).
    const t = clip.transform || {};
    box.append(el('div', { className: 'fx-pts', textContent: 'transform' }));
    box.append(sliderField('x', t.x ?? 0, -1, 1,
      (v) => commitLive(setClipTransform(show(), id, clip.id, { x: v })), 0));
    box.append(sliderField('y', t.y ?? 0, -1, 1,
      (v) => commitLive(setClipTransform(show(), id, clip.id, { y: v })), 0));
    box.append(sliderField('scale', t.scale ?? 1, 0, 3,
      (v) => commitLive(setClipTransform(show(), id, clip.id, { scale: v })), 1));
    box.append(sliderField('rotation', t.rotation ?? 0, -180, 180,
      (v) => commitLive(setClipTransform(show(), id, clip.id, { rotation: v })), 0));
    box.append(sliderField('opacity', clip.opacity ?? 1, 0, 1,
      (v) => commitLive(setClipOpacity(show(), id, clip.id, v)), 1));

    // Effect chain.
    box.append(el('div', { className: 'fx-pts ly-fxlabel-clip', textContent: 'EFFECTS' }));
    const fxs = clip.effects || [];
    for (let fx = 0; fx < fxs.length; fx++) {
      box.append(clipEffectBlock(id, clip, fx, fxs));
    }
    const dropZone = el('div', { className: 'composer-drop', textContent: '▸ drop effect here' });
    makeDropTarget(dropZone, (payload) => {
      if (payload.kind === 'effect') commit(addClipEffect(show(), id, clip.id, payload.name));
    });
    box.append(dropZone);
    return box;
  }

  // One clip effect block: a drag-to-reorder block with a "⋯" options menu.
  function clipEffectBlock(id, clip, fx, effects) {
    const name = effects[fx];
    const entry = getEntry(name);
    const block = el('div', { className: 'ly-fx ly-fx-clip' });
    makeDropTarget(block, (payload) => {
      if (payload.kind === 'fx-clip' && payload.index !== fx) {
        commit(moveClipEffect(show(), id, clip.id, payload.index, fx - payload.index));
      }
    });

    // The header is the drag handle (so sliders inside still scrub normally).
    const head = el('div', { className: 'ly-fxhead', draggable: true }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${labelOf(name)}` }),
    ]);
    head.addEventListener('dragstart', (e) => {
      drag = { kind: 'fx-clip', index: fx };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'fx');
    });
    head.addEventListener('dragend', () => { drag = null; });
    head.append(fxMenu({
      presetName: entry?.name || name,
      getParams: () => paramsForPrefix(liveClip(clip.id)?.params, name),
      applyParams: (p) => commit(mergeClipParams(show(), id, clip.id, p)),
      onReset: () => commit(mergeClipParams(show(), id, clip.id, prefixedDefaults(name))),
      onRemove: () => commit(removeClipEffect(show(), id, clip.id, fx)),
    }));
    block.append(head);

    if (entry) {
      for (const p of entry.params) {
        const key = entry.name + '.' + p.key;
        block.append(animatableParam({
          key, p, value: clip.params?.[key], anim: clip.anim?.[key],
          onValue: (v) => commitLive(setClipParam(show(), id, clip.id, key, v)),
          onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, key, spec)),
        }));
      }
    }
    return block;
  }

  // --- right column: draggable Sources + Effects libraries -------------------
  function composerRail() {
    const rail = el('div', { className: 'composer-rail' });
    rail.append(el('div', { className: 'composer-label', textContent: 'SOURCES' }));
    rail.append(libList('source', generatorNames()));
    rail.append(el('div', { className: 'composer-label composer-label-fx', textContent: 'EFFECTS' }));
    rail.append(libList('effect', effectNames()));
    return rail;
  }

  function libList(kind, names) {
    const list = el('div', { className: 'lib-list' });
    for (const name of names) {
      const item = el('div', {
        className: 'lib-item lib-' + kind, draggable: true,
        title: kind === 'source' ? 'drag onto a clip' : 'drag onto a clip or the drop zone',
      });
      // Sources show a rendered thumbnail; effects keep just the label.
      const thumb = kind === 'source' ? thumbnails[name] : null;
      if (thumb) item.append(el('img', { className: 'lib-thumb', src: thumb, alt: '', draggable: false }));
      item.append(el('span', { className: 'lib-label', textContent: labelOf(name) }));
      item.addEventListener('dragstart', (e) => {
        drag = { kind, name };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', `${kind}:${name}`);
      });
      item.addEventListener('dragend', () => { drag = null; });
      list.append(item);
    }
    return list;
  }

  // Wire an element as a drop target that accepts the module drag payload.
  function makeDropTarget(node, onDrop) {
    node.addEventListener('dragover', (e) => {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      node.classList.add('drop-hover');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-hover'));
    node.addEventListener('drop', (e) => {
      node.classList.remove('drop-hover');
      if (!drag) return;
      e.preventDefault();
      const payload = drag;
      drag = null;
      onDrop(payload);
    });
  }

  // Delete the selected clip (bound to the Delete key by app.js).
  function deleteActiveClip() {
    const l = firstLayer();
    const target = selectedClipId || l?.activeClipId;
    if (l && target) commit(removeClip(show(), l.id, target));
  }

  render();
  return { el: root, refresh: render, setPlayhead, updateLive, deleteActiveClip };
}

// Rename a clip (small local helper — there is no dedicated model fn, so we
// reuse the clip update via a param-free patch through changeClipGenerator's
// sibling). We do it inline to avoid touching the model: find + immutably set.
function patchClipName(show, layerId, clipId, name) {
  const layers = (show.composition?.layers || []).map((l) => {
    if (l.id !== layerId) return l;
    return { ...l, clips: (l.clips || []).map((c) => c.id === clipId ? { ...c, name } : c) };
  });
  return { ...show, composition: { ...show.composition, layers } };
}
