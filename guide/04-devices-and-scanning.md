# Devices & scanning

Finding and configuring the physical controllers that drive your LEDs. A **device** is a
physical controller (WLED/QuinLED or a generic Art-Net node); a **fixture** is a mapped
light shape on the canvas; a **template** is a reusable definition in the
[Inventory](05-fixtures-and-inventory.md). This page covers the **Devices** panel, finding
controllers by scanning or adding them from a template, and the per-device settings.

![The Devices panel](img/devices.png)

## The Devices panel

The Devices panel lists every controller as an always-expanded section, with its assigned
fixtures as rows beneath. Controllers stay open — there is no fold/collapse. A persistent
**Unassigned** group sits at the bottom; drop a fixture there to detach it from any
controller.

Each controller header shows:

- **Name** (uppercase) and a **status dot** — see [Status dot](#status-dot) below.
- A **pixel budget badge**, e.g. `512px`, with a **⚠** appended when one of its outputs is
  over budget — see [Pixel budget](#pixel-budget) below.

Click a controller header to select it and open its settings editor in the sidebar. Click a
fixture row to select just that fixture. Drag a fixture row onto a controller header to
**assign** it to that controller (drag onto an output-tagged group to target a specific
output); drag onto **Unassigned** to detach it.

### Header icons

The panel header (titled **Devices**) carries three small icons — there are no large
"+ Fixture / + Device" buttons:

- **add-fixture** — opens a template picker; pick a fixture template (or **Blank**) to place
  a new fixture. See [Fixtures & Inventory](05-fixtures-and-inventory.md).
- **add-device** — opens a controller-template picker; pick a controller model (shown with
  its output count, e.g. `DigQuad (4 out)`) or **Blank** to add a new controller.
- **inventory** — opens the [Inventory](05-fixtures-and-inventory.md) tab, where the fixture
  and controller **templates** live.

## Scanning the network

The **⌖ scan** button sits under the device list. It probes the LAN for controllers using
two probes in parallel:

- **WLED subnet sweep** — finds WLED/QuinLED controllers and reports their LED count.
- **Art-Net ArtPoll** — finds generic Art-Net nodes.

While scanning, a live progress block appears: a spinner with **Scanning…**, then one line
per probe that flips to a **✓** with a count (e.g. `2 found`) as each leg finishes
independently. The two probes resolve on their own, so you may see one complete before the
other.

Scanning needs the daemon running. With no daemon the **⌖ scan** button is disabled and its
tooltip says to start it (`npm start`) — see [Deploying](11-deploying.md).

### Adding a found controller

Each result row shows the controller name, its IP, and a pixel count (WLED) or its long
name (Art-Net). Click **add** to add it to your rig in one click:

- **WLED** controllers are added with the DigQuad model (or the first available model),
  **DDP** protocol, port 4048, and GRB colour order.
- **Art-Net** nodes are added with the Generic model, **Art-Net** protocol, port 6454, base
  universe 0, and GRB colour order.

The controller appears in the device list immediately and is selected for editing. A row
already in your rig (matching IP) shows a **✓** and is disabled — it cannot be added twice.

## Adding a controller from a template

Use the **add-device** header icon when you are building a rig offline or have hardware that
won't answer a scan. Pick a controller model from the menu (or **Blank**, which stamps the
always-present Generic model). The new controller is added with a unique name, selected, and
ready to edit — set its IP afterwards. Controller models live in the
[Inventory](05-fixtures-and-inventory.md); editing a model there propagates its output count
and budget to every controller that uses it, but per-unit facts (name, IP, colour order,
brightness) stay on the device.

To multiply a controller, **duplicate** it (each copy owns its own settings). Selecting more
than one controller or fixture bulk-edits them: shared values show normally, differing
("mixed") values are dimmed, and editing a field writes to all selected.

## Per-device settings

Selecting a controller opens its editor in the sidebar:

- **Name** — the controller's label in the list.
- **IP** — the controller's address. The field flags a malformed IPv4 with a red border. The
  **↗** opens the controller's own WLED web UI at `http://<ip>` (disabled until an IP is
  set).
- **Model** — the controller model (from the Inventory). Drives the **Outputs** count, shown
  read-only as `N (from model)`.
- **Protocol** — **DDP (WLED)** or **Art-Net**. Switching also resets the port to that
  protocol's default (4048 for DDP, 6454 for Art-Net).
- **Universe** (Art-Net only) — the base universe; the controller's pixels occupy consecutive
  universes from it. A hint shows the span (170 px per universe).
- **Format** — the colour byte order (RGB / GRB / RGBW, etc.) matching how the strip is
  wired.
- **Gamma** — a daemon-side gamma LUT that straightens LED fades (1 = linear).
- **Patch ruler** — proportional segments of the controller's pixel address space, one per
  fixture in offset order, so you can see each fixture's slice at a glance.

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
online/offline state without opening each one.

## Pixel budget

Every controller output has a pixel budget — the practical limit at which it can still hold
a smooth frame rate. The default is **830 px/output ≈ 40 fps** for WS281x-family strips,
editable per controller model in the Inventory.

The header badge totals the controller's patched pixels (e.g. `512px`). When any single
output exceeds its budget, a **⚠** is appended to the badge and the badge is flagged. In a
fixture's chain editor the per-output readout shows `runPx/cap px`, and a full output reads
**⚠ full** — extending its chain past the cap is blocked. Stay under budget, or split the
load across more outputs (a QuinLED DigQuad has 4) to keep frame rate up.

---

_See also: [Concepts](02-concepts.md), [Getting started](03-getting-started.md),
[Fixtures & Inventory](05-fixtures-and-inventory.md),
[Output & calibration](10-output-and-calibration.md),
[Troubleshooting](12-troubleshooting.md)._
