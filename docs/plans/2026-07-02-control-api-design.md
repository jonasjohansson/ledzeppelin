# HTTP control API on the daemon (D1) — design

Status: design only (no code). Backlog: D1 (#22) in `2026-07-02-feedback-backlog.md` — REST/WS first, MCP wrapper later.

## Goals / non-goals

**Goals:** let external clients (shell scripts, Home Assistant, cron, later Claude via MCP) control the *running* show over plain HTTP/WS on the LAN. Stable, versioned, documented.

**Non-goals:** not a cloud service; no remote editing of the rig (fixtures/devices/patch — that's the editor's job); no pixel-data ingest (the /frames binary protocol stays private between editor and daemon); no user accounts.

## Architectural ground truth (verified in code)

- **Rendering is browser-side.** The editor renders WebGL and streams RGB frames over WS `/frames` (`src/bridge.js` → `server/index.js`). The daemon holds the *latest* frame and paces DDP/Art-Net output on its own timer (`sendFrame` in `server/output.js`). The daemon cannot render, trigger clips, or evaluate params itself.
- **A relay channel already exists and is exactly what we need.** OSC UDP (`bindOsc` in `server/index.js`) parses messages and calls `broadcastExt(channel, value)`, which sends `{ type:'ext', channel, value }` to every `/frames` WS client. The editor (`src/bridge.js` `onExt` → `src/app.js` `handleExt` → `routeOsc` in `src/model/osc-map.js`) maps canonical addresses onto the show. The phone remote (`control/remote.js`) uses this same channel — it sends `{ type:'ext' }` frames and reads the cached manifest. **There is no separate command protocol; the API formalizes this one.**
- **Canonical addresses** (from `osc-map.js`, 1-based, values normalized 0..1): `/layer/<n>/opacity`, `/layer/<n>/bypass`, `/layer/<n>/clip/<m>/trigger`, `/layer/<n>/clip/<m>/<paramKey>`, `/layer/<n>/clip/<m>/tf/<x|y|scale|rotation|opacity>`, `/selected/…`.
- **The daemon caches the editor's companion manifest** (`lastManifest` in `server/index.js`): layers → clips (index `m`, name, active), layer opacity/bypass, and the exposed custom controls with label/min/max/value. So *read* endpoints for clips/controls can be answered daemon-side from cache, no round trip.
- **The daemon knows devices only via the WS `route` message** (`{ ip, port, protocol, colorOrder, byteStart, byteEnd, segments, gamma, brightness, delayMs, universe }`). Today `route` is per-connection closure state; serving `GET /devices` requires hoisting the last route to module scope (same pattern as `lastManifest`) — a small proposed change.
- **Existing HTTP surface** (`server/index.js`): `/health`, `/api/info`, `POST /api/osc/port`, `/api/wled/*` proxy, `/api/artnet/scan`. Unversioned; no auth; binds all interfaces on port 7070.
- **Scenes do not exist yet.** No scene/snapshot model in `src/model/` (only cosmetic uses of the word). Scene endpoints are v2, blocked on the scene-snapshot feature (next-horizons).

## Architecture: daemon-native vs relayed

| Class | Commands | How |
|---|---|---|
| Daemon-native | status, devices, blackout, per-device brightness override | Served directly; blackout/brightness act at the output layer in the frame pacer / `sendFrame` |
| Cache-served reads | clips list, exposed controls | Answered from the cached `lastManifest` (may be stale ≤200ms; `null` if no editor has ever connected) |
| Relayed writes | trigger clip, set param, layer opacity/bypass | `broadcastExt(address, value)` — identical to OSC/phone path; the editor applies it via `routeOsc` |
| v2 relayed | scene recall | Same channel, once scenes exist as canonical addresses (`/scene/<id>/recall`) |

**No editor connected → honest error.** Relayed writes are fire-and-forget today; a command with no editor listening vanishes silently. Proposed: the daemon marks the connection that sent a `route` message as *the editor* (only the editor sends routes). Relayed endpoints return `503 { "type": "no-editor", "detail": "no editor connected; command not delivered" }` when no editor socket is open. Delivery is still at-most-once with no ack — responses are `202 Accepted`, meaning "relayed", not "applied". (A request/response ack over the WS is possible later; not v1.)

**Blackout (daemon-native, proposed):** a module-level flag; while set, the frame pacer substitutes zeros (reusing the existing `safeBuf` fade machinery for a ~300ms fade) and ignores incoming frames for output. Survives editor reconnects; cleared only via the API. This is the "kill the wall now" control that must not depend on a browser tab.

**Per-device brightness (daemon-native, proposed):** an override multiplier map `ip → 0..1` applied in `sendFrame` on top of the route's own `brightness` (folded into the existing LUT cache key). Override, not edit — the editor's route resends won't clobber it, and it doesn't persist.

## Endpoints (`/api/v1`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/status` | daemon + editor + output state |
| GET | `/api/v1/devices` | output devices from the last route |
| GET | `/api/v1/clips` | layers/clips from cached manifest |
| GET | `/api/v1/controls` | exposed params from cached manifest |
| POST | `/api/v1/blackout` | `{ "on": true }` — output-layer kill |
| POST | `/api/v1/devices/:ip/brightness` | `{ "value": 0.4 }` — override multiplier |
| POST | `/api/v1/clips/:layer/:index/trigger` | relay `/layer/n/clip/m/trigger` = 1 |
| POST | `/api/v1/params` | `{ "address": "/layer/1/clip/2/speed", "value": 0.7 }` — relay any canonical address, value 0..1 |
| GET | `/api/v1/fixtures` | **v2** — fixtures live in the show, not the daemon; needs the editor to publish them (manifest extension) |
| POST | `/api/v1/scenes/:id/recall` | **v2** — blocked on scene snapshots |

`GET /api/v1/status` → 200:

```json
{ "version": "1.4.0", "uptimeSec": 8112, "editorConnected": true, "clients": 3,
  "fpsOut": 42, "outputStale": false, "blackout": false,
  "lastFrameMsAgo": 12, "osc": 9000 }
```

`GET /api/v1/devices` → 200 (503 `no-route` if no editor has sent a route):

```json
{ "devices": [ { "ip": "10.0.0.21", "protocol": "ddp", "port": 4048, "pixels": 300,
    "brightness": 1, "brightnessOverride": 0.4, "gamma": 2.2, "delayMs": 0 } ] }
```

`GET /api/v1/clips` → 200 (from manifest; 503 `no-manifest` before any editor connects):

```json
{ "layers": [ { "n": 1, "name": "Wash", "opacity": 0.8, "bypass": false,
    "clips": [ { "m": 1, "name": "Pulse", "active": true } ] } ] }
```

`POST /api/v1/blackout` body `{ "on": true }` → 200 `{ "blackout": true }`.

`POST /api/v1/devices/10.0.0.21/brightness` body `{ "value": 0.4 }` → 200 `{ "ip": "10.0.0.21", "brightnessOverride": 0.4 }`. `{ "value": null }` clears it.

`POST /api/v1/clips/1/2/trigger` (no body) → 202 `{ "relayed": true, "address": "/layer/1/clip/2/trigger" }` · 503 `no-editor`.

`POST /api/v1/params` body `{ "address": "/layer/1/opacity", "value": 0.5 }` → 202 `{ "relayed": true }` · 400 `bad-address` if it doesn't start with `/` · 503 `no-editor`. Non-canonical addresses fall through to the editor's free-channel store — same as OSC, by design.

## WS event stream — `GET /api/v1/events` (WebSocket)

Separate WS path (keeps API clients off the pixel socket). JSON events, one per message:

- `{ "type": "status", ... }` — same shape as GET /status; sent on connect and on change (editor connect/disconnect, blackout, outputStale flip).
- `{ "type": "manifest", ... }` — same shape as GET /clips; sent when the editor republishes (structure or value changes, already debounced 200ms editor-side).
- v2: `{ "type": "scene", "id": ... }`.

## Auth, CORS, errors, versioning

- **Bind/exposure unchanged:** all interfaces on `PORT` (7070), same as the phone remote today. Threat model = a LAN device, honestly the same as WLED itself (which accepts unauthenticated JSON API writes). Anyone on the Wi-Fi can already blackout the wall by talking DDP to the controllers directly.
- **Optional token:** if `LZ_API_TOKEN` is set, `/api/v1/*` (HTTP and the events WS) requires `Authorization: Bearer <token>` → else 401. Existing routes (`/health`, `/api/wled/*`, `/frames`) stay open — the editor and phone remote must keep working with zero config.
- **Errors:** minimal problem+json-ish body on every non-2xx: `{ "type": "no-editor", "detail": "…" }` with types `no-editor`, `no-route`, `no-manifest`, `bad-address`, `bad-request`, `unauthorized`, `not-found`. `Content-Type: application/json` (skipping the `application/problem+json` media type — no consumer needs it).
- **CORS:** `Access-Control-Allow-Origin: *` on `/api/v1/*` (GET/POST + preflight). It's a LAN control API; browser-based dashboards on other origins are a feature, and the token still gates writes when set.
- **Versioning:** everything new under `/api/v1`. Existing unversioned routes untouched. Breaking changes → `/api/v2`; additive fields are fine within v1.

## MCP wrapper (later, sketch)

A separate small process (stdio MCP server, ~100 lines) whose tools map 1:1 onto endpoints: `get_status`, `list_devices`, `list_clips`, `trigger_clip`, `set_param`, `blackout`, `set_device_brightness` — each a fetch to `http://<host>:7070/api/v1/...` with `LZ_API_TOKEN` passed through. No daemon changes needed; that's the point of REST-first.

## Phasing

- **v1 (daemon-native + existing relay):** `/status`, `/devices` (hoist last route), `/clips`, `/controls` (from manifest cache), `/blackout`, `/devices/:ip/brightness`, `/clips/:l/:i/trigger`, `/params` (via `broadcastExt`), `/events` WS, token auth, editor-connection tracking for honest 503s.
- **v2:** scenes (`/scenes`, `/scenes/:id/recall` — after scene snapshots land as canonical addresses), `/fixtures` (manifest extension), possibly relayed command acks.

## Out of scope

Editing the rig (fixtures, devices, patch, mappings), streaming pixel data in, WLED device config (already covered by `/api/wled/*`), cloud/remote access, multi-daemon orchestration.
