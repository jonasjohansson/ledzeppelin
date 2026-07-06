# Multi-column Source Browser — Design + Plan

> Approved (fan-out). Turn the compact source picker popover into a wider multi-column grid of
> preview cards showing all sources at once. Thumbnails already exist; the pick action + drag +
> anchoring stay identical. **Pure CSS** (scoped to the source picker) — no JS/model changes.

**Goal:** Picking/replacing a clip's source shows a wide, multi-column browser of preview cards
(thumbnail over label), all categories visible, instead of a narrow single-column list.

**Why CSS-only:** `openPicker(anchor,'source',…)` (src/ui/layers.js) already builds
`.pick-pop.pick-grouped` → per-category `.pick-group` header + `.pick-grid` → `.pick-item`
(each `img.lib-thumb` + `span.lib-label`). Restyling `.pick-pop.pick-grouped` into a grid of
cards achieves the browser. The effect picker (`.pick-pop` WITHOUT `.pick-grouped`) is left as-is.

## Task 1: multi-column card CSS (scoped to `.pick-pop.pick-grouped`)

**File:** `src/ui/ui.css` (the `.pick-*` block, ~lines 1710-1725)

Replace the grouped-source rules with a wide multi-column card grid (override the compact list rules
via higher specificity — `.pick-pop.pick-grouped .pick-grid` beats `.pick-grid`):
```css
/* Source browser: a wide multi-column grid of preview cards (thumbnail over label). */
.pick-pop.pick-grouped { width: min(680px, calc(100vw - 16px)); max-width: none; }
.pick-pop.pick-grouped .pick-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: var(--s2); overflow-x: visible;
}
.pick-pop.pick-grouped .pick-item {
  flex-direction: column; align-items: stretch; text-align: left;
  width: auto; min-width: 0; gap: 4px; padding: 5px;
}
.pick-pop.pick-grouped .lib-thumb { width: 100%; height: 58px; }
.pick-pop.pick-grouped .lib-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```
(Keep the existing base `.pick-pop`, `.pick-item`, `.lib-thumb`, `.pick-group` rules — these only
override for the grouped/source case. The `.pick-video`/ISF rows still render as full-width items
inside their own grid; they'll sit in the grid too — acceptable, they carry no thumbnail.)

## Task 2: verify + release
- `node --check` isn't meaningful for CSS; run `npm test` (must stay green — CSS-only, no logic).
- **Manual smoke:** click an empty clip "+" (or replace a clip's source) → the picker is now a wide
  multi-column grid of source cards with larger thumbnails, all categories visible; clicking one
  still sets the source; dragging a card onto a clip still works; the EFFECT picker (add effect) is
  unchanged (compact list). Check it clamps to the viewport near screen edges.
- Cut a signed/notarized release; update memory if worth it.

## Out of scope (YAGNI)
Effect thumbnails, a persistent docked browser window, search/filter, a category-tab toggle.
