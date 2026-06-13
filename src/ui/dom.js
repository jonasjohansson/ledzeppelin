// Shared DOM primitives — the ONE definition of each, so every panel builds
// markup the same way (these used to be copy-pasted into 6 files, which is how
// "identical" controls drifted apart). Keep this tiny and dependency-free.

// el(tag, props, kids): create an element, assign props, append children.
// `data-*` / `aria-*` keys go through setAttribute — Object.assign would set a
// dead expando that never reflects to the attribute or .dataset, so
// `[data-x]` selectors silently miss; everything else is a plain property.
export const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const k in props) {
    if (k.startsWith('data-') || k.startsWith('aria-')) n.setAttribute(k, props[k]);
    else n[k] = props[k];
  }
  for (const k of kids) n.append(k);
  return n;
};

// --- Shift = coarse drag. Holding Shift while dragging ANY slider snaps it to
// 10 evenly-spaced stops across its range (so a 0..1 param moves in 0.1s, 0..3
// in 0.3s, etc.). `shiftDown` is a live ES binding — importers read the current
// value; the listeners keep it in step even when Shift is pressed mid-drag. ---
export let shiftDown = false;
if (typeof window !== 'undefined') {
  const sync = (e) => { shiftDown = e.shiftKey; };
  window.addEventListener('keydown', sync, true);
  window.addEventListener('keyup', sync, true);
  window.addEventListener('pointerdown', sync, true);   // catch Shift already held at grab
}
// Snap `v` to the nearest of 10 stops across [min,max]; 1e-6 rounding kills
// binary-float dust (0.1 not 0.30000000000000004).
export const coarseSnap = (v, min, max) => {
  const step = (max - min) / 10;
  if (!(step > 0)) return v;
  return Math.round((min + Math.round((v - min) / step) * step) * 1e6) / 1e6;
};

// field(label, control[, cls]): a labelled row — `<label class="fx-field [cls]">
// <span>label</span> control</label>`. The optional cls is the Settings superset.
export const field = (label, control, cls = '') =>
  el('label', { className: 'fx-field' + (cls ? ' ' + cls : '') }, [el('span', { textContent: label }), control]);

// selectInput(options, value, onInput): a <select>. Options are strings or
// { value, label }. Fires onInput(value) on change.
export const selectInput = (options, value, onInput) => {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', { value: o.value ?? o, textContent: o.label ?? o });
    if ((o.value ?? o) === value) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => onInput(s.value));
  return s;
};
