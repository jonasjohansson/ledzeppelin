// Shared accent sync for the popout windows (Inventory, Mappings). Those pages load
// ui.css, which only carries the DEFAULT accent — so they mirror the editor's chosen
// accent (persisted in lz.accent) here: on load and live via the `storage` event when
// it changes in the editor, so each popout matches the app's theme.
export function syncAccent() {
  const h2 = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(x || ''); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, w) => { const A = h2(a), B = h2(b); return toHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };
  // Surface vars this file overrides in LIGHT mode — CLEARED when going back to dark so
  // ui.css :root dark values take over again.
  const LIGHT_VARS = ['--bg', '--field-bg', '--panel', '--panel-solid', '--panel-2', '--hover',
    '--line', '--line-2', '--text', '--muted', '--faint', '--readout', '--stage-bg'];
  const apply = () => {
    let hex; try { hex = localStorage.getItem('lz.accent'); } catch { hex = null; }
    if (!h2(hex)) return;
    let theme; try { theme = localStorage.getItem('lz.theme'); } catch { theme = null; }
    const s = document.documentElement.style;
    s.setProperty('--accent', hex);
    if (theme === 'light') {
      // Full LIGHT ramp for popout windows (Inventory/Mappings). They don't read the
      // editor's Brightness/Tint/Contrast, so we use defaults. KEEP IN SYNC with the light
      // branches of src/ui/prefs.js (applyAccent/applyContrast).
      s.setProperty('--accent-soft', mix(hex, '#ffffff', 0.82));
      s.setProperty('--accent-line', mix(hex, '#ffffff', 0.45));
      s.setProperty('--accent-text', mix(hex, '#141414', 0.30));
      s.setProperty('--bg', mix(hex, '#f4f4f6', 0.02));
      s.setProperty('--field-bg', mix(hex, '#ffffff', 0.02));
      const panelL = mix(hex, '#eaeaee', 0.03);
      s.setProperty('--panel', panelL); s.setProperty('--panel-solid', panelL);
      s.setProperty('--panel-2', mix(hex, '#e2e2e7', 0.035));
      s.setProperty('--hover', mix(hex, '#d7d7de', 0.05));
      s.setProperty('--line', mix(hex, '#cfcfd6', 0.05));
      s.setProperty('--line-2', mix(hex, '#bcbcc6', 0.06));
      s.setProperty('--text', mix('#16161a', '#ffffff', 1.3));
      s.setProperty('--muted', mix('#4d4d57', '#ffffff', 1.3));
      s.setProperty('--faint', mix('#74747f', '#ffffff', 1.3));
      s.setProperty('--readout', mix('#2b2b32', '#ffffff', 1.3));
      s.setProperty('--stage-bg', '#0d0d0f');
    } else {
      s.setProperty('--accent-soft', mix(hex, '#0a0a0a', 0.16));
      s.setProperty('--accent-line', mix(hex, '#0a0a0a', 0.40));
      s.setProperty('--accent-text', mix(hex, '#ffffff', 0.62));
      for (const k of LIGHT_VARS) s.removeProperty(k);   // revert to ui.css :root dark values
    }
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
