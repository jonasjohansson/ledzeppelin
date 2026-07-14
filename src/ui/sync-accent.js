// Shared accent sync for the popout windows (Inventory, Mappings). Those pages load
// ui.css, which only carries the DEFAULT accent — so they mirror the editor's chosen
// accent (persisted in lz.accent) here: on load and live via the `storage` event when
// it changes in the editor, so each popout matches the app's theme.
import { themeVars, applyVars } from './palette.js';

export function syncAccent() {
  const valid = (x) => /^#?[0-9a-f]{6}$/i.test(x || '');
  const apply = () => {
    let hex; try { hex = localStorage.getItem('lz.accent'); } catch { hex = null; }
    if (!valid(hex)) return;
    // The UI is dark-only now — popouts always derive against the dark ramp.
    applyVars(themeVars({ accent: hex, theme: 'dark' }));
  };
  document.documentElement.dataset.theme = 'dark';
  apply();
  addEventListener('storage', (e) => {
    if (e.key === 'lz.accent') apply();
  });
}
