# Ultraleap Tracking WebSocket (vendored, patched)

A patched copy of [ultraleap/UltraleapTrackingWebSocket](https://github.com/ultraleap/UltraleapTrackingWebSocket),
vendored here because upstream has bugs that make it crash or peg a CPU core —
see [Patches](#patches) below. Vendored (not a submodule/fork dependency) so a
plain `git clone` of this repo is enough to build it.

This is what makes port `6437` work with the **modern Ultraleap Gemini/Hyperion
tracking service** (the one installed by "Ultraleap Hand Tracking" on macOS
today). It re-implements the legacy LeapJS `v6.json` WebSocket protocol that
Gemini's own runtime dropped — see the root [`../../LEAP.md`](../../LEAP.md)
for why that protocol is what `leap-bridge.js` / `leap/index.html` speak.

## Build (macOS)

```bash
brew install cmake libwebsockets

mkdir -p build && cd build
cmake -DLeapSDK_DIR="/Applications/Ultraleap Hand Tracking.app/Contents/LeapSDK/lib/cmake/LeapSDK" ..
cmake --build .
```

The `LeapSDK_DIR` override is needed because this app bundles its own copy of
the LeapC SDK rather than installing it to the standard
`/Library/Application Support/Ultraleap/LeapSDK` path upstream's `CMakeLists.txt`
expects.

## Build (Windows)

Untested by us (only built/soak-tested on macOS so far — see [Patches](#patches)),
but the patches only touch `main.c`'s connection-handling logic, not anything
platform-specific, so upstream's Windows path should apply unchanged:

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
   with the "Desktop development with C++" workload, and [CMake](https://cmake.org/download/).
2. Install [Ultraleap Gemini V5+ tracking software](https://leap2.ultraleap.com/downloads).
3. Install `libwebsockets` via [vcpkg](https://vcpkg.io/en/getting-started.html):
   `vcpkg install libwebsockets --triplet x64-windows`.
4. Build:
   ```bash
   mkdir build && cd build
   cmake -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake ..
   cmake --build .
   ```

`CMakeLists.txt` looks for the LeapSDK's CMake config under
`%ProgramFiles%\Ultraleap`. **If that fails** (the macOS install didn't put it
where upstream's script expected either — its SDK was bundled inside the app
instead), find `leapsdk-config.cmake` under wherever Ultraleap actually
installed on your machine and pass it explicitly:
`cmake -DLeapSDK_DIR="<path found>\lib\cmake\LeapSDK" ...`.

## Run

```bash
./build/Ultraleap-Tracking-WS
```

Starts a WebSocket server on `ws://127.0.0.1:6437/v6.json`. Requires the
Ultraleap tracking service (`libtrack_server`) to already be running — the
"Ultraleap Hand Tracking" app starts it automatically.

Then point LED Zeppelin's bridge at it (note the `/v6.json` path — **not** the
`/v7.json` LED Zeppelin's scripts default to; see Patches):

```bash
node ../../leap-bridge.js --leap ws://127.0.0.1:6437/v6.json
```

## Patches

Three bugs in upstream `main.c` that surfaced during testing on macOS 14
(Apple Silicon), all in `callback_websocket()`:

1. **Heap buffer overflow → crash on connect.** `LWS_CALLBACK_RECEIVE`
   copied incoming client messages into a fixed 32-byte buffer via
   `snprintf(answer, len + 1, (char*)in)`. Both `leap-bridge.js` and
   `leap/index.html` send a 44-byte handshake message
   (`{"enableGestures":false,"optimizeHMD":false}`) on connect, overflowing the
   buffer and corrupting the heap — the process would crash a moment after a
   client connected. Fixed by allocating exactly `len + 1` bytes.
2. **Format-string bug**, same line: untrusted client input was passed
   directly as the `snprintf` format string. Replaced with `memcpy` + a null
   terminator.
3. **Busy-spin pegging a CPU core (and causing jerky tracking).**
   `LWS_CALLBACK_SERVER_WRITEABLE` re-armed itself immediately whenever no new
   tracking frame was ready yet, spinning as fast as the CPU allowed and
   thrashing the mutex shared with the Leap SDK's own tracking thread — which
   starved that thread enough to make hand tracking visibly jerky, on top of
   pegging a core at 100%. Fixed with a 1ms sleep between idle checks (~1kHz
   poll rate, comfortably above the SDK's native ~90Hz), cutting CPU to ~1-2%
   with no change in frame rate (validated over an 11-minute soak test: steady
   90.0Hz, matching the SDK's native rate exactly).

Also fixed two unrelated memory leaks in the same handler (an allocated-but-
never-used response buffer, and the `answer` buffer above never being freed).

See `git log` / the diff against a fresh clone of upstream for the exact
changes — this vendored copy intentionally stays otherwise identical to
upstream (same license, same structure) to keep future re-syncs easy.
