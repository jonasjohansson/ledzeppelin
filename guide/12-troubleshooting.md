# Troubleshooting & FAQ

Common first-run snags and how to fix them. Work top-down: most "nothing works"
reports come down to one of the first few checks.

## Nothing lights up

No LEDs respond, even though the canvas is animating. Walk this checklist in order:

1. **Is the daemon running?** Streaming needs the local app (the small Node daemon
   that sends the UDP a browser can't). When the daemon is live the top bar shows no
   indicator; when it's unreachable a red **Offline** chip appears in the top bar's
   right cluster (clicking it opens `/health`, which shows the failure directly). If the
   chip is showing, start the app (`npm start`, or launch the packaged build) and reload
   at `http://localhost:7070`.
2. **Are you on the local app, not the hosted site?** See
   [Editor opens but can't stream](#editor-opens-but-cant-stream) below — designing and
   preview work anywhere, but streaming requires the local daemon.
3. **Is the device online?** Open the **Output** section (right sidebar) and check each
   controller's status dot. The daemon pings every device while it's live; a controller
   that isn't answering is shown as offline. Select the row to open its editor (it floats
   in a popup over the canvas) and confirm the **IP** is correct and that the controller
   is powered and on the same LAN as the machine running the app.
4. **Did you allow Local Network access (macOS)?** The first time the app sends DMX or
   scans, macOS shows a **Local Network** permission prompt — you must click **Allow**.
   If you dismissed it, re-enable it under **System Settings › Privacy & Security ›
   Local Network** and toggle LED Zeppelin on. Without it, the daemon runs but no
   packets reach your controllers.
5. **Is the fixture patched?** A fixture only outputs once it's wired to a device. Select
   the fixture and, in its floating editor, confirm it has a **device** and (for WLED/DDP)
   a pixel range, or (for Art-Net) a universe + start address. An unpatched fixture
   samples the canvas but sends nowhere.
6. **Is the canvas actually showing visuals?** If the canvas is black there's nothing to
   sample. Add a clip and make sure it's playing (see
   [Composition looks empty](#composition-looks-empty-or-you-cant-add-a-clip) below). Then
   hit the **output preview** (wall) button in the top bar — it dims the composite and
   lights only each fixture's sampled pixels, so you can see exactly what each fixture is
   reading.

## Composition looks empty, or you can't add a clip

If the stage canvas is blank and nothing animates, there's no clip playing to sample from.
A composition needs **at least one layer with a clip on it**:

- The **timeline** (the deck below the stage) holds the layer(s) and their clips. If it's
  hidden, reveal the bottom panel with the **panel-bottom** toggle in the top bar (in
  **canvas** view the timeline is collapsed — switch the view segment to **split** or
  **edit** to see it).
- Drop a **source** from the **Sources** palette (right sidebar) onto the deck to create a
  clip, then make sure it's the active/playing clip.
- The left sidebar's accordion has **Composition · Layer · Clip** sections that follow your
  current selection. If **Layer** or **Clip** looks empty, you haven't selected (or
  created) one yet.

Panels missing entirely? The dock has three columns — toggle **panel-left**,
**panel-bottom**, **panel-right** in the top bar, or switch the **view** segment
(canvas / split / edit / overlay). Accordion sections can also be fully folded to header
strips; click a header to open it. See
[Canvas: sources & effects](06-canvas-sources-effects.md).

## Reds and greens look swapped

You set red and the strip glows green (or vice versa). This is a **colour order**
mismatch — most WS281x strips are wired **GRB**, not RGB. Select the controller in the
**Output** section and change **Order** to `GRB` in its floating editor (or set it on the
controller's template in the **Library**). The default for new controllers is already
`GRB`; if you typed a template by hand or imported odd data, that's the field to check.
Colour order is per-controller, and an individual fixture can override it with its own
colour format — so you can mix RGB and GRB strips on one controller.

## First ~170 pixels work, the rest stay dark (Art-Net)

One Art-Net universe carries 512 DMX channels = **170 RGB pixels** (170 × 3 = 510). When
a fixture is longer than 170 pixels it spills into the **next universe**, and if that
universe isn't configured the overflow goes nowhere — so the first 170 light and the
remainder is dark. Fix it by giving the fixture the right **start universe** and letting
it span consecutive universes, and make sure the controller is listening on those same
universes. (RGBW is 128 pixels per universe: 512 / 4.) WLED over DDP has no 170-pixel
boundary, so this symptom is Art-Net-specific.

## One fixture (or a whole strip) stays dark

Everything else lights but one section is black. Common causes:

- **Wrong or blank IP.** Select the controller in **Output** and check its IP. A blank IP
  is deliberate on new controllers (so you don't get a false "offline" alarm) — the
  bundled examples ship this way. The **Kagora** example in particular loads with its 12
  controllers un-addressed: **assign each controller's IP after loading it**. Balena
  Voladora likewise expects you to set the two DigOcta IPs.
- **Pixel range doesn't reach it.** Over DDP the daemon packs pixels contiguously from the
  first pixel; over WLED the controller slices by each output's Start/Length. If a
  fixture's byte range or a WLED output's start/length is off, that fixture reads nothing.
- **It's outside the sampled area / off-canvas.** In 3D, or on a tall-narrow rig, confirm
  the fixture actually sits where the visual is playing. Use the **output preview** (wall)
  button to see each fixture light with exactly what it samples.
- **Live show diverged from the preset (installs).** On a deployed machine, a dark output
  is often the browser's saved show drifting from the intended project — reload from the
  known-good `?project=…` URL. See [Deploying the install](11-deploying.md).

## macOS: "is damaged and can't be opened"

If a downloaded build reports *"LED Zeppelin is damaged and can't be opened. You should
move it to the Trash"*, the app is **quarantined** and unsigned. On Apple Silicon /
macOS 15+ there is no "Open Anyway" button for this case. Two fixes:

- **Use a notarized build.** Official [Releases](https://github.com/jonasjohansson/ledzeppelin/releases)
  are signed and notarized and open with a plain double-click. Prefer these.
- **Strip the quarantine flag** on a build you trust:

  ```
  xattr -dr com.apple.quarantine "LED Zeppelin.app"
  ```

The bundle ships its `NSLocalNetworkUsageDescription`, so once it opens you'll get the
Local Network prompt described above — click **Allow**. The first UDP bind may also pop
the **firewall** dialog; signed apps are remembered after the first time.

## Windows: SmartScreen blocks the app

The Windows build is unsigned, so SmartScreen warns on first launch. Click
**More info**, then **Run anyway**. Then run `ledzeppelin.exe` and open
`http://localhost:7070`.

## Port already in use

The daemon needs these ports free: **7070** (the UI), **4048** (DDP), **6454**
(Art-Net), and **9000** (OSC-in). If one is taken — by an earlier copy of the app, an
Art-Net tool, or another DAW/lighting app — the daemon fails to bind that socket. Quit
the conflicting process (or the stray earlier instance) and relaunch. A second copy of
LED Zeppelin already running is the most common cause.

## A scanned controller doesn't appear

Scan from the **Output** section header (**Scan**) — it sweeps for WLED on the subnet and
sends an Art-Net ArtPoll in parallel. Live progress shows as it runs, and a controller you
**Add** appears in the Output device list immediately (a WLED row can offer **+ outputs**
to add the controller plus a fixture per configured LED output). If a device never shows up
at all, it didn't answer the scan — confirm it's powered, on the same subnet, and that
Local Network permission is granted (macOS), then scan again. See
[Devices & scanning](04-devices-and-scanning.md).

## Editor opens but can't stream

If the editor loads and previews fine but nothing reaches your hardware, you're almost
certainly on the **hosted site** ([ledzeppelin.jonasjohansson.se](http://ledzeppelin.jonasjohansson.se/)),
not the local app. The hosted page has no daemon, so it can do everything except send
UDP to controllers. The giveaway: the **Offline** daemon chip stays visible no matter
what. Install and run the local app from
[Releases](https://github.com/jonasjohansson/ledzeppelin/releases) (or `npm start`) and
open `http://localhost:7070`. Your saved project carries over — open it there.

## Stale app code after an update

The editor is a PWA, so it caches its own code to run offline. If a new version behaves
oddly — old UI, missing fixes — force a clean reload with the **Update** (refresh) icon
in the top bar's right cluster. It unregisters the service worker and clears Cache
Storage, then reloads with fresh files. This clears **only** cached app code — your saved
project and settings (stored separately) are kept; live output just pauses briefly during
the reload.

To confirm which version you're running, check the **browser tab title** — it reads
`LED Zeppelin v1.0.x`.

---

_See also: [Getting started](03-getting-started.md) ·
[Devices & scanning](04-devices-and-scanning.md) ·
[Canvas: sources & effects](06-canvas-sources-effects.md) ·
[Output & calibration](10-output-and-calibration.md) ·
[Deploying](11-deploying.md)._
