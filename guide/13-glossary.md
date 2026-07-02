# Glossary & keyboard shortcuts

Quick lookups: the terms LED Zeppelin uses, and the keys the app actually binds.
For definitions in context see [Concepts](02-concepts.md).

## Glossary

**Pixel** — a single addressable LED (or LED group) on a strip. The smallest unit
the engine drives. A fixture's brightness/colour comes from the canvas pixels it
samples; the device's job is to push those values down the wire.

**Pixel count** — how many pixels a fixture or device covers. For a strip it's
LEDs/m × length; on a device it's the total addressable count across the output.

**Device** *(controller)* — a physical box that drives LEDs: WLED, QuinLED, or a
generic Art-Net node. Devices have a network address (IP/host), a protocol, and a
pixel count. Managed in the **Output** panel; see
[Devices & scanning](04-devices-and-scanning.md).

**Fixture** — a mapped light *shape* placed on the canvas: a strip, ring, matrix,
or point with an x/y/w/h/rotation transform. A fixture samples the canvas where it
sits and sends those pixels to a slice of a device's address space (device +
pixel offset + pixel count). See [Fixtures & the Library](05-fixtures-and-inventory.md).

**Template** — a reusable fixture or controller *definition* living in the
**Library**. Placing a template stamps out a standalone fixture/device that owns
its own spec — editing the template afterwards never changes anything already
placed. Duplicate a placed fixture to multiply it.

**Library** — the catalog of fixture and controller templates, opened as a
browser tab (box icon in the top bar, or the library icon in the Output
header). LEDger import lives here too ("import from ledger / choose preset file").
See [Fixtures & the Library](05-fixtures-and-inventory.md).

**DDP** — Distributed Display Protocol. The pixel-streaming protocol LED Zeppelin
uses to push frames to WLED/QuinLED devices over the network. Pixels map by index
into the device's buffer, so a fixture's pixel offset must stay inside the device's
range.

**Art-Net** — a DMX-over-Ethernet protocol, organised into universes. Used for
generic nodes that speak DMX rather than DDP.

**Universe** — an Art-Net addressing block of up to 512 DMX channels (≈170 RGB
pixels). Large rigs span multiple universes.

**Colour order** — the byte order a device expects per pixel (RGB, GRB, BGR, …).
Set it per device; a wrong order shows swapped colours (e.g. red appears green).
See [Output & calibration](10-output-and-calibration.md).

**Mapping / sampling** — *sampling* is how a fixture reads the canvas: each of its
pixels samples the composite image under its on-screen position, so where you place
and size a fixture decides what it shows. *Mapping* is the broader act of laying
fixtures over the canvas so the visual lands on the right lights. (Distinct from
**Mappings** below.)

**Mappings** — input bindings: MIDI, keyboard, and OSC controls wired to app
parameters. Opened as a browser tab (mapping icon in the top bar). See
[Mappings](08-mappings.md).

**Scene** — a saved snapshot of the composition state you can recall later. See
[Scenes](07-scenes.md).

**Source** — a visual generator (shader/pattern/media) that produces an image.
Drag an ISF shader (`.fs` / `.isf` / `.frag` / `.glsl`) onto the window to add one as a
generator clip.

**Effect** — a processor stacked on a layer that transforms the image coming
through it (blur, displace, tint, …).

**Clip** — a single source or effect placed on a layer in the composition,
triggerable and adjustable. See [Canvas, sources & effects](06-canvas-sources-effects.md).

**Composition** — the visual program: layers, clips, and their parameters that
together produce the canvas image. Saved on its own via **Save composition…** in
Settings; loading a composition `.json` restores visuals only (not the rig).

**Daemon** — the local helper process that proxies the device JSON-API and streams
pixels. Its health is shown by the **Daemon** icon in the top bar (opens
`/health`); disabled when offline.

**Preview** — the **Preview** (wall) toggle dims the canvas composite and lights
*only* each fixture's sampled pixels, so you see exactly what the rig will show.
See [Output & calibration](10-output-and-calibration.md).

## Files & import

There is no Import button. Bring things in by **dragging onto the window**:

| Drop this | Result |
|-----------|--------|
| ISF shader (`.fs` / `.isf` / `.frag` / `.glsl`) | New generator clip |
| LED Zeppelin project `.json` | Loads the rig + visuals (same as ⌘O) |
| Composition `.json` | Loads visuals only |
| LEDger preset | Hints to use the Library tab |

**Save project** (⌘S) writes the whole project — rig + visuals. **Save
composition…** (in Settings) writes visuals only.

## Keyboard shortcuts

Verified against the app's key handlers (`src/app.js`) and the button tooltips
(`index.html`). Use ⌘ on macOS, Ctrl on Windows/Linux. Shortcuts are ignored while
you're typing in a field, and most editing keys are blocked while the show is
**locked** (only K, L and Escape pass through).

### Project

| Action | Shortcut |
|--------|----------|
| Save project | ⌘S |
| Open project | ⌘O |
| Undo | ⌘Z |
| Redo | ⌘⇧Z |

### Selection & editing

| Action | Shortcut |
|--------|----------|
| Select all fixtures *(while editing fixtures)* | ⌘A |
| Copy selected fixture(s) / controller | ⌘C |
| Paste *(cascades next to the last paste)* | ⌘V |
| Duplicate selected fixture(s) / controller | ⌘D |
| Delete selection *(fixture, else effect → layer → clip)* | Delete / Backspace |
| Nudge selected fixture(s) by 1 px | Arrow keys |
| Nudge by 10 px | Shift + Arrow |
| Clear fixture selection | Escape |

> ⌘D on the **Library** tab duplicates the selected template instead of a placed
> fixture.

### View & performance

| Action | Shortcut |
|--------|----------|
| Show / hide all UI (full-screen canvas) | H |
| Lock editing (performance mode) | L |
| Panic — blackout output | K |

> View presets (top bar): **Canvas**, **Split**, **Editor**, **Float**. The Edit
> (eye), Snap, Grid, Tint and Preview toggles are buttons, not key bindings.

_See also: [Concepts](02-concepts.md) · [Troubleshooting](12-troubleshooting.md)._
