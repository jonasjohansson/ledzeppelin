# Getting started: first light

From nothing to one strip lit with live visuals, in ~10 minutes. Read
[LED control concepts](02-concepts.md) first if *device*, *fixture*, and *template* are new.

**You need:** a WLED/QuinLED (or Art-Net) controller, powered on, on the **same network** as
your computer, with a strip wired to it. Plus the app (below). The hosted website previews
only — streaming needs the local app.

## 1. Install & launch

From [Releases](https://github.com/jonasjohansson/ledzeppelin/releases):

- **macOS** — the `macos` `.zip` (`arm64` for Apple Silicon, `intel` otherwise). Unzip → drag
  to Applications → double-click. Notarized, opens normally.
- **Windows** — the `windows` zip → `ledzeppelin.exe` → *More info → Run anyway*. Open `http://localhost:7070`.
- **Linux / Pi** — the `linux` tarball → `./ledzeppelin`. Open `http://localhost:7070`.
- **From source** *(developers)* — `npm install && npm start`.

The app opens in your browser. The browser tab title shows the version (`LED Zeppelin v1.0.x`).
The output **daemon** runs alongside the app — when it's reachable the top bar shows nothing
extra; a red **daemon** chip appears only if it's down (and it's always shown on the hosted
site, which never streams). The **Guide** (book icon) reopens these pages.

> **macOS:** click **Allow** on the Local Network prompt the first time it scans/streams, or
> nothing works.

## 2. Know the layout

![The LED Zeppelin editor: the top bar of tools, the left dock, the canvas with its clip deck in the centre, and the right dock.](img/overview.png)

The window is a **top bar** over a **three-column dock**. The columns are always visible at
once; drag the splitters between them to resize.

- **Top bar** — three groups of icon buttons. Left: project actions (**Settings**, **Lock**,
  **Save**, **Open**, **New**, **Import from LEDger**, **Mapping**, **Library**, **Control
  surface**, **Align**). Middle: view + canvas toggles (many are hidden until you turn on
  **Advanced mode** in Settings). Right: **force update**, **Guide**, **report a bug**,
  **install/update**, and the offline **daemon** chip.
- **Left column** — an accordion of inspector sections: **Settings · Composition · Layer ·
  Clip**. Composition is open by default; Layer and Clip follow whatever you have selected.
- **Centre column** — the **canvas** (the output you sample) above the **clip deck** (the
  timeline of clips).
- **Right column** — an accordion: **Library · Output · Sources**. **Output** — the live list
  of your controllers and fixtures — is open by default.

The two accordions show **one section open at a time**, and you can click an open section's
header to fold everything down to header strips. When you select a controller, fixture, or
library model, its editor pops up in a small **floating panel** over the canvas — its own
**Name** field tells you what you're editing.

> New here? Skip building a rig and **load an example** first (below) to see a finished project
> before you make your own.

## 3. Add your controller (device)

A **device** is a physical controller (WLED / QuinLED / Art-Net). Work in the **Output** section
on the right; its header carries three buttons: **+ Controller**, **+ Fixture**, and **Scan**.

![The Output section: your controllers and fixtures, with + Controller / + Fixture / Scan on the header.](img/devices.png)

- **Scan (recommended)** — click **Scan**. It sweeps the network for WLED + Art-Net controllers
  and shows live progress; click **ADD** on a result and that controller appears in the list
  immediately, selected. WLED results offer **+ outputs**, which also adds a fixture per
  configured LED output. (Scan needs the daemon; it does nothing on the hosted site.)
- **Manual** — click **+ Controller**, pick a model (e.g. DigQuad) or **Blank**, then set its
  **IP** in the floating editor.

Select the device and set its **colour order** (WLED strips often need **GRB** — if reds/greens
swap, that's why). For pixel devices, **identify** flashes the physical box so you know which is
which. Full detail: [Devices & scanning](04-devices-and-scanning.md).

## 4. Add a fixture

A **fixture** is a mapped light shape on the canvas. Click **+ Fixture** in the Output header and
pick a **template** (or **Blank**); templates carry a size, shown in parentheses. The fixture
lands under **Unassigned**, selected, on the canvas.

Fixtures are **standalone** — each owns its own spec. Editing a template later never changes
fixtures already placed. Need many identical strips? Add one, then **duplicate** it (⌘D).
Selecting several at once **bulk-edits**: shared values show, differing ones dim as "mixed", and
an edit writes to all selected.

## 5. Patch it to the controller

Drag the fixture row onto a controller group in the list (or onto a specific output) to assign
it; pixel addresses pack automatically — no offsets to enter. You can also set **Device** and
**Output (port)** in the floating editor with the fixture selected. It then moves under that
device. Dragging a fixture back onto **Unassigned** unpatches it.

## 6. Give the canvas something to show

A fixture samples the **canvas**, so it needs visuals or the strip stays dark. The composition
is one layer holding a deck of **clips**; each clip is a source plus an effect chain. The clips
live in the **clip deck** in the centre.

![The clip deck in the centre: clip cells plus an empty "+" cell to add a source.](img/canvas-clips.png)

- Click an empty **`+` cell** → a **source** picker opens (a compact palette grouped Basic,
  Pattern, Motion, Organic). Pick one (e.g. `noise` or `gradient`) and it becomes a new clip.
- In the deck, **click** a clip to select it (edit it in the left **Clip** section),
  **double-click** to trigger it live. The canvas should now show motion.
- You can also **drag** files onto the window (see step 8).

(Full detail: [The canvas](06-canvas-sources-effects.md).)

## 7. See it light up

Daemon up + fixture patched + a clip triggered → the strip shows whatever is under it on the
canvas. Turn on the fixture overlay (the eye toggle) and drag the fixture to change what it
samples. The **output-preview** button (`wall`) dims the composite and lights only each fixture's
sampled pixels, so you can read the mapping directly.

**Dark strip? Check, in order:**
1. **Daemon up?** The top-bar daemon chip — if it's showing, relaunch the app (the website
   can't stream).
2. **Fixture patched?** A fixture left under **Unassigned** isn't wired — assign it (step 5).
3. **Local Network allowed?** (macOS).
4. **Device online?** Its status dot should be green; else check IP/power.
5. **Canvas black?** No triggered clip = nothing to sample (step 6).

More in [Troubleshooting](12-troubleshooting.md).

## 8. Save, open, import, and examples

- **⌘S** saves the whole **project** (rig + visuals); **⌘O** opens one.
- **Load an example** — click **Open** (⌘O). If bundled examples are present, it opens a small
  menu: **Open file…** plus each example. Pick one to replace the current project:
  - **Balena Voladora** — a 3D rig, 2× DigOcta driving a tail, ribs, spline, and fins in
    SK6812 RGBW.
  - **Kagora** — the full install in 3D: 12× DigQuad driving 120 WS2815 tubes standing as
    arches (~31.8k pixels). Assign your controller IPs after loading.
- **Import from LEDger** — the **Import from LEDger…** button in the top bar (also reachable from
  the **Library** section) opens the Library accordion and its LEDger importer. See
  [Importing from LEDger](09-importing-from-ledger.md).
- **Drag a file onto the window** to load: a LED Zeppelin **project** `.json` (rig + visuals) or
  an **ISF shader** (`.fs` / `.isf` / `.frag` / `.glsl`) → a new generator clip.

Capture a look to recall later with [Scenes](07-scenes.md).

---

**The core loop:** add device → add fixture → patch → trigger a clip → output. Everything else
builds on it. Next: [Fixtures & the Library](05-fixtures-and-inventory.md),
[The canvas](06-canvas-sources-effects.md).
