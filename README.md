# ledzeppelin

A standalone realtime LED show tool — "Resolume for addressable LED". Render
generative visuals on a 2D canvas, map fixtures onto it, sample each fixture's
pixels, and stream them to QuinLED controllers over **DDP** at ~40fps.

Built for an installation of ~120 WS2815 tubes (~32,760 px) across 12 QuinLED
DigQuad controllers, but works standalone — define controllers, fixtures, and
compositions by hand, or import the physical layout from the
[LEDger](../LEDger) planning tool.

## How it works

```
BROWSER (WebGL2 render engine)            NODE daemon (server/)
  generator → effect layers                 receives RGB frame
  composite → 2D canvas         ── ws ──▶    slices per controller
  sample fixtures → flat buffer  96KB/fr     packs DDP packets
  readback → send                            unicast UDP 4048 ──▶ 12× DigQuad (WLED)
```

Two processes, served like Kagora (static files + a small Node server). The
browser renders and samples; the Node daemon does the raw UDP that browsers
can't. They talk over a loopback WebSocket. No Electron.

The Resolume model: a fixture's **input** (where it samples the canvas) is
decoupled from its **output** (its DDP target — controller + pixel offset).
Move a tube around the canvas to change its content without touching wiring.

## Run

```bash
npm install
npm start
# open http://localhost:7070
```

On first run a default show renders a radial ripple across a fan of demo tubes.
The editor (right panel) has **three top-level sections** — **Design ·
Output · Control**:

**Design** — the creative side, shown over a clean composite. Three sub-tabs:

- **Clip** — the selected clip's source (generator) params, transform, and
  effects. Every shader param gets an auto-generated slider; the ⚙ cog beside a
  param sets its modulation (Basic / Timeline / Audio / External) and exposes it
  to the Companion.
- **Layer** — the layer's autopilot (deck play-through), blend mode, opacity,
  crossfade. New layers default to **Alpha** blend at **50%** so stacked layers
  show through. The clip **deck** (one row of clips per layer) sits on the left;
  click a clip to select, double-click to trigger (switching **crossfades**), and
  drag clips between layers / reorder layers.
- **Composition** — canvas resolution / aspect (16:9, 1:1, 4:3, custom) +
  composition-level effects. Fixtures sample normalized space, so resolution
  changes source detail, never pixel addressing.

**Output** — the wiring side, with the fixture overlay on the preview and the
fixture editor docked left. Sub-tabs:

- **Fixtures** — place & wire each strip: drag endpoints on the canvas to set
  what it samples; its device / output / pixel range / color order are edited in
  the left panel. Daisy-chain fixtures on one output.
- **Devices** — the controller instances (name / IP / model / protocol).
- **Inventory** — the catalog of controller + fixture-type definitions.
- **Import from LEDger** — load a LEDger preset `.json`, assign controller IPs
  (sequential auto-fill), and run the whole installation.

**Control** — a live shortcut surface: the parameters you exposed via the cog's
**Companion** tick, plus the phone-companion **QR code / URL / connection
status**. (The deck stays visible on the left so you keep the composition in
view.)

Switching sections only toggles visibility — the render loop, sampler, and output
keep running regardless. The show autosaves to `localStorage`; the corner **File**
menu has New / Save / Load / Import.

### Phone companion

The daemon serves a lightweight remote at **`/remote/`** that anyone on the same
network can open (it prints the LAN URL on start; the **Control** tab shows a QR).
It mirrors the **Composition deck** — clip thumbnails to trigger, a Block (mute)
toggle and opacity fader per layer — plus the params you ticked for Companion,
and drives the show through the same canonical OSC addresses over the daemon's
WebSocket relay. (Open to anyone on the LAN — intended for a trusted install.)

### Pointing at real hardware

Set each controller's **IP** under Output › Devices (or via LEDger import +
assign-IPs). Controllers must run WLED with DDP enabled (it listens on UDP
4048). Color order for WS2815 is **GRB**. The daemon unicasts to each
controller independently — one IP per DigQuad.

Develop without hardware: the on-screen **virtual preview** colors each
fixture's pixels from the live sampled frame, so you can build the whole
creative side with no tubes plugged in.

### External control (OSC / socket JSON)

There are **two models**, and they share the same transports:

1. **Canonical addresses** (Resolume-style, the primary path) — *every*
   parameter has a predictable, **always-active** OSC address. No binding step:
   point a controller at the address and send a float normalized **0..1**; it's
   clamped and mapped onto the param's slider range (bool params: ≥ 0.5 = on).
2. **Bound channels** (custom in/out) — for sensor-style signals on arbitrary
   names: open a param's ⚙ menu, pick **External**, and bind a channel with
   your own `in`/`out` mapping.

#### OSC address map

All indices are **1-based, deck order** (`/layer/1` is the *top* deck row;
clips count left→right). `<paramKey>` is the source's manifest key — the same
name as its slider (camelCased: `speed`, `headWidth`, …).

| Address | Drives | Value (0..1) |
|---|---|---|
| `/layer/<n>/clip/<m>/<paramKey>` | a clip's source param | mapped onto the param's min..max |
| `/layer/<n>/clip/<m>/tf/<x\|y\|scale\|rotation\|opacity>` | clip transform | mapped onto the slider range (x/y −1..1, scale 0..3, rotation −180..180, opacity 0..1) |
| `/layer/<n>/clip/<m>/trigger` | activate (trigger) that clip | ≥ 0.5 fires |
| `/layer/<n>/opacity` | layer opacity | 0..1 direct |
| `/selected/<paramKey>` · `/selected/tf/<…>` | the **selected** clip (alias, resolved live) | as above |

```bash
oscsend localhost 9000 /layer/1/clip/2/speed f 0.5   # clip 2's speed → mid-range
oscsend localhost 9000 /layer/1/clip/2/trigger f 1   # activate clip 2
oscsend localhost 9000 /selected/tf/scale f 0.33     # scale whatever's selected
```

Every External controls row shows the param's canonical address as a muted
chip — click it to copy. Anything that *doesn't* match the scheme stays a free
channel for the binding model below.

#### Feeding values

**OSC over UDP** — the daemon listens on `:9000` (`OSC_PORT` overrides). Any
address works; the first numeric argument (`f`/`i`/`d`) becomes the value.
Bundles (TouchOSC, TouchDesigner) are unpacked. Point TouchOSC at
`<host>:9000` and every fader shows up.

**Socket JSON** — any client can connect to the daemon's WebSocket and send
`{ type:'ext', channel, value }` (`channel` may be a canonical address); the
daemon relays it to every other client:

```js
import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:7070/frames');
ws.on('open', () => {
  setInterval(() => ws.send(JSON.stringify({
    type: 'ext', channel: 'sensor/1', value: Math.random(),
  })), 100);
});
```

#### Bound channels (custom mapping)

Per binding, the raw signal maps onto the param as
`from + (to − from) · clamp(value, 0, 1)` — so a 0..1 fader drives the param's
`in`..`out` range. The External controls row offers a select of **live channels**
(`/fader1 · 0.42` — anything that has actually sent a message) and shows the
param's fixed canonical address as a copyable chip; you bind by picking a channel
(addresses are not retyped). The four audio band names (`level`, `bass`, `mid`,
`high`) are **reserved** by the Audio input — don't name external channels after
them.

### Output protocols

Each device picks its protocol in the Output tab's device editor:

- **DDP** (default) — WLED's realtime stream on UDP 4048. Recommended for WLED
  controllers and large pixel counts (one packet per ~480 px, no universe math).
- **Art-Net** — ArtDmx on UDP 6454 for non-WLED gear (commercial nodes,
  consoles, MadMapper/Resolume). Set the device's base **universe**; its pixels
  occupy consecutive universes from there at **170 RGB px per universe**
  (510 channels). The editor shows the resulting span.

## Architecture

| Layer | Files |
|---|---|
| Daemon | `server/{index,static,ddp,artnet,osc,colororder,output,wled,calibrate}.js` |
| Engine | `src/engine/{gl,sampler,compositor,thumbs}.js`, `shaders/manifest.js` |
| Model (pure) | `src/model/{show,sampling,pipeline,chains,layers,fixture-transform,osc-map,remote,external,anim,audio,kagora-import,ip}.js` |
| UI | `src/ui/{fixtures,preview,layers,composition,control,import,controls,section,dom,qr,theme}.js` |
| Companion | `remote/{index.html,remote.js}` (phone page) |
| Bridge | `src/bridge.js` (browser ws client) |

Pure logic is unit-tested (`node --test`): DDP packing, color order, show
validation, sampling math, multi-device pipeline routing, LEDger import, IPv4
helpers. GPU/UI is verified visually.

```bash
npm test
```

## Performance notes

- ~32,760 px × 3 B ≈ 96 KB/frame; ~31 Mbps total at 40fps — trivial on wired
  gigabit. The daemon unicasts per controller (~4 Mbps each).
- The framerate ceiling is **WS2815 data timing per output** (~683 px/output →
  ~48fps), not DDP. Target **40fps**.
- The sampled buffer is read back via an **async PBO** path (WebGL2
  `PIXEL_PACK_BUFFER` + fence, double-buffered) so there's no GPU→CPU stall on the
  frame loop. Output is paced by the daemon's own 42fps clock (it coalesces bursts
  to the newest frame), not by browser timing.

## Hardware scale test (the M4.3 milestone)

Run on the real rig once controllers are reachable:

1. Import the full LEDger preset; assign the 12 real DigQuad IPs.
2. Confirm the HUD holds ≥40fps and the daemon's fps log matches.
3. Verify a moving line sweeps the whole installation, then a 2-layer effect
   show. If `readPixels` stalls below 40fps, apply the PBO readback above.

## Status

MVP complete: M0 skeleton → M1 DDP output → M2 fixtures/sampling/CRUD →
M3 layers/effects → M4 LEDger import + multi-device routing. See
`docs/plans/` for the design and implementation plan.

Deferred (post-MVP): audio/mic modulation bus, timeline/clip deck with
transitions, more generators/effects + custom-shader paste.

## Known limitations

- Two instances of the same effect on one layer share parameters (effect params
  are namespaced by name, not chain position).
- The dev server serves the whole repo root — localhost dev tool only.
