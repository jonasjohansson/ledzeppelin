# Deploying Led Zeppelin on a Raspberry Pi

Goal: the show server **boots on power-on**, **restarts on crash**, and is reachable
on the LAN at **`http://ledzeppelin.local`** so you can open the editor in any browser
and run/edit shows. Rendering happens client-side in the browser — the Pi only serves
files and streams pixel output (DDP/Art-Net) — so **Raspberry Pi OS Lite (no desktop)**
is all you need.

## What the app needs (from `server/index.js` + `package.json`)
- Entry: `node server/index.js` (the `start` script). **Don't** use `launch` / `OPEN=1` (it tries to open a browser — pointless on a headless Pi).
- One HTTP server serves the editor, `/control/`, and the JSON API; the WebSocket bridge rides the **same port** at `/frames` (no separate port to open).
- Ports: HTTP `PORT` (default **7070**); OSC input `OSC_PORT` (default **9000/udp**).
- Only runtime dep is `ws` (pure JS — no native build). `playwright` is dev-only; install with `--omit=dev` to skip its browser download.

## 1. Flash the OS
Use **Raspberry Pi Imager** → *Raspberry Pi OS Lite (64-bit, Bookworm)*. In the ⚙ OS-customisation before writing, set:
- **hostname:** `ledzeppelin`  (→ gives you `ledzeppelin.local`)
- **username/password** (e.g. `led`), and **enable SSH**
- Wi-Fi only if you can't use Ethernet (wired is steadier for lighting output)

## 2. Node (NodeSource — system-wide, predictable path)
```bash
ssh led@ledzeppelin.local
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v24.x ; which node → /usr/bin/node
```

## 3. Code + production deps
```bash
cd ~ && git clone https://github.com/jonasjohansson/ledzeppelin.git
cd ledzeppelin && npm ci --omit=dev      # installs only ws; skips playwright
PORT=7070 node server/index.js           # smoke test, then Ctrl-C
```

## 4. systemd service — boot on start + restart on crash
Binds **port 80** via `AmbientCapabilities` (survives Node upgrades, no `setcap` needed).
Adjust `User`/paths to your user.
```ini
# /etc/systemd/system/ledzeppelin.service
[Unit]
Description=Led Zeppelin LED show server
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
(Prefer port 7070? set `Environment=PORT=7070`, drop the two capability lines, and use `http://ledzeppelin.local:7070`.)

## 5. mDNS (`ledzeppelin.local`)
Pi OS ships `avahi-daemon`, so the hostname resolves on the LAN out of the box
(`systemctl status avahi-daemon`). macOS/iOS/Linux/Win10+ all resolve `.local`.
If it's flaky, the network is likely blocking multicast (guest/client-isolation Wi-Fi)
or routing across subnets — fall back to a DHCP-reserved static IP.

## 6. Firewall (only if `ufw` is enabled)
```bash
sudo ufw allow 80/tcp      # HTTP + WebSocket (same port)
sudo ufw allow 9000/udp    # OSC input
sudo ufw allow ssh
```
DDP/Art-Net to the LED controllers is **outbound** — no inbound rule needed; just keep
the Pi and controllers on the same subnet.

## 7. Running vs updating
- **Run/edit a show:** no Pi access — open `http://ledzeppelin.local` in a browser; the phone surface is `http://ledzeppelin.local/control/`.
- **Update the code:**
  ```bash
  ssh led@ledzeppelin.local
  cd ~/ledzeppelin && git pull && npm ci --omit=dev
  sudo systemctl restart ledzeppelin
  ```

## Gotchas
- Run as a **non-root** user; bind port 80 via the unit's `AmbientCapabilities` (not root).
- `--omit=dev` keeps Playwright (and its big browser download) off the Pi.
- No GL/display packages needed — rendering is client-side in the browser.
- WebSocket = same port as HTTP (`/frames`) — don't look for a second port.
- If a future version writes files into its own folder, don't add `ProtectHome=read-only` to the unit.
