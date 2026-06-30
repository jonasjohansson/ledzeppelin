# Output & calibration

> **Status: outline — draft in progress.** What actually leaves the app and how to tune it.

## What this page will cover
- The output stream: per-fixture sampling → per-device packets (DDP/Art-Net) at ~40 fps.
- **Brightness** (per-device cap applied on our stream, so it works for Art-Net too).
- **Colour order** recap and where to set it.
- **Output preview / overlay** — dim the composite so fixtures' pixels show what they sample.
- **Blackout** / pausing output.
- **Known gap:** colour and output calibration are limited today (on the roadmap) — set
  expectations and note current workarounds.

_See also: [Devices](04-devices-and-scanning.md), [concepts: protocols](02-concepts.md)._
