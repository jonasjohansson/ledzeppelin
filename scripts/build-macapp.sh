#!/usr/bin/env bash
# Wrap the Bun-compiled binary + web assets into a macOS "Led Zeppelin.app" that a
# non-technical user can double-click. Optionally code-signs + notarizes so it opens
# without the Gatekeeper "Open Anyway" dance (needs an Apple Developer ID).
#
# Requires Bun. Usage:
#   scripts/build-macapp.sh [arm64|x64]     # default: arm64
# Signing (optional) via env:
#   SIGN_ID="Developer ID Application: Your Name (TEAMID)" \
#   NOTARY_PROFILE="lz-notary"   # a stored `xcrun notarytool store-credentials` profile
#   scripts/build-macapp.sh arm64
set -euo pipefail
cd "$(dirname "$0")/.."
command -v bun >/dev/null || { echo "bun not found — curl -fsSL https://bun.sh/install | bash"; exit 1; }

ARCH="${1:-arm64}"; TARGET="bun-darwin-$ARCH"
APP="dist/LEDZeppelin.app"; C="$APP/Contents"
rm -rf "$APP"; mkdir -p "$C/MacOS" "$C/Resources"

echo "→ compiling daemon ($TARGET)…"
bun build server/index.js --compile --minify --target "$TARGET" --outfile "$C/MacOS/ledzeppelin"
chmod +x "$C/MacOS/ledzeppelin"

echo "→ staging web assets into Resources…"
for p in index.html manifest.webmanifest favicon.svg service-worker.js src fonts icons control mappings; do
  [ -e "$p" ] && cp -R "$p" "$C/Resources/"
done

# App icon — build AppIcon.icns from the 512px logo so the .app/Dock/Finder show
# the LEDZeppelin mark instead of the generic blank icon.
ICON_SRC="icons/icon-512.png"
if [ -f "$ICON_SRC" ] && command -v sips >/dev/null && command -v iconutil >/dev/null; then
  echo "→ building app icon…"
  ICONSET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2)); sips -z "$d" "$d" "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$C/Resources/AppIcon.icns" && rm -rf "$(dirname "$ICONSET")"
else
  echo "  (skipped app icon — need $ICON_SRC + sips + iconutil)"
fi

VERSION=$(grep -oE "[0-9]+\.[0-9]+\.[0-9]+" src/version.js | head -1)
cat > "$C/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>LEDZeppelin</string>
  <key>CFBundleDisplayName</key><string>LEDZeppelin</string>
  <key>CFBundleIdentifier</key><string>se.jonasjohansson.ledzeppelin</string>
  <key>CFBundleVersion</key><string>${VERSION:-1.0.0}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION:-1.0.0}</string>
  <key>CFBundleExecutable</key><string>ledzeppelin</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <!-- It sends DDP/Art-Net + scans the LAN for controllers → macOS shows the
       Local Network permission prompt; this is the reason text. -->
  <key>NSLocalNetworkUsageDescription</key>
  <string>LEDZeppelin sends light data to and discovers LED controllers on your local network.</string>
</dict></plist>
PLIST

echo "✓ $APP"

if [ -n "${SIGN_ID:-}" ]; then
  echo "→ codesigning (hardened runtime)…"
  codesign --force --deep --options runtime --timestamp --sign "$SIGN_ID" "$APP"
  if [ -n "${NOTARY_PROFILE:-}" ]; then
    echo "→ notarizing…"; ZIP="dist/ledzeppelin.zip"
    ditto -c -k --keepParent "$APP" "$ZIP"
    xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$APP"; rm -f "$ZIP"
    echo "✓ signed + notarized"
  else echo "  (set NOTARY_PROFILE to also notarize)"; fi
else
  echo "  (unsigned — set SIGN_ID to codesign; macOS 15+ users otherwise need"
  echo "   System Settings ▸ Privacy & Security ▸ Open Anyway on first launch)"
fi
