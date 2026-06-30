// Shared accent sync for the popout windows (Inventory, Mappings). Those pages load
// ui.css, which only carries the DEFAULT accent — so they mirror the editor's chosen
// accent (persisted in lz.accent) here: on load and live via the `storage` event when
// it changes in the editor, so each popout matches the app's theme.
export function syncAccent() {
  const h2 = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(x || ''); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, w) => { const A = h2(a), B = h2(b); return toHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };
  const apply = () => {
    let hex; try { hex = localStorage.getItem('lz.accent'); } catch { hex = null; }
    if (!h2(hex)) return;
    const s = document.documentElement.style;
    s.setProperty('--accent', hex);
    s.setProperty('--accent-soft', mix(hex, '#0a0a0a', 0.16));
    s.setProperty('--accent-line', mix(hex, '#0a0a0a', 0.40));
    s.setProperty('--accent-text', mix(hex, '#ffffff', 0.62));
  };
  apply();
  addEventListener('storage', (e) => { if (e.key === 'lz.accent') apply(); });
}
