# Fixtures & the Library

The heart of patching: turning physical strips and panels into shapes on the
canvas, and keeping a reusable catalog of the gear you own. Builds on
[Concepts: the three things](02-concepts.md).

## Fixtures vs templates — and why placement is standalone

Three terms, used consistently throughout the guide:

- **Device** — a physical controller (WLED / QuinLED / Art-Net node).
- **Fixture** — a mapped light shape placed on the canvas.
- **Template** — a reusable definition in the **Library** (a fixture *type* or a
  controller *model*).

A template is a starting point, not a live link. When you add a fixture from a
template, the template's spec — pixel count, colour order, grid size, DMX channel
map — is **inlined onto a fresh standalone instance**. The instance keeps a
reference back to the template it came from (so the Library can count how many
copies exist), but every spec field now lives on the fixture itself.

The consequence matters in practice: **editing a template never changes fixtures
you've already placed.** Change a strip type from 60 to 144 LEDs/m in the
Library and your existing strips keep their pixel counts; only the *next*
fixture you stamp from that type picks up the new value. The same rule holds for
devices: a controller instance owns its own outputs / per-output budget and falls
back to the model only for fields it genuinely lacks.

The one deliberate exception is the fixture editor's **Push to placed fixtures
(N)** button, which fans a template's spec out to the N instances that came from
it — an explicit, opt-in re-sync when you *do* want existing fixtures updated.

This is deliberate. A show is a record of the real rig — once a fixture is on the
wall, its definition shouldn't shift under you because you tidied the catalog.

## Where things live

The app is a **dock of three columns**. Fixtures and the Library live in the
**right column**, an accordion of three sections — **Library · Output ·
Sources** — with one section open at a time (click a header to open it, or
click the open header again to fold the column to header strips):

- **Library** — the template catalog: your controller *models* and fixture
  *types*. Authoring only, no canvas.
- **Output** — the *live* patch list: the actual devices and the fixtures wired
  under them, with status dots. This is where you add and assign fixtures. See
  also [Devices & scanning](04-devices-and-scanning.md).
- **Sources** — the visual palette (covered in the canvas chapter).

The **selected item's editor** (a fixture, a device, or a Library model) opens
in a small **floating panel that docks into the canvas's top-right corner** —
not inline in the sidebar. Select something and its editor pops up over the
stage; press **Esc** or click away to dismiss it.

## The Library section

Open the Library from the **Library** icon in the top bar, or by clicking the
**Library** header in the right column. It's the template library — where you
define the gear you own so you can stamp it repeatedly.

It renders two flat catalog lists:

- **Controllers** — controller *models*: a board's physical output count and
  per-output pixel budget (e.g. a QuinLED *DigQuad* = 4 outputs). QuinLED presets
  (DigUno / DigQuad / DigOcta) and a permanent **Generic** model are always
  present.
- **Fixtures** — fixture *types*, reusable physical definitions:
  - **Strips**, by density × length: LEDs/m × metres → pixel count, plus a colour
    order (default GRB) and an optional colour format (`RGBW`, amber variants,
    "None — channels only", or *From controller* to inherit).
  - **Matrices / panels**, by columns × rows, wired in a chosen distribution
    (snake / row order). Pixel count is always cols × rows.
  - **DMX-profile fixtures**, defined as a list of named **channels** (a colour
    block like `RGB`, or a function like Dimmer / Strobe), which expand into a
    flat **DMX channel map**. A permanent **Generic** fixture type is always
    present.

![The Library section: the template catalog of controller models and fixture types.](img/inventory.png)

Each section header carries a right-pinned **+ Controller** / **+ Fixture**
button that authors a fresh blank model in that section and selects it for
editing. Every catalog row shows an instance count (`×N`) and two row actions:

- **⧉ Duplicate** (⌘D) — author an independent numbered copy ("DigQuad 2") of
  the model. No placed fixtures are created; only the definition is copied.
- **✕ Delete** — remove the model from the catalog (with the confirm and
  in-use guard). The permanent **Generic** model/type has no ✕.

Click a row to open its editor in the floating panel over the canvas. A
controller-model editor sets Name, Outputs, Max px/output, and Art-Net sync; a
fixture-type editor sets Name (+ size suffix), layout (Pixels / DMX), Width,
Height, the read-only Pixel count, colour channels, the matrix wiring picker,
physical size (LEDs/m + Length), and the **Push to placed fixtures (N)** button.

> The Library authors *templates only* — there's no canvas here, so its rows have
> no "+ place" button. Placing fixtures onto the canvas happens from the **Output**
> header (next section). Edits sync live between the Library and the rest of the
> app.

### LEDger import

To bring a whole rig — controllers + fixtures + layout — in at once, use the
**Import from LEDger…** button in the **top bar** (not inside the Library). It
opens the Library section and loads the importer. See
[Importing from LEDger](09-importing-from-ledger.md).

## Adding fixtures and devices

Everything you place goes through the **Output** header, which carries three
buttons: **+ Controller**, **+ Fixture**, and **Scan**.

Click **+ Fixture** and a menu drops down listing your fixture types by name
(with a size hint like `144px`, `16×16`, or `7ch`), plus a **Blank** entry at the
bottom. Pick a type to stamp a standalone copy, centred on the canvas and left
**unassigned** (no device yet) so you can patch it deliberately. **Blank** stamps
from the always-present Generic type.

**+ Controller** works the same way against your controller models, with
**Blank** stamping a generic 4-output controller. **Scan** sweeps the network for
WLED and Art-Net nodes — covered in [Devices & scanning](04-devices-and-scanning.md).

The new instance is selected immediately, so its editor opens in the floating
panel and the canvas overlay reveals it.

### Duplicate to multiply

To make many identical fixtures, stamp one and **duplicate** it with ⌘D (Ctrl-D)
— or copy/paste with ⌘C / ⌘V. Each copy is placed next to its original (shifted by
the fixture's on-screen width plus a small gap) and appended **contiguously** in
its device's pixel address space, so addressing stays valid. Duplicating is faster
than stamping repeatedly when you've already positioned and patched the first one.
A selected **controller** duplicates too (its settings, not its fixtures).

## The fixture editor

Select a fixture and its editor opens in the floating panel over the canvas, in
two groups — **Position** and **Patch**. The fixture's name is in the panel title.

![The fixture editor: Position (x/y/w/h/rotation) and Patch (device/output, pixel range).](img/fixture-editor.png)

### Position

A **shape** toggle in the Position header picks what the fixture *is*:
**Linear** (a straight strip — x / y / w / h / rotation) or, in 3D mode,
**Bezier** (a curved arch — two ends + one control point). A **Polyline** (a
bendable multi-segment run) isn't a chip — it emerges when you add vertices to a
run on the canvas; a straight two-point polyline is edited exactly like a Linear
bar. Conversions keep the endpoints.

For a **Linear** bar:

- **X / Y** — the bounding box's top-left corner (Figma-style), in canvas pixels.
- **Z** — the whole fixture's height off the canvas plane, in pixels (`0` = flat
  on it). Visible in **3D mode** (below). Lifting a whole bar doesn't change
  where it samples (3D projects front-on); sampling shifts when the height
  *varies* along a run — an arch, a tilted polyline.
- **Width** — the run length on the canvas.
- **Height** — **auto** by default: drawn to physical scale (a 10 mm strip at this
  fixture's pixels-per-metre). The field shows the effective pixels; type a value
  to override, or set `0` (or clear it) to return to auto.
- **Rotation°** — with inline ±90° steppers.

A **Polyline** shows a compact per-vertex **X/Y/Z** table instead (one row per
vertex); a **Bezier** shows its two ends and the **C**(ontrol) row — raise C's Z
to pull the middle up into a standing arch.

- **Reverse direction** — not a transform flip; it reverses *which end of the strip
  is pixel 0* (the canvas arrow points at pixel 0).

### Patch

- **Device** — the controller this fixture is wired to. The first option is
  *— unassigned —*, so a fixture can sit deviceless while you prototype.
- **Output** — the controller's output/port, limited to that device's actual
  output count.
- **Pixels** — a read-only display of the fixture's device-local pixel range.

> **Chains.** If fixtures are daisy-chained on one output, the run's device and
> output are set by the **head** (first) fixture; downstream members inherit them
> and their pickers are locked. Moving the head moves the whole run together.

### DMX-profile fixtures

A DMX fixture gets a different editor. **Fixture** shows its type (its channel
layout is owned by the type — edit it in the Library) and the on-canvas
footprint (X/Y/W/H — the box is where it *samples* colour, independent of the
channel layout). **Patch** sets the **Controller**, **Universe**, and **Address**,
and shows a footprint badge (`Nch · U{universe}.{address}`).

Below that, **Parameters** gives one row per channel group (an RGB block is one
row, not three). Each parameter picks a **source**: *Canvas* (sample the visual,
default for colour), *Manual* (a fader), a *Layer*'s level, or a *Dashboard* link.

## 3D mode

The **3D** cube in the top bar switches the stage to a 3D viewport: a ground grid
with the canvas rectangle on it (the plane the visuals live on), every fixture as
a projected strip, and its live LED colours. Set a fixture's **Z** and it lifts
off the plane.

- **Drag** orbits the view, **Shift-drag** pans, the **wheel** dollies in/out.
  The view is remembered but never enters undo history — it's a camera, not an edit.
  The **⟲ Reset view** icon (in the footer, 3D only) returns the orbit to home.
- **Click** a strip to select it.
- **Edit in 3D:** a polyline's vertex handles (and a bezier's ends + diamond
  control) are draggable — a plain drag slides the point on the horizontal plane
  at its current height; **Alt-drag** moves it vertically (Z only). Double-click
  a polyline segment to insert a vertex on the run; right-click a vertex to
  remove it. Every edit is undoable. Bar move/resize/rotate stays a 2D gesture —
  arrange bars in 2D, lift them with the Z field.
- **Bezier arch:** switch a strip to **Bezier** in the editor, then Alt-drag the
  diamond control upward — the flat strip bows into a standing arch, its LEDs
  spaced evenly along the *3D* curve.
- **Bulk arc:** select several strips, click **Bezier** in the multi editor, then
  type one **Arc Z** — every selected strip stands up as an arch of that height.

**How 3D samples.** In 3D mode the output samples the composition *front-on*,
through a fixed front-ortho camera — **there is no projection or camera preset to
pick**. Fixtures at Z = 0 keep sampling *exactly* where 2D put them; a lifted
shape spaces its LEDs evenly along its true 3D length (an arch bunches toward its
steep ends on the canvas). The footer's 3D-only controls include a **Fields** icon
that ghosts the active volumetric fields (plane / gradient arrow / sphere rings /
noise lattice) so you can see how light will move through space. For light that
moves *through* the rig (up an arch, across the room), use the **Volumetric**
sources (see the sources chapter).

The daemon/output path is unchanged; 3D only decides *where each LED reads*
the 2D composition.

## Multi-select bulk edit

Select several fixtures and the editor becomes a **bulk editor** over the whole
selection. A field whose value is the **same** across every selected fixture shows
that value; a field that **differs** renders as **"— mixed —"** and dims (the row
greys out). Typing into any field — or choosing from a dropdown — writes that value
to **all** selected fixtures at once.

Bulk Position covers X / Y / Width / Height / Rotation (with ±90° and Reverse
applied per-fixture). Bulk Patch covers Device for the whole selection, Output port
when the selection includes strips, and Universe / Address when it includes DMX
fixtures. When every selected fixture is a DMX fixture of the *same* type, a shared
**Parameters** section drives one named fader across all of them. (Per-chain
settings and the derived pixel range aren't bulk-editable.)

The **Align** button in the top bar (active with 2+ selected) aligns and
distributes the selection against either the other selected fixtures or the
composition.

## Patching & auto-packed offsets

You never hand-author a fixture's pixel offset. Each output's run is packed
**automatically**: within a device, fixtures are ordered by (port, then list
order) and assigned **contiguous** device-local offsets starting at 0. Each port's
pixels are contiguous, and ports pack in ascending order — exactly how a
multi-output controller (e.g. a QuinLED DigQuad) lays its outputs into one pixel
array.

This re-packs whenever a fixture's device, port, count, or membership changes — so
assigning a fixture to a device (via the Patch picker, or by **dragging** its row
onto a controller header in the Output list) can't leave gaps or overlaps. The
read-only **Pixels** range you see is the result of this packing.

Controllers in the Output list are **always expanded** — fixtures appear nested
under their controller, with an *Unassigned* group for any not yet patched.

---

To verify your patch looks right on the wall, use **Output preview** (the wall
button in the top bar): it dims the canvas and lights only each fixture's sampled
pixels.

_See also: [Getting started](03-getting-started.md) · [Devices & scanning](04-devices-and-scanning.md) · [Importing from LEDger](09-importing-from-ledger.md)._
