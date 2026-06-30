# Troubleshooting & FAQ

> **Status: outline — draft in progress.** Common first-run snags and fixes.

## What this page will cover
- **Nothing lights up** — checklist: daemon running? Local Network permission allowed? device
  IP correct/online (status dot)? fixture patched? canvas actually showing visuals?
- **Reds and greens swapped** → wrong **colour order** (try GRB).
- **First 170 pixels work, rest dark** (Art-Net) → **universe** mismatch.
- **macOS "is damaged and can't be opened"** → unsigned/quarantined download; fix is a
  notarized build, or `xattr -dr com.apple.quarantine "LED Zeppelin.app"`.
- **macOS Local Network prompt** — must click Allow; how to re-enable in System Settings.
- **Windows SmartScreen** — More info → Run anyway.
- **Port already in use** (7070/4048/6454/9000) — what's conflicting.
- **A scanned controller doesn't appear** — (fixed) it now shows immediately on ADD.
- **Editor opens but can't stream** — you're on the hosted site, not the local app.

_See also: [Getting started](03-getting-started.md), [Deploying](11-deploying.md)._
