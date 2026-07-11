# Leap Motion → LED Zeppelin

Control LED Zeppelin with a Leap Motion controller: hand position, grab/pinch,
finger pointing and a point/fist gesture stream in as external channels that any
parameter (or layer opacity / bypass) can bind to.

```
Leap service                leap-bridge.js            LED Zeppelin daemon
ws://127.0.0.1:6437   ──▶    (this script)    ──▶    ws://127.0.0.1:7070/frames
(hand tracking)              normalises to             (npm start)
                             /leap/hand/* 0..1
```

`leap-bridge.js` is a standalone Node script (not part of the `npm` scripts). It
auto-reconnects to both ends, so you can start it before either is ready.

## ⚠️ Runtime: needs the LEGACY protocol, not Gemini's own one

The bridge speaks the legacy LeapJS WebSocket protocol on **port 6437**. Ultraleap
Gemini (V5+, the current "Ultraleap Hand Tracking" install) dropped this
protocol — no "Allow Web Apps" toggle, `ECONNREFUSED 127.0.0.1:6437` forever —
so you need something in front of it that re-speaks v6/v7. Two ways to get that,
depending on which runtime you actually have installed:

- **Legacy runtime (V2 "Desktop" / Orion)** exposes it natively at
  `ws://127.0.0.1:6437/v7.json` — nothing extra to build.
- **Modern Gemini/Hyperion runtime** (what "Ultraleap Hand Tracking" installs
  today) needs [`leap/bridge/`](leap/bridge/) built and running first — a
  small vendored, patched C WebSocket server
  ([`ultraleap/UltraleapTrackingWebSocket`](https://github.com/ultraleap/UltraleapTrackingWebSocket))
  that re-exposes port 6437 at `/v6.json`. See [`leap/bridge/README.md`](leap/bridge/README.md)
  for the build steps and why it's patched (upstream crashes on connect and
  pegs a CPU core). If you're on this path, pass `--leap ws://127.0.0.1:6437/v6.json`
  to `leap-bridge.js` (its default below is `/v7.json`, for the legacy runtime).

The original Leap Controller hardware works with both runtimes; it's the
*software* that matters.

```powershell
Test-NetConnection 127.0.0.1 -Port 6437   # TcpTestSucceeded : True  → server is live
```

## ⚠️ Run ONLY ONE bridge

There are two ways to feed the editor and you must use **exactly one**, or the same
channel arrives from two sources with different mappings and params flip/glitch:

- **`node leap-bridge.js`** — the headless bridge (recommended; this is what the
  calibration flags below apply to).
- **the `/leap/` browser page** (`http://localhost:7070/leap/`) — a visualiser +
  debugger. Its **"stream to LZ" checkbox is OFF by default** precisely so it does
  NOT double-feed the bridge. Leave it off unless the bridge isn't running.

A backgrounded `/leap/` tab that's streaming is the classic "glitches ~once a
second" bug (the browser throttles it to ~1 Hz).

## Run it

1. `npm start` (daemon on `:7070`).
2. Make sure the legacy Leap service is up (check port 6437 above).
3. `node leap-bridge.js` — with calibration flags once tuned, e.g.
   `node leap-bridge.js --ylo 190 --yhi 300 --yfloor 0.2`

## Channels

Per hand, prefixed `/leap/hand/…` (one hand) or `/leap/left/…` + `/leap/right/…`
(two hands). All 0..1.

| Channel   | Meaning                                             |
|-----------|-----------------------------------------------------|
| `x y z`   | palm position (left→right, low→high, near→far)      |
| `grab`    | fist strength (open→closed)                         |
| `pinch`   | pinch strength                                      |
| `roll pitch yaw` | palm orientation (0.5 = level/forward)       |
| `spread`  | finger spread                                       |
| `vel`     | hand speed (clamped)                                |
| `point`   | index-point gesture: index out, ≤1 of the other three out (1/0) |
| `ball`    | fist **OR** point (1/0) — one trigger for both      |
| `/leap/hands` | number of hands (0 / 0.5 / 1)                   |

Gesture channels (`grab`/`point`/`ball`) only report when the hand is confidently
tracked (see `--conf`) — at the sensor's edge the Leap invents a fist.

> **Aiming note:** the original Leap can't resolve finger *direction* reliably once
> the hand turns (a level finger's vertical reads ±0.15 of noise at `conf:1.0`), so
> use **palm `x`/`y`** to position the ball — not finger pointing. A future Ultraleap
> Gemini device tracks fingers well enough to revisit finger-aim.

## Calibration flags

Positions map a mm range → 0..1 per axis; trims re-stretch the 0..1 reading to cut
a noisy edge; the rest gate/scale gestures.

| Flag | Default | Purpose |
|------|---------|---------|
| `--rate` | `40` | send rate (Hz) |
| `--xlo/--xhi` | `-200/200` | palm X range (mm) |
| `--ylo/--yhi` | `100/350` | palm Y range (mm) — height above sensor |
| `--zlo/--zhi` | `-150/150` | palm Z range (mm) |
| `--xfloor/--xceil` etc. | `0/1` | trim: readings ≤floor pin to 0, ≥ceil to 1, rescaled |
| `--conf` | `0.2` | min hand-tracking confidence for gesture channels |
| `--leap` / `--lz` | — | override the WebSocket URLs |

**Tuning height:** watch the bound param's live value (or the `/leap/` page). At
your lowest hand it should read ~0 (raise `--ylo`/`--yfloor` if it floors above 0);
at your highest, ~1 (lower `--yhi` if it never reaches the top). The original Leap
rarely tracks a hand below ~190 mm, so `--ylo 190` is a good start.

## Mapping in the editor

**There is no "External" mode in the parameter cog menu** — external channels bind
through **System › Mapping** (the toolbar **MAPPING** button opens it).

1. Point the hand at the sensor so channels are streaming.
2. In the Mapping window, find the target row (a clip param, or **Layer Opacity** /
   **Layer Bypass**). Its **MIDI** cell is a **dropdown** — pick the channel
   (e.g. `/leap/hand/y`) directly. (The "⊙ learn" option is move-to-bind for real
   MIDI gear; the dropdown is easier for Leap.)
3. Back on the param, the **in/out** fields set the output range — swap them
   (in 1, out 0) to invert an axis.

## Height in 3D (Plane Sweep)

Since the 3D update the dome stands in real space, so **height is a true axis** — no
canvas trickery. Place the Kagora arches and light them by height:

1. **Stand the arches up.** Enter **3D** (toolbar) — 3D always samples through the
   fixed front-ortho camera, so lifted geometry is used automatically (no projection
   choice). Select all fixtures → **Position → shape → Bezier** → raise **Arc Z**
   until the dome looks right. Each strip becomes a standing arch with real per-LED z
   (feet z=0, crest at the apex).
2. **Add a Plane Sweep** volumetric clip (clip picker → **Volumetric** group), set
   **axis = z**, and bind its **`pos` → `/leap/hand/y`** in the Mapping window. A
   horizontal plane now climbs the arches as you raise your hand — evaluated at each
   LED's real height.

Notes:
- **Volumetrics light the LEDs, not the canvas** — the result shows on the LED dots
  in the 3D viewport and the wall Preview, never on the 2D canvas. Toggle the
  **FIELDS** chip (projection row) to ghost the plane's position, and **⟲** resets
  the orbit view if you get lost.
- **`pos` is absolute world-z** (0 = feet/canvas plane, up to your apex ≈ Arc Z ÷
  canvas-height-px). Park it too high and the plane floats above the dome in empty
  air. Set the `/leap/hand/y` binding's **in = 0** (feet), **out ≈ apex z**.
- The old flat workaround ([`scripts/tent-remap.mjs`](scripts/tent-remap.mjs) —
  faking height by reshaping canvas sampling into a ∩) is **superseded** by real 3D;
  it's kept only for flat / pre-3D rigs.

## The gesture switch (plane ⇄ ball)

Two sources, switched by the point/fist gesture:
- **Plane Sweep** (height) — `pos ← /leap/hand/y`, as above.
- **Sphere Pulse** (a positioned ball, the 3D cousin of the 2D **Spot** generator) —
  bind `centerX / centerY / centerZ ← /leap/hand/x`, `/y`, `/z` so it rides the dome
  at your hand's position.

**Open hand = plane, point/fist = ball** — a hard switch via momentary Layer Bypass:

- **Plane-sweep layer on top**, blend **Normal (Alpha)**, 100% opacity.
- **Sphere-pulse layer below**, always active.
- Bind the **top layer's Bypass ← `/leap/hand/ball`**, mode **momentary**.

Open hand → the top layer covers the one below; point or clench → `/leap/hand/ball`
= 1 → the top layer bypasses → the ball is revealed. Momentary = a hard threshold at
50% (no crossfade).

**Axis direction:** LED Zeppelin's canvas Y is top-down and the Front camera's up is
flipped, so a Leap axis can feel reversed. Fix it on the binding — set **in 1 /
out 0** on whichever of x/y/z is backwards.

(**Spot** — a flat 2D radial dot, `centerX/centerY/radius/softness` — remains in the
generator list for non-3D rigs.)

## Debug page

`http://localhost:7070/leap/` shows a hand visualiser, every channel as a live bar,
and a per-finger line (`▮` extended / `▯` curled) with `point`, `grab` and `conf`
— handy for diagnosing gesture detection. Keep **"stream to LZ" off** while the node
bridge is running.

## Troubleshooting

- **`ECONNREFUSED :6437`** — legacy Leap runtime not running (see Runtime above).
- **Glitches ~1×/sec** — two bridges feeding at once; close the `/leap/` tab (or
  untick its stream box).
- **A bound dropdown won't open / snaps shut** — fixed; the Mapping window no longer
  rebuilds on the editor's 2 s param re-push.
- **Ball pops in at the edges** — the Leap fakes a fist when it loses the fingers;
  raise `--conf` (e.g. `0.4`).
- **Fingers all read `▯` / `spread` stuck at 0** — the frame keeps fingers in a
  top-level `pointables` array (not `hand.fingers`); the bridge attaches them, so
  make sure you're on the current `leap-bridge.js`.
