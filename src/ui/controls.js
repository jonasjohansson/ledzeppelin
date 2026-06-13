// The ONE slider control — a range + an editable numeric readout in a param row.
// Every slider in the app (clip/layer params, Library specs, device settings)
// routes through this so they look and behave identically (same `--fill` track,
// same typeable readout, same clamping). Older `sliderField`/`sliderRow` are now
// thin wrappers around it.
//
// Slider(label, value, { min, max, onInput, step, default, commit, fmt }) → row el
//   commit: 'live'   — onInput fires on every drag tick (clip/layer params)
//           'release'— onInput fires only on pointer-up (avoids rebuild mid-drag)
//   default: right-click the track to reset to this value (omit = not resettable)

import { el, shiftDown, coarseSnap } from './dom.js';

// 3-decimal trim (integers stay bare). Shared so readouts format the same.
const fmtDefault = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

export function Slider(label, value, opts = {}) {
  const { min = 0, max = 1, onInput = () => {}, default: def = null, commit = 'live' } = opts;
  const fmt = opts.fmt || fmtDefault;
  const step = opts.step ?? ((max - min) <= 2 ? 0.001 : (max - min) <= 50 ? 0.01 : 1);

  const out = el('input', {
    className: 'ly-readout ly-readout-edit', type: 'text', inputMode: 'decimal',
    spellcheck: false, value: fmt(value), title: 'click to type a value',
  });
  const range = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value ?? 0) });
  const paint = () => range.style.setProperty('--fill', (max > min ? (Number(range.value) - min) / (max - min) * 100 : 50) + '%');
  paint();

  // Drag: always repaint + sync the readout; fire onInput live, or defer to
  // release. Holding Shift snaps to 10 coarse stops across the range.
  range.addEventListener('input', () => {
    let v = Number(range.value);
    if (shiftDown) { v = coarseSnap(v, min, max); range.value = String(v); }
    out.value = fmt(v); paint(); if (commit === 'live') onInput(v);
  });
  if (commit === 'release') range.addEventListener('change', () => onInput(Number(range.value)));

  // Type-to-edit: allow only a number (digits, one '.', leading '-' when negative).
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
  out.addEventListener('focus', () => out.select());
  out.addEventListener('keydown', (e) => { if (e.key === 'Enter') out.blur(); });
  out.addEventListener('change', () => {
    const v = Number(out.value);
    if (Number.isFinite(v)) { const c = Math.min(max, Math.max(min, v)); range.value = String(c); out.value = fmt(c); paint(); onInput(c); }
    else out.value = fmt(Number(range.value));
  });

  const row = el('div', { className: 'fx-field ly-param ly-row' + (def != null ? ' resettable' : '') }, [
    el('span', { className: 'ly-plabel', textContent: label }), out, range,
  ]);
  // Right-click ANYWHERE on the row resets to the default (when one exists) and
  // always suppresses the OS menu, so a slider feels like a control, not text.
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (def == null) return;
    range.value = String(def); out.value = fmt(def); paint(); onInput(def);
  });
  return row;
}
