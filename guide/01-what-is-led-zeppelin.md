# What is LED Zeppelin

LED Zeppelin drives **addressable LED** (strips, polylines, snake-wired matrices, and 3D
tube rigs) with live generative visuals. You design moving imagery on a 2D canvas, place your
lights on that canvas, and the app streams the right colours to each light in real time
(~40 fps).

Think projection-mapping, but the "surfaces" are LED **fixtures** and the output is network
pixel data, not a video signal.

![The LED Zeppelin editor: the top bar of tools, the left dock (Settings / Composition / Layer / Clip), the canvas with its clip deck in the centre, and the right dock (Library / Output / Sources).](img/overview.png)

## Who it's for

LED Zeppelin is for anyone lighting a **physical LED build** and wanting live, generative
imagery on it rather than a fixed video file:

- **Artists & fabricators** wiring a sculpture, arch, or installation and mapping visuals onto
  its exact pixel layout.
- **VJs & lighting operators** who want to design looks, save them as **scenes**, and recall
  them live from MIDI, OSC, keyboard, or a phone.
- **Installers** deploying a permanent rig (the bundled **Kagora** example is a full 120-tube
  arch install) that runs unattended.

No coding is required for everyday use. If you *do* write shaders, ISF/GLSL drop straight in as
clips or effects.

## Two halves

LED Zeppelin is **a browser editor + a small background daemon**:

- **Editor** — runs in a browser. Design, map, configure. Open it hosted at
  [ledzeppelin.jonasjohansson.se](http://ledzeppelin.jonasjohansson.se/), or locally via the
  app (`http://localhost:7070`).
- **Daemon** — the local program that sends the network packets (UDP) a browser can't, scans
  for controllers, and receives OSC/MIDI.

**Design anywhere; to light real LEDs, run the local app.** The hosted site previews but can't
stream — only the local daemon talks to hardware. The released app needs no Node.js.

## What you can do

- **Design** — stack generative sources and effects on a layer's clips; modulate any param by
  time, audio, or OSC/MIDI. Colour params modulate too. ISF shaders work as clips or effects.
- **Map** — place **fixtures** on the canvas to set what each one samples. Flip to **3D mode**
  to arrange the rig in space; volumetric fields fill the full height of your build.
- **Output** — wire fixtures to **devices** (controllers) in the Output list; stream over DDP
  (WLED) or Art-Net.
- **Operate** — save/recall looks as **scenes**; drive them live via MIDI, OSC, keyboard, or a
  phone companion.

It uses **scenes** (recallable snapshots), not a cue list.

## The top bar

![The top bar: icon buttons with tiny uppercase captions, grouped left to right.](img/topbar.png)

A single full-width row of icon buttons (with tiny uppercase captions) across the top of the
window, grouped left to right:

- **Settings** (gear, far left) — opens the **Settings** section in the left dock (audio input,
  snap, output, appearance).
- **Project** — lock (performance mode, **L**), save (⌘S), open (⌘O), new. Undo/redo live on
  ⌘Z / ⇧⌘Z.
- **Import from LEDger…** — opens the **Library** and loads the LEDger importer to bring a
  preset in.
- **Mapping** — opens the MIDI / keyboard / OSC mapping screen.
- **Library** (box icon) — opens the **Library** section in the right dock (fixture &
  controller *templates*).
- **Control surface** (phone remote), and **align/distribute** selected fixtures.
- **View presets** — Canvas / Split / Editor / Overlay layouts — plus the panel toggles
  (left / bottom / right). Many of these appear only in **Advanced mode**.
- **Canvas tools** — edit fixtures, snap, grid, tint-by-controller, outlines, **3D mode**, and
  **Preview** (the wall button: it dims the composite so each fixture lights up only with the
  pixels it samples).
- **Guide** (book icon) opens this guide; plus refresh, report-a-bug, and install.

The current build version shows in the **browser tab title** (`LED Zeppelin v1.0.x`).

## The layout

The editor is a three-column **dock** — everything visible at once, splitters resize neighbours:

| Column | Holds |
| --- | --- |
| **Left** | An accordion: **Settings · Composition · Layer · Clip**. One section open at a time (or all folded to header strips). |
| **Centre** | The output **canvas** with the clip/layer **deck** below it. In 3D mode an orbit view with a **Fields** ghost toggle and a reset-view button. |
| **Right** | An accordion: **Library · Output · Sources**. Output is the live device/fixture patch; Library is the template catalog; Sources is the generator palette. |

Selecting a controller, fixture, or library model opens its editor in a small floating panel
over the canvas. See [Fixtures & Inventory](05-fixtures-and-inventory.md) for the
template-vs-device split.

## Loading work

There is no generic Import button — **drag a file onto the window**:

- an **ISF shader** (`.fs` / `.isf` / `.frag` / `.glsl`) → a new generator clip;
- a **LED Zeppelin project** `.json` → loads the rig *and* visuals.

To bring in a **LEDger preset**, use the **Import from LEDger…** button on the top bar (it opens
the Library and walks you through it). See
[Importing from LEDger](09-importing-from-ledger.md).

Save the whole project with ⌘S (open with ⌘O) — both live on the top bar.

New to LED terms? Read [LED control concepts](02-concepts.md). Otherwise jump to
[Getting started](03-getting-started.md).
