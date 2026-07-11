# Leap Motion → LED Zeppelin

Control LED Zeppelin parameters with a Leap Motion controller. Hand position,
grab, pinch, rotation and finger spread are streamed as external channels that
any parameter can bind to.

## Prerequisites

1. **Leap Motion Controller** (original or Ultraleap Stereo IR 170) and its
   drivers — downloads (easy to lose track of, since Ultraleap's site buries
   them) are at
   [ultraleap.com/downloads/leap-controller](https://www.ultraleap.com/downloads/leap-controller/).
2. **Ultraleap Tracking Software** (Gemini V5+ / Hyperion V6) — or the classic
   Leap Motion SDK V4 with _"Allow Web Apps"_ enabled in the control panel.
3. The **Ultraleap Tracking WebSocket** server running (exposes hand data at
   `ws://127.0.0.1:6437`). If using Gemini V5+/Hyperion, build the copy vendored
   at [`bridge/`](bridge/) — it patches crash/CPU bugs in upstream
   [ultraleap/UltraleapTrackingWebSocket](https://github.com/ultraleap/UltraleapTrackingWebSocket),
   see [`bridge/README.md`](bridge/README.md) for build steps.

## Quick start — browser page

The easiest way: open the built-in page in your browser alongside the editor.

1. Start LED Zeppelin as usual (`npm start` or the app).
2. Open **`http://localhost:7070/leap/`** in a browser tab.
3. Hold your hand over the Leap sensor — the page shows a live visualisation
   and the channel values streaming to the editor.
4. In the editor, set any parameter's modulation to **External** and pick a
   `/leap/…` channel from the dropdown.

## Quick start — Node bridge (headless)

For a headless setup (no browser tab needed), run the Node bridge script:

```bash
npm install ws           # one-time dependency
node leap-bridge.js      # uses defaults (Leap on :6437, LZ on :7070)
```

Options:

| Flag      | Default                          | Description                  |
|-----------|----------------------------------|------------------------------|
| `--leap`  | `ws://127.0.0.1:6437/v7.json`   | Leap WebSocket URL           |
| `--lz`    | `ws://127.0.0.1:7070/frames`    | LED Zeppelin daemon URL      |
| `--rate`  | `40`                             | Send rate in Hz              |

```bash
# Example: LED Zeppelin on a different machine
node leap-bridge.js --lz ws://192.168.1.50:7070/frames
```

## Available channels

| Channel              | Range | Description                             |
|----------------------|-------|-----------------------------------------|
| `/leap/hands`        | 0–1   | Number of hands (0 / 0.5 / 1)          |
| `/leap/hand/x`       | 0–1   | Palm position left → right              |
| `/leap/hand/y`       | 0–1   | Palm height (low → high)                |
| `/leap/hand/z`       | 0–1   | Palm depth (near → far)                 |
| `/leap/hand/grab`    | 0–1   | Grab strength (open → fist)             |
| `/leap/hand/pinch`   | 0–1   | Pinch strength (open → pinched)         |
| `/leap/hand/roll`    | 0–1   | Palm roll (0.5 = level)                 |
| `/leap/hand/pitch`   | 0–1   | Palm pitch (0.5 = level)                |
| `/leap/hand/yaw`     | 0–1   | Palm yaw (0.5 = forward)               |
| `/leap/hand/spread`  | 0–1   | Finger spread                           |
| `/leap/hand/vel`     | 0–1   | Hand speed (clamped)                    |

When two hands are visible, separate channels appear with `/leap/left/…` and
`/leap/right/…` prefixes instead of `/leap/hand/…`.

## Mapping in the editor

External channels bind through **System › Mapping** (the toolbar **MAPPING**
button), not a per-parameter "External" mode:

1. Point the hand at the sensor so channels are streaming.
2. In the Mapping window, find the target row and pick the `/leap/…` channel from
   its **MIDI** cell dropdown.
3. Back on the parameter, adjust the **in/out** range (swap them to invert).

> For the full setup — calibration flags, the Kagora height (tent) remap, the Spot
> generator, the point/fist gesture switch, and troubleshooting — see
> [`../LEAP.md`](../LEAP.md).

## Troubleshooting

- **No Leap dot**: Check that the Ultraleap tracking software is running and
  the WebSocket server is active on port 6437. Try opening
  `ws://127.0.0.1:6437/v7.json` in a WebSocket test tool.
- **No LZ dot**: Make sure LED Zeppelin's daemon is running (`npm start`).
- **Jittery values**: Lower the `--rate` or try `--rate 20`. You can also
  smooth values in the editor using the gain/ease settings on each parameter.
