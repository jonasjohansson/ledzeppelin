// View & appearance preferences — the localStorage-persisted UI prefs that were
// wired inline in app.js: controller tint, fixture outlines, the native
// right-click toggle, hover tooltips, and the accent/appearance CSS-var
// appliers. Extracted verbatim (no behavior change) behind the same hooks
// pattern as createSettingsPanel: everything window-specific arrives explicitly.
//
//   initPrefs({ preview, redrawOverlay }) → {
//     applyAccent, savedAccent, applyContrast,
//     setUiScale, savedScale, setTranslucency, savedTranslucency,
//     applyTips, setNativeCtxMenu,
//   }
//
// The returned appliers are what the lz-settings BroadcastChannel handler in
// app.js re-runs when the Settings popout writes new keys. Snap + grid toggles
// deliberately did NOT move: their state (snapEnabled/SNAP_GRID/SNAP_DIST/
// showGrid) is read per-frame by the overlay redraw and mutated by drag
// machinery + the settings bus — it lives with that code in app.js.

import { themeVars, applyVars } from './palette.js';

export function initPrefs({ preview, redrawOverlay }) {
  // Controller-colour tint for the fixture CHROME on the preview canvas. (The Output
  // list's controller dots/swatches always show gdev.color regardless of this toggle,
  // so only the preview redraws.) Toggled from the corner "▢ color" button; persisted.
  // Default ON.
  let controllerTint = (() => { try { return localStorage.getItem('lz.tint') !== '0'; } catch { return true; } })();
  const colorBtn = document.getElementById('color-btn');
  function setControllerTint(on) {
    controllerTint = !!on;
    try { localStorage.setItem('lz.tint', controllerTint ? '1' : '0'); } catch { /* ignore */ }
    if (colorBtn) colorBtn.classList.toggle('on', controllerTint);
    preview?.setColorTint?.(controllerTint);
    redrawOverlay();   // tint only affects the preview chrome, not the Output list
  }
  colorBtn?.addEventListener('click', () => setControllerTint(!controllerTint));
  // Initial sync (preview pushes the persisted tint into its chrome).
  if (colorBtn) colorBtn.classList.toggle('on', controllerTint);
  preview?.setColorTint?.(controllerTint);

  // OUTLINES: fixture outline strokes on the stage (2D footprints AND the 3D strip
  // curves). Off = light-only — just the lit cells/dots at full strength; the
  // selected fixture keeps its chrome so it stays editable. Persisted view pref.
  // (Reads the retired lz.wires3d key as a fallback — it shipped briefly as a
  // 3D-only "Wires" chip before becoming this top-bar toggle.)
  let fixtureOutlines = (() => {
    try { return (localStorage.getItem('lz.outlines') ?? localStorage.getItem('lz.wires3d')) !== '0'; }
    catch { return true; }
  })();
  const outlineBtn = document.getElementById('outline-btn');
  // Tint only colours the fixture outline strokes — with outlines hidden the
  // button toggles nothing visible, so it's disabled while outlines are off
  // (same pattern as EDIT disabled in 3D: disabled + a title that says why).
  // The persisted lz.tint value is untouched — the preference just sits inert.
  function syncTintEnabled() {
    if (!colorBtn) return;
    colorBtn.disabled = !fixtureOutlines;
    colorBtn.title = fixtureOutlines ? 'tint fixtures by controller colour'
      : 'tint needs outlines on — it colours the fixture outline strokes';
  }
  function setFixtureOutlines(on) {
    fixtureOutlines = !!on;
    try { localStorage.setItem('lz.outlines', fixtureOutlines ? '1' : '0'); } catch { /* ignore */ }
    if (outlineBtn) outlineBtn.classList.toggle('on', fixtureOutlines);
    preview?.setOutlines?.(fixtureOutlines);
    syncTintEnabled();
    redrawOverlay();
  }
  outlineBtn?.addEventListener('click', () => setFixtureOutlines(!fixtureOutlines));
  if (outlineBtn) outlineBtn.classList.toggle('on', fixtureOutlines);
  preview?.setOutlines?.(fixtureOutlines);
  syncTintEnabled();   // persisted outlines=off → Tint boots disabled

  // This is an app surface, not a document — by default suppress the OS right-click menu
  // everywhere EXCEPT editable text fields (where copy/paste is wanted), and sliders keep
  // their right-click-to-reset. A Settings toggle ("native right-click") disables all of
  // that so a normal browser context menu is available — modules read body.native-ctx.
  let nativeCtxMenu = (() => { try { return localStorage.getItem('lz.ctxmenu') !== '0'; } catch { return true; } })();
  const nativeCtxOn = () => nativeCtxMenu;
  const setNativeCtxMenu = (on) => {
    nativeCtxMenu = !!on;
    document.body.classList.toggle('native-ctx', nativeCtxMenu);
    try { localStorage.setItem('lz.ctxmenu', nativeCtxMenu ? '1' : '0'); } catch { /* private */ }
  };
  setNativeCtxMenu(nativeCtxMenu);   // reflect on boot
  document.addEventListener('contextmenu', (e) => {
    if (nativeCtxMenu) return;   // user opted into the browser's native menu everywhere
    if (e.target.closest?.('input:not([type=range]), textarea, [contenteditable]')) return;
    e.preventDefault();
  });

  // --- Toolbar (footer) labels: OFF by default (icons only); Settings toggles them.
  const getToolbarLabels = () => { try { return localStorage.getItem('lz.tbl') === '1'; } catch { return false; } };
  const applyToolbarLabels = () => document.body.classList.toggle('hide-toolbar-labels', !getToolbarLabels());
  const setToolbarLabels = (on) => { try { localStorage.setItem('lz.tbl', on ? '1' : '0'); } catch { /* private */ } applyToolbarLabels(); };
  applyToolbarLabels();   // reflect on boot (default: hidden)

  // --- Accent colour (user-selectable; persisted; live via CSS vars) -----------
  const ACCENT_KEY = 'lz.accent';
  const ACCENT_DEFAULT = '#3ecfa6';   // Resolume teal-mint (the one accent)
  const accHexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [232, 163, 92]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const accToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const accMix = (a, b, w) => { const A = accHexToRgb(a), B = accHexToRgb(b); return accToHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };
  // --- Theme (chrome palette: 'dark' default, or 'light'). Persisted in lz.theme;
  // branches the accent/contrast appliers below so the CHROME goes light while the
  // display surfaces (stage/preview/output/spectrum) stay dark (see ui.css --stage-bg).
  const THEME_KEY = 'lz.theme';
  const savedTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
  function setTheme(v) {
    try { localStorage.setItem(THEME_KEY, v === 'light' ? 'light' : 'dark'); } catch { /* private */ }
    document.documentElement.dataset.theme = savedTheme();
    applyAccent(savedAccent());
    applyContrast();
  }
  // --accent cascades (green/amber/cyan + every color-mix(--accent …) follow); the
  // soft/line/text variants AND the warm surface ramp are derived from it here, so
  // changing the accent re-tints the whole sidebar (its gray surfaces carry a small
  // % of the accent → a desaturated tint that follows whatever accent you pick).
  // The chrome palette is derived in ONE place now (src/ui/palette.js): light is the
  // dark ramp luminance-inverted, so Brightness/Tint/Contrast track BOTH themes.
  function applyAccent(hex) {
    const accent = /^#?[0-9a-f]{6}$/i.test(hex || '') ? hex : savedAccent();
    applyVars(themeVars({ accent, theme: savedTheme(), brightness: savedBright(), tint: savedTint(), contrast: savedContrast() }));
    preview?.setAccentColor?.(accent);   // fixture chrome on the canvas follows the accent
  }
  const savedAccent = () => { try { return localStorage.getItem(ACCENT_KEY) || ACCENT_DEFAULT; } catch { return ACCENT_DEFAULT; } };

  // --- Appearance (Settings › Appearance): UI brightness (surface lift, can go negative
  // = darker than base), accent tint, text contrast, text size. Persisted; live. ---
  const num = (key, def, lo, hi) => { try { const raw = localStorage.getItem(key); const v = Number(raw); return (raw != null && Number.isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : def; } catch { return def; } };
  const BRIGHT_KEY = 'lz.brightness';
  const savedBright = () => num(BRIGHT_KEY, 0, -12, 20);
  const TINT_KEY = 'lz.tint.amt';
  const savedTint = () => num(TINT_KEY, 100, 0, 220);
  const CONTRAST_KEY = 'lz.contrast';
  const savedContrast = () => num(CONTRAST_KEY, 130, 60, 130);
  // Text contrast is part of the derived palette now (palette.js) — re-derive the whole
  // chrome so the text vars update in step with the current theme/brightness/tint.
  function applyContrast() { applyAccent(savedAccent()); }
  const SCALE_KEY = 'lz.uiscale';
  const savedScale = () => num(SCALE_KEY, 1, 0.8, 1.4);
  function setUiScale(v) { const c = Math.max(0.8, Math.min(1.4, v)); document.documentElement.style.setProperty('--ui-scale', String(c)); try { localStorage.setItem(SCALE_KEY, String(c)); } catch { /* private */ } }
  // Translucency of the floating panels (device editor + timeline): 0 = opaque … higher =
  // more see-through. Drives --pop-opacity = (100 − translucency)%.
  const TRANSLU_KEY = 'lz.translucency';
  const savedTranslucency = () => num(TRANSLU_KEY, 0, 0, 90);
  function setTranslucency(v) { const c = Math.max(0, Math.min(90, Math.round(v))); document.documentElement.style.setProperty('--pop-opacity', (100 - c) + '%'); try { localStorage.setItem(TRANSLU_KEY, String(c)); } catch { /* private */ } }
  document.documentElement.dataset.theme = savedTheme();   // mark the chrome theme on boot
  setUiScale(savedScale());        // apply text scale on boot
  setTranslucency(savedTranslucency());   // apply panel translucency on boot
  applyContrast();                // apply text contrast on boot

  applyAccent(savedAccent());   // apply the saved accent (+ brightness + tint) on boot

  // --- Hover tooltips (native `title`) — ON by default (the icon-heavy chrome needs
  // them for discoverability). When toggled OFF in Settings, every `title` is moved to
  // `data-tip` (kept moved as the UI re-renders) so no tooltip appears on hover. Either
  // way titles read as sentence case. ---
  const TIPS_KEY = 'lz.tips';
  const tipsOn = () => { try { return localStorage.getItem(TIPS_KEY) !== '0'; } catch { return true; } };
  // Stash the title (so no native tooltip shows) BUT keep it as an aria-label so
  // icon-ONLY interactive controls still have an accessible name (a11y) when tooltips
  // are off. Only icon-only interactive elements get the label — adding aria-label to
  // plain spans (prohibited) or to controls that already show their text (name
  // mismatch) fails Lighthouse, so we skip those.
  // Tooltips read as normal sentence case (capitalise the first letter; acronyms like
  // MIDI/OSC are already upper-case mid-string and are left alone).
  const sentenceCase = (s) => (s && /^[a-z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const stashTip = (el) => {
    const t = sentenceCase(el.getAttribute('title'));
    if (t == null) return;
    el.dataset.tip = t;
    const interactive = el.matches('button, a[href], input, select, textarea, [role], [tabindex]');
    const iconOnly = !el.textContent.trim();
    if (interactive && iconOnly && !el.getAttribute('aria-label')) el.setAttribute('aria-label', t);
    el.removeAttribute('title');
  };
  const stripTips = (root) => { if (root.nodeType !== 1) return; if (root.hasAttribute('title')) stashTip(root); root.querySelectorAll?.('[title]').forEach(stashTip); };
  const restoreTips = (root) => root.querySelectorAll?.('[data-tip]').forEach((el) => { el.setAttribute('title', el.dataset.tip); delete el.dataset.tip; });
  // Tips ON: keep native titles but sentence-case them (idempotent — only writes on change).
  const normTitle = (el) => { const t = el.getAttribute('title'); const n = sentenceCase(t); if (n && n !== t) el.setAttribute('title', n); };
  const normalizeTitles = (root) => { if (root.nodeType !== 1) return; if (root.hasAttribute('title')) normTitle(root); root.querySelectorAll?.('[title]').forEach(normTitle); };
  const tipObserver = new MutationObserver((muts) => {
    const on = tipsOn();
    for (const m of muts) {
      if (m.type === 'attributes' && m.target.nodeType === 1 && m.target.hasAttribute('title')) { on ? normTitle(m.target) : stashTip(m.target); }
      for (const n of m.addedNodes) { on ? normalizeTitles(n) : stripTips(n); }
    }
  });
  function applyTips() {
    if (tipsOn()) { restoreTips(document.body); normalizeTitles(document.body); }
    else { stripTips(document.body); }
    // One observer, mode-aware: normalises (on) or stashes (off) titles as the UI rebuilds.
    tipObserver.disconnect();
    tipObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  }
  applyTips();   // on boot

  return {
    applyAccent, savedAccent, applyContrast,
    getTheme: savedTheme, setTheme,
    setUiScale, savedScale, setTranslucency, savedTranslucency,
    applyTips, setNativeCtxMenu,
    getToolbarLabels, setToolbarLabels, applyToolbarLabels,
  };
}
