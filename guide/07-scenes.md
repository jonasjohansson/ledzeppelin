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

Until scenes ship, save and restore work at the **whole-project** level:

- **⌘S** saves the entire project (rig + visuals) to its `.json`.
- **⌘O** opens a project, or drag a `.json` onto the window to load it.
- **Save composition…** in Settings writes just the visuals (no rig). Dropping a
  composition `.json` back on the window loads those visuals onto the current rig.
- **Undo / redo** steps through recent edits within a session.

These give you durable saved states to return to; they are not yet per-look recall with a
fade. For now, keep distinct looks as separate composition `.json` files and load the one
you want.

## What's coming

Planned scene support: capture the current look as a named scene, list scenes in the
Composition area (capture / rename / recall), and recall one with a crossfade. Once that
lands, a scheduler and a living-show director will recall those same named scenes
automatically — and this page will be expanded to match.

---

_See also: [Getting started](03-getting-started.md), [Canvas, sources & effects](06-canvas-sources-effects.md), [Mappings](08-mappings.md) (trigger looks from MIDI/OSC), [Output & calibration](10-output-and-calibration.md)._
