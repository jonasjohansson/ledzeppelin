# Deploying the install

> **Status: outline — draft in progress.** Running LED Zeppelin permanently. Will consolidate
> the existing `docs/deploy-raspberry-pi.md` and `docs/PACKAGING.md`.

## What this page will cover
- The **permanent install** model (the 12-QuinLED target): always-on, headless.
- **Raspberry Pi** deployment (link/absorb `deploy-raspberry-pi.md`): autostart as a service.
- **Packaging / builds** (link/absorb `PACKAGING.md`): the Node-free single-binary app per OS.
- **macOS signing & notarization** for distributable builds (so downloads aren't "damaged").
- Network/firewall notes: ports **7070** (UI), **4048** (DDP), **6454** (Art-Net), **9000** (OSC).
- Recovery: restarting the daemon, reconnecting after a controller reboot.

_See also: [Troubleshooting](12-troubleshooting.md)._
