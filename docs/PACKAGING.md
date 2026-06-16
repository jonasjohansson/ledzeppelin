# Packaging — a Node-free app

ledzeppelin is a static web UI **plus** a tiny Node daemon (`server/`) that does the
things a browser can't: raw **UDP** (DDP 4048, Art-Net 6454, OSC-in 9000), UDP
**broadcast** (Art-Net discovery), LAN WLED scan, and it serves the UI on `:7070`.
So we can't ship "just a web page" — we need a native runtime. But the daemon is
pure ESM with **one dependency (`ws`)** and **no native addons**, so it compiles to
a single self-contained binary. End users need **no Node.js install**.

We use **Bun's** `--compile` (smallest effort that supports `node:dgram` + broadcast
+ `ws`; cross-compiles to mac/Win/Linux from one machine). `@yao-pkg/pkg` is the
"real Node" fallback if Bun ever misbehaves.

## One-time: install Bun
```
curl -fsSL https://bun.sh/install | bash
```

## Build a runnable folder (any OS)
```
npm run build:app                 # for this machine → dist/host/
# or specific targets:
scripts/build-app.sh bun-darwin-arm64 bun-darwin-x64 bun-windows-x64 bun-linux-x64
```
Each `dist/<target>/` has the `ledzeppelin` binary + the web assets it serves. Run
the binary; it serves `http://localhost:7070` and opens your browser automatically.

## Build a macOS .app (double-clickable)
```
npm run build:mac                 # → "dist/Led Zeppelin.app" (arm64; pass x64 for Intel)
```
The bundle carries `NSLocalNetworkUsageDescription` (the LAN-permission prompt
reason). **Unsigned**, macOS 15+ makes users go through System Settings ▸ Privacy &
Security ▸ "Open Anyway" on first launch. To avoid that, sign + notarize with an
Apple Developer ID:
```
SIGN_ID="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE="lz-notary" \      # from: xcrun notarytool store-credentials
npm run build:mac
```

## How assets are found
`server/index.js` resolves its web-asset root: the repo root in dev; next to the
executable (or `../Resources` in a `.app`) when compiled. So the build just copies
the assets beside the binary — no embedding step.

## First-run gotchas (macOS)
- **Local Network** prompt the first time it sends DMX / scans — the user clicks Allow.
- The first UDP bind may pop the **firewall** dialog; signed apps are remembered.
- Ports 7070 / 4048 / 6454 / 9000 must be free.
