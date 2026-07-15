# Output & calibration

What actually leaves the app, how to tune brightness, white and colour order, and how to watch the result on the canvas.

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

**Global cap.** Settings › *output* › **Max FPS** (default 42) caps the whole pipeline's send rate. There's no point rendering or streaming faster than the LEDs can show, so this is the ceiling for DDP and Art-Net alike. Range 1–60. Settings is the top section of the left dock (open it with the ⚙ button in the top bar); the *output* controls are **Advanced-only**, so switch on **Advanced mode** in Settings › *preferences* if you don't see them.

**Per-output budget.** WS281x-family LEDs clock out at roughly 30 µs per pixel, so a single data line tops out near **830 pixels at 40 fps** (`1 / (40 · 30µs)`). This is the default `maxPerOutput` for QuinLED and generic controller models — it is *not* a board limit (the QuinLED outputs have no hard pixel cap; the real constraint is the ESP's framerate and RAM). It's editable per controller model in the **Library** (right dock).

When a single output's pixel run reaches its budget, you'll see a **⚠** badge:

- In the **Output** list, the controller's pixel total shows `⚠` when an output is over budget.
- In a fixture's chain/patch inspector, the run shows `… / 830px ⚠ full`, and the "Output →" picker greys out — you can't daisy-chain more pixels onto a full output.

The fix is to split the run across another output or another device. See [Devices & scanning](04-devices-and-scanning.md) and [Fixtures & the Library](05-fixtures-and-inventory.md).

> **Preview On/Off is a performance lever, not an output one.** Settings › *output* › **Preview** (On by default) toggles whether the on-screen stage draws the full-motion composite at all. Set it **Off** to skip that fullscreen draw — the stage goes dark but **output to hardware keeps running** unchanged. Use it to lighten the load on a Raspberry Pi install or stop VNC from mirroring the whole animated stage (equivalently, `?preview=0` in the URL). Don't confuse it with the output-preview *view* button below.

## Brightness (per-device cap)

Each device carries an **output brightness** — a 0–1 cap applied per-frame to our stream, daemon-side, *before* the LEDs. Because it acts on the stream it works for Art-Net too, not just WLED (WLED's own master-brightness write is ignored during realtime streaming).

Select the controller in the **Output** list (right dock) — its editor pops up over the canvas — and use the **Bright** slider (0–100%) in the controller's live-status block. Hold Shift while dragging for coarse snapping. The slider surfaces on **detected WLED controllers**; Art-Net nodes don't show live status, but the brightness cap still applies to their stream. This is the right lever for taming a too-bright run or matching one device to another — it does not touch your composition, only what that controller emits.

This is separate from the **Brightness** slider in Settings › *appearance*, which only lifts the UI surface and has nothing to do with output.

## Colour order

Colour order is the physical byte order the strip is wired for (GRB, RGB, BGR, …). It's set per **device** in the device editor under **Order** (default GRB) — the common case, since a controller's strips are usually wired alike. Open it by selecting the controller in the **Output** list; the editor floats over the canvas.

A single fixture can override its controller's order with its own **colour format** (set on the fixture; "From controller" inherits the device order), including RGBW and amber (RGBW/RGBWA) variants. That lets an RGBW strip sit on the same controller as RGB ones — when any fixture pins its own format, the device **Order** notes `· order set per-fixture` and only acts as the fallback for the rest. See [Fixtures & the Library](05-fixtures-and-inventory.md).

If your colours look swapped (red showing as green, etc.), the device **Order** is the first thing to check.

## White (RGBW derivation)

Strips with a dedicated white LED need a rule for how much of a colour to route to that W channel. LED Zeppelin derives white from the shared minimum, `W = min(R, G, B)`, and Settings › *output* › **White Mode** (Advanced-only) picks what happens to the RGB afterwards:

| Mode | What it does | Use when |
|------|--------------|----------|
| **Accurate** *(default)* | Pulls the white out of RGB — subtracts `W` from each of R, G, B and sends it on the W LED. Neutral tones render as clean white, not a muddy RGB mix. | You want faithful colour and a real white point. |
| **Additive** | Keeps RGB at full and adds `W` on top. Brighter, punchier, but whites lean toward the RGB emitters' tint. | You want maximum output and don't mind a warmer/cooler cast. |

White Mode is global (it applies to every RGBW/RGBWA fixture in the show) and is pushed straight to the daemon when you change it. Whether a given fixture *has* a white channel is decided by its colour format (a GRBW device order, or a per-fixture RGBW format); see [Colour order](#colour-order) above.

## Output preview (the wall view)

The **output-preview** button in the top bar (the broadcast/wall icon) turns the canvas into a stand-in for the physical wall. It dims the composite and lights **only each fixture's sampled pixels** at full strength — so where a visual crosses a tube, that tube's pixels glow; everywhere else stays dark context. It's a CSS-only view: the sampler reads the GL canvas regardless, so output to hardware is unaffected.

This is the fastest way to judge what the rig will actually show without standing in front of it. With no fixtures placed there's nothing to light, so the dim is skipped.

![LED Zeppelin output-preview view: the canvas dimmed so each fixture's sampled pixels light up](img/output-preview.png)

## Blackout & pausing

**Blackout** holds all output dark while the composition keeps playing, so you can cue and rearrange without lighting the wall. Toggle it with the composition's **B** button — the master mute (bypass) on the deck's master row: it composites every layer to black, so all devices receive zeros. It's off by default. A separate hard **Panic** (`K`) forces output dark from anywhere, independent of the composition, and raises a **PANIC** HUD in the corner so the operator always knows the live state.

A few related behaviours:

- **Hidden fixtures** (eye toggled off) go dark on the wall too: they're still sampled to keep packet indices contiguous, but their bytes are zeroed.
- The **identify** button (device editor, WLED only) flashes a controller red so you can locate it on the rig — use it with output paused or blacked out, since live DDP otherwise overrides WLED's own segments.

## Colour calibration — limited today

Calibration is intentionally minimal right now; set expectations accordingly.

- **Gamma** is the one calibration control: a per-device daemon-side LUT (device editor, Advanced-only, range 0.5–3, default 1 = linear) that straightens LED fades so dims don't crush. It's applied before the LEDs, not to the Preview.
- There is **no per-channel white balance, no colour-temperature match, and no per-device colour correction** beyond gamma + brightness + white mode + byte order. Matching the exact colour of mixed LED batches or different strip types is not yet possible in-app.

Workarounds for now: keep each run to one strip type, use per-device **Brightness** to balance levels, pick the right **White Mode** for RGBW strips, set **Gamma** to tame fades, and rely on the device **Order** for correct channel order. Fuller colour/output calibration is on the roadmap.

---

_See also: [Devices & scanning](04-devices-and-scanning.md) · [Fixtures & the Library](05-fixtures-and-inventory.md) · [Concepts](02-concepts.md) · [Troubleshooting](12-troubleshooting.md)._
