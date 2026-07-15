# Deploying the install

LED Zeppelin is built to run permanently: a 12-QuinLED rig that powers on, comes
back from a reboot on its own, and is reachable from any browser on the LAN. This
page covers the permanent-install model, deploying on a Raspberry Pi, running the Pi
as its own render kiosk, booting straight into a fixed show with `?project=`,
packaging the Node-free app for desktop, macOS signing & notarization, the network
ports, and recovery when something drops.

## The permanent-install model

The app is two halves:

- A **static web UI** that renders everything client-side in the browser (the canvas,
  sources, effects, the [output preview](10-output-and-calibration.md)).
- A **tiny Node daemon** (`server/`) that does what a browser can't: raw UDP for
  DDP / Art-Net / OSC, UDP broadcast for Art-Net discovery, the LAN WLED scan, and
  serving the UI on port **7070**.

Rendering is client-side, so the show server itself needs no GPU, no display, and no
desktop. For the permanent 12-QuinLED install the server lives on a headless box (a
Raspberry Pi), runs as a service that starts on power-on and restarts on crash, and
you open the editor from any laptop or phone on the same network. The single QuinLED
on the bench is just a test piece; the deploy story is the same for both.

> **A browser must render for pixels to flow.** The daemon only *serves* the UI and
> *streams* DDP/Art-Net — it never renders frames itself. Output moves only while at
> least one browser is connected and painting; the health snapshot proves it with
> `clients` and `fpsOut` (see [Recovery](#recovery)). That gives you two ways to run a
> permanent show:
>
> - **Attended** — an operator browser (laptop/phone) stays open on the LAN and does the
>   rendering. Raspberry Pi OS **Lite** (no desktop) is enough on the server.
> - **Unattended** — the Pi renders *itself* by running a **kiosk browser** pointed at its
>   own daemon, so output flows 24/7 with nothing else plugged in. This needs a desktop /
>   Wayland session on the Pi — see [Render on the Pi (kiosk)](#5-render-on-the-pi-kiosk-mode).

Two ways to run the server:

- **Raspberry Pi** as a permanent always-on, headless show server (below).
- **Desktop app** — a Node-free single binary / `.app` you double-click. Good for the
  bench, demos, and authoring shows before they go to the Pi. See
  [Packaging](#packaging-a-node-free-app).

## Raspberry Pi deployment

Goal: the server **boots on power-on**, **restarts on crash**, and is reachable on the
LAN at `http://ledzeppelin.local`. If a laptop/phone will always be the renderer,
**Raspberry Pi OS Lite (no desktop)** is all you need. If the Pi will render its own
show (kiosk mode), use the full **Desktop** image instead — see step 5.

The only runtime dependency is `ws` (pure JS, no native build). `playwright` is
dev-only — install with `--omit=dev` to skip its browser download.

### 1. Flash the OS

Use **Raspberry Pi Imager** → *Raspberry Pi OS Lite (64-bit, Bookworm)* for a headless
server, or the full **Desktop** image if the Pi will run the kiosk. In the OS
customisation (the gear before writing), set:

- **hostname:** `ledzeppelin` (gives you `ledzeppelin.local`)
- **username/password** (e.g. `led`), and **enable SSH**
- Wi-Fi only if you can't use Ethernet — wired is steadier for lighting output.

### 2. Install Node

```bash
ssh led@ledzeppelin.local
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v24.x ; which node → /usr/bin/node
```

### 3. Code + production deps

```bash
cd ~ && git clone https://github.com/jonasjohansson/ledzeppelin.git
cd ledzeppelin && npm ci --omit=dev      # installs only ws; skips playwright
PORT=7070 node server/index.js           # smoke test, then Ctrl-C
```

Use `node server/index.js` (the `start` script). Don't use `launch` / `OPEN=1` — that
tries to open a browser, which is pointless on a headless Pi.

### 4. Run it as a service (boot on start + restart on crash)

A systemd unit binds **port 80** via `AmbientCapabilities`, so the app runs as a
non-root user and survives Node upgrades without `setcap`. Adjust `User` and paths.

```ini
# /etc/systemd/system/ledzeppelin.service
[Unit]
Description=LED Zeppelin LED show server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=led
WorkingDirectory=/home/led/ledzeppelin
ExecStart=/usr/bin/node server/index.js
Environment=NODE_ENV=production
Environment=PORT=80
Environment=OSC_PORT=9000
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ledzeppelin

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ledzeppelin
systemctl status ledzeppelin
journalctl -u ledzeppelin -f      # tail logs
sudo reboot                       # prove it auto-starts; then open http://ledzeppelin.local
```

Prefer port 7070? Set `Environment=PORT=7070`, drop the two capability lines, and use
`http://ledzeppelin.local:7070`.

> **The daemon exits when its last browser closes.** By design, once a client has
> connected, the server quits the moment the last window disconnects — `Restart=always`
> brings it straight back, ready for the next client. That keeps a stale render from
> streaming forever; it also means the service must be paired with a browser that stays
> connected (an operator's, or the Pi's own kiosk).

### 5. Render on the Pi (kiosk mode)

For a truly unattended install — no laptop left open — the Pi must run its own browser
to render frames so DDP keeps flowing. Use the **Desktop** image (a Wayland session,
`labwc` on Bookworm) with autologin, and autostart Chromium in kiosk mode against the
local daemon:

```bash
# ~/.local/bin/lz-kiosk.sh  (wait for the daemon, then launch Chromium fullscreen)
until curl -sf http://localhost:7070/api/health >/dev/null; do sleep 1; done
chromium --kiosk --ozone-platform=wayland \
  --user-data-dir="$HOME/.config/lz-kiosk" \
  "http://localhost:7070/"
```

Wire it to run on login from the compositor's autostart (`~/.config/labwc/autostart`,
plus an XDG `~/.config/autostart/*.desktop` as a belt-and-braces fallback). A few
Pi-specific gotchas worth knowing:

- **Wayland env is mandatory.** Launched from a detached SSH shell Chromium dies with an
  empty `WAYLAND_DISPLAY`; run it from the graphical session (autologin → compositor →
  script) and pass `--ozone-platform=wayland`.
- **After deploying new JS**, relaunch with a fresh profile (`rm -rf ~/.config/lz-kiosk`)
  or the service worker keeps serving stale assets. The top-bar **force-update** button
  does the same for an operator browser.
- **Confirm it's rendering:** `curl -s http://localhost:7070/api/health` should show
  `clients: 1` and `fpsOut > 0`.

### `?project=` — boot straight into a fixed show

Append `?project=<file>` to the URL to load a bundled example from
`examples/projects/` immediately, with **no confirm prompt**, overriding whatever is in
that browser's saved show:

```
http://localhost:7070/?project=kagora.json
http://localhost:7070/?project=balena-voladora.json
```

Only a bare filename is accepted (no `/` or `..`). This is the clean way to force a
kiosk onto a known show. Note the persistence model, though: a loaded show is saved in
**that browser's `localStorage`** (`ledzeppelin.show`) — there is **no server-side
show state**. So:

- Point the kiosk at the **plain URL** (`.../`) for day-to-day running, and any edits
  made on the Pi persist across reboots (they live in its browser's localStorage).
- Point it at **`?project=…`** once when you want to *reset* the Pi to a preset (this
  overwrites the saved show — and any live clip edits with it), then switch back to the
  plain URL.

Because the running show is the browser's localStorage copy, not the on-disk preset, it
can silently drift from the file you edited on your Mac — a fixture you added to the
preset later never reaches a kiosk that's still on its old saved show, which usually
shows up as a dark strip or output. See
[Troubleshooting](12-troubleshooting.md) and the `/api/debug/route` diagnostic in
[Recovery](#recovery) for how to catch and reseed it.

### 6. mDNS (`ledzeppelin.local`)

Pi OS ships `avahi-daemon`, so the hostname resolves on the LAN out of the box
(`systemctl status avahi-daemon`). macOS / iOS / Linux / Windows 10+ all resolve
`.local`. If it's flaky, the network is probably blocking multicast (guest /
client-isolation Wi-Fi) or routing across subnets — fall back to a DHCP-reserved
static IP.

### 7. Firewall (only if `ufw` is enabled)

```bash
sudo ufw allow 80/tcp      # HTTP + WebSocket (same port)
sudo ufw allow 9000/udp    # OSC input
sudo ufw allow ssh
```

DDP / Art-Net to the controllers is **outbound** — no inbound rule needed; just keep
the Pi and controllers on the same subnet.

### 8. Running vs updating

- **Run/edit a show:** no Pi access needed — open `http://ledzeppelin.local` in a
  browser; the phone control surface is `http://ledzeppelin.local/control/` (the daemon
  prints this LAN URL on startup).
- **Update the code (Pi has internet):**
  ```bash
  ssh led@ledzeppelin.local
  cd ~/ledzeppelin && git pull && npm ci --omit=dev
  sudo systemctl restart ledzeppelin
  ```
- **Update the code (Pi is offline / LAN-only):** the only runtime dep is `ws`, so push
  the source from your working copy and restart — no git/npm on the Pi:
  ```bash
  rsync -rltz --exclude=node_modules --exclude=.git --exclude=dist \
    ./ led@ledzeppelin.local:/home/led/ledzeppelin/
  ssh led@ledzeppelin.local 'sudo systemctl restart ledzeppelin'
  ```
  Skip `--delete` so `node_modules` and any saved state survive. If the Pi runs the
  kiosk, relaunch it with a fresh profile afterward so it picks up the new assets.

## Packaging: a Node-free app

For the desktop you don't want users installing Node. The daemon is pure ESM with one
dependency (`ws`) and no native addons, so it compiles to a single self-contained
binary that bundles the server and the web assets it serves. End users need **no
Node.js install** — they run the binary and the UI opens.

We use **Bun's** `--compile` (smallest tool that supports `node:dgram` + broadcast +
`ws`, and cross-compiles to mac / Windows / Linux from one machine). `@yao-pkg/pkg`
is the "real Node" fallback if Bun ever misbehaves.

One-time: install Bun.

```bash
curl -fsSL https://bun.sh/install | bash
```

Build a runnable folder for any OS:

```bash
npm run build:app                 # for this machine → dist/host/
# or specific targets:
scripts/build-app.sh bun-darwin-arm64 bun-darwin-x64 bun-windows-x64 bun-linux-x64
```

Each `dist/<target>/` gets the `ledzeppelin` binary plus the web assets it serves. Run
the binary; it serves `http://localhost:7070` and opens your browser automatically.

`server/index.js` resolves its asset root automatically: the repo root in dev, next to
the executable (or `../Resources` in a `.app`) when compiled — so the build just copies
the assets beside the binary, no embedding step.

Build a double-clickable macOS `.app`:

```bash
npm run build:mac                 # → "dist/LEDZeppelin.app" (arm64; pass x64 for Intel)
```

The bundle carries `NSLocalNetworkUsageDescription` (the reason text for the LAN
permission prompt) and an app icon built from the 512px logo.

## macOS signing & notarization

Bun's `--compile` ad-hoc-signs the inner binary, so an **unsigned** build runs fine on
the machine that built it. But once it's **downloaded** (and thus quarantined),
Gatekeeper sees an ad-hoc/unsigned app and refuses it:

> "LEDZeppelin" is damaged and can't be opened. You should move it to the Trash.

There is **no** "Open Anyway" button for this on Apple Silicon / macOS 15+ (Sequoia,
Tahoe). A recipient can clear the quarantine flag manually:

```bash
xattr -dr com.apple.quarantine "LEDZeppelin.app"
```

To skip that entirely, sign **and** notarize with an Apple Developer ID — a notarized,
stapled build opens with a plain double-click. First store notary credentials once
(`xcrun notarytool store-credentials`), then:

```bash
SIGN_ID="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE="lz-notary" \
npm run build:mac
```

What the build does under the hood:

- **Strips extended attributes** (`xattr -cr`) first — `cp -R` and Finder can attach
  detritus that makes `codesign` refuse the bundle.
- **Signs with the hardened runtime** (mandatory for notarization) and JIT entitlements
  (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`),
  since the daemon is a Bun / JavaScriptCore binary. It signs the bundle directly — no
  `--deep` (Apple deprecates it and it's unreliable for notarization).
- If `NOTARY_PROFILE` is set, it zips the app, submits with `notarytool submit … --wait`,
  staples the ticket, and runs `spctl --assess` to confirm.

Set both `SIGN_ID` and `NOTARY_PROFILE`. Signing without notarizing still leaves
downloaded builds showing "damaged" — notarization is the part that clears Gatekeeper.

> If `notarytool` returns a **403**, accept the latest App Store Connect / Apple
> Developer agreement in your account, then resubmit.

## Network & ports

Open these on whatever box runs the server:

| Port | Proto | Direction | What |
|------|-------|-----------|------|
| **7070** | TCP | inbound | UI + JSON API + the `/frames` WebSocket bridge (same port) |
| **9000** | UDP | inbound | OSC input (`OSC_PORT`) |
| **4048** | UDP | outbound | DDP pixel output to controllers |
| **6454** | UDP | outbound | Art-Net pixel output + discovery broadcast |

Notes:

- The WebSocket rides the **same** port as HTTP at `/frames` — there's no second port
  to open.
- Pixel output (DDP / Art-Net) is **outbound** from the server to the controllers, so
  it needs no inbound firewall rule — just keep the server and all devices on the same
  subnet.
- On the Pi, `PORT` defaults to **7070**; the systemd unit above moves the UI to 80 so
  you can drop the `:7070`.
- On macOS the first time the app sends DMX or scans, you'll get the **Local Network**
  prompt — click Allow. The first UDP bind may also pop the **firewall** dialog; signed
  apps are remembered. Ports 7070 / 4048 / 6454 / 9000 must be free.

### Control API

The daemon also serves a versioned HTTP + WebSocket **control API at `/api/v1`** —
status, devices, clips, blackout, per-device brightness, clip triggers and param
sets from anything on the LAN (shell scripts, Home Assistant, cron). It rides the
same port as the UI; set `LZ_API_TOKEN` in the service environment to require a
Bearer token. Full endpoint reference with curl examples:
[`docs/api.md`](../docs/api.md).

```bash
curl -s http://ledzeppelin.local/api/v1/status
curl -s -X POST http://ledzeppelin.local/api/v1/blackout -d '{"on":true}'
```

## Recovery

When something drops, work outward from the server:

- **Is anything rendering?** Hit the health snapshot first — it's the fastest triage:
  ```bash
  curl -s http://ledzeppelin.local/api/health   # version, uptime, fpsOut, clients
  ```
  `clients: 0` or `fpsOut: 0` means **nothing is painting** — no browser (or kiosk) is
  connected, so the daemon has no frames to stream. Open the show in a browser (or
  relaunch the Pi kiosk) and output resumes. The top-bar offline chip appears in the UI
  for the same condition, and opens `/health` when clicked.
- **Restart the daemon (Pi):**
  ```bash
  sudo systemctl restart ledzeppelin
  journalctl -u ledzeppelin -f      # watch it come back
  ```
  The unit has `Restart=always`, so a crash recovers on its own within a few seconds —
  this is for a manual kick.
- **Restart the daemon (desktop app):** quit and relaunch the binary / `.app`.
- **After a controller reboot:** a power-cycled WLED/QuinLED may come back on a new IP
  (DHCP). Open the [Output](04-devices-and-scanning.md) section (right-hand dock) and
  **Scan** (the button on the Output header, alongside + Controller / + Fixture); a
  scan shows live progress and drops found controllers into the list. If a device keeps
  moving, give it a DHCP reservation on the router so its IP is stable across reboots.
- **A single strip / output is dark:** the running show (the browser's localStorage
  copy) has probably drifted from the current preset — a fixture missing from the live
  show shifts every later DDP output downstream. Ground truth is the daemon, not the UI:
  ```bash
  curl -s http://ledzeppelin.local/api/debug/route   # per-device pixels / wireBytes / segments
  ```
  If the segment counts fall short of your fixture map, **reseed** by loading the show
  once with `?project=<file>` (see [`?project=`](#project-boot-straight-into-a-fixed-show)),
  confirm the pixel totals via `/api/debug/route`, then return to the plain URL.
- **Verify output:** use **Preview** (the wall button in the top bar) to dim the canvas
  and light only each fixture's sampled pixels — fast confirmation that the server is
  reaching every controller. See [Output & calibration](10-output-and-calibration.md).
- **Re-open the show:** the browser only needs `http://ledzeppelin.local` again; if the
  page is blank, the daemon is down — check `systemctl status ledzeppelin`.

_See also: [Devices & scanning](04-devices-and-scanning.md) · [Output & calibration](10-output-and-calibration.md) · [Troubleshooting](12-troubleshooting.md)._
