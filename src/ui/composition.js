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

import { clampCanvasSize } from '../model/layers.js';

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};

const field = (label, control) =>
  el('label', { className: 'fx-field' }, [el('span', { textContent: label }), control]);

// gcd-based aspect string (e.g. 1280×720 → "16:9"). Falls back to "—" on 0.
function aspectLabel(w, h) {
  if (!(w > 0) || !(h > 0)) return '—';
  const g = (a, b) => (b ? g(b, a % b) : a);
  const d = g(Math.round(w), Math.round(h));
  return `${Math.round(w) / d}:${Math.round(h) / d}`;
}

// createCompositionPanel({ getShow, setSize })
export function createCompositionPanel({ getShow, setSize }) {
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

    root.append(el('div', { className: 'fx-title', textContent: 'Composition' }));

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
      className: 'fx-add cmp-apply', textContent: 'Apply',
      onclick: () => {
        const c = clampCanvasSize(draft.w, draft.h);
        setSize(c.w, c.h);
        render();
      },
    }));
  }

  render();
  return { el: root, refresh: render };
}
