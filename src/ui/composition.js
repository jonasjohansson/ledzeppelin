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
import { el, field } from './dom.js';

// createCompositionPanel({ getShow, setSize })
//   Canvas resolution only. Composition-global preferences (crossfade, audio
//   gain, theme, file I/O) moved to the global Settings panel; master opacity
//   moved to the Composition group head + its inspector.
export function createCompositionPanel({ getShow, setSize, fitToFixtures, setTitle }) {
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

    // --- Title — names the composition; saved with it (commits on blur/enter). ---
    if (setTitle) {
      const title = el('input', { type: 'text', placeholder: 'untitled', value: getShow().composition?.title || '' });
      title.addEventListener('change', () => setTitle(title.value.trim()));
      root.append(el('div', { className: 'fx-card cmp-grid' }, [field('Title', title)]));
    }

    // --- Width / height fields (reflect the draft) ---
    const mkNum = (value, onInput) => {
      const i = el('input', { type: 'number', value: String(value), step: '1', min: '16', max: '4096' });
      i.addEventListener('input', () => onInput(i.value === '' ? 0 : Number(i.value)));
      return i;
    };
    const wInput = mkNum(draft.w, (x) => { draft = { ...draft, w: x }; });
    const hInput = mkNum(draft.h, (x) => { draft = { ...draft, h: x }; });

    const grid = el('div', { className: 'fx-card cmp-grid' }, [
      field('Width', wInput),
      field('Height', hInput),
    ]);
    root.append(grid);

    // --- Apply ---
    root.append(el('button', {
      className: 'fx-add cmp-apply', textContent: 'apply',
      onclick: () => {
        const c = clampCanvasSize(draft.w, draft.h);
        setSize(c.w, c.h);
        render();
      },
    }));

    // --- Fit to fixtures (fluid canvas — let the strips decide the size) ---
    if (fitToFixtures) {
      root.append(el('button', {
        className: 'fx-add cmp-fit', textContent: 'fit to fixtures',
        title: 'resize the canvas to exactly contain the placed fixtures',
        onclick: () => { fitToFixtures(); render(); },
      }));
    }
    // (Crossfade is now a PER-LAYER setting in the Layer inspector — default 500.)
  }

  render();
  return { el: root, refresh: render };
}
