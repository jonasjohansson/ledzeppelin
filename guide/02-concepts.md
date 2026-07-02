# LED control concepts

This page explains the ideas LED Zeppelin is built on. If you're new to addressable LED,
read it once and the rest of the app will make sense. Nothing here is specific to LED
Zeppelin until the last section — these are the fundamentals of pixel control.

## Pixels and strips

**Addressable LED** is made of **pixels** — tiny lights you can set to any colour
*individually*. A **strip** is a line of pixels (e.g. "60 pixels per metre"); a **matrix**
or **panel** is a grid of them. Each pixel is usually RGB (red/green/blue), and some are
RGBW (with a white channel).

The number that matters most is the **pixel count** — how many individually-addressable
lights a fixture has. A 2-metre strip at 60 px/m has 120 pixels.

> **Colour order.** Strips don't all expect colours in the same order — some want RGB,
> many WLED strips want **GRB**. If your reds and greens look swapped, the colour order is
> wrong. You set this per device (see [Devices](04-devices-and-scanning.md)).

## Controllers (devices)

Pixels can't talk to the network by themselves. A **controller** is the small board that
receives data over Wi-Fi/Ethernet and drives the physical pixels. Common ones:

- **WLED** — popular open-source controller firmware (runs on ESP32 boards).
- **QuinLED** — a family of well-built ESP32 boards that run WLED. LED Zeppelin's target
  install uses several QuinLED boards. A board like a **QuinLED DigQuad** has **4 outputs**,
  meaning four separate strips can plug into one controller.

A controller has an **IP address** on your network (e.g. `192.168.1.50`). LED Zeppelin
finds controllers by **scanning** the network, or you add them by IP.

In LED Zeppelin a controller is called a **device**.

## Protocols: how data reaches the controller

A **protocol** is the "language" used to send pixel data over the network. LED Zeppelin
speaks two:

- **DDP** (Distributed Display Protocol) — the simple, efficient choice for **WLED**
  controllers. Used by default.
- **Art-Net** — a widely-supported lighting protocol, for nodes that aren't WLED (Digidot,
  PixLite, generic Art-Net gear). Art-Net organises data into **universes**.

### Universes (Art-Net only)

Art-Net carries data in blocks called **universes**. One universe holds 512 channels =
170 RGB pixels (170 × 3 = 510). A fixture bigger than that spans **consecutive universes**.
With DDP you rarely think about universes; with Art-Net you set a **base universe** per
device — that's just the *starting* universe number for that controller; its pixels fill that
universe and then the next ones in order. If your first 170 pixels work and the rest are dark,
suspect a universe mismatch.

## Pixel mapping (the core idea)

This is the concept that ties the whole app together.

LED Zeppelin draws moving visuals on a flat **canvas** (like a video frame). You then place
each physical light onto that canvas as a shape. Wherever you put it, the light **samples**
the colours under it and sends them to the real pixels. Move a strip to the left edge and
it shows whatever is happening at the left of your visuals.

So you're not programming each pixel by hand — you're arranging your lights inside a picture
and letting them pick up colour from it. That arrangement is called the **mapping**.

## The three things you'll work with

LED Zeppelin keeps three ideas separate. Beginners often blur them; keeping them distinct is
the key to the interface:

| Term | What it is | Real-world analogy |
|------|-----------|--------------------|
| **Device** | A physical controller on your network (WLED/QuinLED/Art-Net node). Has an IP, outputs, a colour order. | The power/data box on the wall. |
| **Fixture** | A light *shape* on the canvas, with a pixel count and a position. It **samples** the canvas and is **patched** to a device's output. | A specific strip, hung in a specific place. |
| **Template** | A reusable definition you stamp new fixtures/devices from (e.g. "2 m strip, 120 px, GRB"). Lives in the **Library**. Editing a template never changes lights you've already placed. | A cut-list spec you build many identical strips from. |

A typical flow: define a **template** once → **stamp** several standalone **fixtures** from
it → place each fixture on the canvas → **patch** each to an output on a **device**. Once
placed, every fixture is independent — you can resize or re-patch one without touching the
others.

## Patching: fixtures → device outputs

**Patching** means telling the app which device output a fixture is wired to, and in what
order. A controller's pixels are one continuous address space per output; LED Zeppelin packs
your fixtures into that space automatically in the order they're listed, so you don't hand-
enter pixel offsets. You just say "this fixture is on DigQuad #1, output 2" and the app works
out the addresses.

## Quick glossary

- **Pixel** — one individually-addressable LED.
- **Pixel count** — how many pixels a fixture has.
- **Device / controller** — the hardware that drives pixels (WLED/QuinLED/Art-Net node).
- **Fixture** — a mapped light shape on the canvas.
- **Template** — a reusable fixture/device definition in the Library.
- **DDP / Art-Net** — protocols for sending pixel data.
- **Universe** — a 512-channel block in Art-Net (~170 RGB pixels).
- **Colour order** — the byte order a strip expects (RGB, GRB, RGBW…).
- **Mapping** — how fixtures are arranged on the canvas to sample visuals.
- **Patching** — wiring a fixture to a device output.

Next: [Getting started](03-getting-started.md).
