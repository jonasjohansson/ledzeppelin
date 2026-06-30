# LED Zeppelin — User Guide

A complete guide to LED Zeppelin, written for people who are **new to LED control**.
It starts with the core ideas, walks you from launch to your first lit pixel, and
then documents every part of the app as a reference.

## Read in order (if you're new)

1. [What is LED Zeppelin](01-what-is-led-zeppelin.md) — what the app is and how it fits together.
2. [LED control concepts](02-concepts.md) — pixels, controllers, protocols, and the device/fixture/template model. **Read this before anything else if the words "DDP", "Art-Net", or "pixel mapping" are new to you.**
3. [Getting started: first light](03-getting-started.md) — install, add a controller, add a fixture, see it light up, save.

## Reference (dip in as needed)

4. [Devices & scanning](04-devices-and-scanning.md) — finding and configuring your controllers.
5. [Fixtures & the Inventory](05-fixtures-and-inventory.md) — defining light shapes, templates, and patching.
6. [The canvas: sources & effects](06-canvas-sources-effects.md) — making the visuals your fixtures sample.
7. [Scenes](07-scenes.md) — saving and recalling looks.
8. [Mappings](08-mappings.md) — controlling the app with MIDI, OSC, or the keyboard.
9. [Importing from LEDger](09-importing-from-ledger.md) — bringing in a rig definition.
10. [Output & calibration](10-output-and-calibration.md) — brightness, colour, and what actually leaves the app.
11. [Deploying the install](11-deploying.md) — running it permanently (Raspberry Pi, packaging).
12. [Troubleshooting & FAQ](12-troubleshooting.md) — common first-run snags.
13. [Glossary & keyboard shortcuts](13-glossary.md) — quick lookups.

## A note on terms

LED Zeppelin separates three ideas that beginners often conflate. Keep them straight
and the whole app gets simpler:

- **Device** = a physical LED controller on your network (e.g. a WLED/QuinLED board).
- **Fixture** = a light *shape* placed on the canvas, mapped to a slice of pixels.
- **Template** = a reusable definition you stamp fixtures/devices from (kept in the Inventory).

The [concepts page](02-concepts.md) explains each in plain language.
