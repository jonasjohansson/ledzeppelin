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
pixel count. Managed in the **Output** section of the right dock; see
[Devices & scanning](04-devices-and-scanning.md).

**Fixture** — a mapped light *shape* placed on the canvas: a strip, ring, matrix,
or point with an x/y/w/h/rotation transform. A fixture samples the canvas where it
sits and sends those pixels to a slice of a device's address space (device +
pixel offset + pixel count). See [Fixtures & the Library](05-fixtures-and-inventory.md).

**Model** *(template)* — a reusable fixture or controller *definition* living in
the **Library**. Adding a model to the canvas stamps out a standalone
fixture/device that owns its own spec — editing the model afterwards never
changes anything already placed, *except* the explicit **"Push to placed
fixtures"** button, which fans a fixture model's geometry out to its instances.
Duplicate a placed fixture (⌘D) to multiply it.

**Library** — the catalog of fixture models and controller models. It lives as
the **Library** section in the right-hand dock (open it with the library icon in
the top bar, or with **+ Controller / + Fixture** on a section header). Selecting
a row opens that model's editor in a small floating panel over the canvas; each
row carries its own **✕** to delete it. Importing from LEDger is a separate
top-bar button (see **Import from LEDger** below). See
[Fixtures & the Library](05-fixtures-and-inventory.md).

**Output** — the live device/fixture *patch*: the actual controllers and fixtures
you are driving, with status dots, shown in the **Output** section of the right
dock. **+ Controller / + Fixture / Scan** sit on its header. Distinct from the
**Library**, which holds the reusable models. See
[Output & calibration](10-output-and-calibration.md).

**DDP** — Distributed Display Protocol. The pixel-streaming protocol LED Zeppelin
uses to push frames to WLED/QuinLED devices over the network. Pixels map by index
into the device's buffer, so a fixture's pixel offset must stay inside the device's
range.

**Art-Net** — a DMX-over-Ethernet protocol, organised into universes. Used for
generic nodes that speak DMX rather than DDP.

**Universe** — an Art-Net addressing block of up to 512 DMX channels (≈170 RGB
pixels). Large rigs span multiple universes.

**Colour order** — the byte order a device expects per pixel (RGB, GRB, BGR, …,
plus RGBW variants). Set it per device; a fixture can override with its own colour
format. A wrong order shows swapped colours (e.g. red appears green). See
[Output & calibration](10-output-and-calibration.md).

**Mapping / sampling** — *sampling* is how a fixture reads the canvas: each of its
pixels samples the composite image under its on-screen position, so where you place
and size a fixture decides what it shows. *Mapping* is the broader act of laying
fixtures over the canvas so the visual lands on the right lights. (Distinct from
**Mappings** below.)

**Mappings** — input bindings: MIDI, keyboard, and OSC controls wired to app
parameters. Opens as its own screen (mapping icon in the top bar). See
[Mappings](08-mappings.md).

**Import from LEDger** — the top-bar import button. It opens the Library section
and loads the LEDger importer, which brings a preset in as fixtures/controllers
(then you assign device IPs). See [Importing from LEDger](09-importing-from-ledger.md).

**Scene** — a saved snapshot of the composition state you can recall later. See
[Scenes](07-scenes.md).

**Source** — a visual generator (shader/pattern/media) that produces an image.
Picked from the compact 2-column **Sources** palette in the right dock, or drag an
ISF shader (`.fs` / `.isf` / `.frag` / `.glsl`) onto the window to add one as a
generator clip.

**Effect** — a processor stacked on a layer that transforms the image coming
through it (blur, displace, tint, …).

**Clip** — a single source or effect placed on a layer in the composition,
triggerable and adjustable. See [Canvas, sources & effects](06-canvas-sources-effects.md).

**Layer** — a stack slot in the composition holding clips; layer-level colour and
transform reach every clip on it, including its 3D clips.

**Composition** — the visual program: layers, clips, and their parameters that
together produce the canvas image. It is part of the project and saved with it
(⌘S). Dropping a composition-only `.json` onto the window restores the visuals but
leaves the rig (devices + fixtures) alone.

**Dock** — the three-column workspace: the left column (**Settings · Composition ·
Layer · Clip**), the centre stage + timeline, and the right column (**Library ·
Output · Sources**). Each side column is an accordion — one section open at a time,
or click the open header to fold everything to header strips. Splitters resize the
neighbouring columns.

**3D mode** — arranges and views the rig in 3D (orbit camera). Output sampling is
always a fixed front-ortho view — there are no projection/camera presets to choose.
The **Fields** toggle ghosts the active volumetric fields; **⟲** resets the orbit
view. See [Canvas, sources & effects](06-canvas-sources-effects.md).

**Volumetric field** — a 3D spatial effect (plane pulse, axis gradient, drift, …)
evaluated per LED in space. Each LED's height is rescaled so the tallest fixture
point sits at the top of the field, so tall rigs are fully covered.

**Advanced mode** — a preference (Settings ▸ preferences) that reveals extra
controls: the view/panel toggles, snap/output settings, and advanced device
options. Off by default for a simpler surface.

**Daemon** — the local helper process that proxies the device JSON-API and streams
pixels. When it's unreachable a red **OFFLINE** chip appears in the top bar; no
chip means the daemon is live.

**Preview** — the **Preview** (wall) toggle dims the canvas composite and lights
*only* each fixture's sampled pixels, so you see exactly what the rig will show.
See [Output & calibration](10-output-and-calibration.md).

## Files & import

There is no generic Import button — bring things in by **dragging onto the window**
(LEDger presets are the exception, via the top-bar **Import from LEDger** button):

| Drop this | Result |
|-----------|--------|
| ISF shader (`.fs` / `.isf` / `.frag` / `.glsl`) | New generator clip under the drop target |
| LED Zeppelin project `.json` | Loads the rig + visuals (same as ⌘O) |
| Composition `.json` | Loads visuals only |
| `.obj` model | Imports the mesh as a whole rig + starter show |
| LEDger preset `.json` | Prompts you to import it from the **Library** instead |

**Save project** (⌘S) writes the whole project — rig + visuals — as one `.json`.
There is no separate visuals-only export; loading a composition `.json` (by
dropping it) restores visuals only.

## Keyboard shortcuts

Verified against the app's key handlers (`src/app.js`, `src/ui/project-io.js`) and
the button tooltips (`index.html`). Use ⌘ on macOS, Ctrl on Windows/Linux.
Shortcuts are ignored while you're typing in a field, and most editing keys are
blocked while the show is **locked** (only K, L and Escape pass through).

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

> ⌘D on a selected **Library** model duplicates the model instead of a placed
> fixture.

### View & performance

| Action | Shortcut |
|--------|----------|
| Show / hide all UI (full-screen canvas) | H |
| Lock editing (performance mode) | L |
| Panic — blackout output | K |

> View presets (top bar, Advanced mode): **Canvas**, **Split**, **Editor**,
> **Float**. The Edit (eye), Snap, Grid, Tint, Outline, Preview (wall) and 3D
> toggles are buttons, not key bindings.

_See also: [Concepts](02-concepts.md) · [Troubleshooting](12-troubleshooting.md)._
