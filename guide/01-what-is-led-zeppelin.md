# What is LED Zeppelin

LED Zeppelin drives **addressable LED** (strips, panels, matrices) with live generative
visuals. You design moving imagery on a 2D canvas, place your lights on that canvas, and
the app streams the right colours to each light in real time (~40 fps).

Think projection-mapping, but the "surfaces" are LED fixtures and the output is network
pixel data, not a video signal.

![The LED Zeppelin editor: top-bar tools, the Composition/Layer/Clip panel on the left, the canvas with its clip grid in the centre, and the Devices panel on the right.](img/overview.png)

## Two halves

LED Zeppelin is **a browser editor + a small background daemon**:

- **Editor** — runs in a browser. Design, map, configure. Open it hosted at
  [ledzeppelin.jonasjohansson.se](http://ledzeppelin.jonasjohansson.se/), or locally via the
  app (`http://localhost:7070`).
- **Daemon** — the local program that sends the network packets (UDP) a browser can't, scans
  for controllers, and receives OSC/MIDI.

**Design anywhere; to light real LEDs, run the local app.** The hosted site previews but can't
stream — only the local daemon talks to hardware.

## What you can do

- **Design** — layer generative clips and effects; modulate by time, audio, or OSC/MIDI. ISF
  shaders work too (optional GPU visuals).
- **Map** — place fixtures on the canvas to set what each samples.
- **Output** — wire fixtures to controllers; stream over DDP (WLED) or Art-Net.
- **Operate** — save/recall looks as scenes; control live via MIDI, OSC, keyboard, or a phone.

It uses **scenes** (recallable snapshots), not a cue list. The released app needs no Node.js.

New to LED terms? Read [LED control concepts](02-concepts.md). Otherwise jump to
[Getting started](03-getting-started.md).
