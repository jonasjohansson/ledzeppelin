# leap-osc

Native macOS app: reads an Ultraleap sensor via LeapC and streams normalized
`/leap/*` values as OSC/UDP to the LED Zeppelin daemon on `:9000`. Runs on the
Mac mini alongside the Ultraleap runtime.

## Build

```bash
cmake -S leap/osc -B build && cmake --build build
```

- With the LeapSDK present (`/Library/Application Support/Ultraleap/LeapSDK`, or
  `-DLEAPSDK_DIR=…`): `LeapC found — full build`.
- Without it: `LeapC NOT found — fake-only build` — builds, but only `--fake`
  runs.

The binary lands at `build/leap-osc`.

## Run

```bash
./build/leap-osc --verbose   # real sensor
./build/leap-osc --fake      # no hardware — spoofs a moving hand
```

Calibration lives in flags (`--help` lists them all).

See [`../../LEAP.md`](../../LEAP.md) for the full architecture, channel list,
calibration, editor binding, autostart, and debugging.
