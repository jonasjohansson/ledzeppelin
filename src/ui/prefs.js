// View & appearance preferences — the localStorage-persisted UI prefs that were
// wired inline in app.js: controller tint, fixture outlines, the native
// right-click toggle, hover tooltips, and the accent/appearance CSS-var
// appliers. Extracted verbatim (no behavior change) behind the same hooks
// pattern as createSettingsPanel: everything window-specific arrives explicitly.
//
//   initPrefs({ preview, renderOutput, redrawOverlay }) → {
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

export function initPrefs({ preview, renderOutput, redrawOverlay }) {
  // Controller-colour tint for the UI (preview chrome + placement-list swatches).
  // Toggled from the corner "▢ color" button; persisted. Default ON.
  let controllerTint = (() => { try { return localStorage.getItem('lz.tint') !== '0'; } catch { return true; } })();
  const colorBtn = document.getElementById('color-btn');
  function setControllerTint(on) {
    controllerTint = !!on;
    try { localStorage.setItem('lz.tint', controllerTint ? '1' : '0'); } catch { /* ignore */ }
    if (colorBtn) colorBtn.classList.toggle('on', controllerTint);
    preview?.setColorTint?.(controllerTint);
    renderOutput(); redrawOverlay();
  }
  colorBtn?.addEventListener('click', () => setControllerTint(!controllerTint));
  // Initial sync (preview exists; the startup renderOutput reads controllerTint).
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

  // --- Accent colour (user-selectable; persisted; live via CSS vars) -----------
  const ACCENT_KEY = 'lz.accent';
  const ACCENT_DEFAULT = '#e8a35c';
  const accHexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [232, 163, 92]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const accToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const accMix = (a, b, w) => { const A = accHexToRgb(a), B = accHexToRgb(b); return accToHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };
  // --accent cascades (green/amber/cyan + every color-mix(--accent …) follow); the
  // soft/line/text variants AND the warm surface ramp are derived from it here, so
  // changing the accent re-tints the whole sidebar (its gray surfaces carry a small
  // % of the accent → a desaturated tint that follows whatever accent you pick).
  function applyAccent(hex) {
    const s = document.documentElement.style;
    s.setProperty('--accent', hex);
    s.setProperty('--accent-soft', accMix(hex, '#0a0a0a', 0.16));
    s.setProperty('--accent-line', accMix(hex, '#0a0a0a', 0.40));
    s.setProperty('--accent-text', accMix(hex, '#ffffff', 0.62));
    // Surface ramp = a neutral dark gray with a SUBTLE touch of the accent. Each gray
    // anchor is first lifted toward white by `lift` (the Settings › Appearance
    // brightness, 0 = base near-black … ~0.2 = noticeably brighter).
    const lift = savedBright() / 100;     // negative = darker than the base anchors
    const tm = savedTint() / 100;         // accent-tint multiplier (Settings › Appearance)
    const L = (anchor) => accMix('#ffffff', anchor, lift);          // lift the gray anchor
    const S = (anchor, w) => accMix(hex, L(anchor), w * tm);        // + tint it by the accent
    s.setProperty('--bg', S('#0b0b0d', 0.03));
    s.setProperty('--field-bg', S('#121214', 0.03));
    const panel = S('#17171a', 0.04);
    s.setProperty('--panel', panel);
    s.setProperty('--panel-solid', panel);
    s.setProperty('--panel-2', S('#1e1e22', 0.05));
    s.setProperty('--hover', S('#2c2c31', 0.06));
    s.setProperty('--line', S('#303034', 0.06));
    s.setProperty('--line-2', S('#45454e', 0.07));
    preview?.setAccentColor?.(hex);   // fixture chrome on the canvas follows the accent
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
  function applyContrast() {
    const f = savedContrast() / 100;   // 1 = base; <1 dims text toward bg; >1 brightens
    const s = document.documentElement.style;
    s.setProperty('--text', accMix('#f4f5f7', '#0c0c10', f));
    s.setProperty('--muted', accMix('#a3aab4', '#0c0c10', f));
    s.setProperty('--faint', accMix('#737a84', '#0c0c10', f));
    s.setProperty('--readout', accMix('#d7dbe0', '#0c0c10', f));
  }
  const SCALE_KEY = 'lz.uiscale';
  const savedScale = () => num(SCALE_KEY, 1, 0.8, 1.4);
  function setUiScale(v) { const c = Math.max(0.8, Math.min(1.4, v)); document.documentElement.style.setProperty('--ui-scale', String(c)); try { localStorage.setItem(SCALE_KEY, String(c)); } catch { /* private */ } }
  // Translucency of the floating panels (device editor + timeline): 0 = opaque … higher =
  // more see-through. Drives --pop-opacity = (100 − translucency)%.
  const TRANSLU_KEY = 'lz.translucency';
  const savedTranslucency = () => num(TRANSLU_KEY, 0, 0, 90);
  function setTranslucency(v) { const c = Math.max(0, Math.min(90, Math.round(v))); document.documentElement.style.setProperty('--pop-opacity', (100 - c) + '%'); try { localStorage.setItem(TRANSLU_KEY, String(c)); } catch { /* private */ } }
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
    setUiScale, savedScale, setTranslucency, savedTranslucency,
    applyTips, setNativeCtxMenu,
  };
}
