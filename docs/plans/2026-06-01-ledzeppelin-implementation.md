# ledzeppelin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone realtime LED show tool that renders generative visuals on a 2D canvas and streams sampled pixels to 12 QuinLED DigQuad controllers over DDP at ~40fps.

**Architecture:** Two processes, served like Kagora. A browser WebGL2 engine renders generator→effect GLSL layers, composites them, samples each fixture's pixels via a pixel-map texture, reads them back, and ships a binary frame over a loopback WebSocket. A Node daemon (`server/`) serves the static UI, receives frames, assembles a per-controller byte buffer, and unicasts DDP packets (UDP 4048). Resolume Arena model: a fixture's canvas placement (input) is decoupled from its DDP target (output).

**Tech Stack:** Node (built-in `http`, `dgram`, `node --test`) + single dependency `ws`. Browser: vanilla ES modules + raw WebGL2, no framework. JSON show file as native format.

---

## Conventions

- **TDD for all pure logic** (DDP packing, show-file model, Kagora import, sampling math). Write the failing test, see it fail, implement minimal, see it pass, commit.
- **GPU/UI work is verified visually** (no DOM/WebGL unit tests) — each such task ends with a manual verification step and a commit.
- Run tests with `node --test` from the repo root.
- Commit after every green step. Conventional commit messages.
- All paths are relative to `/Users/jonas/Documents/GitHub/org/jonasjohansson/ledzeppelin`.
- Co-author trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

# Milestone M0 — Skeleton (it runs)

### Task 0.1: package.json + scripts

**Files:**
- Create: `package.json`

**Step 1:** Write `package.json`:

```json
{
  "name": "ledzeppelin",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "start": "node server/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

**Step 2:** Run `npm install`. Expected: `ws` installed, `node_modules/` present (already gitignored).

**Step 3:** Commit.
```bash
git add package.json package-lock.json && git commit -m "chore: init node package with ws"
```

---

### Task 0.2: Static file server

**Files:**
- Create: `server/static.js`
- Test: `test/static.test.js`

**Step 1: Write the failing test.** `server/static.js` exports `contentType(path)`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentType } from '../server/static.js';

test('contentType maps common extensions', () => {
  assert.equal(contentType('a.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('a.glsl'), 'text/plain; charset=utf-8');
  assert.equal(contentType('a.json'), 'application/json; charset=utf-8');
  assert.equal(contentType('a.unknown'), 'application/octet-stream');
});
```

**Step 2:** Run `node --test test/static.test.js`. Expected: FAIL (module not found).

**Step 3: Implement** `server/static.js`:

```js
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function contentType(path) {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// Serve files under `root`, preventing path traversal. Returns true if handled.
export async function serveStatic(root, req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, rel === '/' ? 'index.html' : rel);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
    res.writeHead(200, { 'content-type': contentType(filePath) });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}
```

**Step 4:** Run `node --test test/static.test.js`. Expected: PASS.

**Step 5:** Commit.
```bash
git add server/static.js test/static.test.js && git commit -m "feat: static file server with content-type mapping"
```

---

### Task 0.3: Server entry — http + ws bridge

**Files:**
- Create: `server/index.js`
- Create: `index.html`, `src/app.js` (minimal placeholders)

**Step 1: Implement** `server/index.js`:

```js
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveStatic } from './static.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7070;

const http = createServer(async (req, res) => {
  if (await serveStatic(ROOT, req, res)) return;
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server: http, path: '/frames' });
let frames = 0;
wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  ws.on('message', (data, isBinary) => {
    if (isBinary) { frames++; } // M1 wires this to DDP output
  });
  ws.on('close', () => console.log('[ws] client disconnected'));
});

setInterval(() => { if (frames) { console.log(`[ws] ${frames} fps`); frames = 0; } }, 1000);

http.listen(PORT, () => console.log(`ledzeppelin http://localhost:${PORT}`));
```

**Step 2: Create** `index.html`:

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>ledzeppelin</title>
<style>html,body{margin:0;background:#0a0a0a;color:#eee;font:13px system-ui}
canvas{display:block}#hud{position:fixed;top:8px;left:8px;opacity:.8}</style></head>
<body><div id="hud">booting…</div><canvas id="stage"></canvas>
<script type="module" src="./src/app.js"></script></body>
</html>
```

**Step 3: Create** placeholder `src/app.js`:

```js
const hud = document.getElementById('hud');
hud.textContent = 'ledzeppelin: app.js loaded';
```

**Step 4: Verify manually.** Run `npm start`, open `http://localhost:7070`. Expected: dark page showing "ledzeppelin: app.js loaded", server logs "http://localhost:7070".

**Step 5:** Commit.
```bash
git add server/index.js index.html src/app.js && git commit -m "feat: http server serving UI + ws /frames bridge"
```

---

### Task 0.4: WebGL2 helpers + full-screen test gradient + frame loop + FPS

**Files:**
- Create: `src/engine/gl.js`
- Modify: `src/app.js`

**Step 1: Implement** `src/engine/gl.js` (minimal helpers used by all passes):

```js
export function getGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 not available');
  return gl;
}

export function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
  return sh;
}

// Builds a program from a fragment shader; vertex shader is a fixed full-screen triangle.
const VERT = `#version 300 es
const vec2 P[3] = vec2[](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
out vec2 uv;
void main(){ vec2 p = P[gl_VertexID]; uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

export function program(gl, fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// A render target: RGBA8 texture + framebuffer at w×h.
export function makeTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
    gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
    gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export function drawFullscreen(gl) { gl.drawArrays(gl.TRIANGLES, 0, 3); }
```

**Step 2: Rewrite** `src/app.js` to render an animated gradient to the canvas and count FPS:

```js
import { getGL, program, drawFullscreen } from './engine/gl.js';

const canvas = document.getElementById('stage');
const hud = document.getElementById('hud');
canvas.width = 1280; canvas.height = 720;
const gl = getGL(canvas);

const prog = program(gl, `#version 300 es
precision highp float; in vec2 uv; out vec4 frag; uniform float uТ;
void main(){ float g = 0.5+0.5*sin(uv.x*6.2831 + uТ); frag = vec4(vec3(g),1.); }`
  .replace(/uТ/g, 'uT')); // (ASCII-safe)
const uT = gl.getUniformLocation(prog, 'uT');

let frames = 0, last = 0, t0 = 0;
function loop(ts) {
  if (!t0) t0 = ts;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(prog);
  gl.uniform1f(uT, (ts - t0) / 1000);
  drawFullscreen(gl);
  frames++;
  if (ts - last > 500) { hud.textContent = `${(frames * 1000 / (ts - last)).toFixed(0)} fps`; frames = 0; last = ts; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

**Step 3: Verify manually.** Reload `http://localhost:7070`. Expected: animated horizontal gradient sweeping; HUD shows ~60 fps.

**Step 4:** Commit.
```bash
git add src/engine/gl.js src/app.js && git commit -m "feat: webgl2 helpers, animated test gradient, fps loop"
```

**M0 done:** the engine runs and renders.

---

# Milestone M1 — DDP output path (first tube lights)

### Task 1.1: DDP packet builder (TDD, pure)

**Files:**
- Create: `server/ddp.js`
- Test: `test/ddp.test.js`

DDP header is 10 bytes: `[flags1, seq, dataType, destId, offset(4 BE bytes), len(2 BE bytes)]`, then payload. `flags1` = `0x40` (version 1) `| 0x01` PUSH on the **last** packet only. Max 1440 data bytes/packet (480 RGB pixels). Offset is in **bytes** into the device buffer.

**Step 1: Write the failing test:**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackets } from '../server/ddp.js';

test('single small frame → one PUSH packet', () => {
  const bytes = Buffer.from([1,2,3, 4,5,6]); // 2 pixels
  const pkts = buildPackets(bytes, { sequence: 5 });
  assert.equal(pkts.length, 1);
  const p = pkts[0];
  assert.equal(p[0], 0x41);            // version1 | PUSH
  assert.equal(p[1], 5);               // sequence
  assert.equal(p.readUInt32BE(4), 0);  // byte offset
  assert.equal(p.readUInt16BE(8), 6);  // data length
  assert.deepEqual([...p.subarray(10)], [1,2,3,4,5,6]);
});

test('fragments at 480 pixels (1440 bytes); PUSH only on last', () => {
  const bytes = Buffer.alloc(481 * 3); // 481 pixels
  const pkts = buildPackets(bytes, { sequence: 1 });
  assert.equal(pkts.length, 2);
  assert.equal(pkts[0][0], 0x40);            // no PUSH
  assert.equal(pkts[0].readUInt16BE(8), 1440);
  assert.equal(pkts[0].readUInt32BE(4), 0);
  assert.equal(pkts[1][0], 0x41);            // PUSH on last
  assert.equal(pkts[1].readUInt16BE(8), 3);  // 1 pixel
  assert.equal(pkts[1].readUInt32BE(4), 1440);
});
```

**Step 2:** Run `node --test test/ddp.test.js`. Expected: FAIL (module not found).

**Step 3: Implement** `server/ddp.js`:

```js
const MAX_DATA = 1440;           // 480 RGB pixels
const FLAG_VER1 = 0x40, FLAG_PUSH = 0x01;

// Split a device byte buffer (already in device color order) into DDP packets.
export function buildPackets(bytes, { sequence = 0, maxData = MAX_DATA } = {}) {
  const packets = [];
  for (let off = 0; off < bytes.length || off === 0; off += maxData) {
    const chunk = bytes.subarray(off, off + maxData);
    const isLast = off + maxData >= bytes.length;
    const h = Buffer.alloc(10);
    h[0] = FLAG_VER1 | (isLast ? FLAG_PUSH : 0);
    h[1] = sequence & 0x0f;
    h[2] = 0;                    // data type: default
    h[3] = 1;                    // destination/output id
    h.writeUInt32BE(off, 4);
    h.writeUInt16BE(chunk.length, 8);
    packets.push(Buffer.concat([h, chunk]));
    if (chunk.length < maxData) break;
  }
  return packets;
}
```

**Step 4:** Run `node --test test/ddp.test.js`. Expected: PASS.

**Step 5:** Commit.
```bash
git add server/ddp.js test/ddp.test.js && git commit -m "feat: DDP packet builder with fragmentation"
```

---

### Task 1.2: Color-order swizzle (TDD, pure)

**Files:**
- Create: `server/colororder.js`
- Test: `test/colororder.test.js`

**Step 1: Failing test:**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDeviceOrder } from '../server/colororder.js';

test('GRB reorders R,G,B → G,R,B per pixel', () => {
  const rgb = Buffer.from([10,20,30, 40,50,60]);
  assert.deepEqual([...toDeviceOrder(rgb, 'GRB')], [20,10,30, 50,40,60]);
});
test('RGB is identity', () => {
  const rgb = Buffer.from([1,2,3]);
  assert.deepEqual([...toDeviceOrder(rgb, 'RGB')], [1,2,3]);
});
```

**Step 2:** Run, expect FAIL.

**Step 3: Implement** `server/colororder.js`:

```js
const IDX = { R: 0, G: 1, B: 2 };
export function toDeviceOrder(rgb, order = 'RGB') {
  const a = [IDX[order[0]], IDX[order[1]], IDX[order[2]]];
  const out = Buffer.allocUnsafe(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    out[i]   = rgb[i + a[0]];
    out[i+1] = rgb[i + a[1]];
    out[i+2] = rgb[i + a[2]];
  }
  return out;
}
```

**Step 4:** Run, expect PASS. **Step 5:** Commit `feat: color-order swizzle`.

---

### Task 1.3: dgram sender + wire ws frame → DDP (one hardcoded device)

**Files:**
- Create: `server/output.js`
- Modify: `server/index.js`

`server/output.js` holds a routing table `{ deviceId → {ip, port, byteRange, colorOrder} }`. For M1, hardcode one device covering the whole frame. The browser sends frames as: 4-byte header `[uint32 frameId]` is **not** needed yet — for M1 the binary message is just the raw RGB buffer for the single device.

**Step 1: Implement** `server/output.js`:

```js
import dgram from 'node:dgram';
import { buildPackets } from './ddp.js';
import { toDeviceOrder } from './colororder.js';

const sock = dgram.createSocket('udp4');
let seq = 0;

// devices: [{ ip, port=4048, colorOrder, byteStart, byteEnd }]
export function sendFrame(rgb, devices) {
  seq = (seq + 1) & 0x0f;
  for (const d of devices) {
    const slice = rgb.subarray(d.byteStart, d.byteEnd);
    const bytes = toDeviceOrder(slice, d.colorOrder);
    for (const pkt of buildPackets(bytes, { sequence: seq }))
      sock.send(pkt, d.port ?? 4048, d.ip);
  }
}
```

**Step 2: Modify** `server/index.js` ws handler to call it. Add near the top:

```js
import { sendFrame } from './output.js';
// M1: one hardcoded device — set to a real DigQuad IP, or a WLED sim.
const DEVICES = [{ ip: '10.0.0.11', port: 4048, colorOrder: 'GRB', byteStart: 0, byteEnd: 300*3 }];
```

Replace the binary branch:

```js
if (isBinary) { frames++; sendFrame(Buffer.from(data), DEVICES); }
```

**Step 3: Verify (loopback first, no hardware).** Add a throwaway listener test:
Run `node -e "import('dgram').then(d=>{const s=d.default.createSocket('udp4');s.on('message',m=>console.log('rx',m.length,'b flags',m[0].toString(16)));s.bind(4048,()=>console.log('listening 4048'))})"` in one terminal, set `DEVICES[0].ip='127.0.0.1'`, run `npm start`, open the page. Expected: `rx` lines printing ~40–60/s with flags `41`.

**Step 4: Verify (hardware).** Point `DEVICES[0].ip` at one DigQuad running WLED (DDP enabled, ≥300 px configured). Reload page. Expected: **that tube shows the animated gradient** — first light on glass.

**Step 5:** Commit.
```bash
git add server/output.js server/index.js && git commit -m "feat: ws frame → DDP unicast to one device (M1)"
```

**M1 done:** browser canvas drives a real tube.

---

# Milestone M2 — Fixtures, sampling, native CRUD

### Task 2.1: Show-file model + validation (TDD, pure)

**Files:**
- Create: `src/model/show.js`
- Test: `test/show.test.js`

Functions: `emptyShow()`, `addDevice(show, d)`, `addFixture(show, f)`, `validate(show)` (returns `{ok, errors[]}`), `deviceByteRange(show, deviceId)` (computes contiguous byte range from fixtures' `output` for the daemon routing table).

**Step 1: Failing test** (representative subset):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture, validate, deviceByteRange } from '../src/model/show.js';

test('valid minimal show passes validation', () => {
  let s = emptyShow();
  s = addDevice(s, { id: 'c1', name: 'DQ1', ip: '10.0.0.11' });
  s = addFixture(s, { id: 't1', name: 'T1', pixelCount: 300, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 300 },
    input: { points: [[0.1,0.2],[0.1,0.8]], samples: 300 } });
  assert.equal(validate(s).ok, true);
});

test('fixture referencing unknown device fails', () => {
  let s = addFixture(emptyShow(), { id: 't1', name: 'T1', pixelCount: 10, colorOrder: 'GRB',
    output: { deviceId: 'nope', pixelOffset: 0, pixelCount: 10 }, input: { points: [[0,0],[1,1]], samples: 10 } });
  const r = validate(s);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /unknown device/);
});

test('deviceByteRange spans all fixtures on a device', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: 'x' });
  s = addFixture(s, { id: 'a', name:'a', pixelCount:300, colorOrder:'GRB',
    output:{deviceId:'c1',pixelOffset:0,pixelCount:300}, input:{points:[[0,0],[0,1]],samples:300} });
  s = addFixture(s, { id: 'b', name:'b', pixelCount:240, colorOrder:'GRB',
    output:{deviceId:'c1',pixelOffset:300,pixelCount:240}, input:{points:[[0,0],[0,1]],samples:240} });
  assert.deepEqual(deviceByteRange(s, 'c1'), { byteStart: 0, byteEnd: 540*3 });
});
```

**Step 2:** Run, expect FAIL.

**Step 3: Implement** `src/model/show.js` (immutable-ish helpers; structured-clone on write):

```js
export function emptyShow() {
  return { version: 1, devices: [], fixtures: [],
    composition: { canvas: { w: 1280, h: 720 }, layers: [] } };
}
const clone = (s) => structuredClone(s);
export function addDevice(show, d) { const s = clone(show); s.devices.push({ port: 4048, ...d }); return s; }
export function addFixture(show, f) { const s = clone(show); s.fixtures.push(f); return s; }

export function validate(show) {
  const errors = [];
  const ids = new Set(show.devices.map((d) => d.id));
  for (const f of show.fixtures) {
    if (!ids.has(f.output?.deviceId)) errors.push(`fixture ${f.id}: unknown device ${f.output?.deviceId}`);
    if (f.output?.pixelCount !== f.pixelCount) errors.push(`fixture ${f.id}: output pixelCount mismatch`);
    if ((f.input?.points?.length ?? 0) < 2) errors.push(`fixture ${f.id}: input needs ≥2 points`);
  }
  return { ok: errors.length === 0, errors };
}

// Contiguous byte span for a device's pixel buffer (min offset → max offset+count).
export function deviceByteRange(show, deviceId) {
  const fs = show.fixtures.filter((f) => f.output.deviceId === deviceId);
  if (!fs.length) return null;
  const start = Math.min(...fs.map((f) => f.output.pixelOffset));
  const end = Math.max(...fs.map((f) => f.output.pixelOffset + f.output.pixelCount));
  return { byteStart: start * 3, byteEnd: end * 3 };
}
```

**Step 4:** Run, expect PASS. **Step 5:** Commit `feat: show-file model + validation`.

---

### Task 2.2: Sampling math — fixture points → global pixel coordinates (TDD, pure)

**Files:**
- Create: `src/model/sampling.js`
- Test: `test/sampling.test.js`

`buildPixelMap(show)` returns, for every output pixel across all fixtures, its `{ globalIndex, u, v }` where `globalIndex` = the position in the daemon's per-device buffer (device order, by `pixelOffset`), and `(u,v)` is the canvas-space sample point (evenly interpolated along `input.points`, normalized 0..1). This map drives both the GPU sampler and the readback ordering.

**Step 1: Failing test:**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplePoints } from '../src/model/sampling.js';

test('samplePoints interpolates N points along a 2-point line', () => {
  const pts = samplePoints([[0,0],[0,1]], 3); // start, mid, end
  assert.deepEqual(pts, [[0,0],[0,0.5],[0,1]]);
});
test('handles multi-segment polylines by arc length', () => {
  const pts = samplePoints([[0,0],[1,0],[1,1]], 3); // total len 2
  assert.deepEqual(pts[0], [0,0]);
  assert.deepEqual(pts[1], [1,0]);   // midpoint of arc length = corner
  assert.deepEqual(pts[2], [1,1]);
});
```

**Step 2:** Run, expect FAIL.

**Step 3: Implement** `src/model/sampling.js`:

```js
// Resample a polyline into n points evenly spaced by arc length.
export function samplePoints(points, n) {
  if (n === 1) return [points[0].slice()];
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0]-points[i-1][0], dy = points[i][1]-points[i-1][1];
    const len = Math.hypot(dx, dy); seg.push(len); total += len;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = (total * k) / (n - 1), i = 0;
    while (i < seg.length && d > seg[i]) { d -= seg[i]; i++; }
    if (i >= seg.length) { out.push(points[points.length-1].slice()); continue; }
    const t = seg[i] === 0 ? 0 : d / seg[i];
    out.push([
      points[i][0] + (points[i+1][0]-points[i][0])*t,
      points[i][1] + (points[i+1][1]-points[i][1])*t,
    ]);
  }
  return out;
}
```

**Step 4:** Run, expect PASS. **Step 5:** Commit `feat: fixture polyline resampling`.

---

### Task 2.3: Line generator shader + sampler/readback + wire to daemon

**Files:**
- Create: `src/engine/shaders/generators/line.glsl`
- Create: `src/engine/sampler.js`
- Modify: `src/app.js`, `src/bridge.js` (new), `server/index.js`, `server/output.js`

This task replaces the M1 hardcoded path with: render line generator → build pixel-map texture from show → sample pass writes one RGBA texel per output pixel into a 1×N target → `readPixels` → send over ws with a small JSON "route" handshake so the daemon knows device ranges/IPs/color orders from the show file.

**Step 1: Create** `src/engine/shaders/generators/line.glsl`:

```glsl
#version 300 es
precision highp float;
in vec2 uv; out vec4 frag;
uniform float pos;   // 0..1 position across X
uniform float width; // band half-width
uniform float angle; // degrees
void main(){
  float a = radians(angle);
  float coord = uv.x*cos(a) + uv.y*sin(a);
  float d = abs(coord - pos);
  float v = smoothstep(width, 0.0, d);
  frag = vec4(vec3(v), 1.0);
}
```

**Step 2: Implement** `src/engine/sampler.js`. It builds a static data texture of sample UVs (RG32F, one texel per output pixel, ordered by device buffer index) and a sampling program that reads the canvas at those UVs into a 1×N RGBA8 target, then reads it back:

```js
import { makeTarget, program } from './gl.js';

const SAMPLE_FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 frag;
uniform sampler2D uCanvas;   // composited canvas
uniform sampler2D uMap;      // RG = sample uv per output pixel
uniform int uCount;
void main(){
  int i = int(gl_FragCoord.x);
  ivec2 t = ivec2(i, 0);
  vec2 suv = texelFetch(uMap, t, 0).rg;
  frag = texture(uCanvas, suv);
}`;

export function makeSampler(gl, sampleUVs /* Float32Array len 2N */) {
  const n = sampleUVs.length / 2;
  // pack into RG32F texture n×1
  const map = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, map);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, n, 1, 0, gl.RG, gl.FLOAT, sampleUVs);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const target = makeTarget(gl, n, 1);
  const prog = program(gl, SAMPLE_FS);
  const out = new Uint8Array(n * 4);
  return { n, sample(canvasTex) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, n, 1);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, canvasTex);
    gl.uniform1i(gl.getUniformLocation(prog, 'uCanvas'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, map);
    gl.uniform1i(gl.getUniformLocation(prog, 'uMap'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out; // RGBA; bridge strips A
  }};
}
```

**Step 3: Implement** `src/bridge.js` (ws client; sends a JSON route once, then binary RGB frames):

```js
export function connectBridge(route) {
  const ws = new WebSocket(`ws://${location.host}/frames`);
  ws.binaryType = 'arraybuffer';
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'route', route })));
  return {
    send(rgba) {
      if (ws.readyState !== 1) return;
      const n = rgba.length / 4; const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i*3]=rgba[i*4]; rgb[i*3+1]=rgba[i*4+1]; rgb[i*3+2]=rgba[i*4+2]; }
      ws.send(rgb);
    }
  };
}
```

**Step 4: Daemon** — `server/index.js` accepts the JSON `route` message and stores per-connection `DEVICES`; the binary branch uses it:

```js
let route = null;
ws.on('message', (data, isBinary) => {
  if (!isBinary) { const m = JSON.parse(data); if (m.type === 'route') route = m.route; return; }
  if (route) { frames++; sendFrame(Buffer.from(data), route); }
});
```

`route` is `[{ ip, port, colorOrder, byteStart, byteEnd }]`, built in the browser from the show via `deviceByteRange` + device IPs. (For M2, hand-build a 1–2 fixture show in `app.js`; full UI is 2.4.)

**Step 5: Wire** `src/app.js`: build show → compute `samplePoints` per fixture → flatten to `sampleUVs` in device-buffer order → `makeSampler` → each frame: render line gen to a target, `sampler.sample(target.tex)`, `bridge.send(...)`. Render the same line gen to the screen too for visibility.

**Step 6: Verify.** Loopback DDP listener (as in 1.3) shows packets whose length matches the device's pixel count. On hardware, the tube shows a **band that moves along its length** as `pos` animates. Commit `feat: line generator + GPU sampler + show-driven routing (M2 core)`.

---

### Task 2.4: Virtual-fixture preview + fixture/device CRUD UI + output-stage placement

**Files:**
- Create: `src/ui/fixtures.js`, `src/ui/preview.js`
- Modify: `index.html`, `src/app.js`

**Step 1: Preview** (`src/ui/preview.js`): draw each fixture's resampled points to a 2D overlay canvas, coloring each point with the sampled RGB from the last frame. This is the hardware-free dev view.

**Step 2: CRUD UI** (`src/ui/fixtures.js`): list/add/edit/delete devices (name, IP, color order) and fixtures (name, pixelCount, output deviceId+offset, input points). Persist the show to `localStorage` (mirror Kagora's autosave) and offer file load/save via the File API.

**Step 3: Output stage:** drag fixture endpoints on the preview canvas to edit `input.points` (canvas placement) live; recompute `sampleUVs` and rebuild the sampler on change.

**Step 4: Verify manually.** Add two fixtures by hand, drag one across the canvas, confirm its content changes while the other stays; confirm preview matches hardware. Commit `feat: fixture/device CRUD + virtual preview + output-stage placement`.

**M2 done:** fixtures defined natively, sampled from the canvas, previewed and output.

---

# Milestone M3 — Layer stack + effects

### Task 3.1: Param manifest format + auto-generated sliders

**Files:** Create `src/engine/shaders/manifest.js`, `src/ui/layers.js`. Each generator/effect exports `{ name, type, params:[{key,type,min,max,default}] }`. UI renders a slider/colorpicker per param; values feed shader uniforms by name. Verify a manifest renders correct controls. Commit.

### Task 3.2: Compositor — multi-layer + blend modes

**Files:** Create `src/engine/compositor.js`. Render each layer (generator → effect chain) to its own target, then composite top-to-bottom with blend modes (`add`, `screen`, `multiply`, `alpha`) and opacity into the canvas target the sampler reads. Verify two layers blend; sampler reads the composite. Commit.

### Task 3.3: Effects (displace, repeat, strobe)

**Files:** Create `src/engine/shaders/effects/{displace,repeat,strobe}.glsl`, each reading the previous pass texture + its params. Add to a registry. Verify each visibly transforms the line. Commit per effect.

### Task 3.4: Layer-stack UI

**Files:** Extend `src/ui/layers.js`: add/remove/reorder layers, pick generator, add/remove effects, set blend/opacity, edit params. Persist into `show.composition`. Verify a 2-layer + 2-effect show round-trips through save/load. Commit.

**M3 done:** the creative loop.

---

# Milestone M4 — Kagora import + scale

### Task 4.1: Kagora preset adapter (TDD, pure)

**Files:**
- Create: `src/model/kagora-import.js`
- Test: `test/kagora-import.test.js`
- Fixture: copy a trimmed `kagora.json` (2 controllers, a few strips, their edges) to `test/fixtures/kagora-sample.json`.

`importKagora(preset)` returns a show with: one `device` per controller instance (id, name, **no ip** — left blank for the assign step); one `fixture` per strip instance with `pixelCount`/`colorOrder` from its strip type, `output.deviceId` resolved by following data-chain `edges`, and `output.pixelOffset` = cumulative pixels along that controller-output's daisy chain (in edge order). `input.points` default from the strip's `points` normalized into canvas space.

**Step 1: Failing test** — assert device count, fixture count, and that two daisy-chained strips on one output get offsets `0` and `firstPixelCount`. (Write asserts against the trimmed fixture's known topology.)

**Step 2:** Run, expect FAIL.

**Step 3: Implement** the adapter. Key sub-steps:
- Index strip types by id (for `pixelCount`, `colorOrder`, `points`).
- Build a data-graph from `edges` (signal === 'data'): map each strip's `data-out` → next `data-in`, and each output chain's head → its controller output.
- Walk each controller output's chain head→tail, accumulating `pixelOffset`.
- Normalize all strip `points` into a shared 0..1 canvas bounding box.

**Step 4:** Run, expect PASS. **Step 5:** Commit `feat: kagora preset → show importer`.

### Task 4.2: Import UI + IP assignment

**Files:** Modify `src/ui/fixtures.js`. "Import from Kagora…" loads a preset file, runs `importKagora`, then shows an **assign-IPs** table (one row per device) before committing into the show. Verify the 120-fixture preset imports and lists 12 devices needing IPs. Commit.

### Task 4.3: Scale validation to all 12 controllers @40fps

**Files:** none new — measurement + tuning task.
- Load the full Kagora preset, assign the real DigQuad IPs.
- Confirm `readPixels` of ~32,760 texels + ws send + DDP fan-out holds ≥40fps (HUD + daemon fps log).
- If `readPixels` stalls: switch to a PBO async readback (WebGL2 `PIXEL_PACK_BUFFER` + fence) — note as the known optimization.
- Verify the whole installation runs a moving line, then a 2-layer effect show.
- Commit any tuning. Tag `v0.1.0` (MVP complete).

**M4 done:** full installation running a show.

---

## Deferred (post-MVP, separate plans)

- **Audio modulation bus:** Web Audio `AnalyserNode` → bands/beat/envelope; a binding layer mapping modulation sources to any shader param.
- **Timeline / clip deck:** clips per layer, triggers, cross-fade transitions.
- **More generators/effects** + custom-shader paste with live recompile.

## Risk notes for the implementer

- **DDP data-type byte (`h[2]`)**: kept `0` (default) — WLED uses length, not type. If a controller rejects frames, try `0x01`. Verify against your WLED build early in M1.
- **`readPixels` is a sync GPU stall.** Fine at 32k texels for 40fps, but if the HUD dips, the PBO async path in Task 4.3 is the fix — don't pre-optimize.
- **Sequence number** is 4-bit (0–15) per DDP; we wrap. WLED tolerates non-monotonic; fine.
- **WS2815 per-output timing** caps ~48fps/output — target 40fps; don't chase 60.
