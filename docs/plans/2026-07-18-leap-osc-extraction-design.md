# leap-osc Extraction — Design

**Goal:** Make `leap-osc` its own standalone, **private** repo — a self-contained LeapC→OSC hand-tracking bridge that just emits OSC. LED Zeppelin retains **nothing leap-specific**; it consumes `/leap/*` (like any OSC source) through its existing generic OSC-in → external-channel → mapping system, so a hand gesture maps to a trigger / param / layer exactly the way a MIDI controller or TouchOSC would.

This is phase **A** of an agreed A→B: extract the headless bridge now; grow a standalone UI (calibration + monitor) later.

## Why standalone

Leap tooling is conventionally its own software (Leap Control Panel, Visualizer, GECO, Aum, BrettUI). The bridge already talks to LZ **only over UDP/OSC** — zero runtime coupling — and is a clean, dependency-free subproject. Nothing about it is LED-Zeppelin-specific.

## The split

**Moves to the new `leap-osc` repo (private, `github.com/jonasjohansson/leap-osc`):**
- The entire `leap/` tree: the C app (`leap/osc/*` — `channels`, `osc`, `main`, `feed*`, `CMakeLists.txt`, `run-tests.sh`, `test_*.c`, `README.md`, plist) **and** the `/leap/` monitor (`leap/index.html`).
- `LEAP.md` becomes the repo's README/docs.
- **With git history** via `git subtree split` on `leap/`, so the TDD/review history comes along.
- The `leap-cleanup` commit (`29b32c5`, the `main.c` flag-table tidy) is folded in first so the extract carries the cleaned-up parser.
- LaunchAgent relabelled `com.ledzeppelin.leap-osc` → `com.leap-osc.bridge` (no longer LZ's).
- **Layout** (decided in the plan): flatten to a project root — `src/` for the `.c/.h`, `web/` for the monitor, `CMakeLists.txt` + `README.md` + tests at root.

**Stays in LED Zeppelin — generic, not leap:**
- The **Spot** generator (a positionable radial dot; a normal source).
- The Mapping-window **channel picker** (picks *any* channel).
- The OSC-in listener (`:9000` → `parseOsc` → `broadcastExt`) and `server/osc.js` — the generic path that turns any OSC address into an external channel.

**Removed from LED Zeppelin:** `leap/`, `LEAP.md`, `test/leap-osc.test.js`. Plus a one-line tidy of an example `/leap/hand/y` comment in `mappings.js` (cosmetic).

## Mapping "a gesture to a 3D FX" — already generic

No new leap code in LZ. The existing system maps any incoming channel to a **clip trigger**, a **param** (source + transform, via External), or a **layer opacity/bypass**. `/leap/hand/grab` → bind to a trigger (fires on rising edge) or an FX param (External). Toggling a *specific named effect* on/off is **not** a distinct mapping target today (you'd trigger a clip that has the FX, or bind an FX param) — noted as an optional future LZ addition, deliberately **out of scope** here (YAGNI).

## Testing / the wire contract

Fully decoupled, the two repos only need to agree on **standard OSC 1.0**, not a private contract:
- **leap-osc repo:** owns the C unit tests (`channels`, `osc`) via `run-tests.sh` — self-contained, no daemon.
- **LED Zeppelin:** already has a **generic `test/osc.test.js`** exercising `parseOsc`. Removing `test/leap-osc.test.js` therefore drops **no** coverage. No golden-fixture bridge needed.

## Migration mechanics (→ detailed in the implementation plan)

1. Fold `leap-cleanup` (`29b32c5`) into `main`.
2. `git subtree split --prefix=leap -b leap-split` → history-only-for-`leap/` branch.
3. `gh repo create jonasjohansson/leap-osc --private`; push `leap-split`; restructure to the flat layout; relabel plist; verify `cmake` build + `run-tests.sh` green in the new repo.
4. In LZ (branch `leap-extraction`): `git rm -r leap/ LEAP.md test/leap-osc.test.js`; tidy the mappings comment; `npm test` green (osc.test.js still covers `parseOsc`); commit.
5. Ship LZ per the standing auto-build-release flow (this is a real LZ change — the app loses its `leap/` web route).

## Phase B (later, not now)

A standalone UI for the bridge: a small self-hosted HTTP+WS server serving the moved `web/index.html` monitor and streaming the channels it sends (mirroring what LZ's daemon did), plus live calibration controls (the `--x/y/z` ranges + trims as sliders) and start/stop/status. The moved `index.html` currently expects an LZ-style `/frames` socket; phase B gives the bridge its own host.
