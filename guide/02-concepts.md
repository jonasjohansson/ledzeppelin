# LED control concepts

This page explains the ideas LED Zeppelin is built on. If you're new to addressable LED,
read it once and the rest of the app will make sense. Nothing here is specific to LED
Zeppelin until the later sections — the first half is just the fundamentals of pixel control.

## Pixels and strips

**Addressable LED** is made of **pixels** — tiny lights you can set to any colour
*individually*. A **strip** is a line of pixels (e.g. "60 pixels per metre"); a **matrix**
or **panel** is a grid of them. Each pixel is usually RGB (red/green/blue), and some are
RGBW (with a dedicated white channel).

The number that matters most is the **pixel count** — how many individually-addressable
lights a fixture has. A 2-metre strip at 60 px/m has 120 pixels.

> **Colour order.** Strips don't all expect colours in the same order — some want RGB,
> many WLED strips want **GRB**. If your reds and greens look swapped, the colour order is
> wrong. You set it per device, and can override it per fixture (see
> [Devices](04-devices-and-scanning.md) and [Output & calibration](10-output-and-calibration.md)).

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

## The daemon: what actually sends the light

A web browser can't send raw network packets, so LED Zeppelin comes in **two halves** — the
**editor** (the page you design in) and a small local **daemon** that does the talking to
hardware. The daemon sends the DDP/Art-Net packets, scans the network for controllers, and
receives OSC/MIDI. When it's running, the top bar's **Daemon** indicator is hidden; if it
goes offline an amber chip appears — no daemon means **no LED output**.

> **Design anywhere; light real LEDs only with the daemon.** You can open the hosted editor in
> any browser to design and preview, but it can only *stream to hardware* when the local app
> (which carries the daemon) is running. See [What is LED Zeppelin](01-what-is-led-zeppelin.md)
> and [Deploying](11-deploying.md).

## Pixel mapping (the core idea)

This is the concept that ties the whole app together.

LED Zeppelin draws moving visuals on a flat **canvas** (like a video frame). You then place
each physical light onto that canvas as a shape. Wherever you put it, the light **samples**
the colours under it and sends them to the real pixels. Move a strip to the left edge and
it shows whatever is happening at the left of your visuals.

So you're not programming each pixel by hand — you're arranging your lights inside a picture
and letting them pick up colour from it. That arrangement is called the **mapping**.

### The full path, end to end

Every frame (~40 fps) follows the same chain:

**canvas** (your composed visuals) → **sample** (each fixture reads the pixels under its
shape) → **daemon** (concatenates all sampled pixels and slices out each device's bytes) →
**DDP / Art-Net** (packetised over the network) → **controller** (WLED / Art-Net node) →
**physical pixels**.

You arrange the first step; the app handles the rest automatically. Details of the sampling and
packetising live in [Output & calibration](10-output-and-calibration.md).

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
others. Templates live in the **Library** (a section of the right-hand dock); placed fixtures
and live devices live in the **Output** section. See
[Fixtures & the Library](05-fixtures-and-inventory.md).

## Patching: fixtures → device outputs

**Patching** means telling the app which device output a fixture is wired to, and in what
order. A controller's pixels are one continuous address space per output; LED Zeppelin packs
your fixtures into that space automatically in the order they're listed, so you don't hand-
enter pixel offsets. You just say "this fixture is on DigQuad #1, output 2" and the app works
out the addresses.

## Fixtures in 3D

A rig isn't always flat. LED Zeppelin can arrange fixtures in **3D** as well — tubes standing
as arches, ribs on a sculpture, a light hung at any height. The **3D** button in the top bar
switches the stage to a 3D viewport you can orbit to inspect the rig.

Two ideas keep 3D simple:

- **Sampling is still front-on.** No matter how you orbit the view, output always samples the
  canvas through a fixed front-ortho camera — what a fixture reads depends on where it sits
  *facing the canvas*, not on the orbit angle. There are no camera or projection presets to
  choose.
- **Volumetric fields know the real height.** Some sources and effects work in true 3D space
  (up an arch, across the room) rather than flat canvas space. Each LED's height is rescaled so
  the tallest point of the rig sits at the top of the field, so a "sweep up" reaches every
  fixture even on a tall, narrow rig.

The daemon/output path is unchanged by 3D — it only changes *where each LED reads its colour
from*. The two bundled examples (**Balena Voladora** and the full **Kagora** install) are both
3D rigs. More in [Fixtures & the Library › 3D mode](05-fixtures-and-inventory.md#3d-mode-beta).

## Quick glossary

- **Pixel** — one individually-addressable LED.
- **Pixel count** — how many pixels a fixture has.
- **Device / controller** — the hardware that drives pixels (WLED/QuinLED/Art-Net node).
- **Fixture** — a mapped light shape on the canvas (2D or 3D).
- **Template** — a reusable fixture/device definition in the Library.
- **Daemon** — the local helper that sends packets, scans, and receives OSC/MIDI.
- **DDP / Art-Net** — protocols for sending pixel data.
- **Universe** — a 512-channel block in Art-Net (~170 RGB pixels).
- **Colour order** — the byte order a strip expects (RGB, GRB, RGBW…).
- **Mapping** — how fixtures are arranged on the canvas to sample visuals.
- **Patching** — wiring a fixture to a device output.

Next: [Getting started](03-getting-started.md).
</content>
</invoke>
