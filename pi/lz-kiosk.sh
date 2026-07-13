#!/bin/bash
# LED Zeppelin kiosk launcher (Raspberry Pi, labwc/Wayland). Autostarted once at
# login via ~/.config/labwc/autostart and ~/.config/autostart/ledzeppelin-kiosk.desktop.
# Loads the PLAIN URL so the show persists in the browser's localStorage across reboots.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
[ -z "$WAYLAND_DISPLAY" ] && export WAYLAND_DISPLAY="$(cd "$XDG_RUNTIME_DIR" 2>/dev/null && ls wayland-* 2>/dev/null | grep -v "\.lock" | head -1)"
[ -z "$DBUS_SESSION_BUS_ADDRESS" ] && [ -S "$XDG_RUNTIME_DIR/bus" ] && export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
# Wait for the daemon before opening the page (up to 40s).
for i in $(seq 1 40); do curl -sf http://localhost:7070/api/health >/dev/null 2>&1 && break; sleep 1; done
# V3D: the RPi chromium wrapper injects --enable-gpu-rasterization (from
# /etc/chromium.d/default-flags), which CRASHES the V3D GPU process → white screen.
# We disable it at the source (see README) AND pass --disable-gpu-rasterization here
# (the wrapper execs `$CHROMIUM_FLAGS "$@"`, so our args win). NEVER add
# --ignore-gpu-blocklist. Keep only these known-safe flags.
exec chromium --kiosk --ozone-platform=wayland --js-flags= \
  --disable-gpu-rasterization \
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
  --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble --check-for-update-interval=31536000 \
  --user-data-dir="$HOME/.config/lz-kiosk" \
  "http://localhost:7070/"
