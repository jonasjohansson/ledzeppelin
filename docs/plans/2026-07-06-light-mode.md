# Light Mode — Design + Plan

> Approved (fan-out). A Settings toggle switches the UI **chrome** to a light palette. **Display
> surfaces stay dark** (3D preview, output/stage canvas, composition pasteboard, spectrum) — they
> show LED/light content where dark is correct, which also avoids a big canvas-color audit.

**Goal:** Settings ▸ Appearance ▸ Theme: **Dark | Light**. Light makes panels/sidebars/menus/
inspector/text/borders/inputs light; the stage/preview/output/spectrum keep their dark backgrounds.

**Architecture:** The CSS is ~99% token-driven and `prefs.js applyAccent()`/`applyContrast()` already
derive the whole palette from anchors. Branch those on a saved theme. Pin the composition/stage
surfaces to a new dark `--stage-bg` token (constant across themes). Persist `lz.theme`, broadcast on
the existing `lz-settings` channel, sync to popout windows.

**Files:** `src/ui/prefs.js`, `src/ui/settings.js`, `src/ui/ui.css`, `src/ui/spectrum.js`,
`src/app.js`, `src/ui/sync-accent.js`.

---

## Task 1: prefs.js — theme state + light palette branch

- Add `const THEME_KEY = 'lz.theme'; const savedTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };`
  and `function setTheme(v){ try { localStorage.setItem(THEME_KEY, v === 'light' ? 'light' : 'dark'); } catch {} document.documentElement.dataset.theme = savedTheme(); applyAccent(savedAccent()); applyContrast(); }`
- On init, set `document.documentElement.dataset.theme = savedTheme();` where the other appliers run.
- **Branch `applyAccent(hex)`**: `const light = savedTheme() === 'light';`
  - Light surface ramp (anchors near-white; keep the subtle accent tint via the same `S()` but light
    anchors; brightness `lift` still applies but toward the anchors — clamp so it stays legible):
    ```js
    if (light) {
      s.setProperty('--accent-soft', accMix(hex, '#ffffff', 0.82));
      s.setProperty('--accent-line', accMix(hex, '#ffffff', 0.45));
      s.setProperty('--accent-text', accMix(hex, '#141414', 0.30));
      const S2 = (anchor, w) => accMix(hex, anchor, w * tm);   // tint light anchors, no white-lift
      s.setProperty('--bg', S2('#f4f4f6', 0.02));
      s.setProperty('--field-bg', S2('#ffffff', 0.02));
      const panelL = S2('#eaeaee', 0.03);
      s.setProperty('--panel', panelL); s.setProperty('--panel-solid', panelL);
      s.setProperty('--panel-2', S2('#e2e2e7', 0.035));
      s.setProperty('--hover', S2('#d7d7de', 0.05));
      s.setProperty('--line', S2('#cfcfd6', 0.05));
      s.setProperty('--line-2', S2('#bcbcc6', 0.06));
    } else { /* existing dark ramp unchanged */ }
    ```
    (Keep the existing dark branch verbatim; `--accent`/`accent-soft/line/text` in dark unchanged.)
- **Branch `applyContrast()`**: light → dark text anchors mixed toward white by contrast:
  ```js
  if (savedTheme() === 'light') {
    s.setProperty('--text', accMix('#141417', '#ffffff', 2 - f));
    s.setProperty('--muted', accMix('#3a3a42', '#ffffff', 2 - f));
    s.setProperty('--faint', accMix('#63636c', '#ffffff', 2 - f));
    s.setProperty('--readout', accMix('#26262c', '#ffffff', 2 - f));
  } else { /* existing light-on-dark unchanged */ }
  ```
- Export `getTheme: savedTheme, setTheme` in the appearance hooks object returned by prefs (grep how
  `getBrightness/setBrightness` are exposed and mirror it).
- Commit: `feat(ui): light-mode palette branch in prefs (applyAccent/applyContrast)`.

## Task 2: settings.js — the Theme toggle
- In the Appearance section (grep `Brightness`/`appearance.getBrightness`), add a **Theme** control:
  a two-option select or segmented toggle **Dark | Light** → `appearance.setTheme(v)`; init from
  `appearance.getTheme()`. Match the existing appearance-control style. Commit: `feat(ui): Theme (Dark|Light) toggle in Settings`.

## Task 3: ui.css — keep display surfaces dark
- Add a constant dark token in `:root`: `--stage-bg:#0d0d0f;` (NOT theme-flipped).
- Point the composition/stage display surfaces at it instead of `var(--bg)` so they stay dark in
  light mode: the **pasteboard** (line ~314 `background-color: var(--bg)`) → `var(--stage-bg)`; the
  stage-island body / any full-bleed canvas backdrop that currently uses `--bg` for the PREVIEW area.
  Leave the output canvas (`background:#000`, ~line 330) and the checker pattern as-is. Do NOT change
  the html/body `--bg` (that SHOULD flip — it's the chrome). Grep every `var(--bg)` in ui.css and, for
  each, decide chrome (flip) vs display (→ `--stage-bg`); the safe set to pin dark: pasteboard/stage
  preview backdrop only. Commit: `feat(ui): --stage-bg keeps the preview/pasteboard dark in light mode`.

## Task 4: spectrum.js — readable on a light panel
- In `createClipSpectrum`'s `frame()`, draw a dark inner background rect FIRST (before bars), e.g.
  `ctx.fillStyle = 'rgba(12,12,14,0.9)'; ctx.fillRect(0,0,W,H);` so the white/cyan bars stay visible
  whatever the panel color. (Keep the existing bar/region/threshold drawing.) Commit: `feat(ui): spectrum draws its own dark scope background (light-mode legible)`.

## Task 5: multi-window sync
- `src/app.js`: the theme change already broadcasts via Settings' `setShow`/settings-changed path —
  confirm the `lz-settings` bus handler (grep `settings-changed`) re-runs `prefs.applyAccent` +
  `prefs.applyContrast`; ALSO set `document.documentElement.dataset.theme = prefs.getTheme()` there.
- `src/ui/sync-accent.js`: it syncs accent across popout windows on the `storage` event for `lz.accent`.
  Extend it to ALSO react to `lz.theme` (set `dataset.theme` + re-apply) so popouts (Inventory/Mappings/
  Settings) theme too. Commit: `feat(ui): sync light mode across popout windows`.

## Task 6: verify + release
- `node --check` the JS files; `npm test` green (no logic tests affected).
- **Manual smoke (REQUIRES the user's eyes — I can't see it):** toggle Settings ▸ Theme ▸ Light;
  confirm chrome goes light + legible (text contrast, hairlines, inputs, menus, the source browser,
  hover/accent), the stage/3D-preview/output stay dark, the spectrum stays readable, popouts follow.
  Toggle back to Dark → identical to before.
- Cut a signed/notarized release. **Flag for visual review** — expect a round of color tweaks.

## Out of scope (YAGNI)
Auto `prefs-color-scheme`, theming the 3D preview/output to light, per-window independent themes,
converting decorative dark shadows to vars.
