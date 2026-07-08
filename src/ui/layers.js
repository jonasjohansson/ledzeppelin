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
  generatorNames, effectNames, effectKind, getEntry, labelOf, descOf,
} from '../engine/shaders/manifest.js';
import { CATEGORY_COLORS, CATEGORY_TABS, sourceCategory, filterSources } from './source-catalog.js';
import {
  addClip, addClipAt, addVideoClip, removeClip, moveClip, moveClipToLayer, duplicateClip, setActiveClip, changeClipGenerator,
  setClipParam, addClipEffect, removeClipEffect, moveClipEffect, setClipEffectParam,
  addLayerEffect, removeLayerEffect, moveLayerEffect, setLayerParam,
  addCompositionEffect, removeCompositionEffect, moveCompositionEffect,
  setCompositionParam, mergeCompositionParams, setCompositionAnim,
  setClipTransform, setClipOpacity, setClipDuration, resetClipTransform,
  setClipAnim, setLayerAnim, patchLayer, setCompositionOpacity,
  removeLayer, moveLayer,
  mergeClipParams, mergeLayerParams, prefixedDefaults,
  setDashboardLinkValue, setDashboardLinkName,
} from '../model/layers.js';
import { dashboardLinkLabels } from '../model/dashboard.js';
import { Knob } from './kit/knob.js';
import { makeAnim, makeAudioAnim, makeExternalAnim, makeDashboardAnim, animatedValue, retimeAnim } from '../model/anim.js';
import { addressFor } from '../model/osc-map.js';
import { hasRemoteControl, toggleRemoteControl } from '../model/remote.js';
import { AUDIO_BANDS, enableAudio, audioEnabled, disableExternal } from '../model/audio.js';   // enableAudio(source) — 'external' | 'composition'
import { extList } from '../model/external.js';
import { listPresets, savePreset, loadPreset, deletePreset } from '../model/presets.js';
import { Section } from './section.js';
import { el, field, selectInput, shiftDown, coarseSnap } from './dom.js';
import { Slider } from './controls.js';
import { placePopover, dismissOnOutside } from './kit/popover.js';
import { confirmDelete } from './confirm.js';
import { createClipSpectrum } from './spectrum.js';

const BLEND_MODES = ['add', 'screen', 'multiply', 'alpha'];

// Param keys in the manifest are terse (lowercase / camelCase: `pos`, `headWidth`,
// `modFreq`). Show them title-cased with the camelCase seam split, so labels read
// like a pro UI ("Pos", "Head Width", "Mod Freq") without changing the model keys.
const prettyParam = (key) =>
  String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

const fmt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};
// Format for the LIVE animated readout — FIXED 2 decimals, never trimmed: a
// sweeping value that collapses "2.00" → "2" as it crosses a round number makes
// the display skip width every cycle. Constant shape = calm counting.
const fmtLive = (v) => (Number(v) || 0).toFixed(2);

// Clip/layer param slider — live commit (writes on every drag tick). Thin wrapper
// over the shared Slider; right-click resets to defaultValue.
const sliderField = (label, value, min, max, onInput, defaultValue, stepOverride) =>
  Slider(label, value, { min, max, onInput, default: defaultValue, step: stepOverride });

// Build a control for one manifest param.
function paramControl(p, value, onInput) {
  if (p.type === 'color') {
    const i = el('input', { type: 'color', className: 'fx-color', value: value || '#ffffff' });
    i.addEventListener('input', () => onInput(i.value));
    return field(prettyParam(p.key), i);
  }
  if (p.type === 'bool') {
    const i = el('input', { type: 'checkbox', checked: !!value });
    i.addEventListener('change', () => onInput(i.checked));
    // Inline row: label left, checkbox right (matches the slider params).
    return el('label', { className: 'fx-field bool-row' }, [
      el('span', { className: 'ly-plabel', textContent: prettyParam(p.key) }), i,
    ]);
  }
  const min = p.min ?? 0, max = p.max ?? 1;
  const v = value == null ? (p.default ?? min) : value;
  return sliderField(prettyParam(p.key), v, min, max, onInput, p.default ?? min, p.step);
}

// A dual-handle range track for an animated param: two thumbs mark `in` and `out`
// on the [min,max] track (Resolume-style), with a fill between and a live marker
// the render loop moves to the current animated value. Dragging a thumb commits
// on release (change) — the fill follows live (input) without re-rendering.
function rangeTrack({ min, max, step, from, to, animKey, onFrom, onTo, onLiveFrom, onLiveTo, ticks }) {
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
  // The in/out VALUES live on the handles themselves: grabbing a thumb pops a
  // tiny editable bubble above it that follows the drag; type into it to set an
  // exact value. This replaces the separate in/out number fields below the track.
  const wrap = el('div', { className: 'range-track' });
  const mkBubble = () => el('input', { type: 'text', inputMode: 'decimal', className: 'rt-bubble', hidden: true, spellcheck: false });
  const inBub = mkBubble(), outBub = mkBubble();
  const place = (bub, rangeEl) => {
    const w = wrap.clientWidth || 1;
    const x = frac(Number(rangeEl.value)) * (w - 12) + 6;
    bub.style.left = `${Math.max(23, Math.min(w - 23, x))}px`;   // keep the 44px bubble on the track
    if (document.activeElement !== bub) bub.value = fmtLive(Number(rangeEl.value));
  };
  let hideHook = null;
  const showBubbles = () => {
    inBub.hidden = outBub.hidden = false;
    place(inBub, inEl); place(outBub, outEl);
    if (!hideHook) {   // dismiss when interaction leaves the track
      hideHook = (ev) => {
        if (wrap.contains(ev.target)) return;
        inBub.hidden = outBub.hidden = true;
        document.removeEventListener('pointerdown', hideHook); hideHook = null;
      };
      document.addEventListener('pointerdown', hideHook);
    }
  };
  const typeCommit = (bub, rangeEl, fire) => {
    bub.addEventListener('keydown', (e) => { if (e.key === 'Enter') bub.blur(); });
    bub.addEventListener('change', () => {
      const v = Number(bub.value.trim().replace(',', '.'));
      if (Number.isFinite(v)) { const c = Math.min(max, Math.max(min, v)); rangeEl.value = String(c); layout(); fire(c); }
      else bub.value = fmt(Number(rangeEl.value));
    });
  };
  typeCommit(inBub, inEl, onFrom); typeCommit(outBub, outEl, onTo);
  inEl.addEventListener('pointerdown', showBubbles);
  outEl.addEventListener('pointerdown', showBubbles);
  // Shift snaps either handle to 10 coarse stops across the range (like the sliders).
  const coarse = (rangeEl) => { if (shiftDown) rangeEl.value = String(coarseSnap(Number(rangeEl.value), min, max)); };
  inEl.addEventListener('input', () => { coarse(inEl); layout(); place(inBub, inEl); onLiveFrom?.(Number(inEl.value)); });
  outEl.addEventListener('input', () => { coarse(outEl); layout(); place(outBub, outEl); onLiveTo?.(Number(outEl.value)); });
  inEl.addEventListener('change', () => onFrom(Number(inEl.value)));
  outEl.addEventListener('change', () => onTo(Number(outEl.value)));
  // Beat-sync tick marks: divide the track into `ticks` equal segments (e.g. 8
  // beats → 7 interior ticks) so the loop's beat grid reads at a glance.
  const tickLayer = el('div', { className: 'rt-ticks' });
  const nTicks = Math.round(Number(ticks) || 0);
  if (nTicks > 1) for (let i = 1; i < nTicks; i++) {
    const t = el('div', { className: 'rt-tick' }); t.style.left = `${(i / nTicks) * 100}%`; tickLayer.append(t);
  }
  wrap.append(el('div', { className: 'rt-base' }), tickLayer, fill, live, inEl, outEl, inBub, outBub);
  wrap.dataset.animkey = animKey;
  wrap.dataset.min = String(min); wrap.dataset.max = String(max);
  layout();
  return wrap;
}

// A numeric param that can be BASIC (static slider) or ANIMATED (Timeline/
// Audio/External). The cog picks the mode. When animated the row becomes a
// dual-handle in/out range track (tagged data-animkey so the render loop moves
// the live marker) and a controls row appears below (direction · in · out · s,
// band · in · out · gain, or channel · in · out · gain).
//   onValue(v): set the static value · onAnim(spec|null): set/clear the animation
//   oscAddress: the param's CANONICAL always-active OSC address (shown in the
//   External controls as a copyable chip), when the scheme covers it.
function animatableParam({ key, p, value, anim, onValue, onAnim, onAnimLive, oscAddress }) {
  if (p.type === 'color' || p.type === 'bool') return paramControl(p, value, onValue);
  const min = p.min ?? 0, max = p.max ?? 1;
  const animated = !!anim;
  const isAudio = anim?.mode === 'audio';
  const isExternal = anim?.mode === 'external';
  const isDashboard = anim?.mode === 'dashboard';
  const wrap = el('div', { className: 'anim-param' });
  const cog = animModeMenu({
    animated, isAudio, isExternal, isDashboard, audioSource: anim?.source, oscAddress,
    label: prettyParam(p.key),
    onPick: (mode) => {
      // Default the sweep to the FULL slider range (in = min, out = max).
      if (mode === 'basic') onAnim(null);
      // Dashboard: follow a global link (default the first), full range.
      else if (mode === 'dashboard') onAnim(makeDashboardAnim(min, max, (isDashboard && anim.link) || dashLinks()[0]?.id || '', isDashboard ? anim.invert : false));
      // Two audio sources (Resolume-style): External input or Composition (clip)
      // audio. Switching source on an existing audio anim keeps its band/gain.
      else if (mode === 'audio-external' || mode === 'audio-composition') {
        const src = mode === 'audio-composition' ? 'composition' : 'external';
        enableAudio(src);
        const base = isAudio ? anim : null;
        onAnim(makeAudioAnim(base?.from ?? min, base?.to ?? max, base?.band ?? 'level', base?.gain ?? 1, src));
      }
      // Default to the first live channel, if any has been seen yet.
      else if (mode === 'external') onAnim(makeExternalAnim(min, max, extList()[0]?.channel ?? ''));
      else onAnim(makeAnim(min, max, 10000, 'forward'));
    },
  });

  if (!animated) {
    const shown = value == null ? (p.default ?? min) : value;
    const row = sliderField(prettyParam(p.key), shown, min, max, onValue, p.default ?? min, p.step);
    row.append(cog);
    wrap.append(row);
    return wrap;
  }

  // Animated layout (un-crammed): label · live value · cog, then a full-width in/out
  // track, then the mode's controls. EXCEPT dashboard — a global link drives the param
  // across its full range, so it shows just the link picker (no in/out track).
  const readout = el('span', { className: 'ly-readout', textContent: fmtLive(anim.from) });
  wrap.classList.add('is-animated');
  if (isAudio) wrap.classList.add('is-audio');
  if (isExternal) wrap.classList.add('is-external');
  if (isDashboard) wrap.classList.add('is-dashboard');
  const head = el('div', { className: 'ly-param anim-head' }, [
    el('span', { className: 'ly-plabel', textContent: prettyParam(p.key) }), readout, cog,
  ]);
  wrap.append(head);
  if (isDashboard) {
    // No track — tag the readout so the live loop still updates the shown value.
    readout.dataset.animkey = key; readout.dataset.min = min; readout.dataset.max = max;
  } else {
    const track = rangeTrack({
      min, max, step: p.step, from: anim.from, to: anim.to, animKey: key,
      // Beat-synced loops show their beat grid as tick marks on the track.
      ticks: anim.beats != null ? anim.beats : 0,
      onFrom: (v) => onAnim({ ...anim, from: v }),
      onTo: (v) => onAnim({ ...anim, to: v }),
      // Mid-drag the spec is written LIVE (commitLive — no re-render, the running
      // sweep/mapping follows the thumb in realtime); the thumb's own value bubble
      // tracks the drag. Release does the full commit + re-render.
      onLiveFrom: (v) => onAnimLive?.({ ...anim, from: v }),
      onLiveTo: (v) => onAnimLive?.({ ...anim, to: v }),
    });
    wrap.append(track);
  }
  wrap.append(animControls(anim, onAnim, oscAddress, onAnimLive));
  return wrap;
}

// The cog button + the MODE PICKER FLYOUT (Basic/Timeline/Dashboard/Audio).
// Clicking the cog opens #anim-pop — a SINGLETON vertical panel docked at the
// right edge of the LEFT SIDEBAR (#dock-left), vertically aligned with the
// clicked param's row, so it reads as a flyout sitting beside the sidebar
// (replaces the in-row slide strip). Opening from another param's cog MOVES the
// panel there; Esc / outside click closes. When the row doesn't live inside
// #dock-left (a popout or another column) the panel anchors at the cog instead
// (standard kit placement). Picking closes the panel and calls onPick — the
// commit that follows re-renders the panel's rows into the chosen state.
let animPopEl = null, animPopDismiss = null, animPopOwner = null;
function closeAnimPop() {
  if (animPopDismiss) { animPopDismiss(); animPopDismiss = null; }
  if (animPopEl) { animPopEl.remove(); animPopEl = null; }
  animPopOwner = null;
}
function animModeMenu({ animated, isAudio, isExternal, isDashboard, audioSource, onPick, oscAddress, label }) {
  const wrap = el('div', { className: 'anim-cog-wrap' });
  const cur = !animated ? 'basic'
    : isDashboard ? 'dashboard'
    : isAudio ? (audioSource === 'composition' ? 'audio-composition' : 'audio-external')
    : isExternal ? 'external' : 'timeline';
  // Compact one-line items; what each mode does lives on the HOVER title — a
  // visible description per row made this little picker read like a manual.
  const item = (mode, lbl, desc) => el('button', {
    type: 'button',
    className: 'anim-pop-item' + (mode === cur ? ' is-current' : ''),
    textContent: lbl, title: desc,
    onclick: (e) => { e.stopPropagation(); closeAnimPop(); onPick(mode); },
  });
  const open = () => {
    closeAnimPop();                           // singleton — opening elsewhere moves it
    const pop = el('div', { id: 'anim-pop' }, [
      el('div', { className: 'anim-pop-head', textContent: label || 'Modulation' }),
      item('basic', 'Basic', 'hold a value, or sweep between two'),
      item('timeline', 'Timeline', 'keyframes across the clip’s duration'),
      item('dashboard', 'Dashboard', 'follow a global Dashboard link knob'),
      item('audio-external', 'Audio Ext.', 'follow a band of a hardware audio input'),
      item('audio-composition', 'Audio Comp.', 'follow a band of the composition’s clip audio'),
      // No 'External' item: any param is bound live via System › Mapping (which
      // sets the External binding under the hood), so an explicit entry is redundant.
    ]);
    // Control tick: publishes THIS parameter to the Control surface. (Only for
    // params that have a canonical address — i.e. everything routable.)
    if (oscAddress) {
      const on = remoteHook.has(oscAddress);
      pop.append(el('button', {
        type: 'button',
        className: 'anim-pop-item anim-pop-tick' + (on ? ' is-on' : ''),
        title: 'show this parameter on the Control surface',
        onclick: (e) => { e.stopPropagation(); closeAnimPop(); remoteHook.toggle(oscAddress); },
      }, [el('span', { className: 'fx-tick-box' }), 'Control']));
    }
    // POSITION: x = the left dock's right edge + a small gap; y = the clicked
    // row's top — both clamped to the viewport, so it sits BESIDE the sidebar
    // level with the row it edits. Rows hosted outside #dock-left fall back to
    // the kit's anchored-at-the-cog placement.
    const row = wrap.parentElement || wrap;   // the .ly-param row the cog lives in
    const dock = document.getElementById('dock-left');
    document.body.append(pop);                // attach first so offsetWidth/Height measure
    if (dock && dock.contains(row)) {
      const d = dock.getBoundingClientRect(), r = row.getBoundingClientRect();
      pop.style.left = Math.max(6, Math.min(d.right + 6, window.innerWidth - 6 - pop.offsetWidth)) + 'px';
      pop.style.top = Math.max(6, Math.min(r.top, window.innerHeight - 6 - pop.offsetHeight)) + 'px';
    } else {
      placePopover(pop, wrap);
    }
    animPopEl = pop; animPopOwner = wrap;
    // The cog is OUTSIDE the body-appended panel — exempt it from the outside-
    // click dismiss so its own click reaches the toggle (close) handler below.
    animPopDismiss = dismissOnOutside(pop, closeAnimPop, wrap);
  };
  // External keeps the plain accent 'on' treatment (only Audio recolours green).
  const btn = el('button', {
    className: 'anim-cog' + (animated ? ' on' : '') + (isAudio ? ' audio' : ''),
    textContent: '⚙', title: 'animate this parameter (Basic / Timeline / Audio) · map it in System › Mapping · or expose it on the Control surface',
  });
  btn.onclick = (e) => { e.stopPropagation(); if (animPopOwner === wrap) closeAnimPop(); else open(); };
  wrap.append(btn);
  return wrap;
}

// LFO controls for timeline modulation: a base waveform (saw/sine/square/random) plus
// independent REVERSE (direction) and BOUNCE (ping-pong) toggles.
const WAVE_DEFS = [
  { value: 'saw', glyph: '↗', title: 'saw' },
  { value: 'sine', glyph: '∿', title: 'sine' },
  { value: 'square', glyph: '⊓', title: 'square' },
  { value: 'random', glyph: '⋮', title: 'random (sample & hold)' },
  { value: 'noise', glyph: '≈', title: 'noise — smooth organic drift (slow rate = drift)' },
];
// Re-phase `next` so its post-modifier sweep position equals where `prev` is right now —
// flipping reverse/bounce continues from the current value instead of jumping.
function retimeLfo(prev, next, timeSec, bpm) {
  const durOf = (s) => (s.beats ? (s.beats * 60000) / (bpm || 120) : s.durationMs);
  const dsec = (Number(durOf(next)) || 0) / 1000;
  if (dsec <= 0) return next;
  const rawT = (s) => { const ds = (Number(durOf(s)) || 0) / 1000; return ds > 0 ? (((timeSec / ds) + (Number(s.phase) || 0)) % 1 + 1) % 1 : 0; };
  const modT = (s, t) => { const rv = s.reverse != null ? !!s.reverse : s.direction === 'backward'; const bn = s.bounce != null ? !!s.bounce : s.direction === 'mirror'; if (bn) t = 1 - Math.abs(2 * t - 1); if (rv) t = 1 - t; return t; };
  const cur = modT(prev, rawT(prev));                // current output position 0..1
  const rv = next.reverse != null ? !!next.reverse : next.direction === 'backward';
  const bn = next.bounce != null ? !!next.bounce : next.direction === 'mirror';
  let want = cur; if (rv) want = 1 - want;           // undo reverse
  const rt = bn ? want / 2 : want;                   // undo bounce (rising half)
  const base = ((timeSec / dsec) % 1 + 1) % 1;
  return { ...next, phase: rt - base };
}
function lfoControls(anim, onAnim, clock, bpm) {
  const shape = anim.shape || 'saw';
  const rev = anim.reverse != null ? !!anim.reverse : anim.direction === 'backward';
  const bnc = anim.bounce != null ? !!anim.bounce : anim.direction === 'mirror';
  const set = (patch) => {
    const next = { ...anim, shape, reverse: rev, bounce: bnc, direction: undefined, ...patch };
    if (next.shape === 'noise') {
      if (next.seed == null) next.seed = Math.floor(Math.random() * 1000);   // independent drift per param (persisted, deterministic at playback)
      onAnim(next);   // noise isn't periodic — no phase retime
    } else {
      onAnim(retimeLfo(anim, next, clock ? clock() : 0, bpm ? bpm() : 120));   // continue from current position
    }
  };
  const btn = (on, glyph, title, patch) => el('button', {
    className: 'dir-btn' + (on ? ' on' : ''), textContent: glyph, title,
    onclick: (e) => { e.preventDefault(); set(patch); },
  });
  const row = el('div', { className: 'dir-btns' }, WAVE_DEFS.map((d) => btn(d.value === shape, d.glyph, d.title, { shape: d.value })));
  row.append(
    btn(rev, '←', rev ? 'forward' : 'reverse direction', { reverse: !rev }),
    btn(bnc, '⇄', bnc ? 'bounce off' : 'bounce (ping-pong)', { bounce: !bnc }),
  );
  return row;
}

// Fields for an animated param (mode already chosen via the cog menu). The
// in/out values live on the range-track handles (value bubbles), so each row
// carries only what's left:
//   Timeline → direction buttons · s    Audio → band · gain
//   External → channel select · canonical-address chip (fixed, copy-only)
function animControls(anim, onAnim, oscAddress, onAnimLive) {
  const mini = (label, val, commit, { commitLive, step = 0.1 } = {}) => {
    const i = el('input', { type: 'number', value: fmt(val), step: 'any', className: 'anim-num' });
    // Arrow keys step the value LIVE (no re-render) so focus stays on the field and
    // you can keep pressing up/down. (A native number input fires `change` on each
    // arrow press, which would rebuild this control and yank focus elsewhere.)
    i.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const cur = i.value === '' ? 0 : Number(i.value);
      const v = Math.round((cur + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000;
      i.value = fmt(v); (commitLive || commit)(v);
    });
    i.addEventListener('change', () => commit(i.value === '' ? 0 : Number(i.value)));
    const lab = el('label', { className: 'anim-mini' }, [el('span', { textContent: label }), i]);
    lab.dataset.mini = label;   // lets the range-track thumbs sync this field live
    return lab;
  };
  const isAudio = anim.mode === 'audio';
  const isExternal = anim.mode === 'external';
  const isDashboard = anim.mode === 'dashboard';
  const kids = [];
  if (isDashboard) {
    // Pick which global link drives this param; Invert flips the link; in/out live
    // on the track handles above (so a link can map to a sub-range of the param).
    const links = dashLinks();
    kids.push(selectInput(links.length ? links.map((l) => ({ value: l.id, label: l.name || l.id })) : [{ value: '', label: '(no links)' }],
      anim.link || '', (id) => onAnim({ ...anim, link: id })));
    const inv = el('label', { className: 'anim-mini anim-invert' }, [el('span', { textContent: 'invert' })]);
    const box = el('input', { type: 'checkbox' }); box.checked = !!anim.invert;
    box.addEventListener('change', () => onAnim({ ...anim, invert: box.checked }));
    inv.append(box);
    kids.push(inv);
    return el('div', { className: 'anim-ctrls' }, kids);
  }
  if (isAudio) {
    // (in/out live on the track handles — grab a thumb for its value bubble)
    kids.push(selectInput(AUDIO_BANDS.map((bnd) => ({ value: bnd, label: bnd })), anim.band || 'level',
      (bnd) => onAnim({ ...anim, band: bnd })));
    kids.push(mini('gain', anim.gain ?? 1, (v) => onAnim({ ...anim, gain: v }), { commitLive: onAnimLive && ((v) => onAnimLive({ ...anim, gain: v })) }));
  } else if (isExternal) {
    // The channel lives in System › Mapping; here we expose the IN/OUT range the
    // incoming 0..1 maps to (so a control can drive a sub-range of the param), as
    // editable fields alongside the track handles above.
    kids.push(el('span', { className: 'seg-hint', textContent: anim.channel ? `mapped: ${anim.channel}` : 'map in System › Mapping' }));
    kids.push(mini('in', anim.from, (v) => onAnim({ ...anim, from: v }), { commitLive: onAnimLive && ((v) => onAnimLive({ ...anim, from: v })) }));
    kids.push(mini('out', anim.to, (v) => onAnim({ ...anim, to: v }), { commitLive: onAnimLive && ((v) => onAnimLive({ ...anim, to: v })) }));
    return el('div', { className: 'anim-ctrls' }, kids);
  } else {
    // (in/out live on the track handles — grab a thumb for its value bubble)
    // Direction/duration edits are RETIMED against the clock so the sweep
    // continues from its current position instead of jumping.
    kids.push(lfoControls(anim, onAnim, animClock, animBpm));
    // Duration unit: free SECONDS or BEAT-synced (locks the loop to the tempo).
    const beatSync = anim.beats != null;
    const bpm = animBpm();
    const beatLabel = (d) => (d < 1 ? `1/${Math.round(1 / d)}` : String(d));
    const unit = el('button', {
      className: 'anim-unit' + (beatSync ? ' on' : ''), type: 'button', textContent: beatSync ? '♪' : 's',
      title: beatSync ? 'beat-synced to tempo, click for free seconds' : 'free seconds, click to sync to tempo',
      onclick: (e) => {
        e.stopPropagation();
        if (beatSync) {
          const dur = Math.max(1, Math.round((anim.beats * 60000) / bpm));
          const { beats, ...rest } = anim;   // eslint-disable-line no-unused-vars
          onAnim(retimeAnim(anim, { ...rest, durationMs: dur }, animClock()));
        } else {
          const DIVS = [0.25, 0.5, 1, 2, 4, 8, 16];
          const wantBeats = ((anim.durationMs / 1000) * bpm) / 60;
          const beats = DIVS.reduce((a, b) => (Math.abs(b - wantBeats) < Math.abs(a - wantBeats) ? b : a), 1);
          onAnim(retimeAnim(anim, { ...anim, beats, durationMs: Math.round((beats * 60000) / bpm) }, animClock()));
        }
      },
    });
    kids.push(unit);
    if (beatSync) {
      const DIVS = [0.25, 0.5, 1, 2, 4, 8, 16];
      kids.push(selectInput(DIVS.map((d) => ({ value: String(d), label: beatLabel(d) })), String(anim.beats),
        (v) => { const b = Number(v); onAnim(retimeAnim(anim, { ...anim, beats: b, durationMs: Math.round((b * 60000) / bpm) }, animClock())); }));
    } else {
      kids.push(mini('s', anim.durationMs / 1000, (v) =>
        onAnim(retimeAnim(anim, { ...anim, durationMs: Math.max(0, Math.round(v * 1000)) }, animClock())), {
        commitLive: onAnimLive && ((v) => onAnimLive(retimeAnim(anim, { ...anim, durationMs: Math.max(0, Math.round(v * 1000)) }, animClock()))),
        step: 0.1,
      }));
    }
  }
  return el('div', { className: 'anim-ctrls' }, kids);
}

// Module-level drag payload. HTML5 dataTransfer.getData isn't readable during
// `dragover` (only on `drop`), but we need the kind there to decide whether a
// target accepts the drag — so we stash it here on dragstart and clear on
// dragend. dataTransfer still carries the payload for completeness.
let drag = null; // { kind: 'source' | 'effect', name }

// The animation clock — set from the transport by createLayerPanel so the
// module-level control builders (animControls) can retime sweep edits.
let animClock = () => 0;
// Live tempo (bpm) getter — lets the Timeline controls convert beats↔seconds.
let animBpm = () => 120;
// Live dashboard links getter — lets the Dashboard anim mode pick/show a link.
let dashLinks = () => [];

// Companion-remote hook — set by createLayerPanel so the (module-level) cog menu
// can read/toggle whether a parameter is published to the phone companion.
let remoteHook = { has: () => false, toggle: () => {} };

// transport (optional): { isPlaying(), toggle(), getLoop(), setLoop(bool) } —
// drives the play-through of the clip deck as a timeline. The panel renders a
// play/stop + loop bar and exposes setPlayhead(i) so app.js can move the
// highlight as the playhead advances (cheap class toggle, no re-render).
export function createLayerPanel({ getShow, setShow, onChange, transport, clipTrigsFor, mounts, thumbnails = {}, onClipSelect, onLayerSelect, onCompositionSelect, getISFExamples, onAddISF, showSources }) {
  if (transport?.now) animClock = transport.now;
  animBpm = () => getShow().composition?.bpm ?? 120;
  dashLinks = () => getShow().composition?.dashboard?.links || [];
  // Wire the cog-menu Companion tick to the show's exposed-controls set.
  remoteHook = {
    has: (addr) => hasRemoteControl(getShow(), addr),
    toggle: (addr) => commit(toggleRemoteControl(getShow(), addr)),
  };
  const root = el('div', { className: 'fx-panel cmp2-panel' });
  let deckCells = [];        // clip cells by deck index (for the playhead highlight)
  let playheadIndex = -1;
  let selectedClipId = null; // inspector target — SELECT (click) is decoupled from ACTIVE (trigger)
  let selectedLayerId = null; // which layer the Layer inspector edits
  // Which deck element is the ACTIVE selection (drives the delete target + which
  // header/row highlights). A clip is ALWAYS kept selected underneath, so 'clip'
  // is the default; clicking a layer head or the composition header switches the
  // active target without dropping the clip selection.
  let deckSel = 'clip';      // 'clip' | 'layer' | 'comp'
  // Double-click the COMPOSITION header to collapse the deck to just that bar.
  let deckCollapsed = (() => { try { return localStorage.getItem('lz.deck.collapsed') === '1'; } catch { return false; } })();
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
  // `signals` = audio bands merged with external channels (see app.js).
  function applyLive(container, anim, t, signals) {
    if (!anim || !container) return;
    for (const k of Object.keys(anim)) {
      const node = container.querySelector(`[data-animkey="${k}"]`);
      if (!node) continue;
      const v = animatedValue(anim[k], t, signals);
      // Range track: slide the live marker along [min,max]. (Fallback: a plain input.)
      const lo = Number(node.dataset.min), hi = Number(node.dataset.max);
      const live = node.querySelector?.('.anim-live');
      if (live && hi > lo) live.style.left = `${Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100}%`;
      else if (node.tagName === 'INPUT') node.value = String(v);
      const out = node.closest('.anim-param')?.querySelector('.ly-readout');
      if (out) out.textContent = fmtLive(v);
    }
  }
  function updateLive(t, signals) {
    const layers = getShow().composition?.layers || [];
    if (!layers.length) return;
    // The selected clip can live in any layer; the composition FX shown is the top layer's.
    let sel = null;
    for (const L of layers) { sel = (L.clips || []).find((c) => c && c.id === selectedClipId); if (sel) break; }
    applyLive(mounts?.inspectorClip || root, sel?.anim, t, signals);
    applyLive(mounts?.inspectorComposition || root, layers[layers.length - 1].anim, t, signals);
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
      const r = dl.querySelector('.lh-op'); if (r) r.style.setProperty('--fill', Math.round((Math.max(0, Math.min(1, Number(v) || 0))) * 100) + '%');
      const o = dl.querySelector('.lh-op-val'); if (o) o.textContent = Math.round((Number(v) || 0) * 100) + '%';
    }
    const insp = document.querySelector(`.ly-param[data-opacity-layer="${id}"]`);
    if (insp) {
      const r = insp.querySelector('input[type=range]'); if (r) { r.value = String(v); r.style.setProperty('--fill', (v * 100) + '%'); }
      const o = insp.querySelector('.ly-readout');
      if (o && document.activeElement !== o) { if (o.tagName === 'INPUT') o.value = fmt(v); else o.textContent = fmt(v); }
    }
  }
  const show = () => getShow();
  const firstLayer = () => getShow().composition?.layers?.[0] || null;
  const layerById = (lid) => (getShow().composition?.layers || []).find((L) => L.id === lid) || null;
  const layerOfClip = (cid) => (getShow().composition?.layers || []).find((L) => (L.clips || []).some((c) => c && c.id === cid)) || null;
  const topLayer = () => { const ls = getShow().composition?.layers || []; return ls[ls.length - 1] || null; };
  // Live clip lookup (presets read CURRENT params, not the captured render-time clip).
  const liveClip = (cid) => layerOfClip(cid)?.clips.find((c) => c && c.id === cid) || null;

  // The param subset of `params` whose keys are prefixed by `name + '.'`.
  const paramsForPrefix = (params, name) => {
    const out = {}; const pfx = name + '.';
    for (const k of Object.keys(params || {})) if (k.startsWith(pfx)) out[k] = params[k];
    return out;
  };

  // Head options as small inline glyph buttons (no kebab): save preset, duplicate,
  // reset, remove — placed right next to the clip/effect name. Saved presets, when
  // any exist, fold into one small ▾ popover (a list can't be inline buttons).
  // Shared by effect rows and the clip preset control; `kind` selects the preset
  // namespace ('effect' | 'source'); pass onRemove only for effects.
  function fxMenu({ kind = 'effect', presetName, getParams, applyParams, onReset, onRemove, onDuplicate, resetLabel = 'reset', dirty }) {
    const wrap = el('div', { className: 'fx-acts' });
    const act = (glyph, title, onClick, cls = '') => {
      const b = el('button', { type: 'button', className: 'fx-act ' + cls, textContent: glyph, title });
      b.onclick = (e) => { e.stopPropagation(); onClick(); };
      return b;
    };

    // Load a saved preset — only when some exist; a compact popover list.
    const names = listPresets(kind, presetName);
    if (names.length) {
      const pwrap = el('div', { className: 'fx-menu-wrap' });
      const menu = el('div', { className: 'fx-menu', hidden: true });
      let dismiss = null;
      const close = () => { menu.hidden = true; if (dismiss) { dismiss(); dismiss = null; } };
      for (const n of names) menu.append(el('button', {
        className: 'fx-menu-item', textContent: n,
        onclick: (e) => { e.stopPropagation(); const p = loadPreset(kind, presetName, n); if (p) applyParams(p); close(); },
      }));
      const pbtn = act('▾', 'load preset', () => {
        if (menu.hidden) { menu.hidden = false; dismiss = dismissOnOutside(pwrap, close); }
        else close();
      });
      pwrap.append(pbtn, menu);
      wrap.append(pwrap);
    }

    wrap.append(act('⤓', 'save preset…', () => {
      const pn = window.prompt(`Save ${presetName} preset as:`);
      if (pn && pn.trim()) { savePreset(kind, presetName, pn.trim(), getParams()); render(); }
    }));
    if (onDuplicate) wrap.append(act('⧉', 'duplicate', () => onDuplicate()));
    // Reset — disabled (inert) when there's nothing to reset (dirty() false).
    const rst = act('↺', resetLabel, () => { if (!rst.disabled) onReset(); });   // commits → re-renders
    if (dirty) {
      // Re-evaluated live: the params edited elsewhere commit without a re-render
      // (commitLive), so the caller wires wrap.evalReset to the inspector body.
      wrap.evalReset = () => { const d = !!dirty(); rst.disabled = !d; rst.title = d ? resetLabel : 'nothing to reset'; };
      wrap.evalReset();
    }
    wrap.append(rst);
    if (onRemove) wrap.append(act('✕', 'remove', () => onRemove(), 'fx-act-danger'));
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
    closeAnimPop();   // the flyout is body-appended — don't strand it over stale rows
    const layers = getShow().composition?.layers || [];
    // Clear each distinct container once.
    const seen = new Set();
    for (const c of [deckEl, clipEl, layerEl, compEl, libraryEl]) {
      if (!seen.has(c)) { c.textContent = ''; seen.add(c); }
    }

    if (!layers.length) {
      deckEl.append(el('div', { className: 'ly-hint', textContent: 'no composition layer' }));
      return;
    }

    // --- DECK region: one row per layer, TOP-of-stack first (Resolume-style:
    //     the top row renders on top — it's the LAST layer in the array). An empty
    //     layer is always kept at the bottom (tidyEmptyLayers), so there's no
    //     manual "+ layer" button. Master opacity is in the Composition inspector.
    const deckBox = el('div', { className: 'deck-layers' });
    // MASTER row above the layers: ✕ (eject all) · B (master mute / blackout) · the
    // master opacity fader (composition.opacity).
    deckBox.append(el('div', { className: 'deck-layer deck-master' }, [masterHead()]));
    // Pad every layer's deck to the same column count so clips line up vertically
    // into a Resolume-style grid (max clips across layers + 1 trailing empty).
    const maxClips = layers.reduce((m, L) => Math.max(m, (L.clips || []).length), 0);
    // When ANY layer is soloed, the others aren't rendering — dim them so the deck
    // mirrors what the compositor actually outputs.
    const anySolo = layers.some((L) => L && L.solo);
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      deckBox.append(el('div', {
        className: 'deck-layer'
          + (deckSel === 'layer' && layer.id === selectedLayerId ? ' is-sel' : '')
          + (anySolo && !layer.solo ? ' is-muted' : ''),
        'data-layer': layer.id,
      }, [layerHead(layer, layer.id, i, layers.length > 1), clipDeck(layer, layer.id, maxClips)]));
    }
    // The deck IS the layer/clip grid now; its framing + title come from the docked
    // Timeline island (the old in-deck "COMPOSITION" header + collapse were dropped —
    // the Composition group lives in the left column). Composition properties are
    // always visible there, so no in-deck selection step is needed.
    deckEl.append(deckBox);

    // --- CLIP inspector: the SELECTED clip, found across ALL layers ----------
    // There is ALWAYS a clip selected when any clip exists: if the current
    // selection is gone (deleted, fresh load, or a layer/comp click left it
    // pointing nowhere) fall back to the current layer's active clip, else the
    // first clip of the topmost layer that has any.
    let selLayer = layers.find((L) => (L.clips || []).some((c) => c && c.id === selectedClipId));
    if (!selLayer) {
      const pick = (L) => L && ((L.clips || []).find((c) => c && c.id === L.activeClipId)?.id ?? (L.clips || [])[0]?.id);
      selLayer = layers.find((L) => L.id === selectedLayerId);
      let cid = pick(selLayer);
      for (let i = layers.length - 1; i >= 0 && !cid; i--) { if (layers[i].clips?.length) { selLayer = layers[i]; cid = pick(layers[i]); } }
      if (cid) { selectedClipId = cid; selectedLayerId = selLayer.id; }
    }
    if (!selLayer) selLayer = layers.find((L) => L.id === selectedLayerId) || layers[layers.length - 1];
    const selClip = (selLayer.clips || []).find((c) => c && c.id === selectedClipId);
    if (selClip) clipEl.append(selectedClipEditor(selLayer.id, selClip));
    else clipEl.append(el('div', { className: 'ly-hint', textContent: 'no clips, add one with +' }));

    // --- LAYER inspector: the selected layer's settings ----------------------
    if (!layers.some((L) => L.id === selectedLayerId)) selectedLayerId = selLayer.id;
    const inspLayer = layers.find((L) => L.id === selectedLayerId) || selLayer;
    layerEl.append(layerSettings(inspLayer, inspLayer.id));

    // COMPOSITION inspector (the group's inspector): the composition effect chain
    // (3rd tier, applied to the final composite of ALL layers). Canvas resolution +
    // title sit above this in #comp-settings. (Master opacity was removed.)
    compEl.append(dashboardSection());
    compEl.append(compositionFx());
    // (Sources/Effects are added via on-demand pickers — the empty clip slot's "+"
    //  for sources, each Effects chain's "+ effect" for effects — so there's no
    //  longer a docked library shelf.)
  }

  // Dashboard — global link knobs (0..1) that any parameter or DMX channel can be
  // modulated by. Lives on composition.dashboard.links; values persist + feed the
  // per-frame signals. A FIXED 4×4 grid of 16 links — drag a knob to set, rename
  // inline (not addable/removable).
  function dashboardSection() {
    const sh = getShow();
    const links = sh.composition?.dashboard?.links || [];
    // A link with no manual name auto-labels itself from whatever it drives.
    const labels = dashboardLinkLabels(sh);
    const isAuto = (n) => !n || /^Link \d+$/.test(n);
    const box = el('div', { className: 'comp-dashboard' });
    box.append(Section('Dashboard', 'dashboard', (b) => {
      const grid = el('div', { className: 'dash-grid' });
      for (const lnk of links) {
        // A link is "live" only once something drives it (labels[id] is set); idle
        // links are shown disabled (not draggable / editable) until linked.
        const linked = !!labels[lnk.id];
        const cell = el('div', { className: 'dash-cell' + (linked ? '' : ' is-unlinked') });
        cell.append(Knob('', lnk.value, {
          onInput: (v) => commitLive(setDashboardLinkValue(show(), lnk.id, v)),
          onCommit: (v) => commit(setDashboardLinkValue(show(), lnk.id, v)),
        }));
        // Name = a manual label if set, otherwise the auto label of what it drives
        // (display-only; typing a name persists it). Driven+auto reads dimmer.
        const auto = isAuto(lnk.name) && labels[lnk.id];
        const nm = el('input', { className: 'dash-name' + (auto ? ' dash-auto' : ''), value: auto ? labels[lnk.id] : (lnk.name || lnk.id), title: auto ? `${labels[lnk.id]} · auto-named from what it drives; type to rename` : 'rename link' });
        nm.addEventListener('change', () => commit(setDashboardLinkName(show(), lnk.id, nm.value)));
        cell.append(nm);
        grid.append(cell);
      }
      b.append(grid);
    }));
    return box;
  }

  // Composition effect chain — applied to the WHOLE composite (all layers), after
  // each layer's own chain. Edits composition.effects / composition.params.
  function compositionFx() {
    const comp = getShow().composition || {};
    const fxs = comp.effects || [];
    const box = el('div', { className: 'comp-fx' });
    box.append(Section('Effects', 'comp-fx', (b) => {
      for (let fx = 0; fx < fxs.length; fx++) b.append(compEffectBlock(fx, fxs));
      const addBtn = el('button', { className: 'composer-add', textContent: '+' });
      addBtn.onclick = () => openPicker(addBtn, (name) => commit(addCompositionEffect(show(), name)));
      b.append(addBtn);
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
      onReset: () => commit(mergeCompositionParams(show(), prefixedDefaults(name), true)),
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
          onAnimLive: (spec) => commitLive(setCompositionAnim(show(), key, spec)),
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
      onReset: () => commit(mergeLayerParams(show(), id, prefixedDefaults(name), true)),
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
          onAnimLive: (spec) => commitLive(setLayerAnim(show(), id, key, spec)),
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
    // An empty grid slot — a hole (a deleted clip, `index ≥ 0`) or the trailing
    // add slot (`index < 0`). Click → pick a source to fill it; drop a clip → move
    // it into this slot; drop a source → new clip here.
    const emptySlot = (index) => {
      const slot = el('div', { className: 'clip-cell clip-empty', title: 'add a source' }, [
        el('div', { className: 'clip-empty-plus', textContent: '+' }),
      ]);
      // No popover — the sidebar Sources tab IS the source browser. Clicking an empty
      // slot reveals it; drag a source onto this slot (below) to place it precisely.
      slot.addEventListener('click', () => showSources?.());
      deckZone(slot, (pl) => pl.kind === 'clip', (pl) => {
        selectedClipId = pl.clipId; selectedLayerId = id;
        commit(moveClipToLayer(show(), pl.layerId ?? id, pl.clipId, id, index));
      });
      makeDropTarget(slot, (payload) => {
        if (payload.kind === 'source') commit(index >= 0 ? addClipAt(show(), id, index, payload.name) : addClip(show(), id, payload.name));
      });
      return slot;
    };
    for (let ci = 0; ci < clips.length; ci++) {
      const clip = clips[ci];
      if (!clip) { const s = emptySlot(ci); deckCells.push(s); deck.append(s); continue; }   // deleted slot (hole)
      const isActive = clip.id === layer.activeClipId;
      // Only show the clip as SELECTED (accent label fill) when the deck
      // selection is actually a clip. selectedClipId always points at *some*
      // clip (the Clip inspector needs one), so without this gate a clip stayed
      // highlighted even after selecting the composition or a layer — making two
      // things look selected at once. `.clip-active` (the live/playing outline)
      // is independent and stays.
      const isSelected = deckSel === 'clip' && clip.id === selectedClipId;
      const isVol = !!getEntry(clip.generator)?.volumetric;
      const cell = el('div', {
        className: 'clip-cell' + (isActive ? ' clip-active' : '') + (isSelected ? ' clip-selected' : ''),
        title: isVol
          ? 'volumetric source — lights each LED at its 3D position (not drawn on the canvas) · max 4 active at once · click to select · double-click to trigger'
          : 'click to select · double-click to trigger · drag to reorder / move',
        'data-clip': clip.id,
      });
      // Click = SELECT (edit in inspector) without activating; double-click = trigger.
      // Selecting also focuses the Clip inspector tab (onClipSelect) and makes the
      // clip's own layer the selected layer, so the layer highlight follows the
      // clip you're editing (not whichever layer head was last clicked).
      const selectThis = () => { selectedClipId = clip.id; selectedLayerId = id; deckSel = 'clip'; onClipSelect?.(); };
      cell.addEventListener('click', () => { selectThis(); render(); });
      cell.addEventListener('dblclick', () => { selectThis(); commit(setActiveClip(show(), id, clip.id)); });
      // Drag this clip (pointer-based) to reorder it within a layer OR move it to
      // another layer — drop on any cell / empty slot in any row. The payload
      // carries the SOURCE layer so the drop tells reorder from cross-layer move.
      deckDraggable(cell, () => ({ kind: 'clip', clipId: clip.id, layerId: id, label: clip.name || clip.id }));
      // Accept an incoming clip onto THIS clip's slot (place it here).
      deckZone(cell, (pl) => pl.kind === 'clip' && pl.clipId !== clip.id, (pl) => {
        const to = (layerById(id)?.clips || []).findIndex((c) => c && c.id === clip.id);
        if (to < 0) return;
        selectedClipId = pl.clipId; selectedLayerId = id;
        commit(moveClipToLayer(show(), pl.layerId ?? id, pl.clipId, id, to));
      });
      // Native drop target ONLY for source/effect drags from the picker rail.
      makeDropTarget(cell, (payload) => {
        if (payload.kind === 'source') {
          // Replace the source AND select it (no auto-trigger).
          selectThis();
          commit(changeClipGenerator(show(), id, clip.id, payload.name));
        } else if (payload.kind === 'effect') {
          // Volumetric clips have no effect chain in v1 (fields aren't canvas
          // images — nothing for a 2D effect to read). Ignore the drop.
          if (isVol) return;
          selectThis();   // dropping an effect also selects the clip you dropped on
          commit(addClipEffect(show(), id, clip.id, payload.name));
        }
      });
      // Thumbnail (top) + a label bar UNDERNEATH (Resolume-style).
      const thumbWrap = el('div', { className: 'clip-thumbwrap' });
      const thumb = thumbnails[clip.generator];
      if (thumb) thumbWrap.append(el('img', { className: 'clip-thumb', src: thumb, alt: '', draggable: false }));
      // Triggerable source (e.g. Pulse) → a ⚡ badge so you know it fires.
      if (getEntry(clip.generator)?.triggerable) thumbWrap.append(el('div', { className: 'clip-trig', textContent: '⚡', title: 'triggerable, fire from the Clip inspector' }));
      // Volumetric source → a "3D" badge: it lights LEDs at their world xyz and
      // never draws on the canvas (the thumbnail is a z-slice preview).
      if (isVol) thumbWrap.append(el('div', { className: 'clip-vol', textContent: '3D', title: 'volumetric — evaluated per LED in 3D space · max 4 active at once' }));
      // A video clip whose file didn't survive a reload (object URLs are
      // session-only) — flag it instead of showing a silent black clip.
      if (clip.videoMissing) thumbWrap.append(el('div', { className: 'clip-missing', textContent: '⚠ video', title: 'video file lost on reload, drop a new source onto this clip' }));
      cell.append(thumbWrap);
      // Modulation badges on the THUMBNAIL corner (the label bar is too narrow):
      // T = a param runs on the timeline, A = follows the audio input, E = follows
      // an external (OSC / socket) channel — so the deck shows at a glance which
      // clips are animated / driven from outside.
      const animModes = new Set(Object.values(clip.anim || {}).map((a) => a && a.mode));
      const mods = el('div', { className: 'clip-mods' });
      if (animModes.has('timeline')) mods.append(el('span', { className: 'clip-mod', textContent: 'T', title: 'a parameter runs on the timeline' }));
      if (animModes.has('audio')) mods.append(el('span', { className: 'clip-mod', textContent: 'A', title: 'a parameter follows the audio input' }));
      if (animModes.has('external')) mods.append(el('span', { className: 'clip-mod', textContent: 'E', title: 'a parameter follows an external (OSC / socket) channel' }));
      if (mods.childNodes.length) thumbWrap.append(mods);
      // Label bar: clip name + an "fx" marker when it carries effects.
      const labelBar = el('div', { className: 'clip-label-bar' }, [el('span', { textContent: clip.name || clip.id })]);
      if ((clip.effects || []).length) labelBar.append(el('span', { className: 'deck-fx', textContent: 'fx', title: 'has effects' }));
      cell.append(labelBar);
      if (ci === playheadIndex) cell.classList.add('clip-playhead');
      deckCells.push(cell);
      deck.append(cell);
    }

    // Trailing empty slots — pad to the grid's column count + one more "+" cell.
    // Each carries its real COLUMN index so dropping a clip/source there places it
    // in that exact cell (padding earlier columns with holes), e.g. moving a lone
    // clip from column 0 into column 1. (Inline holes above are rendered by the loop.)
    const realCount = clips.length;
    const emptyCount = Math.max(1, (columns - realCount) + 1);
    for (let e = 0; e < emptyCount; e++) deck.append(emptySlot(realCount + e));
    return deck;
  }

  // Layer inspector tab: name · opacity · blend · crossfade (layer-level props).
  function layerSettings(layer, id) {
    const box = el('div', { className: 'clip-editor' });
    const name = el('input', { className: 'ly-nameedit', value: layer.name ?? 'Layer 1', title: 'layer name' });
    name.addEventListener('change', () => commit(patchLayer(show(), id, { name: name.value })));
    const layerHeadRow = el('div', { className: 'clip-editor-head' }, [name]);
    // Delete THIS layer — danger ✕ top-right. Refuses the last remaining layer.
    {
      const nLayers = (getShow().composition?.layers || []).length;
      const del = el('button', {
        className: 'fx-act fx-act-danger insp-del', textContent: '✕',
        title: nLayers <= 1 ? 'can’t delete the last layer' : 'delete this layer',
      });
      del.disabled = nLayers <= 1;
      del.onclick = (e) => {
        e.stopPropagation();
        const layers = show().composition?.layers || [];
        if (layers.length <= 1) return;
        if (!confirmDelete('Delete this layer?')) return;
        const i = layers.findIndex((l) => l.id === id);
        selectedLayerId = layers[i + 1]?.id ?? layers[i - 1]?.id ?? null;
        commit(removeLayer(show(), id));
      };
      layerHeadRow.append(del);
    }
    box.append(layerHeadRow);

    // Autopilot (Resolume-style): play-through of the clip deck with a direction
    // (off / ▶ forward / ◀ backward / ⤨ shuffle) + a loop toggle.
    if (transport) {
      const dir = transport.getDirection?.() ?? (transport.isPlaying() ? 'forward' : 'off');
      box.append(Section('Autopilot', 'autopilot', (b) => {
        const dirBtn = (d, glyph, title) => el('button', {
          className: 'dir-btn' + (dir === d ? ' on' : ''), textContent: glyph, title,
          onclick: () => { transport.setDirection(d); if (d === 'off') setPlayhead(-1); render(); },
        });
        // LOOP rides in the same strip as a fourth, INDEPENDENT toggle (it's not
        // a direction — it's whether the deck wraps after the last clip). The
        // shuffle mode still exists in the transport but isn't exposed here.
        const loopBtn = el('button', {
          className: 'dir-btn' + ((transport.getLoop?.() ?? true) ? ' on' : ''),
          textContent: 'LOOP', title: 'wrap to the first clip after the last (off: stop on the last clip)',
          onclick: () => { transport.setLoop(!(transport.getLoop?.() ?? true)); render(); },
        });
        b.append(field('Direction', el('div', { className: 'dir-btns' }, [
          dirBtn('backward', '◀', 'play the deck backward'),
          dirBtn('off', '■', 'stop (hold the current clip)'),
          dirBtn('forward', '▶', 'play the deck forward'),
          loopBtn,
        ])));
      }));
    }

    box.append(Section('Composition', 'layer-comp', (b) => {
      // Display labels only — values stay the lowercase keys the compositor + saved
      // shows expect. Premultiplied-over is universally called "Normal" in video
      // tools, so 'alpha' shows as Normal (and leads, as the default/most common).
      const BLEND_LABELS = { alpha: 'Normal', add: 'Add', screen: 'Screen', multiply: 'Multiply' };
      const blendOpts = ['alpha', 'add', 'screen', 'multiply'].map((m) => ({ value: m, label: BLEND_LABELS[m] }));
      b.append(field('Blend Mode', selectInput(blendOpts, layer.blend ?? 'alpha',
        (m) => commit(patchLayer(show(), id, { blend: m })))));
      const opacityRow = sliderField('Opacity', layer.opacity ?? 1, 0, 1,
        (v) => { commitLive(patchLayer(show(), id, { opacity: v })); syncLayerOpacity(id, v); }, 1);
      opacityRow.dataset.opacityLayer = id;
      b.append(opacityRow);
      // Crossfade (ms) — this layer's clip-change fade time (per-layer; default 500).
      b.append(sliderField('Crossfade', layer.transitionMs ?? 500, 0, 5000,
        (v) => commitLive(patchLayer(show(), id, { transitionMs: Math.round(v) })), 500, 10));
    }, () => commit(patchLayer(show(), id, { blend: 'alpha', opacity: 1, transitionMs: 500 }))));

    // Layer effect chain (applied to the whole layer's output, after its active
    // clip + that clip's effects). Locked open while empty so the drop target stays.
    const layerFx = layer.effects || [];
    box.append(Section('Effects', 'layer-effects', (b) => {
      for (let fx = 0; fx < layerFx.length; fx++) b.append(layerEffectBlock(id, fx, layerFx));
      const addBtn = el('button', { className: 'composer-add', textContent: '+' });
      addBtn.onclick = () => openPicker(addBtn, (name) => commit(addLayerEffect(show(), id, name)));
      b.append(addBtn);
    }, undefined, layerFx.length === 0));
    // (Delete is the ✕ in the header now — the bottom "Delete Layer" link was removed.)
    return box;
  }

  // Resolume-style layer control block: a vertical opacity fader (the "V"),
  // clear/eject + blend controls, and the layer name bar at the bottom.
  // The MASTER row (full deck width): ✕ (eject all) · B (master mute = composition.bypass,
  // a blackout) + a HORIZONTAL master opacity fader (composition.opacity) filling the rest.
  function masterHead() {
    const comp = show().composition || {};
    const row = el('div', { className: 'master-head' });
    const xBtn = el('button', {
      className: 'lh-clear', textContent: '✕', title: 'clear all (eject every active clip)',
      onclick: (e) => { e.stopPropagation(); let s = show(); for (const L of (s.composition?.layers || [])) s = setActiveClip(s, L.id, null); commit(s); },
    });
    const bBtn = el('button', {
      className: 'lh-tog' + (comp.bypass ? ' on' : ''), textContent: 'B',
      title: comp.bypass ? 'un-mute master' : 'master mute (blackout all output)',
      onclick: (e) => { e.stopPropagation(); commit({ ...show(), composition: { ...show().composition, bypass: !comp.bypass } }); },
    });
    // Horizontal opacity fader: dim fill + a bright accent handle line at the value
    // (the vertical layer fader's look, on its side). Dragged along X.
    const op = el('div', { className: 'master-op', title: 'master opacity', role: 'slider' });
    op.append(el('div', { className: 'master-op-fill' }), el('div', { className: 'master-op-handle' }));
    const paint = (v) => op.style.setProperty('--fill', Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%');
    paint(comp.opacity ?? 1);
    const fromX = (x) => { const r = op.getBoundingClientRect(); let v = r.width ? (x - r.left) / r.width : 0; v = Math.max(0, Math.min(1, v)); return shiftDown ? coarseSnap(v, 0, 1) : v; };
    const set = (v) => { paint(v); commitLive(setCompositionOpacity(show(), v)); };
    let drag = false;
    op.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); drag = true; try { op.setPointerCapture(e.pointerId); } catch { /* not capturable */ } set(fromX(e.clientX)); });
    op.addEventListener('pointermove', (e) => { if (drag) set(fromX(e.clientX)); });
    const end = (e) => { if (!drag) return; drag = false; try { op.releasePointerCapture(e.pointerId); } catch { /* released */ } commit(setCompositionOpacity(show(), fromX(e.clientX))); };
    op.addEventListener('pointerup', end); op.addEventListener('pointercancel', end);
    op.addEventListener('contextmenu', (e) => { if (document.body.classList.contains('native-ctx')) return; e.preventDefault(); e.stopPropagation(); paint(1); commit(setCompositionOpacity(show(), 1)); });
    row.append(xBtn, bBtn, el('div', { className: 'master-label', textContent: 'Master' }), op);
    return row;
  }

  function layerHead(layer, id, index, canReorder) {
    const pct = (v) => Math.round((v ?? 1) * 100) + '%';
    const head = el('div', {
      className: 'layer-head-box lh-clickable',
      title: canReorder ? 'click to edit · double-click to minimise · drag to reorder' : 'click to edit · double-click to minimise',
    });
    // Click → select this layer (Layer inspector) · double-click → minimise.
    // Selecting the layer clears any clip selection, so the layer is now the sole
    // delete target and no clip stays highlighted underneath it.
    head.addEventListener('click', () => { selectedLayerId = id; deckSel = 'layer'; onLayerSelect?.(); render(); });
    // Pointer-drag the head to reorder layers (drop onto another layer row). The
    // deckDraggable threshold + the `.lh-op`/button guard mean a click still
    // selects and the opacity fader still drags without starting a reorder.
    if (canReorder) {
      deckDraggable(head, () => ({ kind: 'layer', layerId: id, index, label: layer.name || id }));
      deckZone(head, (pl) => pl.kind === 'layer' && pl.layerId !== id,
        (pl) => commit(moveLayer(show(), pl.layerId, index - pl.index)));
    }
    const body = el('div', { className: 'lh-body' });

    // Vertical opacity fader (no numeric readout — the slider IS the value).
    // Opacity = a custom vertical fader (a native vertical range can't render a
    // clean full-width handle cross-browser). Bottom-up accent fill to --fill,
    // with a full-width rounded handle bar riding at the value.
    const opCol = el('div', { className: 'lh-op', title: 'layer opacity', role: 'slider' });
    const opFill = el('div', { className: 'lh-op-fill' });
    const opHandle = el('div', { className: 'lh-op-handle' });
    opCol.append(opFill, opHandle);
    const paintOp = (v) => opCol.style.setProperty('--fill', Math.round((Math.max(0, Math.min(1, Number(v) || 0))) * 100) + '%');
    paintOp(layer.opacity ?? 1);
    // y → value (bottom = 0, top = 1); Shift snaps to 0.1 steps.
    const opFromY = (clientY) => {
      const r = opCol.getBoundingClientRect();
      let v = r.height ? 1 - (clientY - r.top) / r.height : 0;
      v = Math.max(0, Math.min(1, v));
      return shiftDown ? coarseSnap(v, 0, 1) : v;
    };
    const opSet = (v) => { paintOp(v); commitLive(patchLayer(show(), id, { opacity: v })); syncLayerOpacity(id, v); };
    let opDrag = false;
    // The fader sits inside the drag-to-reorder, click-to-select head — stop the
    // press/click from reaching the head (adjusting opacity is not selecting it).
    opCol.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      opDrag = true; try { opCol.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      opSet(opFromY(e.clientY));
    });
    opCol.addEventListener('pointermove', (e) => { if (opDrag) opSet(opFromY(e.clientY)); });
    const opEnd = (e) => { if (!opDrag) return; opDrag = false; try { opCol.releasePointerCapture(e.pointerId); } catch { /* already released */ } };
    opCol.addEventListener('pointerup', opEnd);
    opCol.addEventListener('pointercancel', opEnd);
    opCol.addEventListener('click', (e) => e.stopPropagation());
    // Right-click → reset opacity to the default (0.5). A committed change (not a
    // live drag), so it's a single undo step.
    opCol.addEventListener('contextmenu', (e) => {
      if (document.body.classList.contains('native-ctx')) return;
      e.preventDefault(); e.stopPropagation();
      paintOp(0.5); commit(patchLayer(show(), id, { opacity: 0.5 })); syncLayerOpacity(id, 0.5);
    });

    // Body = FOUR equal quarters, Resolume order: ✕ · B · S · opacity. ✕ (eject)
    // is far left; stopPropagation so the buttons don't also fire layer-select.
    const tog = (label, on, title, fn) => el('button', {
      className: 'lh-tog' + (on ? ' on' : ''), textContent: label, title,
      onclick: (e) => { e.stopPropagation(); fn(); },
    });
    body.append(
      el('button', {
        className: 'lh-clear', textContent: '✕', title: 'clear (eject active clip)',
        onclick: (e) => { e.stopPropagation(); commit(setActiveClip(show(), id, null)); },
      }),
      tog('B', !!layer.bypass, layer.bypass ? 'un-bypass layer' : 'bypass (mute) this layer',
        () => commit(patchLayer(show(), id, { bypass: !layer.bypass }))),
      tog('S', !!layer.solo, layer.solo ? 'un-solo layer' : 'solo this layer',
        () => commit(patchLayer(show(), id, { solo: !layer.solo }))),
      opCol,
    );
    head.append(body);

    // (Blend mode lives only in the contextual Layer inspector — not the head.)

    // Layer name bar — a static label (rename in the Layer inspector). Clicking
    // it selects the layer like the rest of the head. An "fx" marker shows when the
    // layer carries its own effect chain.
    const lhName = el('div', { className: 'lh-name' }, [el('span', { textContent: layer.name ?? 'Layer 1' })]);
    if ((layer.effects || []).length) lhName.append(el('span', { className: 'deck-fx', textContent: 'fx', title: 'has effects' }));
    head.append(lhName);
    return head;
  }

  // Editor for the layer's active clip: rename, source params, and its effect
  // chain (with a drop zone). Source is changed by dragging onto a clip cell.
  function selectedClipEditor(id, clip) {
    const box = el('div', { className: 'clip-editor' });
    // 1-based canonical OSC indices: layers in DECK order (top row = /layer/1 =
    // array end — matches osc-map.js), clips left→right.
    const allLayers = getShow().composition?.layers || [];
    const layerIndex = allLayers.length - allLayers.findIndex((L) => L.id === id);
    const clipIndex = ((layerById(id)?.clips || []).findIndex((c) => c && c.id === clip.id)) + 1;

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
    let headMenu = null;
    if (gen && gen.params.length) {
      headMenu = fxMenu({
        kind: 'source', presetName: gen.name, resetLabel: 'reset all',
        getParams: () => paramsForPrefix(liveClip(clip.id)?.params, gen.name),
        applyParams: (p) => commit(mergeClipParams(show(), id, clip.id, p)),
        onDuplicate: () => {
          const next = duplicateClip(show(), id, clip.id);
          const layer = next.composition.layers.find((l) => l.id === id);
          const dup = layer.clips[layer.clips.findIndex((c) => c && c.id === clip.id) + 1];
          if (dup) { selectedClipId = dup.id; onClipSelect?.(); }
          commit(next);
        },
        // "reset all" here resets the clip: source params + transform + opacity.
        onReset: () => {
          let s = changeClipGenerator(show(), id, clip.id, clip.generator);
          s = resetClipTransform(s, id, clip.id);
          commit(s);
        },
        // Dirty iff a reset would actually change something (source params or
        // transform/opacity differ from defaults).
        dirty: () => {
          const cur = liveClip(clip.id); if (!cur) return false;
          let s = changeClipGenerator(show(), id, clip.id, clip.generator);
          s = resetClipTransform(s, id, clip.id);
          const after = s.composition.layers.find((l) => l.id === id)?.clips.find((c) => c && c.id === clip.id);
          if (!after) return false;
          const k = (c) => JSON.stringify({ p: c.params || {}, t: c.transform || {}, o: c.opacity });
          return k(cur) !== k(after);
        },
      });
      clipHead.append(headMenu);
      // Live edits in the sections below commit without a re-render, so refresh the
      // master reset's enabled state whenever anything in the inspector changes.
      box.addEventListener('input', () => headMenu.evalReset?.());
      box.addEventListener('change', () => headMenu.evalReset?.());
    }
    // Delete THIS clip — a danger ✕ pinned to the header's top-right. Refuses the
    // last remaining clip across all layers (a project must keep one), matching
    // the Delete-key behaviour.
    {
      const totalClips = (getShow().composition?.layers || []).reduce((n, L) => n + (L.clips?.length || 0), 0);
      const del = el('button', {
        className: 'fx-act fx-act-danger insp-del', textContent: '✕',
        title: totalClips <= 1 ? 'can’t delete the last clip' : 'delete this clip',
      });
      del.disabled = totalClips <= 1;
      del.onclick = (e) => { e.stopPropagation(); selectedClipId = clip.id; deleteActiveClip(); };
      clipHead.append(del);
    }
    box.append(clipHead);

    // Triggerable sources (Pulse) get a prominent Trigger button here, plus this
    // clip's own audio-onset config — the ⚡ and the mic both fire THIS clip's bus.
    if (gen?.triggerable && transport?.fire) {
      box.append(el('button', {
        className: 'clip-trigger', textContent: '⚡ trigger',
        title: 'fire the pulse', onclick: () => transport.fire(clip.id),
      }));

      // Per-clip Audio Trigger — writes clip.audioTrigger via the same commit path
      // as every other clip field (patchClipAudioTrigger → commitLive, mirroring
      // patchClipName). setAT merges a patch onto the current config.
      const at = clip.audioTrigger || {};
      // Sliders stream LIVE (commitLive, no re-render); the discrete enable/band
      // edits are undoable single actions (commit).
      const setAT = (patch) => commitLive(patchClipAudioTrigger(show(), id, clip.id, patch));
      const setATu = (patch) => commit(patchClipAudioTrigger(show(), id, clip.id, patch));

      box.append(el('div', { className: 'fx-pts', textContent: 'audio trigger' }));

      // Shared mic on/off — the FFT + EVERY clip trigger read this one input. The click is
      // the user gesture getUserMedia needs; the choice persists (lz.mic) so the mic
      // re-opens on the next launch (see app.js first-gesture reopen).
      const micOn = audioEnabled('external');
      const micBtn = el('button', {
        className: 'clip-trigger' + (micOn ? ' on' : ''),
        textContent: micOn ? '● mic on' : '○ enable mic',
        title: micOn ? 'microphone capturing — click to turn off' : 'turn on the shared microphone input',
        onclick: async () => {
          if (audioEnabled('external')) { disableExternal(); try { localStorage.setItem('lz.mic', '0'); } catch { /* ignore */ } }
          else {
            const ok = await enableAudio('external', show().composition?.audioDevice || 'default');
            try { localStorage.setItem('lz.mic', ok ? '1' : '0'); } catch { /* ignore */ }
            if (ok === false) { micBtn.title = 'could not open the mic — check the browser microphone permission'; }
          }
          render();
        },
      });
      box.append(el('label', { className: 'fx-field' }, [el('span', { textContent: 'Microphone' }), micBtn]));

      const onToggle = el('input', { type: 'checkbox' });
      onToggle.checked = !!at.enabled;
      onToggle.addEventListener('change', () => setATu({ enabled: onToggle.checked }));
      box.append(el('label', { className: 'fx-field' }, [el('span', { textContent: 'Fire on sound' }), onToggle]));

      box.append(field('Band', selectInput(
        ['bass', 'mid', 'high', 'level'].map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) })),
        at.band || 'bass', (v) => setATu({ band: v }))));

      // Onset (spike above the running average) vs Level (band level over an absolute line,
      // dragged on the spectrum). Undoable (re-render) — swaps the slider in/out and recreates
      // the spectrum with the right props.
      const mode = at.mode || 'onset';
      box.append(field('Trigger', selectInput(
        [{ value: 'onset', label: 'Onset' }, { value: 'level', label: 'Level' }],
        mode, (v) => setATu({ mode: v }))));

      // Threshold — Onset: required spike above the running average (backs `sensitivity`,
      // 0.05..2). Level: absolute 0..1 (backs `threshold`) — also draggable on the spectrum
      // below; the slider gives keyboard/precise entry.
      if (mode === 'onset') {
        box.append(Slider('Threshold', at.sensitivity ?? 0.5, {
          min: 0.05, max: 2, step: 0.05, default: 0.5, commit: 'live',
          onInput: (v) => setAT({ sensitivity: v }),
        }));
      } else {
        box.append(Slider('Threshold', at.threshold ?? 0.5, {
          min: 0, max: 1, step: 0.01, default: 0.5, commit: 'live',
          onInput: (v) => setAT({ threshold: v }),
        }));
      }
      box.append(Slider('Hold (ms)', at.refractoryMs ?? 120, {
        min: 40, max: 800, step: 10, default: 120, commit: 'live',
        onInput: (v) => setAT({ refractoryMs: Math.round(v) }),
      }));
      box.append(el('div', { className: 'seg-hint', textContent: mode === 'level'
        ? 'fires THIS clip while the band level is over the line — drag it on the spectrum'
        : 'fires THIS clip on a spike above the running average in this band' }));
      box.append(createClipSpectrum({
        band: at.band || 'bass', trigsFor: () => clipTrigsFor?.(clip.id),
        mode, threshold: mode === 'level' ? (at.threshold ?? 0.5) : undefined,
        onThresholdChange: (v) => setAT({ threshold: v }),
      }).el);
    }

    // Playback: how long the layer's autopilot dwells on this clip.
    // (Dirty checks are FUNCTIONS over liveClip — live drags commitLive without
    //  re-rendering, so the ↺ must re-read fresh state, not the render snapshot.)
    box.append(Section('Playback', 'playback', (b) => {
      b.append(sliderField('Duration', (clip.durationMs ?? 4000) / 1000, 0.1, 30,
        (v) => commitLive(setClipDuration(show(), id, clip.id, Math.round(v * 1000))), 4));
    }, () => commit(setClipDuration(show(), id, clip.id, 4000)), undefined,
    () => ((liveClip(clip.id) ?? clip).durationMs ?? 4000) !== 4000));

    // Source: the generator's own look params (auto-generated from the manifest).
    if (gen && gen.params.length) {
      // Dirty when any source param has been moved off its default or animated.
      const srcDirty = () => gen.params.some((p) => {
        const c = liveClip(clip.id) ?? clip;
        const k = gen.name + '.' + p.key;
        if (c.anim?.[k]) return true;
        const cur = c.params?.[k];
        if (cur === undefined) return false;
        const def = p.default;
        if (typeof cur === 'number' || typeof def === 'number') return Math.abs(Number(cur) - Number(def ?? 0)) > 1e-6;
        return cur !== def;
      });
      box.append(Section('Source', 'source', (b) => {
        for (const p of gen.params) {
          const key = gen.name + '.' + p.key;
          b.append(animatableParam({
            key, p, value: clip.params?.[key], anim: clip.anim?.[key],
            oscAddress: addressFor({ kind: 'param', layerIndex, clipIndex, key: p.key }),
            onValue: (v) => commitLive(setClipParam(show(), id, clip.id, key, v)),
            onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, key, spec)),
            onAnimLive: (spec) => commitLive(setClipAnim(show(), id, clip.id, key, spec)),
          }));
        }
      }, () => commit(changeClipGenerator(show(), id, clip.id, clip.generator)), undefined, srcDirty));
    }

    // ISF source: params parsed from the shader's INPUTS, stored flat (keyed by
    // input NAME — runISF reads clip.params[NAME]). Same animatable/mappable rows
    // as manifest sources. point2D/image inputs aren't editable here yet.
    if (clip.isf && clip.isf.params?.length) {
      box.append(Section('Source', 'source', (b) => {
        for (const p of clip.isf.params) {
          if (p.type === 'image') {   // a user-supplied texture (stored as a data URL)
            const pick = el('input', { type: 'file', accept: 'image/*' });
            pick.addEventListener('change', () => {
              const f = pick.files?.[0]; if (!f) return;
              const rd = new FileReader();
              rd.onload = () => commit(setClipParam(show(), id, clip.id, p.key, rd.result));
              rd.readAsDataURL(f);
            });
            b.append(field(p.label || p.key, pick));
            continue;
          }
          if (!(p.type === 'float' || p.type === 'long' || p.type === 'bool' || p.type === 'color')) continue;
          const key = p.key;
          b.append(animatableParam({
            key, p, value: clip.params?.[key], anim: clip.anim?.[key],
            oscAddress: addressFor({ kind: 'param', layerIndex, clipIndex, key }),
            onValue: (v) => commitLive(setClipParam(show(), id, clip.id, key, v)),
            onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, key, spec)),
            onAnimLive: (spec) => commitLive(setClipAnim(show(), id, clip.id, key, spec)),
          }));
        }
      }));
    }

    // VOLUMETRIC clip: no canvas placement (transform) and no effect chain in
    // v1 — the field lights each LED at its world xyz. Keep OPACITY (it scales
    // the per-LED blend, animatable like any param) and stop here.
    if (gen?.volumetric) {
      box.append(Section('Blend', 'transform', (b) => {
        b.append(el('div', { className: 'ly-hint', textContent: 'volumetric — lights each LED at its 3D position (z = height off the canvas); not drawn on the canvas. Max 4 volumetric clips active at once; no effect chain in v1.' }));
        b.append(animatableParam({
          key: 'tf.opacity', p: { key: 'opacity', type: 'float', min: 0, max: 1, default: 1 },
          value: clip.opacity ?? 1, anim: clip.anim?.['tf.opacity'],
          oscAddress: addressFor({ kind: 'tf', layerIndex, clipIndex, key: 'opacity' }),
          onValue: (v) => commitLive(setClipOpacity(show(), id, clip.id, v)),
          onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, 'tf.opacity', spec)),
          onAnimLive: (spec) => commitLive(setClipAnim(show(), id, clip.id, 'tf.opacity', spec)),
        }));
      }, () => commit(resetClipTransform(show(), id, clip.id)), undefined,
      () => Math.abs(Number((liveClip(clip.id) ?? clip).opacity ?? 1) - 1) > 1e-6));
      return box;
    }

    // Transform + opacity (the clip's placement on the canvas) — all animatable
    // (Timeline/Audio) via the cog, like the source params. Anim keyed `tf.*`.
    const t = clip.transform || {};
    const tfDirty = () => {
      const c = liveClip(clip.id) ?? clip;
      const ct = c.transform || {};
      return [['x', 0], ['y', 0], ['scale', 1], ['rotation', 0]].some(([k, d]) => Math.abs(Number(ct[k] ?? d) - d) > 1e-6)
        || Math.abs(Number(c.opacity ?? 1) - 1) > 1e-6
        || ['x', 'y', 'scale', 'rotation', 'opacity'].some((k) => c.anim?.['tf.' + k]);
    };
    box.append(Section('Transform', 'transform', (b) => {
      const tfParam = (key, label, min, max, def, value, apply) => b.append(animatableParam({
        key: 'tf.' + key, p: { key: label, type: 'float', min, max, default: def },
        value, anim: clip.anim?.['tf.' + key],
        oscAddress: addressFor({ kind: 'tf', layerIndex, clipIndex, key }),
        onValue: (v) => commitLive(apply(v)),
        onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, 'tf.' + key, spec)),
        onAnimLive: (spec) => commitLive(setClipAnim(show(), id, clip.id, 'tf.' + key, spec)),
      }));
      tfParam('x', 'x', -1, 1, 0, t.x ?? 0, (v) => setClipTransform(show(), id, clip.id, { x: v }));
      tfParam('y', 'y', -1, 1, 0, t.y ?? 0, (v) => setClipTransform(show(), id, clip.id, { y: v }));
      tfParam('scale', 'scale', 0, 3, 1, t.scale ?? 1, (v) => setClipTransform(show(), id, clip.id, { scale: v }));
      tfParam('rotation', 'rotation', -180, 180, 0, t.rotation ?? 0, (v) => setClipTransform(show(), id, clip.id, { rotation: v }));
      tfParam('opacity', 'opacity', 0, 1, 1, clip.opacity ?? 1, (v) => setClipOpacity(show(), id, clip.id, v));
    }, () => commit(resetClipTransform(show(), id, clip.id)), undefined, tfDirty));

    // Effect chain. Locked open while empty so the drop target stays reachable
    // (collapsing an empty Effects group would hide the only way to add one).
    const clipFx = clip.effects || [];
    box.append(Section('Effects', 'effects', (b) => {
      for (let fx = 0; fx < clipFx.length; fx++) b.append(clipEffectBlock(id, clip, fx, clipFx));
      const addBtn = el('button', { className: 'composer-add', textContent: '+' });
      addBtn.onclick = () => openPicker(addBtn, (name) => commit(addClipEffect(show(), id, clip.id, name)),
        { colorOnly: !!getEntry(clip.generator)?.volumetric });
      b.append(addBtn);
    }, undefined, clipFx.length === 0));
    return box;
  }

  // An ISF effect block (effect item is an { isf, params } object). Its params are
  // stored on the item (keyed by NAME) and edited via setClipEffectParam.
  function isfEffectBlock(id, clip, fx, item) {
    const block = el('div', { className: 'ly-fx ly-fx-clip' + (fxSel('clip', id, clip.id, fx) ? ' is-sel' : '') });
    const head = el('div', { className: 'ly-fxhead', draggable: true }, [
      el('span', { className: 'ly-fxname', textContent: `${fx + 1}. ${item.isf.name || 'ISF'}` }),
    ]);
    head.addEventListener('click', () => { selectedEffect = { scope: 'clip', layerId: id, clipId: clip.id, index: fx }; render(); });
    head.addEventListener('dragstart', (e) => { drag = { kind: 'fx-clip', index: fx }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'fx'); });
    head.addEventListener('dragend', () => { drag = null; });
    head.append(fxMenu({ presetName: item.isf.name || 'ISF', onRemove: () => { if (confirmDelete('Remove this effect?')) commit(removeClipEffect(show(), id, clip.id, fx)); } }));
    block.append(head);
    for (const p of item.isf.params || []) {
      if (!(p.type === 'float' || p.type === 'long' || p.type === 'bool' || p.type === 'color')) continue;
      block.append(paramControl(p, item.params?.[p.key] ?? p.default,
        (v) => commitLive(setClipEffectParam(show(), id, clip.id, fx, p.key, v))));
    }
    return block;
  }

  // One clip effect block: a drag-to-reorder block with a "⋯" options menu.
  function clipEffectBlock(id, clip, fx, effects) {
    const name = effects[fx];
    if (name && name.isf) return isfEffectBlock(id, clip, fx, name);
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
      onReset: () => commit(mergeClipParams(show(), id, clip.id, prefixedDefaults(name), true)),
      onRemove: () => { if (confirmDelete('Remove this effect?')) commit(removeClipEffect(show(), id, clip.id, fx)); },
    }));
    block.append(head);

    if (entry) {
      for (const p of entry.params) {
        const key = entry.name + '.' + p.key;
        block.append(animatableParam({
          key, p, value: clip.params?.[key], anim: clip.anim?.[key],
          onValue: (v) => commitLive(setClipParam(show(), id, clip.id, key, v)),
          onAnim: (spec) => commit(setClipAnim(show(), id, clip.id, key, spec)),
            onAnimLive: (spec) => commitLive(setClipAnim(show(), id, clip.id, key, spec)),
        }));
      }
    }
    return block;
  }

  // --- Picker popover (replaces the bottom Sources/Effects shelf) ------------
  // Opened on demand from a "+" affordance: the empty clip slot offers SOURCES,
  // each Effects chain offers EFFECTS. Anchored to its trigger, click-out / Esc
  // dismisses. Sources show their rendered thumbnail (same as the old shelf).
  let pickPop = null, pickDismiss = null;
  function closePicker() {
    if (!pickPop) return;
    pickPop.remove(); pickPop = null;
    if (pickDismiss) { pickDismiss(); pickDismiss = null; }
  }
  // Source picker grouping (built-in generators) — SOURCE_CATEGORIES is imported
  // from ./source-catalog.js; uncategorised generators fall into "More".
  // The EFFECT picker popover (sources use the sidebar Sources tab, not a popover).
  function openPicker(anchor, onPick, opts = {}) {
    closePicker();
    const pop = el('div', { className: 'pick-pop' });
    const item = (name) => {
      const row = el('div', { className: 'pick-item' });
      row.append(el('span', { className: 'lib-label', textContent: labelOf(name) }));
      row.onclick = (e) => { e.stopPropagation(); closePicker(); onPick(name); };
      return row;
    };
    const grid = (names) => { const g = el('div', { className: 'pick-grid' }); names.forEach((n) => g.append(item(n))); return g; };
    const names = opts.colorOnly ? effectNames().filter((n) => effectKind(n) === 'color') : effectNames();
    pop.append(grid(names));
    placePopover(pop, anchor);          // anchor + viewport-clamp (kit)
    pickPop = pop;
    pickDismiss = dismissOnOutside(pop, closePicker);   // click-outside + Esc (kit)
  }

  // Pick a video file and add it as a new clip on `layerId` (or the active layer).
  function pickVideo(layerId) {
    const inp = el('input', { type: 'file', accept: 'video/*' });
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      const l = (layerId && layerById(layerId)) || layerOfClip(selectedClipId) || topLayer();
      if (!f || !l) return;
      const name = f.name.replace(/\.[^.]+$/, '');
      const next = addVideoClip(show(), l.id, name, URL.createObjectURL(f));
      const layer = next.composition.layers.find((x) => x.id === l.id);
      selectedClipId = layer.clips[layer.clips.length - 1].id;
      onClipSelect?.();
      commit(next);
    });
    inp.click();
  }

  // Add a source to the ACTIVE layer (the one pickVideo falls back to) — used by the
  // Sources tab's click-to-add. Drag-to-a-slot uses the slot's own drop target.
  function addSourceToActiveLayer(name) {
    const l = layerOfClip(selectedClipId) || topLayer();
    if (l) commit(addClip(show(), l.id, name));
  }
  function pickVideoActive() { pickVideo(null); }   // pickVideo already falls back to the active/top layer

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

  // --- POINTER-based drag for DECK items (clips + layer heads). Native HTML5 DnD
  //     fires dragstart/dragover but the `drop` is unreliable under the global
  //     `user-select:none` and across browsers — so the deck rolls its own:
  //     press + move past a threshold floats a ghost; the registered zone under
  //     the pointer (elementFromPoint, walking up to a __deckZone) is the live
  //     drop target. (Effects/sources keep the native makeDropTarget — they're
  //     dragged in from the picker rail, not from inside the deck.) Pointer drag
  //     also fixes the long-standing "reorder doesn't take" reports. ---
  function deckZone(node, accepts, onDrop) {
    node.__deckZone = true; node.__deckAccepts = accepts; node.__deckDrop = onDrop;
  }
  const findZone = (x, y, payload) => {
    let n = document.elementFromPoint(x, y);
    while (n) { if (n.__deckZone && n.__deckAccepts(payload)) return n; n = n.parentElement; }
    return null;
  };
  function deckDraggable(node, makePayload) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Don't hijack a press on an interactive child (opacity fader, B/S/✕, etc.).
      if (e.target.closest('input, button, select, textarea, a, .lh-op')) return;
      const sx = e.clientX, sy = e.clientY;
      let live = false, ghost = null, hover = null, payload = null;
      const setHover = (z) => { if (z === hover) return; hover?.classList.remove('drop-hover'); hover = z; hover?.classList.add('drop-hover'); };
      const move = (ev) => {
        if (!live) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;   // threshold
          live = true; payload = makePayload();
          ghost = el('div', { className: 'deck-ghost', textContent: payload.label || '' });
          document.body.append(ghost);
          node.classList.add('deck-dragging');
        }
        ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
        ghost.style.display = 'none';                     // don't let the ghost shadow elementFromPoint
        setHover(findZone(ev.clientX, ev.clientY, payload));
        ghost.style.display = '';
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!live) return;
        node.classList.remove('deck-dragging'); ghost?.remove();
        ghost && (ghost.style.display = 'none');
        const z = findZone(ev.clientX, ev.clientY, payload);
        hover?.classList.remove('drop-hover');
        if (z) z.__deckDrop(payload);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
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
    // A project must keep at least one clip — refuse to delete the very last one
    // (across all layers). Emptying a layer that has siblings is still allowed.
    const totalClips = (show().composition?.layers || []).reduce((n, L) => n + (L.clips?.length || 0), 0);
    if (totalClips <= 1) return;
    if (!confirmDelete('Delete this clip?')) return;
    // Keep a clip selected: hop to the next clip (or the previous if it was last).
    const clips = l.clips || [];
    const i = clips.findIndex((c) => c && c.id === target);
    selectedClipId = clips[i + 1]?.id ?? clips[i - 1]?.id ?? null;
    commit(removeClip(show(), l.id, target));
  }

  // Delete the selected LAYER (Backspace, when a layer — not a clip — is the
  // selection). Refuses the last layer (the composition must keep one). Returns
  // true if it acted, so app.js can chain the delete priorities.
  function deleteSelectedLayer() {
    // Only when a LAYER head is the active selection (a clip is always selected
    // underneath, so we key off the explicit deck target, not clip presence).
    if (deckSel !== 'layer') return false;
    const layers = show().composition?.layers || [];
    if (!selectedLayerId || layers.length <= 1) return false;
    const i = layers.findIndex((l) => l.id === selectedLayerId);
    if (i < 0) return false;
    if (!confirmDelete('Delete this layer?')) return true;   // handled (cancelled)
    const target = selectedLayerId;
    // Keep a layer selected: hop to a neighbour.
    selectedLayerId = layers[i + 1]?.id ?? layers[i - 1]?.id ?? null;
    commit(removeLayer(show(), target));
    return true;
  }

  // TD-style source BROWSER: family tabs + search + dense card grid + a description
  // line. Shared by the Output-pane Sources tab (draggable, click-adds-to-active-layer)
  // and the '+' clip picker (click → onPick). Filtering/categories are pure (source-catalog).
  function sourceBrowser({ onPick, draggable = false, onVideo } = {}) {
    const root = el('div', { className: 'src-browser' });
    let tab = '2D', query = '';
    const tabbar = el('div', { className: 'src-tabs' });
    const search = el('input', { className: 'src-search', type: 'search', placeholder: 'search sources…' });
    const gridEl = el('div', { className: 'src-grid' });
    const descEl = el('div', { className: 'src-desc' });
    const setDesc = (name) => { descEl.textContent = name ? (descOf(name) || sourceCategory(name)) : ''; };

    const card = (name) => {
      const cat = sourceCategory(name);
      const c = el('div', { className: 'src-card', title: labelOf(name), draggable: !!draggable });
      c.style.setProperty('--cat', CATEGORY_COLORS[cat] || 'var(--faint)');
      const thumb = thumbnails[name];
      if (thumb) c.append(el('img', { className: 'src-thumb', src: thumb, alt: '', draggable: false }));
      c.append(el('span', { className: 'src-dot' }), el('span', { className: 'src-label', textContent: labelOf(name) }));
      c.addEventListener('mouseenter', () => setDesc(name));
      if (onPick) c.addEventListener('click', () => onPick(name));
      if (draggable) {
        c.addEventListener('dragstart', (e) => { drag = { kind: 'source', name }; e.dataTransfer.effectAllowed = 'copy'; try { e.dataTransfer.setData('text/plain', name); } catch { /* */ } });
        c.addEventListener('dragend', () => { drag = null; });
      }
      return c;
    };

    const renderGrid = () => {
      gridEl.textContent = '';
      const names = filterSources(generatorNames(), { tab, query });
      names.forEach((n) => gridEl.append(card(n)));
      // ISF imports live under the Shaders tab; the video source under 2D.
      if (tab === 'Shaders' && !query) {
        const examples = (getISFExamples && getISFExamples()) || [];
        if (examples.length && onAddISF) examples.forEach((file) => {
          const c = el('div', { className: 'src-card src-isf', title: file });
          c.style.setProperty('--cat', CATEGORY_COLORS.Shaders);
          c.append(el('span', { className: 'src-dot' }), el('span', { className: 'src-label', textContent: file.replace(/\.[^.]+$/, '') }));
          c.addEventListener('click', () => onAddISF(file));
          gridEl.append(c);
        });
      }
      if (tab === '2D' && onVideo && !query) {
        const v = el('div', { className: 'src-card src-video', title: 'add a video clip' });
        v.append(el('span', { className: 'src-label', textContent: '+ video…' }));
        v.addEventListener('click', () => onVideo());
        gridEl.append(v);
      }
      if (!gridEl.childNodes.length) gridEl.append(el('div', { className: 'seg-hint', textContent: tab === 'Shaders' ? 'no shaders imported' : 'no sources' }));
    };

    const renderTabs = () => {
      tabbar.textContent = '';
      for (const t of CATEGORY_TABS) {
        const b = el('button', { className: 'src-tab' + (t === tab && !query ? ' is-on' : ''), textContent: t });
        if (CATEGORY_COLORS[t]) b.style.setProperty('--cat', CATEGORY_COLORS[t]);
        b.addEventListener('click', () => { tab = t; query = ''; search.value = ''; renderTabs(); renderGrid(); });
        tabbar.append(b);
      }
    };

    search.addEventListener('input', () => { query = search.value; renderTabs(); renderGrid(); });
    root.append(tabbar, search, gridEl, descEl);
    renderTabs(); renderGrid();
    return root;
  }

  render();
  // getSelectedClipId: app.js resolves /selected/… canonical OSC addresses
  // against the inspector's current clip at message time.
  return { el: root, refresh: render, setPlayhead, updateLive, deleteActiveClip, deleteSelectedEffect, deleteSelectedLayer, getSelectedClipId: () => selectedClipId, closeModPop: closeAnimPop, addSourceToActiveLayer, pickVideoActive, sourceBrowser };
}

// Rename a clip (small local helper — there is no dedicated model fn, so we
// reuse the clip update via a param-free patch through changeClipGenerator's
// sibling). We do it inline to avoid touching the model: find + immutably set.
function patchClipName(show, layerId, clipId, name) {
  const layers = (show.composition?.layers || []).map((l) => {
    if (l.id !== layerId) return l;
    return { ...l, clips: (l.clips || []).map((c) => c && c.id === clipId ? { ...c, name } : c) };
  });
  return { ...show, composition: { ...show.composition, layers } };
}

// Merge a patch onto a clip's per-clip audioTrigger config (band/sensitivity/hold/
// enabled). Same immutable clip-patch shape as patchClipName; fed to commitLive.
function patchClipAudioTrigger(show, layerId, clipId, patch) {
  const layers = (show.composition?.layers || []).map((l) => {
    if (l.id !== layerId) return l;
    return { ...l, clips: (l.clips || []).map((c) => c && c.id === clipId
      ? { ...c, audioTrigger: { ...(c.audioTrigger || {}), ...patch } } : c) };
  });
  return { ...show, composition: { ...show.composition, layers } };
}
