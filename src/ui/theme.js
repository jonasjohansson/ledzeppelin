// Live, persisted GUI theme overrides. Editing a token writes a CSS custom
// property on :root (updates the whole UI immediately) and saves it, so the
// look survives reload. resetTheme() drops the overrides back to the defaults
// baked into ui.css.

const KEY = 'ledzeppelin.theme';

// The editable palette tokens (label → CSS var). Hex so a <input type=color>
// round-trips them directly.
export const THEME_TOKENS = [
  ['accent', '--accent'],
  ['background', '--bg'],
  ['panel', '--panel'],
  ['panel 2', '--panel-2'],
  ['text', '--text'],
  ['readout', '--readout'],
  ['green', '--green'],
  ['amber', '--amber'],
  ['cyan', '--cyan'],
];

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

// Apply saved overrides — call once, as early as possible, on boot.
export function applyTheme() {
  const t = read();
  for (const k of Object.keys(t)) document.documentElement.style.setProperty(k, t[k]);
}

// Current value of a token (override or the ui.css default), normalized to #rrggbb.
export function tokenValue(varName) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (/^#([0-9a-f]{6})$/i.test(v)) return v;
  if (/^#([0-9a-f]{3})$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('');
  return v || '#000000';
}

// Set a token live + persist it.
export function setToken(varName, hex) {
  document.documentElement.style.setProperty(varName, hex);
  const t = read(); t[varName] = hex;
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* quota */ }
}

// Drop all overrides → back to the ui.css defaults.
export function resetTheme() {
  for (const [, v] of THEME_TOKENS) document.documentElement.style.removeProperty(v);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
