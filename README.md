# LEDZeppelin

A standalone realtime LED show tool — *"Resolume for addressable LED"*. Render
generative visuals on a 2D canvas, map your LED fixtures onto it, and stream each
fixture's sampled pixels to WLED / Art-Net controllers at ~40fps.

## Try it

The editor runs in the browser — **[ledzeppelin.jonasjohansson.se](http://ledzeppelin.jonasjohansson.se/)**.
(Designing + preview work anywhere; *streaming* to controllers needs the local app
below, which runs the small daemon that does the UDP browsers can't.)

## Install

**Just want the app?** Grab the latest build from
[**Releases**](https://github.com/jonasjohansson/ledzeppelin/releases) — no Node
required:

- **macOS** (Apple Silicon + Intel) — notarized `.app`; unzip → drag to
  Applications → double-click.
- **Linux / Raspberry Pi** (64-bit) — extract the tarball, `./ledzeppelin`, open
  `http://localhost:7070`.

**From source:**

```bash
npm install
npm start          # open http://localhost:7070
```

## What it does

- **Design** — stack layers of generative clips, blend & animate them; per-param
  modulation (timeline / audio / external OSC·MIDI).
- **Output** — place fixtures on the canvas to set what each one samples, then
  wire them to controllers (DDP for WLED, or Art-Net). Input (content) and output
  (wiring) are decoupled — move a strip to change its content, not its address.
- **Control** — a phone companion (QR / LAN URL) plus any params you expose, all
  driven over canonical OSC addresses.

A browser WebGL2 engine renders & samples; a small Node daemon does the UDP that
browsers can't. They talk over a loopback WebSocket.

## Develop

```bash
npm test           # pure logic: DDP packing, routing, sampling, validation…
```

Build the macOS app yourself: `npm run build:mac` (needs [Bun](https://bun.sh)).
See [`docs/PACKAGING.md`](docs/PACKAGING.md).

## License

[MIT](LICENSE) © 2026 Jonas Johansson.
