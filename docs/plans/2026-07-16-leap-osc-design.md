# Leap Motion via OSC — design

**Date:** 2026-07-16
**Status:** approved
**Supersedes:** the `leapmotion` branch's transport (leap-bridge.js + legacy WS protocol). The branch's channel semantics, calibration logic, Spot generator, and docs carry forward.

## Context

The `leapmotion` branch (14 commits, unmerged) feeds Leap Motion hand tracking
into the editor as external channels. It predates two things main has since
grown: a native **OSC/UDP input** on the daemon (`server/index.js` — any OSC
address with a numeric arg becomes an external channel) and the per-param
**External** modulation mode (`src/model/anim.js` — bindable from every param
cog, with gain and soft-takeover). The branch therefore built its own
transport: a vendored, patched C WebSocket server resurrecting the legacy
LeapJS protocol, re-parsed by a Node script (`leap-bridge.js`).

Deployment target: a **visitor-interactive installation running on a Mac
mini** — Ultraleap Hyperion runtime, our app, the daemon, and the render all
on one machine, OSC over localhost. The app is built on the mini itself.

## Decision

Collapse the two-process chain into one native app that speaks the daemon's
existing language:

```
Hyperion service → leap-osc (LeapC → normalize/calibrate → OSC/UDP) → daemon :9000
```

No "Leap Effect" — effects transform pixels; Leap produces control signals,
and any effect/source/layer param can already bind to `/leap/*` channels via
External mode. The visual half is a **Source** (Spot generator, from the
branch).

## Components

### 1. `leap-osc` — native macOS app (new, evolved from `leap/bridge`)

- Keep the vendored bridge's LeapC connection code (`main.c`/`utils.c`),
  including its two upstream patches (connect-crash, CPU-spin).
- Delete the legacy-WebSocket-server output; add a small OSC/UDP encoder
  (~50 lines of C, no dependency) targeting the daemon's OSC port
  (default `127.0.0.1:9000`, overridable).
- Port normalization/calibration from `leap-bridge.js`, same CLI flags:
  axis mm-ranges (`--xlo/--xhi` …), floor/ceil trims, `--conf` gesture
  gating, `--rate`, tent (height) remap. The branch's unit tests
  (`test/leap-bridge.test.js`, `test/tent-remap.test.js`) define expected
  behavior; port them against the C logic's reference implementation or a
  test harness.
- Same channel scheme as the branch: `/leap/hand/*` (one hand),
  `/leap/left/*` + `/leap/right/*` (two), `/leap/hands` count; all 0..1.
  Channels: x y z, grab, pinch, roll pitch yaw, spread, vel, point, ball.
- Runs as a LaunchAgent on the mini (autostart, keepalive). LeapC handles
  service reconnects.
- Built on the mini with CMake against the Hyperion LeapC SDK.

### 2. LED Zeppelin (cherry-picks from the branch; no daemon changes)

- **Spot generator** — positionable radial dot Source (`bdfabfc`), the
  visual anchor for hand presence.
- **Mapping-window channel picker** + dropdown fix (`a65130c`).
- **`/leap/` visualizer page** — repoint from the dead legacy protocol to
  the daemon's client socket (channels are already rebroadcast to clients);
  keep its "stream to LZ" path out (no double-feed risk once OSC is the
  only transport).
- **Docs** — rewrite LEAP.md for the OSC architecture (it currently
  documents the superseded transport and wrongly claims External mode
  doesn't exist).
- **Retire:** `leap-bridge.js`, the C bridge's WS server role, the
  run-only-one-bridge footgun.

### 3. Interaction rig (project configuration, not code)

Default shipped rig (sample project, replacing `leapmotion-project.json`):
ambient show keeps playing; a Spot/glow source rides on top with opacity
bound to `/leap/hands`, position to palm x/y, grab as a pulse. Instant
feedback, never goes dark, no scene snapping — right default for an
unattended install. Full takeover is a different binding, not a feature.

## Risks

- **Original Leap Motion Controller on macOS Hyperion** — the macOS runtime
  is framed around Controller 2; the install hardware is the original.
  **Verify on the mini first.** If unsupported: get a Controller 2 (same
  channels, better tracking) rather than change architecture.
- OSC/UDP is fire-and-forget on localhost — acceptable; channel values are
  idempotent absolute levels at ~40 Hz.

## Testing

- Channel math (normalize, trims, tent remap, gesture gating): unit tests
  ported from the branch.
- End-to-end: `oscsend`-style synthetic packets → daemon → External-bound
  param moves (no hardware needed); then hardware smoke test on the mini.
