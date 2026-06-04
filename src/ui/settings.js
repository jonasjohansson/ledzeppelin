// Global Settings panel — app-wide preferences that are NOT per-clip / per-layer
// and not composition geometry: appearance (GUI theme), audio input gain,
// composition defaults (crossfade), composition file I/O, and output/mapping snap.
//
// These used to be scattered across the Composition sub-tab; they live here so the
// Composition inspector is just the group's settings (master opacity, canvas,
// effects). Mounts into its own top-level "Settings" view.
//
// createSettingsPanel({ getShow, setShow, loadComposition, snap }) → { el, refresh() }
//   setShow(s):       composition-only persist (no rebuild) — crossfade, audio gain
//   loadComposition:  replace the composition from a loaded file
//   snap: { enabled(), setEnabled(b), grid(), setGrid(n), dist(), setDist(n) }

import { setShowAudioGain, setCompositionTransition } from '../model/layers.js';
import { THEME_TOKENS, tokenValue, setToken, resetTheme } from './theme.js';

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};

const field = (label, control) =>
  el('label', { className: 'fx-field' }, [el('span', { textContent: label }), control]);

// Paint a param-row slider's value-based accent fill (so it reaches the ends).
const fill = (r) => { const mn = +r.min, mx = +r.max; r.style.setProperty('--fill', (mx > mn ? (+r.value - mn) / (mx - mn) * 100 : 50) + '%'); };

export function createSettingsPanel({ getShow, setShow, loadComposition, snap }) {
  const root = el('div', { className: 'fx-panel cmp-panel settings-panel' });

  function render() {
    root.textContent = '';

    // --- Appearance: live GUI theme. Each picker writes a CSS token immediately
    //     and persists it; the whole UI updates as you drag. ---
    root.append(el('div', { className: 'fx-pts', textContent: 'appearance' }));
    const colorGrid = el('div', { className: 'fx-card cmp-grid' });
    for (const [label, varName] of THEME_TOKENS) {
      const picker = el('input', { type: 'color', value: tokenValue(varName) });
      picker.addEventListener('input', () => setToken(varName, picker.value));
      colorGrid.append(field(label, picker));
    }
    root.append(colorGrid);
    root.append(el('button', {
      className: 'fx-del-link', textContent: 'reset colors',
      onclick: () => { resetTheme(); render(); },
    }));

    // --- Audio input: global gain on the mic before it drives Audio-mode params.
    //     ×0 mutes, ×1 unity, up to ×8 to boost quiet input. ---
    root.append(el('div', { className: 'fx-pts', textContent: 'audio input' }));
    const gain = getShow().composition?.audioGain ?? 1;
    const gOut = el('span', { className: 'ly-readout', textContent: `×${gain.toFixed(2)}` });
    const gRange = el('input', { type: 'range', min: '0', max: '8', step: '0.05', value: String(gain) });
    fill(gRange);
    gRange.addEventListener('input', () => {
      gOut.textContent = `×${Number(gRange.value).toFixed(2)}`;
      fill(gRange);
      setShow?.(setShowAudioGain(getShow(), Number(gRange.value)));
    });
    gRange.addEventListener('contextmenu', (e) => {           // right-click → reset to ×1
      e.preventDefault(); gRange.value = '1'; gOut.textContent = '×1.00'; fill(gRange);
      setShow?.(setShowAudioGain(getShow(), 1));
    });
    root.append(el('div', { className: 'fx-card' }, [
      el('label', { className: 'fx-field ly-param ly-row resettable' }, [
        el('span', { className: 'ly-plabel', textContent: 'Gain' }), gOut, gRange,
      ]),
    ]));

    // --- Composition defaults: crossfade time (how long a clip change fades,
    //     across ALL layers). ---
    root.append(el('div', { className: 'fx-pts', textContent: 'composition defaults' }));
    const xf = getShow().composition?.transitionMs ?? 500;
    const xfOut = el('span', { className: 'ly-readout', textContent: String(Math.round(xf)) });
    const xfRange = el('input', { type: 'range', min: '0', max: '5000', step: '10', value: String(xf) });
    fill(xfRange);
    xfRange.addEventListener('input', () => {
      xfOut.textContent = String(Math.round(Number(xfRange.value)));
      fill(xfRange);
      setShow?.(setCompositionTransition(getShow(), Number(xfRange.value)));
    });
    xfRange.addEventListener('contextmenu', (e) => { e.preventDefault(); xfRange.value = '500'; xfOut.textContent = '500'; fill(xfRange); setShow?.(setCompositionTransition(getShow(), 500)); });
    root.append(el('div', { className: 'fx-card' }, [
      el('label', { className: 'fx-field ly-param ly-row resettable' }, [
        el('span', { className: 'ly-plabel', textContent: 'Crossfade (ms)' }), xfOut, xfRange,
      ]),
    ]));

    // --- Output / mapping: snap-to-grid for fixture placement, plus the grid
    //     size and alignment tolerance (px). ---
    if (snap) {
      root.append(el('div', { className: 'fx-pts', textContent: 'output mapping' }));
      const snapCard = el('div', { className: 'fx-card' });
      const snapCb = el('input', { type: 'checkbox', checked: !!snap.enabled() });
      snapCb.addEventListener('change', () => snap.setEnabled(snapCb.checked));
      snapCard.append(el('label', { className: 'fx-field bool-row' }, [
        el('span', { className: 'ly-plabel', textContent: 'Snap to grid' }), snapCb,
      ]));
      const mkNum = (value, min, onInput) => {
        const i = el('input', { type: 'number', value: String(value), step: '1', min: String(min), max: '200' });
        i.addEventListener('change', () => { const v = Math.max(min, Math.round(Number(i.value) || min)); i.value = String(v); onInput(v); });
        return i;
      };
      snapCard.append(field('Grid (px)', mkNum(snap.grid(), 1, (v) => snap.setGrid(v))));
      snapCard.append(field('Tolerance (px)', mkNum(snap.dist(), 0, (v) => snap.setDist(v))));
      root.append(snapCard);
    }

    // --- Composition file (visuals only — keeps the fixture patch). ---
    root.append(el('div', { className: 'fx-pts', textContent: 'composition file' }));
    const io = el('div', { className: 'fx-io' });
    io.append(el('button', {
      textContent: 'save composition',
      onclick: () => {
        const comp = getShow().composition || {};
        const blob = new Blob([JSON.stringify(comp, null, 2)], { type: 'application/json' });
        const a = el('a', { href: URL.createObjectURL(blob), download: 'composition.json' });
        a.click(); URL.revokeObjectURL(a.href);
      },
    }));
    const compFileIn = el('input', { type: 'file', accept: '.json,application/json' });
    compFileIn.style.display = 'none';
    compFileIn.addEventListener('change', async () => {
      const file = compFileIn.files[0];
      if (!file) return;
      try { loadComposition?.(JSON.parse(await file.text())); }
      catch (e) { window.alert(`load failed: ${e.message}`); }
      compFileIn.value = '';
    });
    io.append(el('button', { textContent: 'load composition', onclick: () => compFileIn.click() }), compFileIn);
    root.append(io);
  }

  render();
  return { el: root, refresh: render };
}
