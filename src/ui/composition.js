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
export function createCompositionPanel({ getShow, setSize, fitToFixtures, setTitle, setBpm }) {
  const root = el('div', { className: 'fx-panel cmp-panel' });
  let taps = [];   // recent tap-tempo timestamps (ms)

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

    // --- Tempo (BPM) — drives beat-synced Timeline modulation; TAP sets by ear. ---
    if (setBpm) {
      const bpmInput = el('input', { type: 'number', value: String(getShow().composition?.bpm ?? 120), step: '1', min: '20', max: '300' });
      bpmInput.addEventListener('change', () => { const v = Number(bpmInput.value); if (Number.isFinite(v)) setBpm(v); });
      const tap = el('button', { className: 'cmp-tap', textContent: 'TAP', title: 'tap in time with the music to set the tempo' });
      tap.addEventListener('click', () => {
        const t = performance.now();
        taps = taps.filter((x) => t - x < 2000); taps.push(t);
        if (taps.length >= 2) {
          const ivs = []; for (let i = 1; i < taps.length; i++) ivs.push(taps[i] - taps[i - 1]);
          const avg = ivs.reduce((a, b) => a + b, 0) / ivs.length;
          const next = Math.round(60000 / avg);
          if (next >= 20 && next <= 300) { setBpm(next); bpmInput.value = String(next); }
        }
      });
      root.append(el('div', { className: 'fx-card cmp-grid' }, [
        el('label', { className: 'fx-field cmp-bpm' }, [el('span', { textContent: 'BPM' }), bpmInput, tap]),
      ]));
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
