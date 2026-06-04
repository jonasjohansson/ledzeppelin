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
  addClip, addVideoClip, removeClip, moveClip, duplicateClip, setActiveClip, changeClipGenerator,
  setClipParam, addClipEffect, removeClipEffect, moveClipEffect,
  addLayerEffect, removeLayerEffect, moveLayerEffect, setLayerParam,
  addCompositionEffect, removeCompositionEffect, moveCompositionEffect,
  setCompositionParam, mergeCompositionParams, setCompositionAnim,
  setClipTransform, setClipOpacity, setClipDuration, resetClipTransform,
  setClipAnim, setLayerAnim, patchLayer,
  addLayer, removeLayer, moveLayer,
  mergeClipParams, mergeLayerParams, prefixedDefaults,
} from '../model/layers.js';
import { makeAnim, makeAudioAnim, animatedValue } from '../model/anim.js';
import { AUDIO_BANDS, enableAudio } from '../model/audio.js';
import { listPresets, savePreset, loadPreset, deletePreset } from '../model/presets.js';
import { Section } from './section.js';

const BLEND_MODES = ['add', 'screen', 'multiply', 'alpha'];

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};

// Library rail tab (Sources | Effects, Resolume-style). Module-scoped so the
// choice persists across the panel's structural re-renders.
let libTab = 'source';

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
// Coarser format for the LIVE animated readout — a sweeping value at 3 decimals
// churns its last digits every frame and reads as noise. 2 decimals is enough.
const fmtLive = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

// A range slider with a live numeric readout, writing back on every input.
const sliderField = (label, value, min, max, onInput, defaultValue, stepOverride) => {
  const step = stepOverride ?? ((max - min) <= 2 ? 0.001 : (max - min) <= 50 ? 0.01 : 1);
  // Editable readout: click the number to TYPE a value (no spinner arrows), or
  // drag the slider. Both edit the same value and keep each other in sync.
  const out = el('input', {
    className: 'ly-readout ly-readout-edit', type: 'text', inputMode: 'decimal',
    spellcheck: false, value: fmt(value), title: 'click to type a value',
  });
  const range = el('input', {
    type: 'range', min: String(min), max: String(max),
    step: String(step), value: String(value ?? 0),
  });
  range.addEventListener('input', () => {
    const v = Number(range.value);
    out.value = fmt(v);
    onInput(v);
  });
  // Accept ONLY a number as you type: digits, one '.', and a leading '-' (only
  // when the range can be negative). Strips anything else (incl. pasted text)
  // live and keeps the caret put.
  const allowNeg = min < 0;
  out.addEventListener('input', () => {
    const before = out.value;
    let s = before.replace(allowNeg ? /[^0-9.-]/g : /[^0-9.]/g, '');
    if (allowNeg) { const neg = s.startsWith('-'); s = (neg ? '-' : '') + s.replace(/-/g, ''); }
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    if (s !== before) {
      const pos = Math.max(0, (out.selectionStart || 0) - (before.length - s.length));
      out.value = s;
      try { out.setSelectionRange(pos, pos); } catch { /* detached */ }
    }
  });
  // Typed value: parse + clamp on commit (Enter / blur); revert garbage.
  out.addEventListener('focus', () => out.select());
  out.addEventListener('keydown', (e) => { if (e.key === 'Enter') out.blur(); });
  out.addEventListener('change', () => {
    const v = Number(out.value);
    if (Number.isFinite(v)) {
      const c = Math.min(max, Math.max(min, v));
      range.value = String(c); out.value = fmt(c); onInput(c);
    } else { out.value = fmt(Number(range.value)); }
  });
  // Right-click the slider resets to the default value.
  if (defaultValue != null) {
    range.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      range.value = String(defaultValue);
      out.value = fmt(defaultValue);
      onInput(defaultValue);
    });
  }
  // Single row: name left, value, slider fills the rest (Resolume-style, compact).
  // A <div> (not <label>) so clicking the name doesn't grab the number field.
  const row = el('div', { className: 'fx-field ly-param ly-row' + (defaultValue != null ? ' resettable' : '') }, [
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

// A dual-handle range track for an animated param: two thumbs mark `in` and `out`
// on the [min,max] track (Resolume-style), with a fill between and a live marker
// the render loop moves to the current animated value. Dragging a thumb commits
// on release (change) — the fill follows live (input) without re-rendering.
function rangeTrack({ min, max, step, from, to, animKey, onFrom, onTo }) {
  const span = (max - min) || 1;
  const frac = (v) => Math.max(0, Math.min(1, (v - min) / span));
  const st = String(step ?? ((max - min) <= 2 ? 0.001 : (max - min) <= 50 ? 0.01 : 1));
  const fill = el('div', { className: 'rt-fill' });
  const live = el('div', { className: 'anim-live' });
  const mk = (cls, val, title) => el('input', { type: 'range', className: cls, title, min: String(min), max: String(max), step: st, value: String(val) });
  const inEl = mk('rt-in', from, 'in');
  const outEl = mk('rt-out', to, 'out');
  const layout = () => {
    const a = frac(Number(inEl.value)), b = frac(Number(outEl.value));
    fill.style.left = `${Math.min(a, b) * 100}%`;
    fill.style.width = `${Math.abs(b - a) * 100}%`;
  };
  inEl.addEventListener('input', layout);
  outEl.addEventListener('input', layout);
  inEl.addEventListener('change', () => onFrom(Number(inEl.value)));
  outEl.addEventListener('change', () => onTo(Number(outEl.value)));
  const wrap = el('div', { className: 'range-track' }, [el('div', { className: 'rt-base' }), fill, live, inEl, outEl]);
  wrap.dataset.animkey = animKey;
  wrap.dataset.min = String(min); wrap.dataset.max = String(max);
  layout();
  return wrap;
}

// A numeric param that can be BASIC (static slider) or ANIMATED (Timeline/Audio).
// The cog picks the mode. When animated the row becomes a dual-handle in/out range
// track (tagged data-animkey so the render loop moves the live marker) and a
// controls row appears below (direction · in · out · s, or band · in · out · gain).
//   onValue(v): set the static value · onAnim(spec|null): set/clear the animation
function animatableParam({ key, p, value, anim, onValue, onAnim }) {
  if (p.type === 'color' || p.type === 'bool') return paramControl(p, value, onValue);
  const min = p.min ?? 0, max = p.max ?? 1;
  const animated = !!anim;
  const isAudio = anim?.mode === 'audio';
  const wrap = el('div', { className: 'anim-param' });
  const cog = animModeMenu({
    animated, isAudio,
    onPick: (mode) => {
      // Default the sweep to the FULL slider range (in = min, out = max).
      if (mode === 'basic') onAnim(null);
      else if (mode === 'audio') { enableAudio(); onAnim(makeAudioAnim(min, max, 'level', 1)); }
      else onAnim(makeAnim(min, max, 10000, 'forward'));
    },
  });

  if (!animated) {
    const shown = value == null ? (p.default ?? min) : value;
    const row = sliderField(p.key, shown, min, max, onValue, p.default ?? min, p.step);
    row.append(cog);
    wrap.append(row);
    return wrap;
  }

  // Animated layout (un-crammed): three stacked rows —
  //   1. label · live value · cog   2. full-width in/out track   3. direction · in · out · s
  const readout = el('span', { className: 'ly-readout', textContent: fmtLive(anim.from) });
  const track = rangeTrack({
    min, max, step: p.step, from: anim.from, to: anim.to, animKey: key,
    onFrom: (v) => onAnim({ ...anim, from: v }),
    onTo: (v) => onAnim({ ...anim, to: v }),
  });
  wrap.classList.add('is-animated');
  if (isAudio) wrap.classList.add('is-audio');
  const head = el('div', { className: 'ly-param anim-head' }, [
    el('span', { className: 'ly-plabel', textContent: p.key }), readout, cog,
  ]);
  wrap.append(head);
  wrap.append(track);
  wrap.append(animControls(anim, onAnim));
  return wrap;
}

// The cog button + its Basic/Timeline/Audio popover (Resolume-style). The cog
// reflects the current mode (accent when animated, green for Audio); the menu
// marks the active mode. Replaces the old inline "T" toggle + mode dropdown.
function animModeMenu({ animated, isAudio, onPick }) {
  const wrap = el('div', { className: 'fx-menu-wrap anim-cog-wrap' });
  const menu = el('div', { className: 'fx-menu anim-mode-menu', hidden: true });
  const close = () => { menu.hidden = true; };
  const cur = !animated ? 'basic' : (isAudio ? 'audio' : 'timeline');
  const item = (mode, label) => el('button', {
    className: 'fx-menu-item' + (mode === cur ? ' is-current' : ''), textContent: label,
    onclick: (e) => { e.stopPropagation(); close(); onPick(mode); },
  });
  menu.append(item('basic', 'Basic'), item('timeline', 'Timeline'), item('audio', 'Audio'));
  const btn = el('button', {
    className: 'anim-cog' + (animated ? ' on' : '') + (isAudio ? ' audio' : ''),
    textContent: '⚙', title: 'animate this parameter (Basic / Timeline / Audio)',
  });
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

// Three small segmented buttons for the sweep direction (mode chosen via the cog).
function dirButtons(current, onPick) {
  const defs = [
    { value: 'forward', glyph: '→', title: 'forward' },
    { value: 'backward', glyph: '←', title: 'backward' },
    { value: 'mirror', glyph: '⇄', title: 'ping-pong' },
  ];
  return el('div', { className: 'dir-btns' }, defs.map((d) => el('button', {
    className: 'dir-btn' + (d.value === current ? ' on' : ''),
    textContent: d.glyph, title: d.title,
    onclick: (e) => { e.preventDefault(); onPick(d.value); },
  })));
}

// Fields for an animated param (mode already chosen via the cog menu):
//   Timeline → direction buttons · in · out · s    Audio → band · in · out · gain
function animControls(anim, onAnim) {
  const mini = (label, val, commit) => {
    const i = el('input', { type: 'number', value: String(val), step: 'any', className: 'anim-num' });
    i.addEventListener('change', () => commit(i.value === '' ? 0 : Number(i.value)));
    return el('label', { className: 'anim-mini' }, [el('span', { textContent: label }), i]);
  };
  const isAudio = anim.mode === 'audio';
  const kids = [];
  if (isAudio) {
    kids.push(selectInput(AUDIO_BANDS.map((bnd) => ({ value: bnd, label: bnd })), anim.band || 'level',
      (bnd) => onAnim({ ...anim, band: bnd })));
    kids.push(mini('in', anim.from, (v) => onAnim({ ...anim, from: v })));
    kids.push(mini('out', anim.to, (v) => onAnim({ ...anim, to: v })));
    kids.push(mini('gain', anim.gain ?? 1, (v) => onAnim({ ...anim, gain: v })));
  } else {
    kids.push(dirButtons(anim.direction, (d) => onAnim({ ...anim, direction: d })));
    kids.push(mini('in', anim.from, (v) => onAnim({ ...anim, from: v })));
    kids.push(mini('out', anim.to, (v) => onAnim({ ...anim, to: v })));
    kids.push(mini('s', anim.durationMs / 1000, (v) => onAnim({ ...anim, durationMs: Math.max(0, Math.round(v * 1000)) })));
  }
  return el('div', { className: 'anim-ctrls' }, kids);
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
export function createLayerPanel({ getShow, setShow, onChange, transport, mounts, thumbnails = {}, onClipSelect, onLayerSelect }) {
  const root = el('div', { className: 'fx-panel cmp2-panel' });
  let deckCells = [];        // clip cells by deck index (for the playhead highlight)
  let playheadIndex = -1;
  let selectedClipId = null; // inspector target — SELECT (click) is decoupled from ACTIVE (trigger)
  let selectedLayerId = null; // which layer the Layer inspector edits
  let selectedEffect = null; // a selected effect row: { scope:'clip'|'layer', layerId, clipId?, index } — Backspace deletes it
  const fxSel = (scope, layerId, clipId, index) => selectedEffect
    && selectedEffect.scope === scope && selectedEffect.layerId === layerId
    && selectedEffect.clipId === clipId && selectedEffect.index === index;
  const BLEND_MODES = ['add', 'screen', 'multiply', 'alpha'];

  function setPlayhead(i) {
    if (i === playheadIndex) return;
    playheadIndex = i;
    deckCells.forEach((cell, idx) => cell.classList.toggle('clip-playhead', idx === i));
  }

  // Move each animated param's live marker + readout to its value at time t
  // (selected clip + composition FX). Cheap: only touches data-animkey nodes.
  function applyLive(container, anim, t, bands) {
    if (!anim || !container) return;
    for (const k of Object.keys(anim)) {
      const node = container.querySelector(`[data-animkey="${k}"]`);
      if (!node) continue;
      const v = animatedValue(anim[k], t, bands);
      // Range track: slide the live marker along [min,max]. (Fallback: a plain input.)
      const lo = Number(node.dataset.min), hi = Number(node.dataset.max);
      const live = node.querySelector?.('.anim-live');
      if (live && hi > lo) live.style.left = `${Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100}%`;
      else if (node.tagName === 'INPUT') node.value = String(v);
      const out = node.closest('.anim-param')?.querySelector('.ly-readout');
      if (out) out.textContent = fmtLive(v);
    }
  }
  function updateLive(t, bands) {
    const layers = getShow().composition?.layers || [];
    if (!layers.length) return;
    // The selected clip can live in any layer; the composition FX shown is the top layer's.
    let sel = null;
    for (const L of layers) { sel = (L.clips || []).find((c) => c.id === selectedClipId); if (sel) break; }
    applyLive(mounts?.inspectorClip || root, sel?.anim, t, bands);
    applyLive(mounts?.inspectorComposition || root, layers[layers.length - 1].anim, t, bands);
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
  // The layer head fader and the inspector opacity slider are the SAME value —
  // keep both DOM controls in step live (neither triggers a re-render mid-drag).
  function syncLayerOpacity(id, v) {
    const dl = document.querySelector(`.deck-layer[data-layer="${id}"]`);
    if (dl) {
      const r = dl.querySelector('.lh-op-range'); if (r) r.value = String(v);
      const o = dl.querySelector('.lh-op-val'); if (o) o.textContent = Math.round((Number(v) || 0) * 100) + '%';
    }
    const insp = document.querySelector(`.ly-param[data-opacity-layer="${id}"]`);
    if (insp) {
      const r = insp.querySelector('input[type=range]'); if (r) r.value = String(v);
      const o = insp.querySelector('.ly-readout');
      if (o && document.activeElement !== o) { if (o.tagName === 'INPUT') o.value = fmt(v); else o.textContent = fmt(v); }
    }
  }

  const show = () => getShow();
  const firstLayer = () => getShow().composition?.layers?.[0] || null;
  const layerById = (lid) => (getShow().composition?.layers || []).find((L) => L.id === lid) || null;
  const layerOfClip = (cid) => (getShow().composition?.layers || []).find((L) => (L.clips || []).some((c) => c.id === cid)) || null;
  const topLayer = () => { const ls = getShow().composition?.layers || []; return ls[ls.length - 1] || null; };
  // Live clip lookup (presets read CURRENT params, not the captured render-time clip).
  const liveClip = (cid) => layerOfClip(cid)?.clips.find((c) => c.id === cid) || null;

  // The param subset of `params` whose keys are prefixed by `name + '.'`.
  const paramsForPrefix = (params, name) => {
    const out = {}; const pfx = name + '.';
    for (const k of Object.keys(params || {})) if (k.startsWith(pfx)) out[k] = params[k];
    return out;
  };

  // A single "⋯" options button: a popover with preset load, save, reset and
  // (for effects) remove. Shared by effect rows and the clip preset control, so
  // sources and effects manage saved looks the same way. `kind` selects the
  // preset namespace ('effect' | 'source'); pass onRemove only for effects.
  function fxMenu({ kind = 'effect', presetName, getParams, applyParams, onReset, onRemove, onDuplicate, resetLabel = 'reset' }) {
    const wrap = el('div', { className: 'fx-menu-wrap' });
    const menu = el('div', { className: 'fx-menu', hidden: true });
    const close = () => { menu.hidden = true; };
    const item = (label, onClick, cls = '') => el('button', {
      className: 'fx-menu-item ' + cls, textContent: label,
      onclick: (e) => { e.stopPropagation(); onClick(); },
    });
    const names = listPresets(kind, presetName);
    if (names.length) {
      menu.append(el('div', { className: 'fx-menu-label', textContent: 'presets' }));
      for (const n of names) menu.append(item(n, () => { const p = loadPreset(kind, presetName, n); if (p) applyParams(p); close(); }));
      menu.append(el('div', { className: 'fx-menu-sep' }));
    }
    menu.append(item('save preset…', () => {
      const pn = window.prompt(`Save ${presetName} preset as:`);
      if (pn && pn.trim()) { savePreset(kind, presetName, pn.trim(), getParams()); render(); }
    }));
    if (onDuplicate) menu.append(item('duplicate', () => onDuplicate()));
    menu.append(item(resetLabel, () => onReset()));        // commits → re-renders
    if (onRemove) menu.append(item('remove', () => onRemove(), 'fx-menu-danger'));
    const btn = el('button', { className: 'fx-menu-btn', textContent: '⋯', title: onRemove ? 'effect options' : 'preset options' });
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
    const layers = getShow().composition?.layers || [];
    // Clear each distinct container once.
    const seen = new Set();
    for (const c of [deckEl, clipEl, layerEl, compEl, libraryEl]) {
      if (!seen.has(c)) { c.textContent = ''; seen.add(c); }
    }

    if (!layers.length) {
      deckEl.append(el('div', { className: 'ly-hint', textContent: 'no composition layer' }));
      deckEl.append(el('button', { className: 'fx-add deck-addlayer', textContent: '+ layer', onclick: () => commit(addLayer(show())) }));
      libraryEl.append(composerRail());
      return;
    }

    // --- DECK region: one row per layer, TOP-of-stack first (Resolume-style:
    //     the top row renders on top — it's the LAST layer in the array). A
    //     "+ layer" button adds another. Transport moved to the Layer autopilot.
    const deckBox = el('div', { className: 'deck-layers' });
    // Pad every layer's deck to the same column count so clips line up vertically
    // into a Resolume-style grid (max clips across layers + 1 trailing empty).
    const maxClips = layers.reduce((m, L) => Math.max(m, (L.clips || []).length), 0);
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      deckBox.append(el('div', {
        className: 'deck-layer' + (layer.minimized ? ' is-min' : '') + (layer.id === selectedLayerId ? ' is-sel' : ''),
        'data-layer': layer.id,
      }, [layerHead(layer, layer.id, i, layers.length > 1), clipDeck(layer, layer.id, maxClips)]));
    }
    deckEl.append(deckBox);
    deckEl.append(el('button', { className: 'fx-add deck-addlayer', textContent: '+ layer', onclick: () => commit(addLayer(show())) }));

    // --- CLIP inspector: the SELECTED clip, found across ALL layers ----------
    let selLayer = layers.find((L) => (L.clips || []).some((c) => c.id === selectedClipId));
    if (!selLayer) { selLayer = layers[layers.length - 1]; selectedClipId = selLayer.activeClipId; }
    const selClip = (selLayer.clips || []).find((c) => c.id === selectedClipId);
    if (selClip) clipEl.append(selectedClipEditor(selLayer.id, selClip));
    else clipEl.append(el('div', { className: 'ly-hint', textContent: 'no clip selected' }));

    // --- LAYER inspector: the selected layer's settings ----------------------
    if (!layers.some((L) => L.id === selectedLayerId)) selectedLayerId = selLayer.id;
    const inspLayer = layers.find((L) => L.id === selectedLayerId) || selLayer;
    layerEl.append(layerSettings(inspLayer, inspLayer.id));

    // COMPOSITION effects (3rd tier) — applied to the final composite of ALL
    // layers. Lives at the bottom of the Composition tab (#insp-compfx).
    compEl.append(compositionFx());

    // --- LIBRARY region: draggable Sources + Effects -------------------------
    libraryEl.append(composerRail());
  }

  // Composition effect chain — applied to the WHOLE composite (all layers), after
  // each layer's own chain. Edits composition.effects / composition.params.
  function compositionFx() {
    const comp = getShow().composition || {};
    const fxs = comp.effects || [];
    const box = el('div', { className: 'comp-fx' });
    box.append(Section('Effects', 'comp-fx', (b) => {
      for (let fx = 0; fx < fxs.length; fx++) b.append(compEffectBlock(fx, fxs));
      const dropZone = el('div', { className: 'composer-drop', textContent: '▸ drop effect here' });
      makeDropTarget(dropZone, (payload) => {
        if (payload.kind === 'effect') commit(addCompositionEffect(show(), payload.name));
      });
      b.append(dropZone);
    }, undefined, fxs.length === 0));
    return box;
  }

  // One composition effect block — drag-reorder + click-to-select + "⋯" menu.
  function compEffectBlock(fx, effects) {
    const name = effects[fx];
    const entry = getEntry(name);
    const comp = getShow().composition || {};
    const block = el('div', { className: 'ly-fx ly-fx-layer' + (fxSel('comp', null, undefined, fx) ? ' is-sel' : '') });
    makeDropTarget(block, (payload) => {
      if (payload.kind === 'fx-comp' && payload.index !== fx) commit(moveCompositionEffect(show(), payload.index, fx - payload.index));
    });
    const head = el('div', { className: 'ly-fxhead', draggable: true }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${labelOf(name)}` }),
    ]);
    head.addEventListener('dragstart', (e) => { drag = { kind: 'fx-comp', index: fx }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'fx'); });
    head.addEventListener('dragend', () => { drag = null; });
    head.addEventListener('click', () => { selectedEffect = { scope: 'comp', layerId: null, clipId: undefined, index: fx }; render(); });
    head.append(fxMenu({
      presetName: entry?.name || name,
      getParams: () => paramsForPrefix(getShow().composition?.params, name),
      applyParams: (p) => commit(mergeCompositionParams(show(), p)),
      onReset: () => commit(mergeCompositionParams(show(), prefixedDefaults(name))),
      onRemove: () => commit(removeCompositionEffect(show(), fx)),
    }));
    block.append(head);
    if (entry) {
      for (const p of entry.params) {
        const key = entry.name + '.' + p.key;
        block.append(animatableParam({
          key, p, value: comp.params?.[key], anim: comp.anim?.[key],
          onValue: (v) => commitLive(setCompositionParam(show(), key, v)),
          onAnim: (spec) => commit(setCompositionAnim(show(), key, spec)),
        }));
      }
    }
    return block;
  }

  // One composition (layer) effect block — drag-reorder + "⋯" menu. Params write
  // layer.params via setLayerParam (a distinct namespace from clip effects).
  function layerEffectBlock(id, fx, effects) {
    const name = effects[fx];
    const entry = getEntry(name);
    const layer = layerById(id);
    const block = el('div', { className: 'ly-fx ly-fx-layer' + (fxSel('layer', id, undefined, fx) ? ' is-sel' : '') });
    makeDropTarget(block, (payload) => {
      if (payload.kind === 'fx-layer' && payload.index !== fx) {
        commit(moveLayerEffect(show(), id, payload.index, fx - payload.index));
      }
    });

    const head = el('div', { className: 'ly-fxhead', draggable: true }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${labelOf(name)}` }),
    ]);
    head.addEventListener('click', () => { selectedEffect = { scope: 'layer', layerId: id, clipId: undefined, index: fx }; render(); });
    head.addEventListener('dragstart', (e) => {
      drag = { kind: 'fx-layer', index: fx };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'fx');
    });
    head.addEventListener('dragend', () => { drag = null; });
    head.append(fxMenu({
      presetName: entry?.name || name,
      getParams: () => paramsForPrefix(layerById(id)?.params, name),
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


  // The clip deck. Each cell: click = trigger; accepts a dragged SOURCE (replace
  // + trigger) or EFFECT (append to that clip). The "+" cell accepts a SOURCE to
  // create a new clip, with a generator <select> as a no-drag fallback.
  function clipDeck(layer, id, columns = 0) {
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
          selectThis();   // dropping an effect also selects the clip you dropped on
          commit(addClipEffect(show(), id, clip.id, payload.name));
        } else if (payload.kind === 'clip' && payload.clipId !== clip.id) {
          // Reorder: move the dragged clip to this clip's position.
          const cur = (layerById(id)?.clips || []);
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

    // Exactly ONE trailing empty slot — a drop target / "+" to add the next clip.
    // (Filling it makes a new clip, and a fresh empty slot reappears after it.)
    const emptyCount = Math.max(1, (columns - clips.length) + 1);
    for (let e = 0; e < emptyCount; e++) {
      const slot = el('div', { className: 'clip-cell clip-empty', title: 'drag a source here' }, [
        el('div', { className: 'clip-empty-plus', textContent: '+' }),
      ]);
      makeDropTarget(slot, (payload) => {
        if (payload.kind === 'source') commit(addClip(show(), id, payload.name));
        else if (payload.kind === 'clip') {
          // Move the dragged clip to the end of the deck.
          const cur = layerById(id)?.clips || [];
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

    // Autopilot (Resolume-style): play-through of the clip deck as a timeline.
    // Always loops (transport.loop defaults true) — no toggle needed.
    if (transport) {
      const playing = transport.isPlaying();
      box.append(Section('Autopilot', 'autopilot', (b) => {
        b.append(el('div', { className: 'autopilot' }, [
          el('button', {
            className: 'transport-play' + (playing ? ' is-playing' : ''),
            textContent: playing ? '■ stop' : '▶ play',
            onclick: () => { transport.toggle(); if (!transport.isPlaying()) setPlayhead(-1); render(); },
          }),
        ]));
      }));
    }

    box.append(Section('Composition', 'layer-comp', (b) => {
      b.append(field('blend mode', selectInput(BLEND_MODES, layer.blend ?? 'add',
        (m) => commit(patchLayer(show(), id, { blend: m })))));
      const opacityRow = sliderField('opacity', layer.opacity ?? 1, 0, 1,
        (v) => { commitLive(patchLayer(show(), id, { opacity: v })); syncLayerOpacity(id, v); }, 1);
      opacityRow.dataset.opacityLayer = id;
      b.append(opacityRow);
      // (crossfade is now a GLOBAL setting in the Composition tab.)
    }, () => commit(patchLayer(show(), id, { blend: 'add', opacity: 1 }))));

    // Layer effect chain (applied to the whole layer's output, after its active
    // clip + that clip's effects). Locked open while empty so the drop target stays.
    const layerFx = layer.effects || [];
    box.append(Section('Effects', 'layer-effects', (b) => {
      for (let fx = 0; fx < layerFx.length; fx++) b.append(layerEffectBlock(id, fx, layerFx));
      const dropZone = el('div', { className: 'composer-drop', textContent: '▸ drop effect here' });
      makeDropTarget(dropZone, (payload) => {
        if (payload.kind === 'effect') commit(addLayerEffect(show(), id, payload.name));
      });
      b.append(dropZone);
    }, undefined, layerFx.length === 0));

    // Delete this layer (only when more than one exists — keep at least one).
    if ((show().composition?.layers || []).length > 1) {
      box.append(el('button', {
        className: 'fx-del-link', textContent: 'delete layer',
        onclick: () => {
          if (!window.confirm(`Delete "${layer.name ?? 'layer'}" and its clips?`)) return;
          selectedLayerId = null; commit(removeLayer(show(), id));
        },
      }));
    }
    return box;
  }

  // Resolume-style layer control block: a vertical opacity fader (the "V"),
  // clear/eject + blend controls, and the layer name bar at the bottom.
  function layerHead(layer, id, index, canReorder) {
    const pct = (v) => Math.round((v ?? 1) * 100) + '%';
    const head = el('div', {
      className: 'layer-head-box lh-clickable',
      title: canReorder ? 'click to edit · double-click to minimise · drag to reorder' : 'click to edit · double-click to minimise',
      draggable: canReorder,
    });
    // Click → select this layer (Layer inspector) · double-click → minimise.
    head.addEventListener('click', () => { selectedLayerId = id; onLayerSelect?.(); render(); });
    head.addEventListener('dblclick', () => commit(patchLayer(show(), id, { minimized: !layer.minimized })));
    // Drag the head to reorder layers (drop onto another layer row).
    head.addEventListener('dragstart', (e) => {
      drag = { kind: 'layer', layerId: id, index };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'layer:' + id);
    });
    head.addEventListener('dragend', () => { drag = null; });
    // Drop another layer's head here → reorder it to this layer's position.
    makeDropTarget(head, (payload) => {
      if (payload.kind === 'layer' && payload.layerId !== id) {
        commit(moveLayer(show(), payload.layerId, index - payload.index));
      }
    });
    const body = el('div', { className: 'lh-body' });

    // Vertical opacity fader.
    const opCol = el('div', { className: 'lh-op' });
    const opOut = el('span', { className: 'lh-op-val', textContent: pct(layer.opacity ?? 1) });
    const opRange = el('input', {
      type: 'range', min: '0', max: '1', step: '0.001', value: String(layer.opacity ?? 1),
      className: 'lh-op-range', title: 'layer opacity',
    });
    opRange.addEventListener('input', () => {
      const v = Number(opRange.value);
      opOut.textContent = pct(v);
      commitLive(patchLayer(show(), id, { opacity: v }));
      syncLayerOpacity(id, v);
    });
    // The fader lives inside the draggable head, so a press on it can otherwise
    // start a native layer-reorder drag. Suspend draggable while the fader is
    // grabbed; restore it on release.
    opRange.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      head.draggable = false;
      const restore = () => { head.draggable = canReorder; window.removeEventListener('pointerup', restore); };
      window.addEventListener('pointerup', restore);
    });
    opCol.append(opOut, opRange);

    // Body = FOUR equal quarters: B · S · ✕ · opacity (vertical slider, right).
    // stopPropagation so the buttons don't also fire the layer-select click.
    const tog = (label, on, title, fn) => el('button', {
      className: 'lh-tog' + (on ? ' on' : ''), textContent: label, title,
      onclick: (e) => { e.stopPropagation(); fn(); },
    });
    body.append(
      tog('B', !!layer.bypass, layer.bypass ? 'un-bypass layer' : 'bypass (mute) this layer',
        () => commit(patchLayer(show(), id, { bypass: !layer.bypass }))),
      tog('S', !!layer.solo, layer.solo ? 'un-solo layer' : 'solo this layer',
        () => commit(patchLayer(show(), id, { solo: !layer.solo }))),
      el('button', {
        className: 'lh-clear', textContent: '✕', title: 'clear (eject active clip)',
        onclick: (e) => { e.stopPropagation(); commit(setActiveClip(show(), id, null)); },
      }),
      opCol,
    );
    head.append(body);

    // (Blend mode lives only in the contextual Layer inspector — not the head.)

    // Layer name bar (Resolume highlights the active layer's name bar).
    const name = el('input', { className: 'lh-name', value: layer.name ?? 'Layer 1', title: 'layer name' });
    name.addEventListener('change', () => commit(patchLayer(show(), id, { name: name.value })));
    name.addEventListener('click', (e) => e.stopPropagation());
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

    // Header: clip name + a "⋯" preset menu in the corner (load/save/reset a
    // saved look), mirroring how effect rows carry their options menu.
    const clipHead = el('div', { className: 'clip-editor-head' }, [nameInput]);
    if (gen && gen.params.length) {
      clipHead.append(fxMenu({
        kind: 'source', presetName: gen.name, resetLabel: 'reset all',
        getParams: () => paramsForPrefix(liveClip(clip.id)?.params, gen.name),
        applyParams: (p) => commit(mergeClipParams(show(), id, clip.id, p)),
        onDuplicate: () => {
          const next = duplicateClip(show(), id, clip.id);
          const layer = next.composition.layers.find((l) => l.id === id);
          const dup = layer.clips[layer.clips.findIndex((c) => c.id === clip.id) + 1];
          if (dup) { selectedClipId = dup.id; onClipSelect?.(); }
          commit(next);
        },
        // "reset all" here resets the clip: source params + transform + opacity.
        onReset: () => {
          let s = changeClipGenerator(show(), id, clip.id, clip.generator);
          s = resetClipTransform(s, id, clip.id);
          commit(s);
        },
      }));
    }
    box.append(clipHead);

    // Triggerable sources (Pulse) get a prominent Trigger button here.
    if (gen?.triggerable && transport?.fire) {
      box.append(el('button', {
        className: 'clip-trigger', textContent: '⚡ trigger',
        title: 'fire the pulse', onclick: () => transport.fire(),
      }));
    }

    // Playback: how long the layer's autopilot dwells on this clip.
    box.append(Section('Playback', 'playback', (b) => {
      b.append(sliderField('duration', (clip.durationMs ?? 4000) / 1000, 0.1, 30,
        (v) => commitLive(setClipDuration(show(), id, clip.id, Math.round(v * 1000))), 4));
    }, () => commit(setClipDuration(show(), id, clip.id, 4000))));

    // Source: the generator's own look params (auto-generated from the manifest).
    if (gen && gen.params.length) {
      box.append(Section('Source', 'source', (b) => {
        for (const p of gen.params) {
          const key = gen.name + '.' + p.key;
          b.append(animatableParam({
            key, p, value: clip.params?.[key], anim: clip.anim?.[key],
            onValue: (v) => commitLive(setClipParam(show(), id, clip.id, key, v)),
            onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, key, spec)),
          }));
        }
      }, () => commit(changeClipGenerator(show(), id, clip.id, clip.generator))));
    }

    // Transform + opacity (the clip's placement on the canvas) — all animatable
    // (Timeline/Audio) via the cog, like the source params. Anim keyed `tf.*`.
    const t = clip.transform || {};
    box.append(Section('Transform', 'transform', (b) => {
      const tfParam = (key, label, min, max, def, value, apply) => b.append(animatableParam({
        key: 'tf.' + key, p: { key: label, type: 'float', min, max, default: def },
        value, anim: clip.anim?.['tf.' + key],
        onValue: (v) => commitLive(apply(v)),
        onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, 'tf.' + key, spec)),
      }));
      tfParam('x', 'x', -1, 1, 0, t.x ?? 0, (v) => setClipTransform(show(), id, clip.id, { x: v }));
      tfParam('y', 'y', -1, 1, 0, t.y ?? 0, (v) => setClipTransform(show(), id, clip.id, { y: v }));
      tfParam('scale', 'scale', 0, 3, 1, t.scale ?? 1, (v) => setClipTransform(show(), id, clip.id, { scale: v }));
      tfParam('rotation', 'rotation', -180, 180, 0, t.rotation ?? 0, (v) => setClipTransform(show(), id, clip.id, { rotation: v }));
      tfParam('opacity', 'opacity', 0, 1, 1, clip.opacity ?? 1, (v) => setClipOpacity(show(), id, clip.id, v));
    }, () => commit(resetClipTransform(show(), id, clip.id))));

    // Effect chain. Locked open while empty so the drop target stays reachable
    // (collapsing an empty Effects group would hide the only way to add one).
    const clipFx = clip.effects || [];
    box.append(Section('Effects', 'effects', (b) => {
      for (let fx = 0; fx < clipFx.length; fx++) b.append(clipEffectBlock(id, clip, fx, clipFx));
      const dropZone = el('div', { className: 'composer-drop', textContent: '▸ drop effect here' });
      makeDropTarget(dropZone, (payload) => {
        if (payload.kind === 'effect') commit(addClipEffect(show(), id, clip.id, payload.name));
      });
      b.append(dropZone);
    }, undefined, clipFx.length === 0));
    return box;
  }

  // One clip effect block: a drag-to-reorder block with a "⋯" options menu.
  function clipEffectBlock(id, clip, fx, effects) {
    const name = effects[fx];
    const entry = getEntry(name);
    const block = el('div', { className: 'ly-fx ly-fx-clip' + (fxSel('clip', id, clip.id, fx) ? ' is-sel' : '') });
    makeDropTarget(block, (payload) => {
      if (payload.kind === 'fx-clip' && payload.index !== fx) {
        commit(moveClipEffect(show(), id, clip.id, payload.index, fx - payload.index));
      }
    });

    // The header is the drag handle (so sliders inside still scrub normally).
    // Clicking it SELECTS the effect (Backspace then deletes it).
    const head = el('div', { className: 'ly-fxhead', draggable: true }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${labelOf(name)}` }),
    ]);
    head.addEventListener('click', () => { selectedEffect = { scope: 'clip', layerId: id, clipId: clip.id, index: fx }; render(); });
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

    // Two panes — Sources (generators + video) and Effects — switched by a tab
    // bar that mirrors the inspector's Clip/Layer/Composition sub-tabs.
    const sources = el('div', { className: 'lib-pane' });
    sources.append(libList('source', generatorNames()), videoAddItem());
    const effects = el('div', { className: 'lib-pane' });
    effects.append(libList('effect', effectNames()));

    const tabs = el('div', { className: 'subtabs lib-tabs' });
    const mkTab = (key, label) => {
      const t = el('button', {
        className: 'subtab' + (libTab === key ? ' subtab-active' : ''), textContent: label,
      });
      t.addEventListener('click', () => {
        libTab = key;
        sources.hidden = key !== 'source';
        effects.hidden = key !== 'effect';
        tabs.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('subtab-active', b === t));
      });
      return t;
    };
    tabs.append(mkTab('source', 'sources'), mkTab('effect', 'effects'));
    sources.hidden = libTab !== 'source';
    effects.hidden = libTab !== 'effect';

    rail.append(tabs, sources, effects);
    return rail;
  }

  // "+ Video…" — pick a video file and add it as a new clip.
  function videoAddItem() {
    const item = el('div', { className: 'lib-item lib-video', title: 'add a video file as a clip' }, [
      el('span', { className: 'lib-label', textContent: '+ video…' }),
    ]);
    item.addEventListener('click', () => {
      const inp = el('input', { type: 'file', accept: 'video/*' });
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        const l = layerOfClip(selectedClipId) || topLayer();
        if (!f || !l) return;
        const name = f.name.replace(/\.[^.]+$/, '');
        const next = addVideoClip(show(), l.id, name, URL.createObjectURL(f));
        const layer = next.composition.layers.find((x) => x.id === l.id);
        selectedClipId = layer.clips[layer.clips.length - 1].id;
        onClipSelect?.();
        commit(next);
      });
      inp.click();
    });
    return item;
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

  // Delete the currently-selected EFFECT (Backspace). Returns true if it acted,
  // so app.js can fall back to deleting the clip when no effect is selected.
  function deleteSelectedEffect() {
    const s = selectedEffect;
    if (!s) return false;
    selectedEffect = null;
    if (s.scope === 'clip') commit(removeClipEffect(show(), s.layerId, s.clipId, s.index));
    else if (s.scope === 'layer') commit(removeLayerEffect(show(), s.layerId, s.index));
    else commit(removeCompositionEffect(show(), s.index));
    return true;
  }

  // Delete the selected clip (bound to the Delete key by app.js).
  function deleteActiveClip() {
    const l = layerOfClip(selectedClipId) || topLayer();
    const target = selectedClipId || l?.activeClipId;
    if (!l || !target) return;
    // Keep a clip selected: hop to the next clip (or the previous if it was last).
    const clips = l.clips || [];
    const i = clips.findIndex((c) => c.id === target);
    selectedClipId = clips[i + 1]?.id ?? clips[i - 1]?.id ?? null;
    commit(removeClip(show(), l.id, target));
  }

  render();
  return { el: root, refresh: render, setPlayhead, updateLive, deleteActiveClip, deleteSelectedEffect };
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
