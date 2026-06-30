# Getting started: first light

This walks you from nothing to one strip lighting up with live visuals. It assumes you've
read [LED control concepts](02-concepts.md) (you should know what a *device*, *fixture*, and
*template* are). Budget about 10 minutes.

**What you need:**
- A WLED/QuinLED (or Art-Net) controller powered on and on the **same network** as your
  computer, with at least one LED strip wired to it.
- The LED Zeppelin app (below).

> **Why the app, not just the website?** The hosted site can design and preview, but
> streaming to real hardware needs the local daemon (it sends the network packets a browser
> can't). For first light, use the installed app.

## 1. Install and launch

Pick one:

- **macOS** — on the [Releases](https://github.com/jonasjohansson/ledzeppelin/releases) page,
  download the macOS asset (the `.zip` with `macos` in its name — `arm64` for Apple Silicon,
  `intel` for older Macs). Unzip, drag **LED Zeppelin** to Applications, double-click.
  (Released builds are notarized, so they open normally.)
- **Windows** — download the `windows` asset, unzip, run `ledzeppelin.exe`. On first launch
  click **More info → Run anyway** past SmartScreen. Then open `http://localhost:7070`.
- **Linux / Raspberry Pi** — download the `linux` tarball, extract, run `./ledzeppelin`, open
  `http://localhost:7070`.
- **From source** *(advanced — for developers; needs Node.js)* — `npm install` then
  `npm start`, open `http://localhost:7070`.

The app opens in your browser. You'll see a **top bar** of icon buttons, a **canvas** in the
centre, and a **Devices** panel on the right.

> **The daemon starts with the app.** When you launch the downloaded app it runs both the
> editor and the daemon for you — there's nothing separate to start. You can confirm the
> daemon is alive via the **health icon** in the top bar (it reads "offline" until the daemon
> is up). If you instead just opened the hosted website, there's no daemon and output won't
> work — use the installed app.

> **macOS permission.** The first time the app scans the network or sends light data, macOS
> shows a **Local Network** permission prompt. Click **Allow** — without it, scanning and
> output won't work.

## 2. Add your controller (device)

In the **Devices** panel on the right, you have two ways to add a controller:

- **Scan (recommended).** Click the **scan** control (the ⌖ target icon) below the device
  list. The app sweeps your network for WLED controllers and listens for Art-Net nodes; you'll
  see live progress, then a list of what it found. Click **ADD** next to your controller — it
  appears in the Devices list immediately, already selected.
- **Add manually.** Click **+ Device**, pick a controller template (e.g. **DigQuad**), then
  set its **IP address** in the device editor (the editor opens when the device is selected).

**Confirm it's the right one:** with the device selected, click the **identify** button in its
editor to flash that physical controller, so you know which box on the rig you're configuring.
Set the **colour order** here too (many WLED strips need **GRB** — see
[concepts](02-concepts.md#pixels-and-strips) if reds and greens look swapped).

## 3. Add a fixture

A device is the hardware; a **fixture** is the light *shape* you map onto the canvas.

Click **+ Fixture** in the Devices panel. A menu lists your fixture **templates** plus a
**Blank** option. Pick one (or define your own first — see
[Fixtures & the Inventory](05-fixtures-and-inventory.md)). The new fixture:

- appears in the Devices list under **Unassigned**, selected, and
- shows up as a shape on the canvas.

Its pixel count comes from the template (e.g. a 120-pixel strip). Need several identical
strips? Add one, then **duplicate** it.

## 4. Patch the fixture to the controller

Tell the app which output the fixture is wired to. With the fixture selected, in its editor
set the **Device** and **Output (port)** — for example DigQuad, output 1. The app packs pixel
addresses automatically; you don't enter offsets by hand.

The fixture now moves from **Unassigned** to under that device in the list.

## 5. Give the canvas something to show

A fixture samples the **canvas**, so the canvas needs visuals or your lights stay dark.

A quick vocabulary note, because these words are easy to mix up:
- **Canvas** — the picture your fixtures sample from.
- **Composition** — your whole arrangement of visuals that fills the canvas.
- **Source** — one visual you add to the composition (a generative **clip**; an **ISF shader**
  is one kind of source). **Effects** then modify sources.

Add a **source** to the composition so the canvas isn't black — open the **source picker** and
choose a clip (the bundled ISF examples are an easy start). You should then see motion/colour
on the canvas.

> _Exact control to confirm against your build: where the source picker opens from (the
> composition/Clip area). The full source/effect workflow is covered in
> [The canvas](06-canvas-sources-effects.md)._

## 6. See it light up

With the daemon up, the fixture patched, and the canvas showing visuals, your strip lights up
with whatever is under it on the canvas. Drag the fixture around the canvas to change what it
samples.

**If nothing lights up,** run down this checklist (most common first):
1. **Daemon up?** Check the **health icon** in the top bar — if it reads "offline", the app/daemon isn't running (relaunch the installed app; the hosted website can't stream).
2. **Fixture patched?** An **Unassigned** fixture isn't wired to any output — assign it a device + port (step 4).
3. **Local Network allowed?** (macOS) — you must have clicked **Allow** on the prompt.
4. **Device online?** The controller's **status dot** in the Devices list should be green/online; if not, check its IP and power.
5. **Canvas not black?** No source = nothing to sample (step 5).

More detail in [Troubleshooting](12-troubleshooting.md).

## 7. Save your work

Press **⌘S** (Save project). You can re-open it later with **⌘O**. To capture a specific look
you can recall later, use [Scenes](07-scenes.md).

---

### You've done the core loop

Add device → add fixture → patch → map on the canvas → output. Everything else in LED Zeppelin
builds on this. Good next steps:

- [Fixtures & the Inventory](05-fixtures-and-inventory.md) — define your own strip/matrix
  templates and patch a whole rig.
- [The canvas](06-canvas-sources-effects.md) — make richer visuals.
- [Devices & scanning](04-devices-and-scanning.md) — manage multiple controllers.
