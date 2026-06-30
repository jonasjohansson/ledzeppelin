# Troubleshooting & FAQ

Common first-run snags and how to fix them. Work top-down: most "nothing works"
reports come down to one of the first few checks.

## Nothing lights up

No LEDs respond, even though the canvas is animating. Walk this checklist in order:

1. **Is the daemon running?** Streaming needs the local app (the small Node daemon
   that sends the UDP a browser can't). Look at the **Daemon** icon in the top bar —
   it is the health indicator. When the daemon is live the icon is enabled and clicking
   it opens `/health` in a new tab; when the daemon is offline the icon is **disabled**
   (its tooltip reads "Daemon health (offline)"). If it's offline, start the app
   (`npm start`, or launch the packaged build) and reload at `http://localhost:7070`.
2. **Are you on the local app, not the hosted site?** See
   [Editor opens but can't stream](#editor-opens-but-cant-stream) below — designing and
   preview work anywhere, but streaming requires the local daemon.
3. **Is the device online?** Open the **Devices** panel and check each controller's
   status. The daemon pings every device while it's live; a controller that isn't
   answering is shown as offline. Confirm its IP is correct and that it's powered and
   on the same LAN as the machine running the app.
4. **Did you allow Local Network access (macOS)?** The first time the app sends DMX or
   scans, macOS shows a **Local Network** permission prompt — you must click **Allow**.
   If you dismissed it, re-enable it under **System Settings › Privacy & Security ›
   Local Network** and toggle LED Zeppelin on. Without it, the daemon runs but no
   packets reach your controllers.
5. **Is the fixture patched?** A fixture only outputs once it's wired to a device. In
   the fixture's inspector, confirm it has a **device** and (for WLED/DDP) a pixel
   range, or (for Art-Net) a universe + start address. An unpatched fixture samples the
   canvas but sends nowhere.
6. **Is the canvas actually showing visuals?** If the canvas is black there's nothing to
   sample. Add a clip and make sure it's playing. Then hit the **Preview** (wall) button
   — it dims the canvas and lights only each fixture's sampled pixels, so you can see
   exactly what each fixture is reading.

## Reds and greens look swapped

You set red and the strip glows green (or vice versa). This is a **colour order**
mismatch — most WS281x strips are wired **GRB**, not RGB. Open the fixture (or its
template in the **Inventory**) and change **Colour order** to `GRB`. The default for new
strips is already `GRB`; if you typed a template by hand or imported odd data, that's the
field to check. Colour order is per-fixture/per-device, so you can mix RGB and GRB strips
on one controller.

## First ~170 pixels work, the rest stay dark (Art-Net)

One Art-Net universe carries 512 DMX channels = **170 RGB pixels** (170 × 3 = 510). When
a fixture is longer than 170 pixels it spills into the **next universe**, and if that
universe isn't configured the overflow goes nowhere — so the first 170 light and the
remainder is dark. Fix it by giving the fixture the right **start universe** and letting
it span consecutive universes, and make sure the controller is listening on those same
universes. (RGBW is 128 pixels per universe: 512 / 4.) WLED over DDP has no 170-pixel
boundary, so this symptom is Art-Net-specific.

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

When you scan, live progress shows as it runs, and a controller you **Add** appears in
the Devices list immediately. If a device never shows up at all, it didn't answer the
scan — confirm it's powered, on the same subnet, and that Local Network permission is
granted (macOS), then scan again. See
[Devices & scanning](04-devices-and-scanning.md).

## Editor opens but can't stream

If the editor loads and previews fine but nothing reaches your hardware, you're almost
certainly on the **hosted site** ([ledzeppelin.jonasjohansson.se](http://ledzeppelin.jonasjohansson.se/)),
not the local app. The hosted page has no daemon, so it can do everything except send
UDP to controllers. The giveaway: the **Daemon** icon stays disabled (offline) no matter
what. Install and run the local app from
[Releases](https://github.com/jonasjohansson/ledzeppelin/releases) (or `npm start`) and
open `http://localhost:7070`. Your saved project carries over — open it there.

## Stale app code after an update

The editor is a PWA, so it caches its own code to run offline. If a new version behaves
oddly — old UI, missing fixes — force a clean reload with the **Update** (refresh) icon
in the top bar. It unregisters the service worker and clears Cache Storage, then reloads
with fresh files. This clears **only** cached app code — your saved project and settings
(stored separately) are kept; live output just pauses briefly during the reload.

To confirm which version you're running, check the **browser tab title** — it reads
`LED Zeppelin v1.0.x`.

---

_See also: [Getting started](03-getting-started.md) ·
[Devices & scanning](04-devices-and-scanning.md) ·
[Output & calibration](10-output-and-calibration.md) ·
[Deploying](11-deploying.md)._
