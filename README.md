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

On first run a default show renders a moving line across two demo fixtures. The
editor (right panel) is split into **two tabs**, mirroring the input/output
split — *what you render* vs. *where it goes*:

**Composition tab** — the creative side, shown over a clean composite (no
fixture overlay):

- **Composition** — set the canvas resolution / aspect (16:9, 1:1, 4:3, custom).
  Fixtures sample normalized space, so resolution changes source detail, never
  pixel addressing.
- **Layers** (Resolume-style) — each layer holds a **deck of clips**; a clip is a
  source (generator) with its own params and effects. Click a clip to trigger it;
  switching clips **crossfades** over the layer's transition time. Effects live
  per-clip *and* per-layer; stack layers with blend modes + opacity. Every shader
  param gets an auto-generated slider.

**Output tab** — the wiring side, with the fixture overlay drawn on the preview.
An **Input / Output** toggle splits the two halves of a fixture's routing:

- **Input** — where each fixture *samples* the canvas. Drag fixture endpoints on
  the overlay to reposition what they sample.
- **Output** — each fixture's *DDP target*: device, pixel offset, color order,
  and per-controller IP. Drag placement is locked in this mode.
- **Import from Kagora** — load a Kagora preset `.json`, assign controller IPs
  (with sequential auto-fill), and run the whole installation.

Switching tabs only toggles visibility — the render loop, sampler, and output
keep running regardless of which tab is shown. The show autosaves to
`localStorage`; use the Save/Load buttons for files.

### Pointing at real hardware

Set each controller's **IP** under the Output tab (or via Kagora import +
assign-IPs). Controllers must run WLED with DDP enabled (it listens on UDP
4048). Color order for WS2815 is **GRB**. The daemon unicasts to each
controller independently — one IP per DigQuad.

Develop without hardware: the on-screen **virtual preview** colors each
fixture's pixels from the live sampled frame, so you can build the whole
creative side with no tubes plugged in.

### External control (OSC / socket JSON)

Any animatable parameter can follow a **live external channel** instead of the
clock or the mic: open a param's ⚙ menu and pick **External**. A channel is just
a name → latest number; two ways to feed one:

**OSC over UDP** — the daemon listens on `:9000` (`OSC_PORT` overrides). Any
address works; the first numeric argument (`f`/`i`/`d`) becomes the channel
value. Bundles (TouchOSC, TouchDesigner) are unpacked. Try it:

```bash
oscsend localhost 9000 /speed f 0.7
```

…or point TouchOSC at `<host>:9000` and every fader shows up as a channel.

**Socket JSON** — any client can connect to the daemon's WebSocket and send
`{ type:'ext', channel, value }`; the daemon relays it to every other client:

```js
import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:7070/frames');
ws.on('open', () => {
  setInterval(() => ws.send(JSON.stringify({
    type: 'ext', channel: 'sensor/1', value: Math.random(),
  })), 100);
});
```

Per binding, the raw signal maps onto the param as
`from + (to − from) · clamp(value × gain, 0, 1)` — so a 0..1 fader can drive any
slider range, and `gain` rescales hotter/colder signals. The External controls
row offers a select of live channels (`/fader1 · 0.42`) plus a free-text field
for an address that hasn't sent anything yet. The four audio band names
(`level`, `bass`, `mid`, `high`) are **reserved** by the Audio input — don't
name external channels after them.

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
| Daemon | `server/{index,static,ddp,colororder,output}.js` |
| Engine | `src/engine/{gl,sampler,compositor}.js`, `shaders/manifest.js` |
| Model (pure) | `src/model/{show,sampling,pipeline,layers,kagora-import,ip}.js` |
| UI | `src/ui/{fixtures,preview,layers,import}.js` |
| Bridge | `src/bridge.js` (browser ws client) |

Pure logic is unit-tested (`node --test`): DDP packing, color order, show
validation, sampling math, multi-device pipeline routing, Kagora import, IPv4
helpers. GPU/UI is verified visually.

```bash
npm test
```

## Performance notes

- ~32,760 px × 3 B ≈ 96 KB/frame; ~31 Mbps total at 40fps — trivial on wired
  gigabit. The daemon unicasts per controller (~4 Mbps each).
- The framerate ceiling is **WS2815 data timing per output** (~683 px/output →
  ~48fps), not DDP. Target **40fps**.
- `readPixels` of the sampled buffer is a synchronous GPU stall. It's fine at
  this scale, but if FPS dips when scaling to all 12 controllers, switch to an
  async **PBO** readback (WebGL2 `PIXEL_PACK_BUFFER` + fence).

## Hardware scale test (the M4.3 milestone)

Run on the real rig once controllers are reachable:

1. Import the full Kagora preset; assign the 12 real DigQuad IPs.
2. Confirm the HUD holds ≥40fps and the daemon's fps log matches.
3. Verify a moving line sweeps the whole installation, then a 2-layer effect
   show. If `readPixels` stalls below 40fps, apply the PBO readback above.

## Status

MVP complete: M0 skeleton → M1 DDP output → M2 fixtures/sampling/CRUD →
M3 layers/effects → M4 Kagora import + multi-device routing. See
`docs/plans/` for the design and implementation plan.

Deferred (post-MVP): audio/mic modulation bus, timeline/clip deck with
transitions, more generators/effects + custom-shader paste.

## Known limitations

- Two instances of the same effect on one layer share parameters (effect params
  are namespaced by name, not chain position).
- The dev server serves the whole repo root — localhost dev tool only.
