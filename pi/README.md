# Raspberry Pi provisioning (the permanent install)

These are the Pi-side files that live *outside* the app but make the install run
headless and self-heal. Kept here so a reflash is reproducible. The app itself is the
Node daemon (`server/index.js`) run by `ledzeppelin.service`; rendering is client-side
in a Chromium kiosk. See the `pi-deployment` project memory for the fuller picture.

## Files
- **`lz-kiosk.sh`** → `~/.local/bin/lz-kiosk.sh` — the kiosk launcher (Wayland env +
  daemon wait + V3D-safe Chromium flags). Autostarted by labwc + XDG autostart.
- **`lz-watchdog.sh`** → `/usr/local/bin/lz-watchdog.sh` — self-heal watchdog: if the
  daemon reports not-rendering (`clients:0`/`fpsOut:0`) it relaunches the kiosk, then
  reboots as a last resort (with loop guards).
- **`lz-watchdog.service`** → `/etc/systemd/system/lz-watchdog.service` — runs the
  watchdog, `Restart=always`, enabled at boot.

## The V3D white-screen fix (critical)
`/usr/bin/chromium` is a wrapper that sources `/etc/chromium.d/*` and force-injects
`--enable-gpu-rasterization`, which crashes the V3D GPU → white screen on boot. Disable
it at the source (belt-and-braces with the `--disable-gpu-rasterization` in lz-kiosk.sh):

```bash
sudo sed -i 's/^\(export CHROMIUM_FLAGS=.*--enable-gpu-rasterization.*\)/#DISABLED-for-V3D# \1/' /etc/chromium.d/default-flags
```

## Install
```bash
# kiosk launcher
install -m 755 pi/lz-kiosk.sh ~/.local/bin/lz-kiosk.sh
# watchdog + service
sudo install -m 755 pi/lz-watchdog.sh /usr/local/bin/lz-watchdog.sh
sudo install -m 644 pi/lz-watchdog.service /etc/systemd/system/lz-watchdog.service
sudo mkdir -p /var/lib/lz-watchdog
sudo systemctl daemon-reload
sudo systemctl enable --now lz-watchdog.service
```

## Health check
`curl -s http://localhost:7070/api/health` → expect `clients:1, fpsOut>0`.
