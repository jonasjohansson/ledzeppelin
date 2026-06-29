# Design: declutter the patch flow

**Date:** 2026-06-29
**Status:** approved, ready for implementation plan

## Problem

Testing showed the device/fixture patching flow is complicated and opaque:

1. **Two-level model is confusing.** The right column has a *Devices* tab (placed
   instances) and an *Inventory* tab (a catalog of models referenced by `typeId`).
   Users don't understand "define a type, then place an instance."
2. **The fixture editor hides info behind toggles** — e.g. the DMX param "Custom…"
   dropdown reveal, and channel counts that are read-only until you pick Custom.
   (GitHub #5: users can't even find how to add/patch a fixture.)
3. **Scanning is a mystery** — `runScan` fires a WLED subnet sweep + Art-Net
   ArtPoll in parallel but shows nothing until results land. (GitHub #4: a found
   controller doesn't appear in Devices until you switch tabs — a re-render bug.)

## Goals

Make patching **direct, transparent, and bulk-editable**, without losing the
ability to define reusable fixture/controller definitions.

## Design

### A. Inventory moves to a popout (mirrors the mappings window)

- The right-column **Inventory tab is removed**. The right column becomes only the
  Devices / patch view.
- A new `inventory/` page (its own route + HTML/JS, like `mappings/`) opens from a
  top-bar icon via `window.open('inventory/', 'lz-inventory', …)`.
- It edits the full catalog: controller models + fixture models.
- It syncs to the main app the same way mappings does — `BroadcastChannel('lz-inventory')`
  plus shared show persistence (`saveShow`).

### B. The catalog is a TEMPLATE LIBRARY, not live-linked types (confirmed)

This is the key decision (Reading 1, confirmed with the user):

- The inventory popout authors **reusable templates** (QuinLED controller, strip,
  matrix, DMX RGB, …).
- `+ Device` / `+ Fixture` **stamps a standalone copy**: the template's full spec is
  **inlined into the instance**. There is **no live link** back to the template.
- Editing one instance — including its channel map / geometry — **never** affects
  other instances. Editing a template only affects *future* stamps.
- `Duplicate` clones an instance outright.

**Data-model consequence:** instances carry their full spec inline. `typeId`
becomes, at most, an optional "created-from" provenance tag (or is dropped).
`normalizeShow` no longer merges a referenced type into each instance; it validates
the inline spec. Migration must inline each existing instance's referenced type spec
into the instance, then the per-show type arrays are no longer the source of truth
for instances (the templates live with the inventory).

### C. Main patch flow — direct add (fixes #5)

- Always-visible `+ Fixture` and `+ Device` controls in the Devices view.
- Each opens a quick menu of templates (or "blank") → creates a standalone instance,
  pre-filled with sensible defaults, and selects it.
- `Duplicate` (⌘D / button) to multiply similar fixtures.

### D. Flat side panel + multi-select bulk edit (fixes #2, adds bulk edit)

- One flat editor side panel. **Everything is always visible** — no "Custom…"
  reveal, no preset-vs-custom read-only gating. The DMX param row becomes an
  always-editable name + channel count.
- Multi-select via shift/⌘-click in the list (and marquee select on the canvas).
- The panel reflects the selection: **shared values render normally; fields that
  differ across the selection are dimmed ("mixed")**.
- Editing any field writes that value to **all** selected instances.

### E. Transparent scan (fixes the "mystery" + #4)

- While scanning, show live progress instead of nothing-until-done: indicate the two
  probes running (WLED subnet sweep + Art-Net ArtPoll), a spinner, and counts as
  results arrive.
- Fix the re-render bug: adding a found controller must update the Devices list
  immediately (re-render on add — don't require a tab switch).

## Out of scope (YAGNI)

- No live-linked types / "update all instances of this type" (explicitly rejected).
- No new protocols or discovery mechanisms — scan logic is unchanged, only its
  feedback and the post-add re-render.
- No change to the engine/compositor or output pipeline.

## Touch points (for the plan)

- `index.html` — remove the Inventory tab; add the inventory popout top-bar icon.
- `src/ui/fixtures.js` — direct add menu, flat panel, multi-select + mixed-value
  rendering, scan progress, re-render-on-add.
- `src/model/show.js` — drop type→instance merge in `normalizeShow`; inline-spec
  validation; migration that flattens referenced types into instances.
- `src/app.js` — wire the inventory popout (open + `BroadcastChannel` sync); selection
  state for multi-select.
- New `inventory/` page — catalog editor (controller + fixture templates).
- `src/model/kagora-import.js` (LEDger import) — produce inlined instances instead of
  type refs.

## Migration / risk

- Existing saved shows reference `typeId`. The migration step must inline each
  instance's referenced type spec so nothing loses its structure when the merge step
  is removed. This is the highest-risk piece — needs a test against a real saved show.
