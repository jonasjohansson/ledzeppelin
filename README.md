# LEDZeppelin

A standalone realtime show tool for addressable LED. Render generative visuals on
a 2D canvas, map your LED fixtures onto it, and stream each fixture's sampled
pixels to WLED / Art-Net controllers at ~40fps.

## Try it

The editor runs in the browser: **[ledzeppelin.jonasjohansson.se](http://ledzeppelin.jonasjohansson.se/)**.
(Designing and preview work anywhere; *streaming* to controllers needs the local
app below, which runs the small daemon that does the UDP browsers can't.)

## Install

**Just want the app?** Grab the latest build from
[**Releases**](https://github.com/jonasjohansson/ledzeppelin/releases), no Node
required:

- **macOS** (Apple Silicon + Intel): notarized `.app`; unzip, drag to
  Applications, double-click.
- **Windows** (64-bit): unzip, run `ledzeppelin.exe`, open `http://localhost:7070`.
  Unsigned, so on first launch click "More info" then "Run anyway" past SmartScreen.
- **Linux / Raspberry Pi** (64-bit): extract the tarball, run `./ledzeppelin`,
  open `http://localhost:7070`.

**From source:**

```bash
npm install
npm start          # open http://localhost:7070
```

## What it does

- **Design**: stack layers of generative clips, blend & animate them; per-param
  modulation (timeline / audio / external OSC·MIDI). Drop in [ISF](https://isf.video/)
  shaders as clips or effects, with a set of examples in the source picker.
- **Output**: place fixtures on the canvas to set what each one samples, then
  wire them to controllers (DDP for WLED, or Art-Net for Digidot / PixLite / any
  generic node, with ArtSync). Strips, polylines and snake-wired LED matrices;
  RGB or RGBW per fixture. Input (content) and output (wiring) are decoupled, so
  you move a strip to change its content, not its address.
- **Control**: a phone companion (QR / LAN URL) plus any params you expose, all
  driven over canonical OSC addresses, with MIDI mapping and soft-takeover.

A browser WebGL2 engine renders & samples; a small Node daemon does the UDP that
browsers can't. They talk over a loopback WebSocket.

## Develop

```bash
npm test           # pure logic: DDP packing, routing, sampling, validation…
```

Build standalone binaries yourself (needs [Bun](https://bun.sh)):
`npm run build:mac` for the notarized macOS `.app`, or
`npm run build:app bun-linux-arm64` for a Raspberry Pi / Linux binary.
See [`docs/PACKAGING.md`](docs/PACKAGING.md).

## Licence

[MIT](LICENSE) © 2026 Jonas Johansson.
