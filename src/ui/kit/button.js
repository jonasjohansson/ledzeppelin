// The one button factory. `variant` maps to the existing button classes so every
// button shares the same chrome; `active` uses the FILLED-accent treatment. There is
// deliberately no size/weight prop — one height, one weight, by construction.
import { el } from '../dom.js';

const VARIANTS = {
  default: 'fx-add',        // full-width primary action
  secondary: 'ctrl-btn',    // in-row action (check, reboot, save)
  corner: 'g-btn',          // viewport corner toggle
  icon: 'fx-act',           // glyph-only action
  add: 'composer-add',      // dashed add affordance
};

export function Button(label, { onClick, variant = 'default', active = false, disabled = false, title = '', glyph } = {}) {
  const text = glyph ? (label ? `${glyph} ${label}` : glyph) : label;
  const btn = el('button', {
    className: (VARIANTS[variant] || VARIANTS.default) + (active ? ' on' : ''),
    textContent: text, disabled, title,
  });
  if (onClick) btn.onclick = onClick;
  return btn;
}

export function IconButton(glyph, opts = {}) {
  return Button('', { ...opts, glyph, variant: opts.variant || 'icon' });
}
