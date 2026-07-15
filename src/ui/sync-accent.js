// Shared accent sync for the popout windows (Inventory, Mappings). Those pages load
// ui.css, which only carries the DEFAULT accent — so they mirror the editor's chosen
// accent (persisted in lz.accent) here: on load and live via the `storage` event when
// it changes in the editor, so each popout matches the app's theme.
import { themeVars, applyVars } from './palette.js';

export function syncAccent() {
  const valid = (x) => /^#?[0-9a-f]{6}$/i.test(x || '');
  const num = (key, def, lo, hi) => { try { const raw = localStorage.getItem(key); const v = Number(raw); return (raw != null && Number.isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : def; } catch { return def; } };
  const apply = () => {
    const hex = '#22bcd6';   // accent is FIXED (no picker) — cyan (MadMapper blue × Resolume teal), matching prefs.js
    if (!valid(hex)) return;
    // Derive surfaces from the SAME accent AND brightness/tint/contrast the editor uses
    // (same lz.* keys as prefs.js / settings.js) — dark-only. Passing just the accent
    // (the old behaviour) left these popouts on the DEFAULT ramp, so a non-default tint
    // gave them a visibly different (darker) background than the main window.
    applyVars(themeVars({
      accent: hex, theme: 'dark',
      brightness: num('lz.brightness', 0, -12, 20),
      tint: num('lz.tint.amt', 100, 0, 220),
      contrast: num('lz.contrast', 130, 60, 130),
    }));
    // Text size (--ui-scale) — the popouts were missing this, so Library items ignored
    // the Text size % setting. Same lz.uiscale key + clamp as prefs.js.
    document.documentElement.style.setProperty('--ui-scale', String(num('lz.uiscale', 1, 0.8, 1.4)));
  };
  document.documentElement.dataset.theme = 'dark';
  apply();
  // Re-derive when the editor changes the accent OR any appearance value (the Settings
  // popout writes these keys → a 'storage' event fires in this cross-context frame).
  addEventListener('storage', (e) => {
    if (['lz.accent', 'lz.brightness', 'lz.tint.amt', 'lz.contrast', 'lz.uiscale'].includes(e.key)) apply();
  });
}
