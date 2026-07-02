# Control API (`/api/v1`)

The daemon exposes a small, versioned HTTP + WebSocket API for controlling the
*running* show from anything on the LAN — shell scripts, Home Assistant, cron,
or an MCP wrapper. Design and rationale:
[`docs/plans/2026-07-02-control-api-design.md`](plans/2026-07-02-control-api-design.md).
Code: `server/api.js` (handlers) wired in `server/index.js`; blackout/brightness
live in `server/output.js`.

It rides the daemon's normal HTTP port (default **7070**). Examples below assume
`http://ledzeppelin.local:7070` — substitute your host/port.

Two classes of commands:

- **Daemon-native** — answered/applied by the daemon itself, no browser needed:
  status, devices, blackout, per-device brightness override.
- **Relayed** — clip triggers and param sets are forwarded to the connected
  editor over the same channel OSC and the phone remote use (`{ type:'ext' }`
  on the `/frames` socket → `routeOsc`). They return **202 Accepted** meaning
  *relayed*, not *applied* — delivery is at-most-once with no ack — and
  **503 `no-editor`** when no editor tab is connected to apply them.

## Auth, CORS, errors

- **No token set → open** (LAN threat model, same as WLED's own JSON API).
- Set `LZ_API_TOKEN` in the daemon's environment and every `/api/v1/*` request
  (including the events WS upgrade) must send `Authorization: Bearer <token>`,
  else **401**. Everything outside `/api/v1` (`/health`, `/frames`, `/control/`,
  `/api/wled/*`) stays open so the editor and phone remote work with zero config.
- **CORS:** `Access-Control-Allow-Origin: *` on all `/api/v1` responses;
  `OPTIONS` preflight answers 204 without auth.
- **Errors** are problem-json-ish: `{ "type": "...", "detail": "..." }` with
  types `unauthorized`, `not-found`, `bad-request`, `bad-address`, `no-route`,
  `no-manifest`, `no-editor`.

```bash
curl -H "Authorization: Bearer $LZ_API_TOKEN" http://ledzeppelin.local:7070/api/v1/status
```

## Read endpoints

### `GET /api/v1/status`

Daemon + editor + output state.

```bash
curl -s http://ledzeppelin.local:7070/api/v1/status
```

```json
{ "version": "1.0.316", "uptimeSec": 8112, "editorConnected": true, "clients": 3,
  "fpsOut": 42, "fpsCap": 42, "outputStale": false, "blackout": false,
  "lastFrameMsAgo": 12, "osc": 9000, "devices": 12 }
```

### `GET /api/v1/devices`

Output devices from the editor's last route (what the daemon *knows* — no
probing). **503 `no-route`** until an editor has connected once.

```bash
curl -s http://ledzeppelin.local:7070/api/v1/devices
```

```json
{ "devices": [ { "ip": "10.0.0.21", "protocol": "ddp", "port": 4048, "pixels": 300,
    "brightness": 1, "brightnessOverride": 0.4, "gamma": 2.2, "delayMs": 0 } ] }
```

### `GET /api/v1/clips` · `GET /api/v1/controls`

Layers/clips and the exposed companion controls, answered from the cached
editor manifest (≤200 ms stale). **503 `no-manifest`** before any editor has
published one.

```bash
curl -s http://ledzeppelin.local:7070/api/v1/clips
curl -s http://ledzeppelin.local:7070/api/v1/controls
```

```json
{ "layers": [ { "n": 1, "name": "Wash", "opacity": 0.8, "bypass": false,
    "clips": [ { "m": 1, "name": "Pulse", "active": true } ] } ] }
```

```json
{ "controls": [ { "address": "/layer/1/clip/1/speed", "label": "Pulse · Speed",
    "kind": "param", "min": 0, "max": 4, "value": 1, "def": 1 } ] }
```

## Actions

### `POST /api/v1/blackout` — daemon-native output kill

Zeros the output at the daemon (packets keep flowing so WLED stays in realtime
mode; ~300 ms fade at the edges). Works with **no browser tab open**, survives
editor reconnects, cleared only via the API. Default OFF.

```bash
curl -s -X POST http://ledzeppelin.local:7070/api/v1/blackout -d '{"on":true}'
# → { "blackout": true }
curl -s -X POST http://ledzeppelin.local:7070/api/v1/blackout -d '{"on":false}'
```

### `POST /api/v1/devices/:ip/brightness` — override multiplier

A 0..1 multiplier applied *on top of* the route's own brightness for one
device. An override, not an edit: the editor's route resends don't clobber it,
and it does not persist across daemon restarts. `null` clears it.

```bash
curl -s -X POST http://ledzeppelin.local:7070/api/v1/devices/10.0.0.21/brightness -d '{"value":0.4}'
# → { "ip": "10.0.0.21", "brightnessOverride": 0.4 }
curl -s -X POST http://ledzeppelin.local:7070/api/v1/devices/10.0.0.21/brightness -d '{"value":null}'
```

### `POST /api/v1/clips/:layer/:index/trigger` — relayed

Activates clip `index` on layer `layer` (1-based, deck order — same numbering
as the OSC map). **202** `{ relayed, address }` · **503 `no-editor`**.

```bash
curl -s -X POST http://ledzeppelin.local:7070/api/v1/clips/1/2/trigger
# → 202 { "relayed": true, "address": "/layer/1/clip/2/trigger" }
```

### `POST /api/v1/params` — relayed

Set any canonical OSC address (see `src/model/osc-map.js`; values normalized
0..1 onto the param's range). Non-canonical addresses fall through to the
editor's free-channel store — same as OSC, by design.

```bash
curl -s -X POST http://ledzeppelin.local:7070/api/v1/params \
  -d '{"address":"/layer/1/opacity","value":0.5}'
# → 202 { "relayed": true, "address": "/layer/1/opacity" }
```

Canonical addresses: `/layer/<n>/opacity` · `/layer/<n>/bypass` ·
`/layer/<n>/clip/<m>/<paramKey>` · `/layer/<n>/clip/<m>/tf/<x|y|scale|rotation|opacity>` ·
`/layer/<n>/clip/<m>/trigger` · `/selected/…`.

## Event stream — `GET /api/v1/events` (WebSocket)

JSON events, one per message (token-gated like the rest of `/api/v1`):

- `{ "type": "status", … }` — same shape as `GET /status`; sent on connect and
  on change (editor connect/disconnect, blackout toggles, `outputStale` flips).
- `{ "type": "manifest", "layers": …, "controls": … }` — sent when the editor
  republishes its manifest (debounced 200 ms editor-side).

```bash
# with websocat (or any WS client):
websocat ws://ledzeppelin.local:7070/api/v1/events
```

## Not in v1

Scene recall (blocked on scene snapshots), `/fixtures`, command acks, editing
the rig (fixtures/devices/patch — the editor's job), pixel-data ingest. See the
design doc's v2 section.
