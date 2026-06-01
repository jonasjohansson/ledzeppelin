# ledzeppelin — Design

**Date:** 2026-06-01
**Status:** Approved (brainstorm), ready for implementation plan

## What it is

ledzeppelin is a standalone realtime LED show tool — a "Resolume for addressable
LED" built for our installation. It renders generative visuals on a 2D canvas,
maps fixtures onto that canvas, samples each fixture's pixels, and streams them
to QuinLED controllers over **DDP** at ~40fps.

It is **standalone**: devices, fixtures, and compositions can all be authored
directly in the tool. It can **optionally import** the physical layout from the
Kagora planning tool, but does not depend on it.

### Tool ecosystem

| Tool | Job |
|------|-----|
| Calculator | Component sizing (PSU/wire/budget) |
| Kagora | Planning: topology, BOM, addressing, voltage drop |
| **ledzeppelin** | Running the show: fixtures, effects, realtime DDP output |

The three meet at the **show file** — ledzeppelin's native format, which Kagora
can produce as one of several sources.

## Target installation (from Kagora preset)

- **120 tubes**: 66 × WS2815 10m (300 px) + 54 × WS2815 8m (240 px)
- **~32,760 pixels total**
- **12 × QuinLED DigQuad** (4 outputs each = 48 physical outputs), WLED firmware
- 18 PSUs, 8 network nodes (wired, managed switches)

### Performance envelope

- Bandwidth: 32,760 px × 3 B ≈ **96 KB/frame**; at 40fps ≈ 31 Mbps total,
  ~4 Mbps/controller — trivial on wired gigabit.
- **Framerate ceiling is the WS2815 data timing per output**, not DDP:
  ~683 px/output avg × ~30 µs/px ≈ 20 ms → ~48fps per output. **Target 40fps.**

## Decisions

### Protocol — DDP

Chosen over ArtNet/sACN. WLED supports it natively (UDP **4048**), flat pixel
addressing (no universe boundaries / channel math), low overhead, per-device
unicast — which matches our one-IP-per-controller topology.

### Stack — "A": Node daemon + browser render (no Electron)

Mirrors Kagora's static-server philosophy. Two processes:

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  BROWSER (render engine) │   WS    │  NODE (output daemon)     │
│  • WebGL2 canvas         │ ──────► │  • receives pixel frame   │
│  • layers: gen → effects │ 96KB/fr │  • slices per controller  │
│  • composite → 2D canvas │         │  • packs DDP packets      │
│  • sample fixtures →     │         │  • dgram unicast → 12 IPs │
│    flat pixel buffer     │ ◄────── │  • serves UI + static     │
│  • UI (fixtures, params) │  state  │  • load/save show file    │
└─────────────────────────┘         └──────────────────────────┘
                                              │ UDP 4048
                                              ▼  12× DigQuad (WLED/DDP)
```

- Render where the GPU + devtools + hot-reload are.
- Raw UDP where Node can do it (`dgram`).
- 96 KB/frame loopback hop ≈ 3.8 MB/s — negligible.
- Electron explicitly **not** used. (A future single-app packaging is a separate,
  later decision that does not affect this design.)

### Composition — 2D canvas, freeform output mapping (Resolume Arena model)

- **Input** = where a fixture sits *in the canvas* (the slice it samples):
  position/rotation/scale. Decoupled from wiring.
- **Output** = where its pixels physically go (DDP device + offset + count).
- Move a fixture around the canvas to change its content without touching wiring.
- 2D is sufficient — a horizontal tube sampling a horizontal gradient gives a
  chase along its length; no 3D needed.

### Effect model — generator → effect chain (GLSL)

```
Layer = { source: generator, effects: [fx…], blend, opacity, params }

  generators (make light)      effects (break it up)
  • line   (band/dot)          • displace (push by noise)
  • gradient                   • repeat   (mirror/tile)
  • solid                      • dissolve (noise threshold)
  • noise  (perlin field)      • strobe   (time gate)
                               • chop     (segment/quantize)
                               • hue/levels (color)
```

- Generators and effects are GLSL fragment shaders; effects chain in order.
- Layers composite top-to-bottom with blend modes + opacity.
- Each shader ships a **param manifest** (typed float/color/bool with ranges);
  the UI auto-generates sliders from it. Those same params are the future audio
  binding targets.
- Shader-based even for "basic" effects: it *is* the Resolume model and 32k px
  at 40fps costs the GPU nothing. Custom-shader paste stays possible later.

## Data model — the show file

One JSON file, three sections. **Kagora owns the physical half; ledzeppelin owns
the creative half.** All fields are plain data, so the whole file can be
hand-authored without Kagora.

```jsonc
{
  "version": 1,
  "devices": [
    { "id": "ctrl-01", "name": "DigQuad 1", "ip": "10.0.0.11", "port": 4048 }
  ],
  "fixtures": [
    {
      "id": "tube-001",
      "name": "Tube 1",
      "pixelCount": 300,
      "colorOrder": "GRB",
      "output": {                          // PHYSICAL (Kagora-derivable)
        "deviceId": "ctrl-01",
        "pixelOffset": 0,                  // cumulative along device chain
        "pixelCount": 300
      },
      "input": {                           // CREATIVE (canvas sampling)
        "points": [[0.10, 0.20], [0.10, 0.85]],  // canvas-space (0..1)
        "samples": 300
      }
    }
  ],
  "composition": {
    "canvas": { "w": 1280, "h": 720 },
    "layers": [
      { "id": "l1", "generator": "line", "effects": ["displace"],
        "blend": "add", "opacity": 1.0,
        "params": { "line.pos": 0.5, "line.width": 0.08, "displace.amt": 0.2 } }
    ]
  }
}
```

- `output.pixelOffset` = cumulative pixel position along a controller's daisy
  chain. Kagora computes everything needed for it from its data-chain edges.
- `input.points` defaults to the tube's real-world layout (so it looks like the
  installation on import) but is freely editable in the output stage.
- **Kagora's one gap:** it has no controller **IP** (no runtime). Import brings
  devices + fixtures + offsets + geometry; ledzeppelin supplies IPs via an
  "assign IPs" step. Everything else maps 1:1 from the existing preset.

## Frame loop (browser, ~40fps)

1. Render each layer's generator + effect chain to its framebuffer (GPU).
2. Composite layers (blend modes) → one canvas texture.
3. **Sample pass:** a pixel-map texture holds every physical pixel's canvas-UV;
   one shader pass reads the canvas at each UV → a 32,760-long RGB buffer.
4. `readPixels` the buffer once (small) → binary WebSocket frame → Node.

**Node:** from the show file it knows each device's `{ip, offset, count}`,
slices the buffer, fragments into DDP packets (≤480 px/packet), unicasts to each
controller IP.

## Repo layout

New sibling repo `org/jonasjohansson/ledzeppelin`. Browser side dependency-free
(raw WebGL2). Node side single dependency `ws`; `dgram` + `http` are built in.

```
ledzeppelin/
  package.json              # node side — single dep: ws
  index.html
  server/
    index.js                # http static + ws bridge + output loop
    ddp.js                  # DDP packing + dgram unicast      ← unit-tested
    show.js                 # load/save show file
  src/                      # browser, served static like Kagora
    app.js                  # shell + frame-loop orchestration
    bridge.js               # ws client → sends pixel frames
    engine/
      gl.js                 # WebGL2 helpers (FBO, quad, passes)
      compositor.js         # layer stack → canvas texture
      sampler.js            # pixel-map texture + sample pass + readback
      shaders/{generators,effects}/*.glsl + manifest.js
    model/
      show.js               # devices/fixtures/composition CRUD ← unit-tested
      kagora-import.js      # preset → show file adapter        ← unit-tested
    ui/
      fixtures.js           # device/fixture CRUD + output-stage placement
      layers.js             # layer stack + auto-generated param sliders
  test/                     # node --test, like Kagora
```

## Testing

`node --test` runner (same as Kagora). Pure logic unit-tested without hardware:

- **DDP packing**: offsets, ≤480px fragmentation, color order, byte layout
- **Kagora import**: preset → fixtures, cumulative offset computation
- **Show-file CRUD/validation** and **sampling math** (canvas-UV from points)

GPU rendering verified visually. An on-screen **virtual-fixture preview** renders
sampled pixels back to screen, so the creative side is built with no tubes
plugged in. A DDP loopback/inspector confirms packets before hardware.

## Milestones (MVP = M0–M4)

| | Milestone | Win |
|---|---|---|
| M0 | Skeleton: static server + ws bridge, browser renders test gradient, frame loop + FPS counter | It runs |
| M1 | DDP output path: packing + unicast, one hardcoded device | First real tube lights from the canvas |
| M2 | Show-file CRUD + line generator + fixture sampling + output-stage placement | Multiple fixtures, defined natively |
| M3 | Layer stack + blend + 2–3 effects + param sliders | Creative loop feels like Resolume |
| M4 | Kagora import + assign IPs + scale to all 12 DigQuads @40fps | Full installation running a show |

## Deferred (post-MVP)

3. **Audio/mic modulation bus** — FFT → bands/beat/envelope as modulation
   sources that bind to any shader param.
4. **Timeline / clip deck** — clips per layer, triggers, cross-fade transitions
   (Resolume Arena composition deck).
5. **More generators/effects** and custom-shader paste.

## Open items for the implementation plan

- Exact DDP packet format details (PUSH flag, sequence/timecode, per-packet
  offset semantics) verified against WLED's DDP receiver.
- WebSocket frame protocol (binary pixel frame + JSON control channel).
- Pixel-map texture construction from fixture `input.points`.
- IP assignment UX on Kagora import.
