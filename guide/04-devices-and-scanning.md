# Devices & scanning

Finding and configuring the physical controllers that drive your LEDs. A **device** (or
**controller**) is a physical box — WLED/QuinLED, or a generic Art-Net node; a **fixture** is
a mapped light shape on the canvas; a **model/template** is a reusable definition in the
[Library](05-fixtures-and-inventory.md). This page covers the **Output** panel, finding
controllers by scanning or adding them from a template, and the per-device settings.

![The Output panel](img/devices.png)

## The Output panel

**Output** is one of the three stacked sections in the **right dock column** (the
`#grp-patch` accordion: **Library · Output · Sources**). Only one of the three is open at a
time; Output is open by default. It is the live device/fixture patch — the actual controllers
in your rig, each shown as a section with its assigned fixtures as rows beneath.

Inside Output, every controller section is **always expanded** — there is no per-controller
fold. A persistent **Unassigned** heading sits at the bottom of the list; drop a fixture
there to detach it from any controller.

Each controller header shows:

- A **status dot**, then the **Name** (uppercase) — see [Status dot](#status-dot) below.
- A **colour swatch** — the controller's identity colour (used by the canvas Tint mode and
  the fixture row bars); editable in the device editor.
- A **pixel badge**, e.g. `512px`, with a **⚠** appended when any one of its outputs is over
  budget — see [Pixel budget](#pixel-budget) below.

Click a controller header to select it and open its editor (a floating popup — see
[Per-device settings](#per-device-settings)). Click a fixture row to select just that
fixture. Drag a fixture row onto a controller header to **assign** it to that controller (a
multi-output controller tags each row with its output, so you can target a specific output);
drag onto **Unassigned** to detach it. Selecting two or more fixtures reveals a
**⛓ chain (same output)** button that puts them all on one shared output as a daisy-chain.

### Header buttons

The **Output** section header carries three labelled buttons (no big in-list toolbar):

- **+ Controller** — opens a controller-model picker; pick a model (shown with its output
  count, e.g. `DigQuad`) or **Blank** to add a new controller. See
  [Adding a controller from a template](#adding-a-controller-from-a-template).
- **+ Fixture** — opens a fixture-template picker; pick a template (or **Blank**) to place a
  new fixture. See [Fixtures & the Library](05-fixtures-and-inventory.md).
- **Scan** — probes the LAN for controllers. See [Scanning the network](#scanning-the-network).

The fixture and controller **templates** themselves live in the **Library** section (the
accordion tab just above Output), not here — Output is live instances, Library is the
template catalog.

## Scanning the network

The **Scan** button on the Output header probes the LAN for controllers using two probes in
parallel:

- **WLED subnet sweep** — finds WLED/QuinLED controllers and reports their LED count.
- **Art-Net ArtPoll** — finds generic Art-Net nodes.

While scanning, a live progress block appears under the list: a spinner with **Scanning…**,
then one line per probe that flips to a **✓** with a count (e.g. `2 found`) as each leg
finishes independently. The two probes resolve on their own, so you may see one complete
before the other. The results collect at the bottom of the list under their own **Scan**
heading.

Scanning needs the output daemon running. With no daemon the **Scan** button is disabled and
its tooltip tells you to start it (`npm start`) — see [Deploying](11-deploying.md).

### Adding a found controller

Each result row shows the controller name, its IP, and a pixel count (WLED) or its long name
(Art-Net):

- **add** — adds the controller to your rig in one click, selected and ready to edit.
  - **WLED** controllers are added with the **DigQuad** model (or the first available model),
    **DDP** protocol, port 4048, and GRB colour order.
  - **Art-Net** nodes are added with the **Generic** model, **Art-Net** protocol, port 6454,
    base universe 0, and GRB colour order.
- **+ outputs** (WLED only) — adds the controller **and** a fixture per configured LED
  output. It reads the controller's bus config over the daemon, skips empty (length-0)
  outputs, picks the matching QuinLED model by bus count, copies each output's colour order,
  and lays each output out as a horizontal bar sized to its pixel count. Use this to bootstrap
  a rig straight from a controller that's already configured.

A row already in your rig (matching IP) shows a **✓** and is disabled — it cannot be added
twice.

## Adding a controller from a template

Use the **+ Controller** header button when you are building a rig offline or have hardware
that won't answer a scan. Pick a controller model from the menu (or **Blank**, which stamps
the always-present Generic model). The new controller is added with a unique name, selected,
and ready to edit — set its IP afterwards. Controller models live in the
[Library](05-fixtures-and-inventory.md); editing a model there propagates its output count
and budget to every controller that uses it, but per-unit facts (name, IP, colour order,
brightness) stay on the device.

To multiply a controller, **duplicate** it (each copy owns its own settings). Selecting more
than one controller or fixture bulk-edits them: shared values show normally, differing
("mixed") values are dimmed, and editing a field writes to all selected.

## Per-device settings

Selecting a controller opens its editor in a **floating popup** (`#device-pop`) that appears
over the canvas where you clicked. Its own **Name** field identifies the selection:

- **Name** — the controller's label in the list.
- **IP** — the controller's address. The field flags a malformed IPv4 with a red border. The
  **↗** opens the controller's own WLED web UI at `http://<ip>` (disabled until an IP is set).
- **Model** — the controller model (from the Library). Drives the **Outputs** count, shown
  read-only as `N (from model)`.
- **Protocol** — **DDP (WLED)** or **Art-Net**. Switching also resets the port to that
  protocol's default (4048 for DDP, 6454 for Art-Net).
- **Universe** (Art-Net only) — the base universe; the controller's pixels occupy consecutive
  universes from it. A hint shows the span (170 px per universe).
- **Order** — the colour byte order (RGB / GRB / RGBW, etc.) matching how the strip is wired.
  A fixture on this device can pin its own format (RGBW on an RGB controller, etc.); when any
  does, a "· order set per-fixture" hint appears and this order is only the fallback for the
  rest.
- **Color** — the controller's identity colour (the swatch in the Output list and the canvas
  Tint mode); auto-assigned on creation, override it here.
- **Gamma** *(Advanced)* — a daemon-side gamma LUT that straightens LED fades (1 = linear).
- **Patch ruler** *(Advanced)* — proportional segments of the controller's pixel address
  space, one per fixture in offset order, so you can see each fixture's slice at a glance.

### Brightness, identify, status

For an online WLED controller, an extra control block appears (Art-Net nodes and
undetected/offline controllers show nothing here, since they have no WLED JSON API):

- **Bright** — an output brightness cap (0–100%) applied per-frame to our stream daemon-side,
  so it works for Art-Net too.
- **check** — re-reads live status from the controller.
- **identify** — flashes the controller red so you can locate it on the rig. Works best with
  output paused or blacked out, since live DDP overrides WLED's own segments.
- **reboot** — restarts the controller (after a confirm). Output to it drops for about 10s
  while it cycles, and its status goes unknown until the next check.
- **save to device** — writes each output's LED count + colour order into WLED's own config
  (and sets the controller's default colour), so the hardware matches your rig.

### Status dot

The dot on each controller header reflects its last health check:

- **online** — a WLED controller answered.
- **offline** — it didn't answer.
- **checking…** — a probe is in flight (or status is unknown).
- **no IP set** — no IP to probe.
- **Art-Net node** — Art-Net devices have no WLED API, so they are never polled (this avoids
  a false "offline").

Controllers with an IP are auto-checked once when the daemon is up, so the dots reflect real
online/offline state without opening each one. A resolved check repaints just that dot in
place — it never rebuilds the list mid-show.

## Pixel budget

Every controller output has a pixel budget — the practical limit at which it can still hold a
smooth frame rate. The default is **830 px/output ≈ 40 fps** for WS281x-family strips,
editable per controller model in the Library.

The header badge totals the controller's patched pixels (e.g. `512px`). When any single
output exceeds its budget, a **⚠** is appended to the badge and the badge is flagged; the
badge's tooltip breaks the load down per output (`out 1: 512/830px …`). In a fixture's chain
editor the per-output readout shows `runPx/cap px`, and a full output reads **⚠ full** —
extending its chain past the cap is blocked. Stay under budget, or split the load across more
outputs (a QuinLED DigQuad has 4) to keep frame rate up.

---

_See also: [Concepts](02-concepts.md), [Getting started](03-getting-started.md),
[Fixtures & the Library](05-fixtures-and-inventory.md),
[Output & calibration](10-output-and-calibration.md),
[Troubleshooting](12-troubleshooting.md)._
