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
} from '../model/layers.js';
import { DIRECTIONS, makeAnim, animatedValue } from '../model/anim.js';

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
  // Single row: name left, value, slider fills the rest (Resolume-style, compact).
  return el('label', { className: 'fx-field ly-param ly-row' }, [
    el('span', { className: 'ly-plabel', textContent: label }), out, range,
  ]);
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
    return field(p.key, i);
  }
  const min = p.min ?? 0, max = p.max ?? 1;
  const v = value == null ? (p.default ?? min) : value;
  return sliderField(p.key, v, min, max, onInput);
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
  const row = sliderField(p.key, shown, min, max, onValue);
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
export function createLayerPanel({ getShow, setShow, onChange, transport, mounts }) {
  const root = el('div', { className: 'fx-panel cmp2-panel' });
  let deckCells = [];        // clip cells by deck index (for the playhead highlight)
  let playheadIndex = -1;

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
    const active = (layer.clips || []).find((c) => c.id === layer.activeClipId);
    applyLive(mounts?.inspectorClip || root, active?.anim, t);
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

  // Mount points (Resolume-style shell). The panel renders its regions into
  // separate containers: DECK (clip-slot strip + transport), the CLIP inspector
  // (selected-clip source/transform/opacity/effects), the COMPOSITION inspector
  // (composition FX — sits under the general settings in the Composition tab),
  // and the LIBRARY (Sources/Effects). When omitted, everything falls back to a
  // single self-contained tree in `root`.
  const deckEl = mounts?.deck || root;
  const clipEl = mounts?.inspectorClip || root;
  const compEl = mounts?.inspectorComposition || root;
  const libraryEl = mounts?.library || root;

  function render() {
    const layer = firstLayer();
    // Clear each distinct container once.
    const seen = new Set();
    for (const c of [deckEl, clipEl, compEl, libraryEl]) {
      if (!seen.has(c)) { c.textContent = ''; seen.add(c); }
    }

    if (!layer) {
      deckEl.append(el('div', { className: 'ly-hint', textContent: 'no composition layer' }));
      return;
    }
    const id = layer.id;

    // --- DECK region: transport + a layer row (header + clip-slot grid) -------
    const deckHead = el('div', { className: 'composer-deckhead' }, [
      el('div', { className: 'composer-label', textContent: 'TIMELINE' }),
    ]);
    if (transport) deckHead.append(transportBar());
    deckEl.append(deckHead);
    deckEl.append(el('div', { className: 'ly-hint',
      textContent: 'click a slot to trigger · drag a source onto an empty slot · ▶ plays through slots' }));
    // A Resolume-style layer row: a header (name · opacity · blend) on the left,
    // then the slot grid (filled clips + empty placeholder slots).
    deckEl.append(el('div', { className: 'deck-layer' }, [
      layerHead(layer, id),
      clipDeck(layer, id),
    ]));

    // --- CLIP inspector: selected clip ---------------------------------------
    const active = (layer.clips || []).find((c) => c.id === layer.activeClipId);
    if (active) clipEl.append(selectedClipEditor(id, active));
    else clipEl.append(el('div', { className: 'ly-hint', textContent: 'no clip selected' }));

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

  // One composition (layer) effect block — params write layer.params via
  // setLayerParam (a distinct namespace from clip effect params).
  function layerEffectBlock(id, fx, effects) {
    const name = effects[fx];
    const entry = getEntry(name);
    const layer = firstLayer();
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
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${labelOf(name)}` }), btns,
    ]));

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
      const cell = el('div', {
        className: 'clip-cell' + (isActive ? ' clip-active' : ''),
        title: isActive ? 'active — click another clip to trigger' : 'click to trigger',
      });
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.clip-aff')) return;
        if (!isActive) commit(setActiveClip(show(), id, clip.id));
      });
      makeDropTarget(cell, (payload) => {
        if (payload.kind === 'source') {
          // Replace the source AND trigger so the result is immediately visible.
          let next = changeClipGenerator(show(), id, clip.id, payload.name);
          next = setActiveClip(next, id, clip.id);
          commit(next);
        } else if (payload.kind === 'effect') {
          commit(addClipEffect(show(), id, clip.id, payload.name));
        }
      });
      cell.append(el('div', { className: 'clip-name', textContent: clip.name || clip.id }));
      // Show the source as a sub-label only when the name differs from it
      // (i.e. a custom-named clip) — otherwise it's redundant.
      const genLabel = labelOf(clip.generator);
      if (genLabel && genLabel !== (clip.name || '')) {
        cell.append(el('div', { className: 'clip-gen', textContent: genLabel }));
      }
      const fxCount = (clip.effects || []).length;
      if (fxCount) cell.append(el('div', { className: 'clip-fxcount', textContent: `${fxCount} fx` }));
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
      });
      deck.append(slot);
    }
    return deck;
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

    // Clear (eject active clip) + blend mode.
    const ctrls = el('div', { className: 'lh-ctrls' });
    ctrls.append(el('button', {
      className: 'lh-clear', textContent: '✕', title: 'clear (eject active clip)',
      onclick: () => commit(setActiveClip(show(), id, null)),
    }));
    ctrls.append(el('span', { className: 'lh-blend-label', textContent: 'blend' }));
    ctrls.append(selectInput(BLEND_MODES, layer.blend ?? 'add',
      (x) => commit(patchLayer(show(), id, { blend: x }))));
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
    box.append(el('div', { className: 'clip-editor-head' }, [
      el('span', { textContent: 'selected:' }), nameInput,
    ]));

    // Source params (auto-generated from the manifest), shown directly — no
    // "source: X" / "X params" meta (the slot already shows the source).
    const gen = getEntry(clip.generator);
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

    // Transform + opacity + slot duration (a clip is a timeline slot).
    const t = clip.transform || {};
    box.append(el('div', { className: 'fx-pts', textContent: 'transform' }));
    box.append(sliderField('x', t.x ?? 0, -1, 1,
      (v) => commitLive(setClipTransform(show(), id, clip.id, { x: v }))));
    box.append(sliderField('y', t.y ?? 0, -1, 1,
      (v) => commitLive(setClipTransform(show(), id, clip.id, { y: v }))));
    box.append(sliderField('scale', t.scale ?? 1, 0, 3,
      (v) => commitLive(setClipTransform(show(), id, clip.id, { scale: v }))));
    box.append(sliderField('rotation', t.rotation ?? 0, -180, 180,
      (v) => commitLive(setClipTransform(show(), id, clip.id, { rotation: v }))));
    box.append(sliderField('opacity', clip.opacity ?? 1, 0, 1,
      (v) => commitLive(setClipOpacity(show(), id, clip.id, v))));
    box.append(sliderField('duration (s)', (clip.durationMs ?? 4000) / 1000, 0.1, 30,
      (v) => commitLive(setClipDuration(show(), id, clip.id, Math.round(v * 1000)))));

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

  // One clip effect block: header (reorder/remove) + its param controls.
  function clipEffectBlock(id, clip, fx, effects) {
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
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${labelOf(name)}` }), btns,
    ]));

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
        className: 'lib-item lib-' + kind, textContent: labelOf(name), draggable: true,
        title: kind === 'source' ? 'drag onto a clip' : 'drag onto a clip or the drop zone',
      });
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

  render();
  return { el: root, refresh: render, setPlayhead, updateLive };
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
