#!/bin/bash
# LED Zeppelin kiosk watchdog — self-heals a Pi that has stopped rendering
# (white screen / GPU wedge / power-flare hangover). "Rendering" is defined by the
# daemon's own health: a browser client is connected (clients>=1) AND frames are
# going out (fpsOut>=1). If not, escalate:
#   1. SOFT  — kill chromium, clear GPU/shader caches, relaunch the kiosk.
#   2. HARD  — reboot (only if the soft attempt already failed, uptime is past the
#              boot window, and we haven't already reboot-looped this episode).
# Sustained health clears all counters (episode over). Guards prevent reboot spam.
set -u
HEALTH="http://localhost:7070/api/health"
USER_NAME="jonas"; UID_N=1000
RUNTIME="/run/user/$UID_N"
KIOSK="/home/$USER_NAME/.local/bin/lz-kiosk.sh"
CFG="/home/$USER_NAME/.config/lz-kiosk"
STATE="/var/lib/lz-watchdog"; mkdir -p "$STATE"
REBOOTS_FILE="$STATE/reboots"; [ -f "$REBOOTS_FILE" ] || echo 0 > "$REBOOTS_FILE"

log(){ echo "$(date '+%F %T') $*"; }

relaunch_kiosk(){
  log "SOFT recovery: kill chromium, clear GPU caches, relaunch kiosk"
  pkill -9 -f chromium 2>/dev/null; sleep 3
  rm -rf "$CFG/ShaderCache" "$CFG/GrShaderCache" "$CFG/GraphiteDawnCache" \
         "$CFG/Default/GPUCache" "$CFG/Default/Code Cache" 2>/dev/null
  systemd-run --quiet --uid="$USER_NAME" \
    --setenv=XDG_RUNTIME_DIR="$RUNTIME" \
    --setenv=WAYLAND_DISPLAY=wayland-0 \
    --setenv=DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME/bus" \
    "$KIOSK" || log "systemd-run relaunch FAILED"
}

sleep 90            # boot grace: let the daemon + kiosk come up before judging
fails=0; softdone=0
while true; do
  H=$(curl -s --max-time 5 "$HEALTH" 2>/dev/null)
  if [ -z "$H" ]; then log "daemon unreachable — systemd owns the daemon, waiting"; sleep 30; continue; fi
  clients=$(echo "$H" | grep -oE '"clients":[0-9]+' | grep -oE '[0-9]+$'); clients=${clients:-0}
  fps=$(echo "$H" | grep -oE '"fpsOut":[0-9]+' | grep -oE '[0-9]+$'); fps=${fps:-0}
  up=$(cut -d. -f1 /proc/uptime)

  if [ "$clients" -ge 1 ] && [ "$fps" -ge 1 ]; then
    [ "$fails" -ne 0 ] && log "healthy again (clients=$clients fps=$fps) — reset"
    fails=0; softdone=0; echo 0 > "$REBOOTS_FILE"
    sleep 30; continue
  fi

  fails=$((fails+1))
  log "UNHEALTHY clients=$clients fps=$fps up=${up}s fails=$fails softdone=$softdone"

  # First escalation: relaunch the kiosk after 3 sustained fails (~90s).
  if [ "$softdone" -eq 0 ] && [ "$fails" -ge 3 ]; then
    relaunch_kiosk; softdone=1; fails=0; sleep 90; continue
  fi

  # Second escalation: reboot, only if the relaunch already failed to help.
  if [ "$softdone" -eq 1 ] && [ "$fails" -ge 4 ] && [ "$up" -gt 240 ]; then
    reboots=$(cat "$REBOOTS_FILE" 2>/dev/null || echo 0)
    if [ "$reboots" -lt 2 ]; then
      log "HARD recovery: reboot (attempt #$((reboots+1)) this episode)"
      echo $((reboots+1)) > "$REBOOTS_FILE"; sync
      systemctl reboot; sleep 120
    else
      log "reboot limit hit (2) — a reboot isn't fixing it; leaving for manual help"
      sleep 120
    fi
  fi
  sleep 30
done
