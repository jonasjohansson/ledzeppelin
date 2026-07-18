# Leap Motion → OSC

Hand tracking as a control source for LED Zeppelin. A native macOS C app
(`leap/osc/`) reads an Ultraleap sensor via LeapC and streams normalized
`/leap/*` values as OSC/UDP to the daemon, where they become **external
channels** any parameter can bind to. Everything runs locally on one Mac mini.

## 1. Architecture

`leap-osc` polls the tracker, normalizes each quantity to `0..1`, and sends one
OSC bundle per frame to the daemon's UDP listener on `:9000`. The daemon turns
every OSC address into an external channel and rebroadcasts each as
`{type:'ext', channel, value}` over its `/frames` websocket. In the editor a
parameter in **External** mode reads one of those channels. No network hop
leaves the machine — the Ultraleap runtime, the app, and the daemon all live on
the Mac mini.

```
┌─────────────────────────────  Mac mini  ─────────────────────────────┐
│                                                                       │
│  Ultraleap        leap-osc                daemon :9000                │
│  Hyperion   ───▶  LeapC → OSC   ──UDP──▶  external channels           │
│  service          (this app)              │                          │
│                                           │  /frames ws (type:'ext')  │
│                                           ▼                          │
│                                    editor params (External mode)      │
│                                    Mapping window (layer rows)        │
└───────────────────────────────────────────────────────────────────────┘
```

## 2. Mac mini setup

1. **Install the Ultraleap Hyperion runtime** (macOS, Apple Silicon). It
   provides the tracking service `leap-osc` talks to via LeapC.
2. **Verify the sensor is tracked FIRST.** Open Ultraleap's own visualizer and
   confirm a hand is recognized before touching this app. The macOS runtime is
   framed around the Leap Motion Controller 2 — if the original Leap Motion
   Controller is not tracked in the visualizer, use a Controller 2. The
   architecture is unchanged either way; `leap-osc` just needs a tracking
   service that reports hands.
3. **Download the LeapSDK.** CMake looks for it at the default install path
   `/Library/Application Support/Ultraleap/LeapSDK`.
4. **Build:**

   ```bash
   cmake -S leap/osc -B build && cmake --build build
   ```

   Expect `LeapC found — full build`. The binary is `build/leap-osc`. Without
   the SDK the build still succeeds but prints `LeapC NOT found — fake-only
   build (run with --fake)` and only `--fake` will run.

   If the SDK is installed somewhere else, point CMake at it:

   ```bash
   cmake -S leap/osc -B build -DLEAPSDK_DIR=/path/to/LeapSDK
   ```

## 3. Channels

Values are normalized `0..1`. With **one hand** the prefix is `/leap/hand/`;
with **two hands** each hand streams under `/leap/left/` and `/leap/right/`
(left/right by handedness, not screen position). `/leap/hands` is always sent.

When **no hand** is visible the app emits a relax frame under `/leap/hand/`:
`y`, `roll`, `pitch`, `yaw` = `0.5`, everything else = `0`, and
`/leap/hands` = `0`. Bound params therefore settle to a neutral resting state
rather than freezing on the last value.

| Channel            | Range        | Meaning |
|--------------------|--------------|---------|
| `/leap/hands`      | 0 / 0.5 / 1  | Hand count: `0` none, `0.5` one, `1` two |
| `<prefix>/x`       | 0..1         | Palm X (left→right) after range map + trim |
| `<prefix>/y`       | 0..1         | Palm Y (down→up) after range map + trim |
| `<prefix>/z`       | 0..1         | Palm Z (near→far) after range map + trim |
| `<prefix>/grab`    | 0..1         | Grab / fist strength |
| `<prefix>/pinch`   | 0..1         | Pinch strength |
| `<prefix>/roll`    | 0..1         | Palm roll, `0.5` = level |
| `<prefix>/pitch`   | 0..1         | Palm pitch, `0.5` = level |
| `<prefix>/yaw`     | 0..1         | Palm yaw, `0.5` = centered |
| `<prefix>/spread`  | 0..1         | Extended-finger spread |
| `<prefix>/point`   | 0 / 1        | Index-point gesture (gated by `--conf`) |
| `<prefix>/ball`    | 0 / 1        | Fist-or-point gesture (gated by `--conf`) |
| `<prefix>/vel`     | 0..1         | Palm speed, mapped over 0..1500 mm/s |

`<prefix>` is `/leap/hand` (one hand) or `/leap/left` + `/leap/right` (two).
`point` and `ball` only fire when the hand is confidently tracked — at the edge
of the field of view the Leap drops the fingers and reports a phantom fist, so
these gestures are gated behind the `--conf` confidence threshold.

## 4. Calibration flags

The `x`/`y`/`z` channels are built in two stages: a **range** maps raw palm
millimetres into `0..1`, then a **trim** re-stretches a `[floor..ceil]`
sub-range back out to fill `0..1`. Set the range to the physical box the hand
moves in; use the trim to discard dead margins at the extremes (e.g. a
`--yfloor 0.2` means the bottom 20% of the mapped Y range reads as `0`, and the
rest is re-expanded to `0..1`).

| Flag              | Default          | Meaning |
|-------------------|------------------|---------|
| `--fake`          | off              | Synthetic feed, no hardware (spoofs a moving hand) |
| `--verbose`       | off              | Log per-frame `hands=… msgs=…` to stderr |
| `--rate N`        | 40               | Send rate in Hz, clamped 1..120 |
| `--host ADDR`     | 127.0.0.1        | Destination host |
| `--port N`        | 9000             | Destination UDP port (the daemon's listener) |
| `--xlo` / `--xhi` | -200 / 200       | Palm X range, mm |
| `--ylo` / `--yhi` | 100 / 350        | Palm Y range, mm |
| `--zlo` / `--zhi` | -150 / 150       | Palm Z range, mm |
| `--xfloor` / `--xceil` | 0 / 1       | X trim on the mapped 0..1 |
| `--yfloor` / `--yceil` | 0 / 1       | Y trim on the mapped 0..1 |
| `--zfloor` / `--zceil` | 0 / 1       | Z trim on the mapped 0..1 |
| `--conf F`        | 0.2              | Gesture confidence gate for `point` / `ball` |
| `--help`          | —                | Print usage and exit |

## 5. Binding in the editor

External channels are a first-class modulation source.

- **Per parameter:** open a parameter's cog menu → **External** → pick a channel
  (e.g. `/leap/hand/x`). Gain and soft-takeover are built into External mode, so
  the parameter picks up the hand smoothly instead of jumping.
- **Per layer:** the **Mapping** window binds layer rows (opacity, bypass) to
  channels the same way — e.g. layer opacity ← `/leap/hands`.

## 6. The install rig recipe

A resilient interactive piece that never goes dark and glows toward the hand:

1. An **ambient clip** on the bottom layer, always playing — this is the baseline
   the piece falls back to when no one is present.
2. A **Spot** source (`generator`, added on this branch — params `centerX`,
   `centerY`, `radius`, `softness`, `color`) on a layer above, bound:
   - `centerX` ← `/leap/hand/x`
   - `centerY` ← `/leap/hand/y`
   - `radius`  ← `/leap/hand/grab`, using an **inverted** External range
     (e.g. `0.3 → 0.05`) so closing into a fist *tightens* the dot
   - layer **opacity** ← `/leap/hands` (Mapping window), so the glow only appears
     while a hand is present and fades out on the relax frame

Net effect: the ambient clip always plays; a raised hand adds a soft glow that
follows it and focuses to a point when the hand closes into a fist.

## 7. Autostart

Run the app on login via a LaunchAgent:

```bash
cp leap/osc/com.ledzeppelin.leap-osc.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.ledzeppelin.leap-osc.plist
```

Calibration flags live in the plist's `ProgramArguments` — tune them there per
install. The shipped values (`--ylo 190 --yfloor 0.2`) are placeholders, and the
binary path (`/usr/local/bin/leap-osc`) is wherever you copied or symlinked the
`build/leap-osc` output. Logs go to `/tmp/leap-osc.log`.

## 8. Debugging

- **Channel monitor:** open `http://localhost:7070/leap/`. Live bars plus an XY
  pad show exactly what the editor receives — every `/leap/*` channel the daemon
  rebroadcasts, with the true numeric value and a bar. The XY pad plots hand
  position and scales the dot by grab. If a channel appears here, a parameter can
  bind to it.
- **Per-frame logging:** run with `--verbose` to print `frame hands=N msgs=M`
  per tick to stderr, confirming the feed and send loop are alive.
- **No hardware:** `./build/leap-osc --fake` spoofs a moving hand so you can wire
  up and test bindings with no sensor attached. `--fake` works in either build.
