// Settings window — the standalone preferences editor, opened from the main
// window's gear (C2: Library / Mapping / Settings are all real popup windows).
// It mounts the SAME form the main window used (createSettingsPanel) with
// POPOUT hooks:
//
//   · show-owned fields (composition.audioDevice / audioGain) — loadShow() on
//     open, every edit saveShow()s + broadcasts { type: 'settings-changed' } on
//     BroadcastChannel('lz-settings'); the main window merges ONLY those fields
//     into its live show (its blob-side layers/fixtures here are stale copies).
//   · This window CANNOT open the audio input — the main window owns capture
//     (getUserMedia + the analyser graph live there). No enableAudio hook is
//     passed, so the panel notes it and a device pick just records the field;
//     the main window re-opens the input when it adopts the change.
//   · Preference / appearance keys (lz.snap, lz.outfps, lz.tips, lz.ctxmenu,
//     lz.brightness, …) are written here directly (same keys as the main
//     window), applied to THIS document's CSS vars, and broadcast so the main
//     window re-applies its side (theme vars, tooltip pass, snap vars, fps cap).
//   · Save composition… works from the persisted show — exactly "the saved
//     composition" from this window's point of view.
//
// Sliders broadcast through a short trailing debounce (they stream input
// events); discrete controls (select, checkboxes, swatches) post immediately.

import { createSettingsPanel } from '../src/ui/settings.js';
import { themeVars, applyVars } from '../src/ui/palette.js';
import { loadShow, saveShow } from '../src/ui/fixtures.js';
import { emptyShow, syncDeviceTypes, syncFixtureTypes } from '../src/model/show.js';

const mount = document.getElementById('set-body');

// The show this window edits (in-memory current; storage may briefly lag while a
// deferred gain save is pending). Seed a fresh show if none is persisted yet, the
// same way the Library popout does, so the page works standalone.
let show = loadShow() || syncDeviceTypes(syncFixtureTypes(emptyShow()));

// BroadcastChannel — outbound only ('settings-changed'). A BroadcastChannel never
// delivers a message back to the posting context, so this can't loop; and this
// page re-reads nothing live, so there's no inbound handler to keep.
const bus = new BroadcastChannel('lz-settings');
const post = () => { try { bus.postMessage({ type: 'settings-changed' }); } catch { /* closed */ } };
let postT = null;
const postSoon = () => { clearTimeout(postT); postT = setTimeout(() => { postT = null; post(); }, 120); };

// --- localStorage helpers (SAME keys + defaults as the main window) -----------
const num = (key, def, lo, hi) => { try { const raw = localStorage.getItem(key); const v = Number(raw); return (raw != null && Number.isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : def; } catch { return def; } };
const put = (key, v) => { try { localStorage.setItem(key, String(v)); } catch { /* private */ } };
const flag = (key) => { try { return localStorage.getItem(key) !== '0'; } catch { return true; } };

// --- Appearance appliers for THIS document. The main window keeps its own copy
// of this math (app.js applyAccent/applyContrast — it also feeds the canvas
// chrome); duplicating the small mix here follows the sync-accent.js precedent
// so the popout has no import into app.js. -------------------------------------
const h2 = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(x || ''); if (!m) return [232, 163, 92]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, w) => { const A = h2(a), B = h2(b); return toHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };
const savedAccent = () => { try { return localStorage.getItem('lz.accent') || '#3ecfa6'; } catch { return '#3ecfa6'; } };
const savedTheme = () => { try { return localStorage.getItem('lz.theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
const savedBright = () => num('lz.brightness', 0, -12, 20);
const savedTint = () => num('lz.tint.amt', 100, 0, 220);
const savedContrast = () => num('lz.contrast', 130, 60, 130);
const savedScale = () => num('lz.uiscale', 1, 0.8, 1.4);
const savedTranslucency = () => num('lz.translucency', 0, 0, 90);
function applyTheme() {
  const s = document.documentElement.style;
  const hex = savedAccent();
  const light = savedTheme() === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  // Whole chrome palette from the ONE shared deriver (light = dark luminance-inverted).
  applyVars(themeVars({ accent: hex, theme: light ? 'light' : 'dark', brightness: savedBright(), tint: savedTint(), contrast: savedContrast() }), s);
  // Text size + floating-panel translucency.
  s.setProperty('--ui-scale', String(savedScale()));
  s.setProperty('--pop-opacity', (100 - savedTranslucency()) + '%');
}
applyTheme();
// Advanced mode: reflect it on THIS document's body so the panel's own .adv-only rows
// (Snap, Output, niche prefs) reveal in step with the main window.
function applyAdvanced() { try { document.body.classList.toggle('advanced', localStorage.getItem('lz.advanced') === '1'); } catch { /* private */ } }
applyAdvanced();
// `storage` fires here when ANOTHER window writes an lz.* key — keep theme + advanced live.
addEventListener('storage', (e) => { if ((e.key || '').startsWith('lz.')) { applyTheme(); applyAdvanced(); } });

// --- Snap (lz.snap carries {on, grid, dist}; the on/off is the main window's
// corner button — preserve it, edit only grid/dist here). ----------------------
const readSnap = () => { try { return JSON.parse(localStorage.getItem('lz.snap') || 'null') || {}; } catch { return {}; } };

// Show-field saves: in-memory `show` is always current; a deferred (gain-drag)
// save coalesces the stream of input events into one write + broadcast.
let saveT = null;
function persist(next, { defer = false } = {}) {
  show = next;
  clearTimeout(saveT); saveT = null;
  if (defer) saveT = setTimeout(() => { saveT = null; saveShow(show); post(); }, 150);
  else { saveShow(show); post(); }
}

const panel = createSettingsPanel({
  getShow: () => show,
  setShow: (next, { defer } = {}) => persist(next, { defer }),
  // no enableAudio — the panel shows its "main window owns audio capture" note.
  snap: {
    get: () => ({ grid: Number(readSnap().grid) || 20, dist: Number(readSnap().dist) || 10 }),
    set: ({ grid, dist } = {}) => {
      const s = readSnap();
      const next = { on: !!s.on, grid: grid ?? (Number(s.grid) || 20), dist: dist ?? (Number(s.dist) || 10) };
      try { localStorage.setItem('lz.snap', JSON.stringify(next)); } catch { /* private */ }
      postSoon();
    },
  },
  output: {
    getFps: () => num('lz.outfps', 42, 1, 60),
    setFps: (n) => { put('lz.outfps', n); postSoon(); },
    getWhiteMode: () => { try { return localStorage.getItem('lz.whitemode') === 'additive' ? 'additive' : 'accurate'; } catch { return 'accurate'; } },
    setWhiteMode: (m) => { put('lz.whitemode', m === 'additive' ? 'additive' : 'accurate'); postSoon(); },
    getPreview: () => flag('lz.preview'),
    setPreview: (on) => { put('lz.preview', on ? '1' : '0'); post(); },
  },
  prefs: {
    getTips: () => flag('lz.tips'),
    setTips: (on) => { put('lz.tips', on ? '1' : '0'); post(); },
    getToolbarLabels: () => { try { return localStorage.getItem('lz.tbl') === '1'; } catch { return false; } },
    setToolbarLabels: (on) => { put('lz.tbl', on ? '1' : '0'); post(); },
    getNativeCtx: () => flag('lz.ctxmenu'),
    setNativeCtx: (on) => { put('lz.ctxmenu', on ? '1' : '0'); post(); },
    getAdvanced: () => { try { return localStorage.getItem('lz.advanced') === '1'; } catch { return false; } },
    setAdvanced: (on) => { put('lz.advanced', on ? '1' : '0'); applyAdvanced(); post(); },
  },
  appearance: {
    getTheme: savedTheme, setTheme: (v) => { put('lz.theme', v === 'light' ? 'light' : 'dark'); applyTheme(); post(); },
    getBrightness: savedBright, setBrightness: (v) => { put('lz.brightness', v); applyTheme(); postSoon(); },
    getTint: savedTint, setTint: (v) => { put('lz.tint.amt', v); applyTheme(); postSoon(); },
    getContrast: savedContrast, setContrast: (v) => { put('lz.contrast', v); applyTheme(); postSoon(); },
    getTranslucency: savedTranslucency, setTranslucency: (v) => { put('lz.translucency', Math.max(0, Math.min(90, Math.round(v)))); applyTheme(); postSoon(); },
    getScale: savedScale, setScale: (v) => { put('lz.uiscale', Math.max(0.8, Math.min(1.4, v))); applyTheme(); postSoon(); },
    getAccent: savedAccent, setAccent: (hex) => { put('lz.accent', hex); applyTheme(); post(); },
  },
});

panel.build(mount);
