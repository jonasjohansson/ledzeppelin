# TD-style source browser — design

**Date:** 2026-07-08
**Status:** approved, ready for planning

## Goal

Rebuild the source browser to read like TouchDesigner's OP Create Dialog: color-coded
**family tabs** across the top, a **search** box, a dense **grid** of source cards, and a
one-line **description** of the focused source at the bottom. One shared component powers
BOTH the persistent **Sources tab** (Output pane, `#patch-sources`) and the **`+` clip
source picker** (`openPicker`, source branch).

## Decisions (from brainstorming)

- **Scope:** the Sources tab + the source picker share ONE component. The effects picker is
  unchanged for now (a follow-up could reuse the component with an Effects tab).
- **Tabs = source categories:** `All · Basic · Pattern · Motion · Liquid · Organic ·
  Volumetric` (the existing `SOURCE_CATEGORIES` in `layers.js`), plus `More` for
  uncategorised generators + Video + ISF examples.

## Component

`sourceBrowser({ onPick, draggable, getISFExamples, onAddISF, onVideo })` in `src/ui/layers.js`,
returning a DOM element:

1. **Tab bar** — `All` + the 6 categories + `More`. Each tab shows the category name with a
   **restrained color indicator**: a thin underline in the category's colour when active, and
   a small category dot. NOT a full saturated fill — this keeps TD's colour-coded-families read
   in the app's structural/hairline language ([[ui-feel-serious-not-glass]]). A muted 6-hue
   `CATEGORY_COLORS` map drives the tab underline + the card dot.
2. **Search box** — filters across ALL sources by label (case-insensitive substring). A
   non-empty query OVERRIDES the active tab and shows all matches in the grid; clearing returns
   to the tab.
3. **Grid** — dense multi-column cards, each = thumbnail (`thumbnails[name]`) + label
   (`labelOf`) + a small category dot. Reuses the existing thumbnails. Draggable (sets the
   shared `drag = { kind:'source', name }` for the layer-slot drop targets) AND click-to-pick
   (`onPick(name)`). Hover/focus updates the description line.
4. **Description line** — a one-liner for the focused/hovered card. Source registry entries gain
   a short `desc` string; fall back to the category label when unwritten.

## Data

- **Category source-of-truth:** `SOURCE_CATEGORIES` (already in `layers.js`). Add a pure helper
  `sourceCategory(name)` → the category label (or 'More'), and `CATEGORY_COLORS` (6 muted hues).
- **Descriptions:** add `desc: '<one line>'` to each generator entry in
  `src/engine/shaders/manifest.js` (Basic/Pattern/Motion/Liquid/Organic/Volumetric sources).
  Short, plain. A `descOf(name)` helper falls back to `''`/label.
- **Filter helper (pure, tested):** `filterSources(allNames, { tab, query })` → the ordered list
  to show — honours the active tab OR the search query, keeps category order. Unit-tested.

## Where it mounts

- **Sources tab:** `setPatchTab('sources')` (app.js) mounts `layerPanel.sourceBrowser(...)` into
  `#patch-sources` instead of the current `buildSourceRail()`. Items add to the active layer on
  click, drag onto slots.
- **`+` picker:** `openPicker(anchor, 'source', onPick, opts)` renders the same component inside
  the popover (replacing the current grouped grid), `onPick` → add clip. The picker popover grows
  to fit the tabbed layout (like the existing `.pick-grouped` width bump).

## Aesthetic

Square corners, hairline dividers, mono labels, near-black. Category colours are MUTED (a small
dot + a 2px active underline), never a filled tab. The description line is `--faint` micro text.
Search box matches the existing input chrome.

## Testing

- **Unit:** `sourceCategory(name)` maps correctly; `filterSources` returns the right ordered list
  for a tab and for a query (across categories); `descOf` falls back.
- **App smoke:** open the Sources tab and the `+` picker — tabs switch, search filters, cards show
  thumbnails + dots + description, click adds a clip, drag adds a clip, no console errors.

## Non-goals (v1)

Effects in the same browser (follow-up), keyboard nav of the grid, favourites/recents, per-source
icons beyond thumbnails.
