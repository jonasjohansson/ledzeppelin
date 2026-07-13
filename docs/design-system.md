# LED Zeppelin — Design System

The one reference for keeping the UI consistent. Synthesized from a 4-lens audit
(spacing, typography, color, components). **Identity:** Resolume profile — neutral
medium-dark gray chrome, monospace, hairline dividers, square corners, ONE
teal-mint accent (`#3ecfa6`), Resolume-dense. `src/ui/palette.js` + `src/ui/ui.css
:root` are the token source.

## Tokens — never write a raw value that a token covers

**Spacing** (dense 2px ramp, monotonic): `--s1:2 --s2:4 --s3:6 --s4:8 --s5:10 --s6:12 --s7:14 --s8:16`. Off-ramp values (3/5/7/9/11/13/17/18/19) are strays — snap to the nearest step. If a value repeats 3+ times, promote it to a token.

**Dimensions:** `--row-h` (one row height) · `--ctrl-h` (one control height inside a row) · `--col-gutter:14` (inspector label/cog gutter) · `--col-label:84` · `--col-val:44` · `--dock-gap:4` · `--topbar-h:42`. Sidebar widths: `--left-w`/`--side-w`/`--side2-w` (no new 2xx/3xx magic widths). **`var(--tok, fallback)` fallbacks must equal the token's real value.**

**Corners:** `--radius:0` / `--radius-sm:0` — square everywhere. `border-radius:50%` allowed ONLY for round dots/swatches ≤10px. No 1/2/3px rounded rectangles.

**Borders:** 1px hairlines from `--line` / `--line-2`. No 2px+ except intentional accent handles.

## Typography

Scale (× `--ui-scale`): `--fs-micro:10` (eyebrows/captions/badges) · `--fs-body:11` (body/menus) · `--fs-ctrl:12` (values, tabs, param labels) · `--fs-title:13` (panel titles) · `--fs-glyph:15` (icon glyphs). Weights: `--fw-reg:400`, `--fw-med:600` (the ONE emphasis — headers, active, modified). Tracking: `--ls-caps:.06em` (UPPERCASE only), `--ls-ui:.04em` (mixed-case chrome), `0` on numeric data. No raw `font-size`/`letter-spacing`.

**Casing (one rule):** UPPERCASE = section-header eyebrows, nav (tabs), app buttons. Title Case = all content labels (`prettyParam`/`labelOf` already do it — `text-transform:none`). As-typed = user names.

**Font semantics:** `--mono` = data only (readouts, numeric fields, param keys, editable names). `--sans` = chrome (buttons, tabs, selects, menu items) — a button label is chrome even when short/uppercase.

## Color & state

`palette.js` is the runtime source of truth (writes inline vars on `<html>`); the `ui.css :root` block is the FOUC/JS-fail fallback and MUST be kept regenerated from `themeVars({accent:'#d4a24a'})` so static == runtime.

Surfaces (neutral gray, ascending): `--bg → --field-bg → --panel → --panel-2 → --hover → --line → --line-2` (no accent tint on chrome — surfaces stay true neutral). Text (neutral): `--text → --readout → --muted → --faint`. Accent: ONE teal-mint `#3ecfa6`; variants `--accent-soft` (selected tint), `--accent-line` (selected border), `--accent-text` (text on tint), `--accent-dark` (glyph on a bright accent fill), `--accent-head` (muted-teal group-header bar).

**Accent law:** accent is a line / edge / glyph / thin tint / small fill. Never a big solid fill on panels, rows or wide areas — solid `var(--accent)` only on small name chips + the checkbox tick. **Exception (Resolume):** inspector param-group headers ARE a filled muted-teal bar (`--accent-head`) — a deliberate group divider, the one sanctioned filled header.

**One rule per state:** hover → accent glyph/text OR `--hover` fill (not both) · selected-fill → `--accent-soft` + `--accent-line` + `--accent-text` · selected-text (tabs/modes) → `--accent` · modified → `--accent-text` · focus → `--accent-line` (interactive) / `--line-2` (passive input) · disabled → `opacity:.35`. Semantic set is closed: `--danger` (error/destructive/panic), `--success` (online/live). Route panic/warn through tokens, never raw hex.

## Components

- **Buttons:** one recipe + variants (primary / icon / toggle); one fill, one hairline (`--line-2`); `height:--ctrl-h`; press = inset shadow; focus = `--accent-line`. No per-button cosmetic `border-color`/`background` overrides.
- **Sliders:** every one is `kit/slider.js` (`Slider()`), composed as `gutter · label · readout · − · + · range`. The div-faders (`.lh-op`/`.master-op`) are the only sanctioned twins. No native `accent-color` ranges.
- **Toggles/segmented:** `Segmented` → `.seg-2`; 2-option settings never use a `<select>`. ONE active treatment across `.seg-2-btn`/`.dir-btn`/`.lh-tog`.
- **Icons:** Pixelarticons sprite via `<svg class="ic"><use href="#ic-…"/>`. No Unicode/CSS-shape glyphs as button icons — add a sprite symbol (`layers.js:341` is the template).
- **Tabs:** all tiers share ONE active look (accent text, no fill).
- **Headers:** two tiers only — `.insp-sec-head` (accent caps + underline) and the shared faint micro-caps sub-label recipe (join the selector list, don't re-declare).
- **Dividers:** always `1px var(--line)` (accent-24% only for the section underline).
- **Panels:** `--panel` frame, `--panel-2` head/body, `1px --line`, `--s3` padding. Popovers: `--panel-solid`/`--line-2` + shadow.

## Prioritized consistency backlog (from the audit)

**Tier 1 (shipped in the first fix pass):** resync `:root` fallback to `palette.js`; `--col-label` fallback 92→84; define `--left-w`; extract `--col-gutter`; kill `.dash-name` `border-radius:3px`; dedup `select:focus-visible`.

**Tier 2 (bigger sweeps):** icon-sprite migration (replace ~30 Unicode glyphs — reset/close/duplicate/play/stop/bolt/warn/check/scan/chain); collapse `.ctrl-btn`+`.fx-add` → one primary button; unify the three segmented active treatments; route the WLED brightness row + stray `accent-color` ranges through `Slider()`; tokenize the 12/16px gaps and control paddings onto the ramp; reconcile the two row heights (`--row-h` vs the 30px param rows).
