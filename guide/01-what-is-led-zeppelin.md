# What is LED Zeppelin

LED Zeppelin is a tool for driving **addressable LED** — strips, panels, and matrices
made of individually-controllable pixels — with live, generative visuals. You design
moving imagery on a 2D canvas, place your physical lights onto that canvas, and the app
streams the right colours to each light in real time (~40 frames per second).

If you've used a VJ or projection-mapping tool, the idea is similar: make visuals, map
them onto surfaces. Here the "surfaces" are your LED fixtures, and the output is pixel
data sent to LED controllers over the network instead of a video signal.

## The two halves

LED Zeppelin is **a browser app plus a small background program (the "daemon")**:

- **The editor** runs in a web browser. This is where you design visuals, place
  fixtures, and configure everything. You can open it two ways:
  - Hosted, at **[ledzeppelin.jonasjohansson.se](http://ledzeppelin.jonasjohansson.se/)** —
    good for designing and previewing anywhere.
  - Locally, by running the app on your own machine (it opens at `http://localhost:7070`).
- **The daemon** is the local program that does the things a browser *can't*: sending raw
  network packets (UDP) to LED controllers, scanning your network for them, and receiving
  OSC/MIDI. A web page alone cannot speak these protocols, which is why **streaming to real
  controllers requires running the local app** — the hosted page can design and preview,
  but not light up hardware.

So: **design anywhere; to light real LEDs, run the local app.**

## What you can do with it

- **Design** — build a composition of generative visual *clips* and *effects* on a canvas,
  animate and blend them, and modulate parameters over time or from audio/OSC/MIDI. You can
  also drop in [ISF](https://isf.video/) shaders (a portable format for GPU visual effects —
  optional, and not needed to get started).
- **Map** — place **fixtures** (your strips/panels) on the canvas to decide which part of
  the image each one samples.
- **Output** — wire fixtures to **devices** (controllers) and stream live: **DDP** for WLED,
  or **Art-Net** for other nodes.
- **Operate** — save and recall looks as **scenes**, and control the app live with MIDI,
  OSC, the keyboard, or a phone remote.

## What it is *not*

- It's not a fixed light-cue console; instead of a cue list it uses **scenes** (snapshots
  you recall).
- It doesn't require Node.js or any developer setup to *use* — the released app is a
  self-contained download.

## Where to go next

If terms like *pixel*, *controller*, *DDP*, or *Art-Net* are unfamiliar, read
[LED control concepts](02-concepts.md) next. If you're comfortable with those, jump to
[Getting started](03-getting-started.md).
