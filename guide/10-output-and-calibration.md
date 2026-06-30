# Output & calibration

What actually leaves the app, how to tune brightness and colour order, and how to watch the result on the canvas.

## The output stream

Every frame, LED Zeppelin renders the composition to one WebGL canvas, then **samples** it: for each fixture it reads the canvas pixels under that fixture's mapped shape, in LED-index order. A strip resamples its polyline evenly; a matrix reads its `cols × rows` block in wiring order. Reversing a fixture flips which physical end is pixel 0.

All sampled pixels from all fixtures are concatenated into one flat RGB buffer and handed to the daemon. The daemon slices each **device**'s bytes out of that buffer and emits packets:

- **DDP** for WLED (the default), to UDP port `4048`.
- **Art-Net** for generic gear (nodes, consoles, PixLite, MadMapper/Resolume), to UDP port `6454`, spanning consecutive universes from the device's base universe. Enable Art-Net **Sync** on the controller model to latch all its universes together tear-free.

The full chain — composite → sample → packetise → send — runs at about **40 fps** (capped at 42; see below). Per-fixture pixel offsets are device-local and reset to 0 per controller, so the daemon addresses each device's slice from DDP offset 0 regardless of where it sits in the flat buffer.

Fixtures with **no device** (or a device that no longer exists) are still sampled so they light up in the Preview, but nothing is sent for them — you can prototype a look before wiring it to hardware.

See [Concepts](02-concepts.md) for the canvas → fixture → device → controller model, and [Devices & scanning](04-devices-and-scanning.md) to add and address controllers.

## Framerate cap & the per-output budget

There are two separate limits — one global, one per output.

**Global cap.** Settings › *output* › **Max FPS** (default 42) caps the whole pipeline's send rate. There's no point rendering or streaming faster than the LEDs can show, so this is the ceiling for DDP and Art-Net alike. Range 1–60.

**Per-output budget.** WS281x-family LEDs clock out at roughly 30 µs per pixel, so a single data line tops out near **830 pixels at 40 fps** (`1 / (40 · 30µs)`). This is the default `maxPerOutput` for QuinLED and generic controller models — it is *not* a board limit (the QuinLED outputs have no hard pixel cap; the real constraint is the ESP's framerate and RAM). It's editable per controller model in the Inventory.

When a single output's pixel run reaches its budget, you'll see a **⚠** badge:

- In the **Devices** panel, the controller's pixel total shows `⚠` when an output is over budget.
- In a fixture's chain/patch inspector, the run shows `… / 830px ⚠ full`, and the "Output →" picker greys out — you can't daisy-chain more pixels onto a full output.

The fix is to split the run across another output or another device. See [Devices & scanning](04-devices-and-scanning.md) and [Fixtures & inventory](05-fixtures-and-inventory.md).

## Brightness (per-device cap)

Each device carries an **output brightness** — a 0–1 cap applied per-frame to our stream, daemon-side, *before* the LEDs. Because it acts on the stream it works for Art-Net too, not just WLED (WLED's own master-brightness write is ignored during realtime streaming).

Set it in the **Devices** panel: each detected WLED controller shows a **Bright** slider (0–100%). Hold Shift while dragging for coarse snapping. This is the right lever for taming a too-bright run or matching one device to another — it does not touch your composition, only what that controller emits.

This is separate from the **Brightness** slider in Settings › *appearance*, which only lifts the UI surface and has nothing to do with output.

## Colour order

Colour order is the physical byte order the strip is wired for (GRB, RGB, BGR, …). It's set per **device** in the Devices panel under **Format** (default GRB) — the common case, since a controller's strips are usually wired alike.

A single fixture can override its controller's order with its own **colour format**, including RGBW variants (set on the fixture; "From controller" inherits the device order). That lets an RGBW strip sit on the same controller as RGB ones. For RGBW/RGBWA output, White is derived as `min(R,G,B)`. See [Fixtures & inventory](05-fixtures-and-inventory.md).

If your colours look swapped (red showing as green, etc.), the device Format is the first thing to check.

## Preview (the wall button)

The **Preview** button in the top bar (labelled *Preview*) turns the canvas into a stand-in for the physical wall. It dims the composite and lights **only each fixture's sampled pixels** at full strength — so where a visual crosses a tube, that tube's pixels glow; everywhere else stays dark context. It's a CSS-only view: the sampler reads the GL canvas regardless, so output to hardware is unaffected.

This is the fastest way to judge what the rig will actually show without standing in front of it. With no fixtures placed there's nothing to light, so the dim is skipped.

![LED Zeppelin Preview view: the canvas dimmed so each fixture's sampled pixels light up](img/output-preview.png)

## Blackout & pausing

**Blackout** holds all output dark while the composition keeps playing, so you can cue and rearrange without lighting the wall. Toggle it with the composition's **B** button — the master mute (bypass): it composites every layer to black, so all devices receive zeros. It's off by default. A separate hard **Panic** (`K`) forces output dark from anywhere, independent of the composition.

A few related behaviours:

- **Hidden fixtures** (eye toggled off) go dark on the wall too: they're still sampled to keep packet indices contiguous, but their bytes are zeroed.
- The **identify** button (Devices panel, WLED only) flashes a controller red so you can locate it on the rig — use it with output paused or blacked out, since live DDP otherwise overrides WLED's own segments.

## Colour calibration — limited today

Calibration is intentionally minimal right now; set expectations accordingly.

- **Gamma** is the one calibration control: a per-device daemon-side LUT (Devices panel, range 0.5–3, default 1 = linear) that straightens LED fades so dims don't crush. It's applied before the LEDs, not to the Preview.
- There is **no per-channel white balance, no colour-temperature match, and no per-device colour correction** beyond gamma + brightness + byte order. Matching the exact colour of mixed LED batches or different strip types is not yet possible in-app.

Workarounds for now: keep each run to one strip type, use per-device **Brightness** to balance levels, set **Gamma** to tame fades, and rely on the device **Format** for correct channel order. Fuller colour/output calibration is on the roadmap.

---

_See also: [Devices & scanning](04-devices-and-scanning.md) · [Fixtures & inventory](05-fixtures-and-inventory.md) · [Concepts](02-concepts.md) · [Troubleshooting](12-troubleshooting.md)._
