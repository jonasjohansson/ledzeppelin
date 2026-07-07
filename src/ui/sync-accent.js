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
    let theme; try { theme = localStorage.getItem('lz.theme'); } catch { theme = null; }
    // Popout windows (Inventory/Mappings) lack the editor's Brightness/Tint/Contrast
    // sliders → defaults. The shared deriver keeps them in step with the editor's theme.
    applyVars(themeVars({ accent: hex, theme: theme === 'light' ? 'light' : 'dark' }));
  };
  // Theme (Dark|Light chrome) also travels in localStorage (lz.theme). Mark it on the
  // root so these popouts follow the editor's theme; accent vars re-derive alongside.
  const applyTheme = () => {
    let t; try { t = localStorage.getItem('lz.theme'); } catch { t = null; }
    document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
    apply();
  };
  applyTheme();
  addEventListener('storage', (e) => {
    if (e.key === 'lz.accent') apply();
    else if (e.key === 'lz.theme') applyTheme();
  });
}
