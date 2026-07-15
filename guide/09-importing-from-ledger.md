# Importing from LEDger

LEDger is the sibling rig-design tool. You lay out the physical install there —
controllers, LED tubes/strips, and the wiring between them — and export it as a
**preset** file. LED Zeppelin imports that preset and turns it into a live rig:
a **device** per controller and a **fixture** per tube, already wired into the
right output ports and pixel ranges, ready to light.

This page covers what comes across, where to trigger the import, how to assign
controller IPs, and the two rules worth remembering — the import **replaces** your
rig (it is not additive) and it is **undoable** with ⌘Z.

![The Library, where the LEDger importer renders](img/inventory.png)

## What a LEDger preset contains

A preset describes the rig, not the visuals:

- **Controllers** → become **devices** (one per controller). The importer keeps
  only controllers that actually drive at least one tube.
- **Tubes / strips** → become **fixtures**, each with its real pixel count and
  colour order from LEDger.
- **Wiring** → the data edges (controller output → first tube → next tube …) set
  each fixture's output **port** and its position in the daisy chain, which in turn
  fixes the contiguous pixel range on that device.
- **Geometry** → each tube's points become a bar (straight runs) or polyline
  (bent runs) on the canvas, and the canvas is sized to the rig's footprint so the
  layout isn't stretched.

A LEDger **fixture type** is created per tube definition in use, so imported tubes
show up in the [Library](05-fixtures-and-inventory.md) with their correct pixel
counts and you can duplicate from them later.

The import is **balanced and limited by what LEDger exports**. Only `strip` and
`controller` instances are imported — anything else (PSUs, decorations, etc.) is
ignored, and you'll see a note saying how many were skipped. If a tube isn't wired
to any controller it still comes in, as an **unassigned** fixture, so the count
reconciles instead of silently dropping it.

## Triggering the import

Import lives on the **top bar**: press the **Import from LEDger…** button (the
`import` icon, between _New project_ and the _Mapping_ button). It opens the
**Library** (the right-sidebar section) and immediately shows the file picker —
choose the exported `.json` preset.

The preview, warnings, assign-IPs and apply UI all render **inside the Library
section** while an import is in progress; there is no always-visible import panel,
so if you dismiss an import the section returns to its normal fixture/controller
catalog.

You can also **drag the preset onto the LED Zeppelin window**. Because a LEDger
preset is a rig (not a project or composition), dropping it doesn't load anything
directly — it shows the hint:

> That looks like a LEDger preset — import it from the Library window.

So either the drop reminds you of, or you go straight to, the same place: the
top-bar **Import from LEDger…** button.

> Other drops behave differently: a project `.json` loads rig + visuals, a
> composition `.json` loads visuals only, an ISF shader (`.fs`/`.isf`/`.frag`/`.glsl`)
> becomes a new generator clip, and a 3D model (`.obj`) imports as a rig — see
> [Import from 3D (OBJ)](#import-from-3d-obj) below.
> See also [Canvas: sources & effects](06-canvas-sources-effects.md).

## Preview and warnings

Once a preset loads, the importer shows a **preview** before anything changes:

- a one-line summary — `N controller(s) · M fixture(s) · total px · canvas W×H`
- a per-controller breakdown — name, output count, total pixels, fixture count
- an **unassigned** line if any tubes came in unwired

Any **warnings** appear here too: a tube with a missing type (it falls back to a
default pixel count so it stays addressable), a tube that fans out to several tubes
(one branch is kept, the rest are dropped with a note), an unwired tube, or ignored
instance kinds. Read these — they tell you exactly what the importer did and didn't
model.

> A structurally valid preset that yields no controllers **and** no fixtures is a
> no-op: the importer says _"Nothing to import — this file has no controllers or
> strips,"_ and there is nothing to apply.

## Assigning controller IPs

LEDger doesn't carry network addresses, so every imported device starts with a
**blank IP**. The importer's **assign controller ips** panel gives you one row per
device — name, IP field, and colour order — plus a sequential **auto-fill**:

1. Type a **base IP** (e.g. `192.168.1.50`).
2. Click **auto-fill sequential** to fill every device row from that base, counting
   up.

A status line tracks `N of M controller(s) need a valid IP`, and **apply import**
stays disabled until every device has a valid IPv4 address. If the address range
runs out before all devices are filled, the importer tells you which controller it
stopped at.

You don't have to use auto-fill — edit any row by hand. Colour order is pre-set per
device from the first tube on it, and you can override it here too.

> **Heads-up:** if you've typed IPs and then re-open the file picker, drop a new
> preset, or cancel, the importer asks before discarding them — and it warns on
> window close too. Nothing is lost silently.

### IPs carry across re-import

If you re-import the same rig (id-for-id) after editing it in LEDger, the importer
**carries forward the IP and colour order** from each matching device already in
your live rig. Addressing a rig once means a re-import doesn't blank it — you only
re-confirm. (Auto-fill won't clobber those carried-over addresses; it only runs on
open for a fresh rig where no device has an IP yet.)

## Applying — it replaces the rig, and it's undoable

Pressing **apply import** first validates the imported rig, then asks you to confirm
the **rig replace**:

> Replace your current rig (X controllers, Y fixtures) with the imported one
> (N controllers, M fixtures)? Your layers & clips are kept; the canvas becomes
> W×H. You can undo this (⌘Z).

Two things to be clear on:

- **It replaces, it is not additive.** Every existing **device** and **fixture** is
  swapped out for the imported rig. To merge two rigs, import the combined layout
  from LEDger rather than importing twice.
- **Your visuals are kept.** Layers and clips stay as they are; only the rig and the
  **canvas size** are adopted (the canvas matches the rig's aspect so the layout
  isn't squished).

The import commits through the same path as any fixture edit — it saves, rebuilds
the sampler/route/output bridge, and refreshes the panels — so the canvas overlay,
the [Output](04-devices-and-scanning.md) list, and the rest of the UI all update at
once.

A successful import is a **single undoable step**: press **⌘Z** to restore your prior
rig and composition. A persistent banner confirms what landed —
`Imported N controllers, M fixtures (total px). Rig replaced — ⌘Z to undo.`

## Import from 3D (OBJ)

If your rig lives in a 3D tool (Blender, Cinema 4D, Rhino, Fusion…) rather than
LEDger, you can bring it in as a Wavefront **`.obj`**. Each named object becomes a
fixture, with its LED data carried in the **object's name** using `__key=value`
tokens:

| Token | Required | Meaning |
| --- | --- | --- |
| `leds=N` | **yes** | pixel count on that run (a run with no `leds=` is skipped) |
| `lpm=N` | no | LEDs per metre (density); default `60` |
| `order=RGB` | no | colour order; a 4-letter value like `GRBW` is treated as a white/amber colour **format** |
| `out=dev.port` | no | wire the run to controller `dev`, output `port` (runs sharing a port daisy-chain in file order) |
| `dir=rev` | no | reverse the point order (pixel 0 at the other end) |

So a run named `Spine__leds=120__order=GRBW__out=quinA.0` is a 120-pixel GRBW run on
controller `quinA`, output 0.

To import: **export your model as OBJ, Y-up** (each run as its own object, and use a
polyline / edge path so the point order matches the pixel order), then **drag the
`.obj` onto the LED Zeppelin window**. It's applied like opening a project — a device
per `dev`, a fixture per run, sized to the model's footprint. Any skipped runs or
notes appear in an **imported with notes** dialog. See `test/fixtures/whale-sample.obj`
for a minimal example.

> The OBJ path reuses the same rig-building pipeline as LEDger import, so it also
> replaces the current rig and adopts the model's footprint as the canvas. It does
> **not** stop for the assign-IPs panel — put addresses on with `out=dev.port` and
> then set device IPs in [Output](04-devices-and-scanning.md).

## After import

The imported devices still need to reach their controllers on the network. Head to
the [Output](04-devices-and-scanning.md) panel to verify each device's IP, scan,
and identify, then use [Output & calibration](10-output-and-calibration.md) and the
**Preview** wall button to confirm pixels light where you expect.

_See also: [Fixtures & the Library](05-fixtures-and-inventory.md) ·
[Devices & scanning](04-devices-and-scanning.md) ·
[Output & calibration](10-output-and-calibration.md)._
</content>
</invoke>
