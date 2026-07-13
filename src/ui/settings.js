// The ONE Settings form — audio input/gain, composition export, snap, output fps,
// preferences and appearance. Extracted from app.js so the same panel can mount in
// the main window AND in the standalone /settings/ popout window (the C2 direction:
// Library / Mapping / Settings all open as real windows).
//
// createSettingsPanel(hooks) → { build(mount) }. The panel is deliberately dumb:
// everything window-specific arrives as a hook, designed 1:1 from what the old
// buildSettings closure actually touched:
//
//   getShow()                      — the current show (main: live; popout: localStorage)
//   setShow(next, {undoable, defer}) — persist show-OWNED fields (composition.audioDevice
//                                    / composition.audioGain). `undoable` asks the owner
//                                    to snapshot for undo first (only the main window has
//                                    an undo stack); `defer` allows a debounced save
//                                    (gain slider streams input events).
//   enableAudio(deviceId)?         — (re)open the hardware input NOW. Main-window only:
//                                    it owns the capture graph; the popout omits this and
//                                    the device pick just writes the show field.
//   snap.get() → {grid, dist}      — fixture-placement snap values;
//   snap.set({grid?, dist?})         persist + apply (main also redraws its overlay).
//   output.getFps() / setFps(n)    — the daemon output-fps cap (lz.outfps).
//   output.getWhiteMode() / setWhiteMode(m) — RGBW white derivation (lz.whitemode).
//   prefs.getTips/setTips          — hover-tooltip toggle (main re-runs its title pass).
//   prefs.getNativeCtx/setNativeCtx— native right-click menu toggle (body class in main).
//   appearance.*                   — get/set pairs for brightness / tint / contrast /
//                                    translucency / scale / accent. Setters persist the
//                                    lz.* key and re-theme the CALLER's document.
//
// Purely-localStorage preferences with no per-window side effects (riff-on-reload,
// confirm-before-delete) are handled internally — both windows share the key.

import { el } from './dom.js';
import { Slider, Segmented } from './controls.js';
import { listInputs } from '../model/audio.js';
import { confirmDeletesOn, setConfirmDeletes } from './confirm.js';

// Accent swatch presets (first = near-white / monochrome). Lives here because the
// Settings panel is the only place that offers the palette.
// Curated + desaturated — a restrained set, not a full-spectrum swatch row (the
// rainbow picker was a strong "theme-generator" tell). Teal-mint (Resolume) ·
// near-white · cool slate · brick red.
export const ACCENT_PRESETS = ['#3ecfa6', '#e8eaee', '#7d8a99', '#c25a4a'];

export function createSettingsPanel(hooks) {
  const { getShow, setShow, enableAudio, snap, output, prefs, appearance } = hooks;

  // Async because the audio device list needs enumerateDevices(); re-run build()
  // whenever the panel is (re)opened so the list and any granted labels refresh.
  async function build(mount) {
    if (!mount) return;
    mount.textContent = '';

    // --- Audio input (the hardware device for the "Audio External" modulator + gain) ---
    mount.append(el('div', { className: 'fx-pts', textContent: 'audio input' }));
    const inputs = await listInputs();
    const curDev = getShow().composition?.audioDevice || 'default';
    const sel = el('select', { title: 'hardware input device for the Audio External modulator' });
    const opt = (value, label, on) => { const o = el('option', { value, textContent: label }); if (on) o.selected = true; sel.append(o); };
    opt('default', 'System default', curDev === 'default');
    inputs.filter((d) => d.deviceId && d.deviceId !== 'default').forEach((d, i) => opt(d.deviceId, d.label || `Input ${i + 1}`, curDev === d.deviceId));
    sel.addEventListener('change', async () => {
      // Main window: actually (re)open the input (the click is the user gesture).
      // Popout: no capture here — just record the pick; the main window re-opens
      // the input when it adopts the change.
      const ok = enableAudio ? await enableAudio(sel.value) : null;
      const s = getShow();
      setShow({ ...s, composition: { ...s.composition, audioDevice: sel.value } }, { undoable: true });
      if (ok === false) sel.title = 'could not open that input, check permissions';
    });
    mount.append(el('label', { className: 'fx-field' }, [el('span', { textContent: 'Input' }), sel]));
    if (!enableAudio) mount.append(el('div', { className: 'seg-hint', textContent: 'the main window opens the input (it owns audio capture)' }));
    mount.append(Slider('Gain', getShow().composition?.audioGain ?? 1, {
      min: 0, max: 8, step: 0.05, default: 1, commit: 'live',
      onInput: (v) => { const s = getShow(); setShow({ ...s, composition: { ...s.composition, audioGain: v } }, { undoable: true, defer: true }); },
    }));

    // --- Composition file (visuals only — the whole rig saves with the project, ⌘S) ---
    mount.append(el('div', { className: 'fx-pts', textContent: 'composition file' }));
    mount.append(el('button', { className: 'fx-add', textContent: 'Save composition…', title: 'export just the visuals (layers / clips / effects), without the rig', onclick: saveCompositionToFile }));
    mount.append(el('div', { className: 'seg-hint', textContent: 'to load: drag a project or composition .json onto the window' }));

    // --- Snap (fixture placement): the grid step + neighbour-align tolerance. The
    // on/off lives on the main window's viewport corner button (a quick toggle). ---
    mount.append(el('div', { className: 'fx-pts', textContent: 'snap' }));
    const sv = snap.get();
    mount.append(Slider('Grid', sv.grid, {
      min: 2, max: 100, step: 1, default: 20, commit: 'live',
      onInput: (v) => snap.set({ grid: Math.round(v) }),
    }));
    mount.append(Slider('Distance', sv.dist, {
      min: 1, max: 40, step: 1, default: 10, commit: 'live',
      onInput: (v) => snap.set({ dist: Math.round(v) }),
    }));

    // --- Output: global framerate cap sent to the daemon (caps the DDP/Art-Net rate). ---
    mount.append(el('div', { className: 'fx-pts', textContent: 'output' }));
    mount.append(Slider('Max FPS', output.getFps(), {
      min: 1, max: 60, step: 1, default: 42, commit: 'live',
      onInput: (v) => output.setFps(Math.max(1, Math.min(60, Math.round(v)))),
    }));
    // RGBW white derivation: Accurate pulls white onto the dedicated W LED
    // (subtracts it from RGB); Additive keeps RGB full and adds W on top.
    mount.append(Segmented('White Mode', [['accurate', 'Accurate'], ['additive', 'Additive']],
      () => output.getWhiteMode?.() || 'accurate', (v) => output.setWhiteMode?.(v)));
    // On-screen stage preview. OFF skips the fullscreen composite draw (the stage goes
    // static black) — LED output is unaffected. Turn it off to lighten the render on a
    // Raspberry Pi and stop VNC mirroring the full-motion stage. (Also ?preview=0 in URL.)
    mount.append(Segmented('Preview', [['on', 'On'], ['off', 'Off']],
      () => (output.getPreview?.() ?? true) ? 'on' : 'off', (v) => output.setPreview?.(v === 'on')));

    // --- Preferences as simple label + checkbox rows (the label IS the instruction). ---
    const toggleRow = (label, get, set) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = !!get();
      cb.addEventListener('change', () => set(cb.checked));
      // Checkbox FIRST so the label has the full remaining width (no truncation).
      return el('label', { className: 'fx-field set-toggle' }, [cb, el('span', { textContent: label })]);
    };
    mount.append(el('div', { className: 'fx-pts', textContent: 'preferences' }));
    const riffAlways = () => { try { return localStorage.getItem('lz.riff.always') === '1'; } catch { return false; } };
    mount.append(toggleRow('Play riff on every reload', riffAlways, (v) => { try { localStorage.setItem('lz.riff.always', v ? '1' : '0'); } catch { /* private */ } }));
    mount.append(toggleRow('Confirm before deleting', confirmDeletesOn, (v) => setConfirmDeletes(v)));
    mount.append(toggleRow('Show tooltips on hover', prefs.getTips, (v) => prefs.setTips(v)));
    mount.append(toggleRow('Toolbar labels (footer text)', prefs.getToolbarLabels, (v) => prefs.setToolbarLabels(v)));
    mount.append(toggleRow('Right-click shows the browser menu', prefs.getNativeCtx, (v) => prefs.setNativeCtx(v)));

    // --- Appearance: theme / brightness / accent tint / contrast / text size (all live). ---
    mount.append(el('div', { className: 'fx-pts', textContent: 'appearance' }));
    // Theme flips the UI CHROME light/dark; display surfaces (stage/preview/output/
    // spectrum) stay dark. Discrete choice → a select, like the audio Input above.
    mount.append(Segmented('Theme', [['dark', 'Dark'], ['light', 'Light']],
      () => appearance.getTheme(), (v) => appearance.setTheme(v)));
    mount.append(Slider('Brightness', appearance.getBrightness(), {
      min: -12, max: 20, step: 1, default: 7, commit: 'live',
      onInput: (v) => appearance.setBrightness(Math.round(v)),
    }));
    mount.append(Slider('Accent tint %', appearance.getTint(), {
      min: 0, max: 220, step: 5, default: 100, commit: 'live',
      onInput: (v) => appearance.setTint(Math.round(v)),
    }));
    mount.append(Slider('Contrast %', appearance.getContrast(), {
      min: 60, max: 130, step: 2, default: 100, commit: 'live',
      onInput: (v) => appearance.setContrast(Math.round(v)),
    }));
    mount.append(Slider('Translucency %', appearance.getTranslucency(), {
      min: 0, max: 90, step: 2, default: 38, commit: 'live',
      onInput: (v) => appearance.setTranslucency(v),
    }));
    mount.append(Slider('Text size %', Math.round(appearance.getScale() * 100), {
      min: 80, max: 140, step: 5, default: 100, commit: 'live',
      onInput: (v) => appearance.setScale(v / 100),
    }));

    // --- Accent colour (least priority → last): preset swatches. ---
    mount.append(el('div', { className: 'fx-pts', textContent: 'accent colour' }));
    const cur = appearance.getAccent();
    const swatches = [];
    const mark = (hex) => swatches.forEach((s) => s.classList.toggle('is-on', s.dataset.hex.toLowerCase() === hex.toLowerCase()));
    const row = el('div', { className: 'accent-swatches' });
    for (const p of ACCENT_PRESETS) {
      const sw = el('button', { className: 'accent-swatch', title: p });
      sw.dataset.hex = p; sw.style.background = p;
      sw.onclick = () => { appearance.setAccent(p); mark(p); };
      swatches.push(sw); row.append(sw);
    }
    mount.append(row);
    mark(cur);
  }

  // Composition file = just the visuals (canvas + layers/clips/effects), no rig.
  // Works from whatever show the hook returns — in the popout that's the
  // localStorage blob, which is exactly what "the saved composition" means there.
  function saveCompositionToFile() {
    const blob = new Blob([JSON.stringify(getShow().composition || {}, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'composition.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  return { build };
}
