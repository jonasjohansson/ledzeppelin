# Scenes

> **Status: not yet shipped.** Scenes are LED Zeppelin's planned recall model — named
> snapshots of a look that you save and recall instead of building a cue list. The
> direction below is real, but **there is no scene UI in the app today.** This page
> describes what exists now and what is coming, without inventing buttons.

## What a scene is

A **scene** is a recallable snapshot of the current look — the composition (its layers,
clips, parameters, and opacities), captured under a name like `Opening`, `Peak`, or
`Ambient`. Recall a scene and the wall fades to that saved state. A scene stores the
*look*, not the rig: your [devices](04-devices-and-scanning.md) and
[fixtures](05-fixtures-and-inventory.md) stay put, only the visuals change.

Scenes are the substrate for the parts of an installation that aren't hand-driven — a
scheduler ("at sunset → Evening"), or an autonomous director that moves between named
looks on its own. That is why they are a *recall primitive*, not an operator console.

## Scenes replace a cue list

LED Zeppelin is built for a permanent generative install that runs unattended, not for an
operator at a laptop tapping GO down a list. So there is deliberately **no cue list / GO
stack**. The recall model is a small set of named looks you switch between, recalled by
name — by a schedule, by a [mapping](08-mappings.md), or by hand — rather than an ordered
sequence of standby-then-go steps. For an install, that usually means a handful of looks
(open / peak / closing) rather than a long cue sheet.

## What you can do today

Until scenes ship, save and restore work at the **whole-project** level. The controls all
live on the top toolbar (see [Getting started](03-getting-started.md#7-save-open-import)):

| Action | How | Scope |
| --- | --- | --- |
| **Save project** | **⌘S** (`menu-save`) | Rig **and** visuals → the project `.json` |
| **Open project** | **⌘O** (`menu-open`), or drag a `.json` onto the window | Replaces rig + visuals |
| **New project** | `menu-new` | Starts a blank project |
| **Undo / redo** | **⌘Z** / **⇧⌘Z** | Steps through recent edits within a session |

Loading is format-aware: drop a full **project** `.json` and it loads the rig and the
visuals; drop a **composition-only** `.json` (layers/canvas, no fixtures) and it applies
those visuals onto the current rig, leaving your devices and fixtures untouched. Drop a
LEDger file and the app points you to
[Import from LEDger…](09-importing-from-ledger.md) instead.

> There is no longer a "Save composition…" export in Settings — the visuals-only export
> button was removed. To keep a distinct look as its own file today, **⌘S the whole
> project under a new name** and open the one you want. That carries the rig with it, which
> for a fixed install is usually what you want anyway.

These give you durable saved states to return to; they are **not** yet per-look recall
with a fade. Switching projects is a hard cut, not a crossfade, and it reloads everything —
so it's a setup-time tool, not a live look-change.

## What's coming

Planned scene support: capture the current look as a named scene, list scenes in the
left-dock **Composition** section (capture / rename / recall), and recall one with a
crossfade — the same crossfade the layer compositor already uses when you trigger a
[clip](06-canvas-sources-effects.md). Once that lands, a scheduler and a living-show
director will recall those same named scenes automatically — and this page will be
expanded to match.

---

_See also: [Getting started](03-getting-started.md), [Canvas, sources & effects](06-canvas-sources-effects.md), [Mappings](08-mappings.md) (trigger looks from MIDI/OSC), [Output & calibration](10-output-and-calibration.md)._
