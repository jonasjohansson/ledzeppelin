# LED Zeppelin — User Guide

A complete guide to LED Zeppelin, written for people who are **new to LED control**.
It starts with the core ideas, walks you from launch to your first lit pixel, and
then documents every part of the app as a reference.

LED Zeppelin is a **dark, single-window app** that runs in a browser or as a
packaged desktop build. You design light on a canvas, and each fixture samples the
pixels underneath it and sends them to your controllers over the network. No
timeline to render, no export step — what you see is what leaves the app, live.

## At a glance

The screen has two parts:

- A **top bar** of icon tools across the top — project (new / open / save), Settings,
  Lock, the Library, LEDger import, mappings, the phone remote, plus view toggles
  (2D/3D, snap, grid, output preview) and help.
- A **three-column workspace** below it:
  - **Left** — a stack of panels that follow your selection: **Settings ·
    Composition · Layer · Clip** (one open at a time; click the open header to fold
    them all away).
  - **Centre** — the **stage** (your canvas / output preview) above the **clip
    timeline**.
  - **Right** — **Library · Output · Sources**. Output is the live list of your
    controllers and fixtures; Library is the reusable templates; Sources is the
    palette of visuals you drop onto the canvas.

Selecting a controller, a fixture, or a template opens its editor in a small
floating panel over the canvas. The full screen tour is on the
[first page](01-what-is-led-zeppelin.md).

## Read in order (if you're new)

1. [What is LED Zeppelin](01-what-is-led-zeppelin.md) — what the app is and how it fits together.
2. [LED control concepts](02-concepts.md) — pixels, controllers, protocols, and the device/fixture/template model. **Read this before anything else if the words "DDP", "Art-Net", or "pixel mapping" are new to you.**
3. [Getting started: first light](03-getting-started.md) — install, add a controller, add a fixture, see it light up, save.

## Reference (dip in as needed)

4. [Devices & scanning](04-devices-and-scanning.md) — finding, adding, and configuring your controllers in the Output panel.
5. [Fixtures & the Library](05-fixtures-and-inventory.md) — defining light shapes, editing reusable templates, and patching pixels to devices.
6. [The canvas: sources & effects](06-canvas-sources-effects.md) — building the visuals your fixtures sample, in 2D or 3D.
7. [Scenes](07-scenes.md) — saving and recalling looks.
8. [Mappings](08-mappings.md) — controlling the app with MIDI, OSC, or the keyboard.
9. [Importing from LEDger](09-importing-from-ledger.md) — bringing in a rig definition with the top-bar **Import from LEDger…** button.
10. [Output & calibration](10-output-and-calibration.md) — brightness, contrast, colour order, and what actually leaves the app.
11. [Deploying the install](11-deploying.md) — running it permanently (Raspberry Pi, packaging).
12. [Troubleshooting & FAQ](12-troubleshooting.md) — common first-run snags.
13. [Glossary & keyboard shortcuts](13-glossary.md) — quick lookups.

## Two example projects to start from

The app ships with two ready-made projects (open them from **New / Open**):

- **Balena Voladora** — a winged 3D rig on two DigOcta controllers (tail, twelve ribs,
  a spline, and two fins) in SK6812 RGBW.
- **Kagora** — the full 3D install: twelve DigQuad controllers driving 120 WS2815 tubes
  standing as arches (~31,800 pixels). Assign the controller IPs after loading.

Both are good places to poke around before wiring your own hardware.

## A note on terms

LED Zeppelin separates three ideas that beginners often conflate. Keep them straight
and the whole app gets simpler:

- **Device** = a physical LED controller on your network (e.g. a WLED/QuinLED board). Live devices live in the **Output** panel.
- **Fixture** = a light *shape* placed on the canvas, mapped to a slice of a device's pixels.
- **Template** = a reusable definition you stamp fixtures/devices from, kept in the **Library** panel (edit a template and the change fans out to everything based on it).

The [concepts page](02-concepts.md) explains each in plain language.
