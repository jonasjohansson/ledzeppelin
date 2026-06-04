// Composition panel (Task 2 — "clips"). Edits the composition CANVAS resolution,
// which drives the source render targets + on-screen stage. Mirrors the
// fixtures/layers panel conventions + dark theme.
//
// createCompositionPanel({ getShow, setSize }) → { el, refresh() }
//   getShow():     returns the current show (reads composition.canvas)
//   setSize(w,h):  apply a new canvas size (app.js wires this to setCanvasSize,
//                  which clamps, persists, resizes the stage + rebuilds the
//                  compositor). The canvas resolution does NOT affect
//                  fixtures/pipeline/routing/sampler.
//
// Just two free fields (width/height) + a readout; Apply commits via setSize.

import { clampCanvasSize, setShowAudioGain } from '../model/layers.js';

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};

const field = (label, control) =>
  el('label', { className: 'fx-field' }, [el('span', { textContent: label }), control]);

// A range slider with a live readout (writes back on every input, no re-render).
const sliderRow = (label, value, min, max, onInput) => {
  const out = el('span', { className: 'ly-readout', textContent: String(Math.round(value)) });
  const range = el('input', {
    type: 'range', min: String(min), max: String(max), step: '1', value: String(value ?? 0),
  });
  range.addEventListener('input', () => { out.textContent = range.value; onInput(Number(range.value)); });
  return el('label', { className: 'fx-field ly-param ly-row' }, [
    el('span', { className: 'ly-plabel', textContent: label }), out, range,
  ]);
};

// gcd-based aspect string (e.g. 1280×720 → "16:9"). Falls back to "—" on 0.
function aspectLabel(w, h) {
  if (!(w > 0) || !(h > 0)) return '—';
  const g = (a, b) => (b ? g(b, a % b) : a);
  const d = g(Math.round(w), Math.round(h));
  return `${Math.round(w) / d}:${Math.round(h) / d}`;
}

// createCompositionPanel({ getShow, setSize, setShow })
//   setShow(s): composition-only persist (no rebuild) — used for the crossfade,
//   which is a composition-global setting living on the single layer.
export function createCompositionPanel({ getShow, setSize, setShow }) {
  const root = el('div', { className: 'fx-panel cmp-panel' });

  // Working draft of the fields (not yet applied). Seeded from the show.
  function currentCanvas() {
    const c = getShow().composition?.canvas || {};
    return clampCanvasSize(c.w ?? 1280, c.h ?? 720);
  }
  let draft = currentCanvas();

  function render() {
    root.textContent = '';
    draft = currentCanvas();

    // (Title omitted — the COMPOSITION tab already names this view; master
    //  opacity lives in the top-bar globals.)

    // --- Width / height fields (reflect the draft) ---
    const mkNum = (value, onInput) => {
      const i = el('input', { type: 'number', value: String(value), step: '1', min: '16', max: '4096' });
      i.addEventListener('input', () => onInput(i.value === '' ? 0 : Number(i.value)));
      return i;
    };
    const wInput = mkNum(draft.w, (x) => { draft = { ...draft, w: x }; updateReadout(); });
    const hInput = mkNum(draft.h, (x) => { draft = { ...draft, h: x }; updateReadout(); });

    const grid = el('div', { className: 'fx-card cmp-grid' }, [
      field('width', wInput),
      field('height', hInput),
    ]);
    root.append(grid);

    // --- Readout (clamped draft size + aspect) ---
    const readout = el('div', { className: 'cmp-readout' });
    const updateReadout = () => {
      const c = clampCanvasSize(draft.w, draft.h);
      readout.textContent = `${c.w} × ${c.h}  ·  ${aspectLabel(c.w, c.h)}`;
    };
    updateReadout();
    root.append(readout);

    // --- Apply ---
    root.append(el('button', {
      className: 'fx-add cmp-apply', textContent: 'apply',
      onclick: () => {
        const c = clampCanvasSize(draft.w, draft.h);
        setSize(c.w, c.h);
        render();
      },
    }));

    // --- Audio input (general config): global gain on the mic before it drives
    //     Audio-mode params. ×0 mutes, ×1 unity, up to ×8 to boost quiet input. ---
    const gain = getShow().composition?.audioGain ?? 1;
    const gOut = el('span', { className: 'ly-readout', textContent: `×${gain.toFixed(2)}` });
    const gRange = el('input', { type: 'range', min: '0', max: '8', step: '0.05', value: String(gain) });
    gRange.addEventListener('input', () => {
      gOut.textContent = `×${Number(gRange.value).toFixed(2)}`;
      setShow?.(setShowAudioGain(getShow(), Number(gRange.value)));
    });
    gRange.addEventListener('contextmenu', (e) => {           // right-click → reset to ×1
      e.preventDefault(); gRange.value = '1'; gOut.textContent = '×1.00';
      setShow?.(setShowAudioGain(getShow(), 1));
    });
    root.append(el('div', { className: 'fx-pts', textContent: 'audio input' }));
    root.append(el('div', { className: 'fx-card' }, [
      el('label', { className: 'fx-field ly-param ly-row resettable' }, [
        el('span', { className: 'ly-plabel', textContent: 'gain' }), gOut, gRange,
      ]),
    ]));

  }

  render();
  return { el: root, refresh: render };
}
