#!/usr/bin/env bash
# Build a Node-FREE ledzeppelin into dist/<target>/ — a single self-contained binary
# (the daemon: server/*.js + ws, bundled by Bun) plus the web assets it serves.
# The end user needs no Node.js install; they run the binary and the UI opens.
#
# Requires Bun:  curl -fsSL https://bun.sh/install | bash
# Usage:
#   scripts/build-app.sh                 # build for THIS machine
#   scripts/build-app.sh bun-darwin-arm64 bun-darwin-x64 bun-windows-x64 bun-linux-x64
set -euo pipefail
cd "$(dirname "$0")/.."

command -v bun >/dev/null || { echo "bun not found — install: curl -fsSL https://bun.sh/install | bash"; exit 1; }

# Web assets the daemon serves over HTTP (NOT the server JS — that's compiled in).
ASSETS=(index.html manifest.webmanifest favicon.svg service-worker.js src fonts icons control mappings inventory examples)

build_one() {
  local target="$1" outdir bin
  if [ -z "$target" ]; then outdir="dist/host"; else outdir="dist/$target"; fi
  bin="ledzeppelin"; case "$target" in *windows*) bin="ledzeppelin.exe";; esac
  rm -rf "$outdir"; mkdir -p "$outdir"

  echo "→ compiling daemon ${target:+($target)}…"
  local flags=(build server/index.js --compile --minify --outfile "$outdir/$bin")
  [ -n "$target" ] && flags+=(--target "$target")
  bun "${flags[@]}"

  echo "→ staging web assets…"
  for p in "${ASSETS[@]}"; do [ -e "$p" ] && cp -R "$p" "$outdir/"; done
  echo "✓ $outdir/$bin"
}

if [ "$#" -eq 0 ]; then build_one ""; else for t in "$@"; do build_one "$t"; done; fi
echo
echo "Run the binary, then open http://localhost:7070 (it opens automatically)."
