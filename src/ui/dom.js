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
