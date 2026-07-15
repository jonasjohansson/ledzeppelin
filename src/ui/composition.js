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
// Two free fields (width/height) that commit via setSize on blur/Enter (no Apply button).

import { clampCanvasSize } from '../model/layers.js';
import { el, field } from './dom.js';
import { Slider } from './controls.js';

// createCompositionPanel({ getShow, setSize })
//   Canvas resolution only. Composition-global preferences (crossfade, audio
//   gain, theme, file I/O) moved to the global Settings panel; master opacity
//   moved to the Composition group head + its inspector.
export function createCompositionPanel({ getShow, setSize, fitToFixtures, setTitle, setBpm, setMasterOpacity }) {
  const root = el('div', { className: 'fx-panel cmp-panel' });
  let taps = [];   // recent tap-tempo timestamps (ms)

  // Working draft of the fields (not yet applied). Seeded from the show.
  function currentCanvas() {
    const c = getShow().composition?.canvas || {};
    return clampCanvasSize(c.w ?? 1280, c.h ?? 720);
  }
  let draft = currentCanvas();

  function render() {
    // Preserve focus + caret across the rebuild — arrow-stepping a number field fires
    // 'change' → setSize → refresh, which would otherwise drop the field's focus.
    const ae = document.activeElement;
    let focusKey = null, selStart = null, selEnd = null;
    if (ae && ae.tagName === 'INPUT' && root.contains(ae)) {
      focusKey = ae.closest('.fx-field')?.querySelector('span')?.textContent || null;
      try { selStart = ae.selectionStart; selEnd = ae.selectionEnd; } catch { /* number inputs */ }
    }
    root.textContent = '';
    draft = currentCanvas();

    // Title · BPM · Width · Height are collected into ONE card so all four rows are
    // evenly spaced. (Splitting them across cards puts a full card-gap between BPM and
    // Width while the other pairs stay tight, which reads as uneven.)
    const idRows = [];

    // --- Title — names the composition; saved with it (commits on blur/enter). ---
    if (setTitle) {
      const title = el('input', { type: 'text', placeholder: 'untitled', value: getShow().composition?.title || '' });
      title.addEventListener('change', () => setTitle(title.value.trim()));
      idRows.push(field('Title', title));
    }

    // --- Tempo (BPM) — drives beat-synced Timeline modulation; TAP sets by ear. ---
    if (setBpm) {
      const bpmInput = el('input', { type: 'number', value: String(getShow().composition?.bpm ?? 120), step: '1', min: '20', max: '300' });
      const tap = el('button', { className: 'cmp-tap pulsing', textContent: 'TAP', title: 'tap in time with the music to set the tempo' });
      // The TAP button flashes once per beat: animation-duration = one beat.
      const beatMs = () => 60000 / Math.max(1, Number(bpmInput.value) || getShow().composition?.bpm || 120);
      const syncPulse = () => tap.style.setProperty('--beat', beatMs() + 'ms');
      // Restart the pulse animation so its on-beat flash re-phases (used on each
      // tap to align the flash to the taps, and as the click reaction).
      const rephase = () => { syncPulse(); tap.classList.remove('pulsing'); void tap.offsetWidth; tap.classList.add('pulsing'); };
      syncPulse();
      bpmInput.addEventListener('change', () => { const v = Number(bpmInput.value); if (Number.isFinite(v)) { setBpm(v); rephase(); } });
      tap.addEventListener('click', () => {
        const t = performance.now();
        taps = taps.filter((x) => t - x < 2000); taps.push(t);
        if (taps.length >= 2) {
          const ivs = []; for (let i = 1; i < taps.length; i++) ivs.push(taps[i] - taps[i - 1]);
          const avg = ivs.reduce((a, b) => a + b, 0) / ivs.length;
          const next = Math.round(60000 / avg);
          if (next >= 20 && next <= 300) { setBpm(next); bpmInput.value = String(next); }
        }
        rephase();   // flash now + re-align the beat pulse to this tap
      });
      idRows.push(el('label', { className: 'fx-field cmp-bpm' }, [el('span', { textContent: 'BPM' }), bpmInput, tap]));
    }
    // --- Width / height apply on COMMIT (blur or Enter) — no Apply button. A live
    // 'input' resize would rebuild the compositor on every keystroke, so we commit on
    // 'change' (which also covers the spinner steps; focus is restored below). ---
    const sizeInput = (dim) => {
      const i = el('input', { type: 'number', value: String(draft[dim]), step: '1', min: '16', max: '4096' });
      i.addEventListener('change', () => {
        const v = Number(i.value);
        const next = Number.isFinite(v) ? { ...draft, [dim]: v } : draft;   // invalid → keep current
        const c = clampCanvasSize(next.w, next.h);
        setSize(c.w, c.h);
        render();
      });
      return i;
    };
    idRows.push(field('Width', sizeInput('w')), field('Height', sizeInput('h')));

    if (idRows.length) root.append(el('div', { className: 'fx-card cmp-grid' }, idRows));
    // (Fit-to-fixtures stays removed; crossfade is a PER-LAYER setting in the Layer inspector.)
    // Master opacity — the composition-wide dimmer (mirrors the deck's master fader).
    if (setMasterOpacity) {
      root.append(Slider('Master', Math.round((getShow().composition?.opacity ?? 1) * 100), {
        min: 0, max: 100, step: 1, default: 100, commit: 'live',
        onInput: (v) => setMasterOpacity(v / 100),
      }));
    }

    // Restore focus to the same field (keeps arrow-stepping / typing alive across rebuilds).
    if (focusKey) {
      const inp = [...root.querySelectorAll('.fx-field')].find((f) => f.querySelector('span')?.textContent === focusKey)?.querySelector('input');
      if (inp) { inp.focus(); try { if (selStart != null) inp.setSelectionRange(selStart, selEnd); } catch { /* number inputs */ } }
    }
  }

  render();
  return { el: root, refresh: render };
}
