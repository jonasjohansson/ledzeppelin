import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { parseOsc } from './osc.js';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serveStatic } from './static.js';
import { sendFrame, suppressOutput } from './output.js';
import { scanArtnet } from './artpoll.js';
import { getState, postState, scanSubnet, pushConfig } from './wled.js';

// Read a request's JSON body (small payloads only).
function readJson(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Proxy a WLED JSON-API call (GET state, POST partial state) for the browser.
// Always returns JSON; failures come back as { error } with a 502 so the UI can
// show the controller as offline without the request throwing.
async function handleWled(req, res, ip) {
  res.setHeader('content-type', 'application/json');
  if (!ip) { res.writeHead(400); return res.end(JSON.stringify({ error: 'missing ip' })); }
  try {
    let data;
    if (req.method === 'POST') {
      // A write (on/off/identify/brightness) is ignored in realtime mode — pause
      // the DDP stream briefly so WLED actually applies it.
      suppressOutput(ip, 4000);
      await new Promise((r) => setTimeout(r, 250));
      data = await postState(ip, await readJson(req));
    } else {
      data = await getState(ip);
    }
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
  }
}

// Open the UI in the default browser. Gated behind OPEN=1 (the `launch` script /
// double-click launchers set it) so plain `npm start`, headless service runs,
// and CI never spawn a browser. Best-effort — a failure must not kill the daemon.
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { shell: process.platform === 'win32', detached: true, stdio: 'ignore' }).unref();
  } catch { /* no browser / unsupported env — UI is still reachable manually */ }
}
// Where the web assets (index.html, src/, fonts/, …) live. In dev they sit at the
// repo root (server/..). In a Bun-compiled binary import.meta.url points inside the
// embedded fs, so fall back to dirs next to the executable — the build ships the
// assets there (plain folder: beside the binary or ./assets; macOS .app:
// ../Resources). `PACKAGED` is true when we resolved from the executable.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = (() => {
  if (existsSync(join(SRC_ROOT, 'index.html'))) return SRC_ROOT;
  const exeDir = dirname(process.execPath);
  for (const c of [exeDir, join(exeDir, 'assets'), join(exeDir, '..', 'Resources')]) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return SRC_ROOT;
})();
const PACKAGED = ROOT !== SRC_ROOT;
const PORT = Number(process.env.PORT) || 7070;
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Control discovery: the editor asks for the daemon's LAN address so it can
  // show a phone-reachable /control/ URL + QR (localhost wouldn't work on a phone).
  if (url.pathname === '/api/info') {
    const lan = Object.values(networkInterfaces()).flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address || null;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ lan, port: PORT, osc: OSC_PORT }));
  }
  // Set the OSC listen PORT live (the Mapping window's OSC-input field). Rebinds.
  if (url.pathname === '/api/osc/port' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json');
    try { bindOsc((await readJson(req)).port); res.end(JSON.stringify({ osc: OSC_PORT })); }
    catch (e) { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (url.pathname === '/api/wled/state') return handleWled(req, res, url.searchParams.get('ip'));
  if (url.pathname === '/api/artnet/scan') {
    res.setHeader('content-type', 'application/json');
    try { res.end(JSON.stringify(await scanArtnet())); }
    catch (e) { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (url.pathname === '/api/wled/scan') {
    res.setHeader('content-type', 'application/json');
    try { res.end(JSON.stringify(await scanSubnet())); }
    catch (e) { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (url.pathname === '/api/wled/config' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json');
    const ip = url.searchParams.get('ip');
    if (!ip) { res.writeHead(400); return res.end(JSON.stringify({ error: 'missing ip' })); }
    try { const body = await readJson(req); res.end(JSON.stringify(await pushConfig(ip, body.outs || []))); }
    catch (e) { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (await serveStatic(ROOT, req, res)) return;
  res.writeHead(404); res.end('not found');
});
// permessage-deflate OFF: RGB pixel frames are high-entropy (near-incompressible),
// so deflate would burn CPU both ends for ~zero gain. maxPayload caps a malformed
// frame. The daemon, not the browser, paces output (below).
const OUTPUT_FPS = 42, KEEPALIVE_MS = 1000;   // default cap; the editor can override per route (m.fps)
const wss = new WebSocketServer({ server: http, path: '/frames', perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 });
let frames = 0;
let lastManifest = null;   // cache the editor's latest companion manifest, so a phone gets the show the moment it connects
wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  if (lastManifest) { try { ws.send(lastManifest); } catch { /* closing */ } }   // hand a new phone the last known show
  // Hold the LATEST frame + route and emit DDP on the daemon's OWN fixed-rate
  // timer (not on WS arrival). This is the authoritative clock: bursts from a
  // fast/uneven browser coalesce to the newest frame, a backgrounded tab can't
  // freeze the wall (we keep-alive the last frame so WLED stays in realtime), and
  // slow downstream can't pile frames up in the receive path.
  let route = null, latest = null, dirty = false, lastSent = 0;
  let outFps = OUTPUT_FPS, timer = null;
  const startTimer = () => {
    if (timer) clearInterval(timer);
    const frameMs = 1000 / outFps;
    timer = setInterval(() => {
      if (!route || !latest) return;
      const now = Date.now();
      if (!dirty && now - lastSent < KEEPALIVE_MS) return;   // fresh frames at outFps; else ~1Hz keep-alive
      dirty = false; lastSent = now; frames++;
      try { sendFrame(latest, route); } catch (e) { console.error('[ws] sendFrame failed', e.message); }
    }, frameMs);
  };
  ws.on('message', (data, isBinary) => {
    if (isBinary) { if (route) { latest = data; dirty = true; } return; }   // ws gives a fresh Buffer per msg → no copy
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'route') {
        route = m.route; console.log(`[ws] route set: ${route.length} device(s)`);
        // Optional global output framerate cap (clamped); rebuild the pacer if it changed.
        const fps = Math.max(1, Math.min(60, Math.round(Number(m.fps) || OUTPUT_FPS)));
        if (fps !== outFps) { outFps = fps; console.log(`[ws] output fps → ${outFps}`); startTimer(); }
      }
      // External-channel ingest over the socket: any client (an app, a sensor
      // script) can send { type:'ext', channel, value } — relay it to the OTHER
      // clients so the UI(s) pick it up. Same shape the OSC listener broadcasts.
      else if (m.type === 'ext') broadcastExt(m.channel, m.value, ws);
      // Companion remote: the editor publishes { type:'manifest', … } (cached so
      // late-joining phones get it instantly); a phone asks with
      // { type:'manifest-req' } — answered from cache AND relayed to the editor
      // so it republishes fresh values.
      else if (m.type === 'manifest') { lastManifest = data.toString(); relayRaw(lastManifest, ws); }
      else if (m.type === 'manifest-req') {
        if (lastManifest && ws.readyState === 1) { try { ws.send(lastManifest); } catch { /* closing */ } }
        relayRaw(data.toString(), ws);
      }
    } catch (e) { console.error('[ws] bad message', e.message); }
  });
  startTimer();
  ws.on('close', () => { if (timer) clearInterval(timer); console.log('[ws] client disconnected'); });
});
setInterval(() => { if (frames) { console.log(`[ws] ${frames} fps out`); frames = 0; } }, 1000);

// --- External modulation ingest ---------------------------------------------
// Push an external channel value to every connected ws client (except the
// sender, when it came in over the socket itself). The browser maps these onto
// 'external'-mode params (src/model/external.js).
// Relay a raw JSON string to every client except the sender (companion manifest).
function relayRaw(str, except) {
  for (const c of wss.clients) {
    if (c !== except && c.readyState === 1) { try { c.send(str); } catch { /* closing */ } }
  }
}
function broadcastExt(channel, value, except) {
  if (typeof channel !== 'string' || !Number.isFinite(Number(value))) return;
  const msg = JSON.stringify({ type: 'ext', channel, value: Number(value) });
  for (const c of wss.clients) {
    if (c !== except && c.readyState === 1) { try { c.send(msg); } catch { /* closing */ } }
  }
}
// OSC over UDP: any address, first numeric arg → an external channel named by
// the address. TouchOSC / TouchDesigner / oscsend point here.
// Bindable so the listen PORT can be changed live (Mapping window → POST
// /api/osc/port). Rebinding closes the old socket and binds the new port.
let OSC_PORT = Number(process.env.OSC_PORT) || 9000;
let osc = null;
function bindOsc(port) {
  const p = Math.max(1, Math.min(65535, Math.round(Number(port) || OSC_PORT)));
  if (osc) { try { osc.close(); } catch { /* already closed */ } osc = null; }
  OSC_PORT = p;
  const s = createSocket('udp4');
  let seen = false;
  s.on('message', (buf) => {
    if (!seen) { seen = true; console.log(`[osc] receiving on :${OSC_PORT}`); }
    for (const { address, value } of parseOsc(buf)) broadcastExt(address, value);
  });
  s.on('error', (e) => { console.error(`[osc] listener error: ${e.message}`); try { s.close(); } catch { /* already closed */ } });
  s.bind(OSC_PORT);
  osc = s;
}
bindOsc(OSC_PORT);
const httpUrl = `http://localhost:${PORT}`;
const wantOpen = () => process.env.OPEN || PACKAGED;
// Is something already listening on the HTTP port? (try to connect to it.)
function portInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    const done = (v) => { try { sock.destroy(); } catch { /* */ } resolve(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), 300);
  });
}
// If the port's busy, LEDZeppelin is most likely already running there — a
// double-click should just OPEN that instance, not crash ("nothing happens").
if (await portInUse(PORT)) {
  console.error(`port ${PORT} in use — LEDZeppelin already running? opening ${httpUrl}`);
  if (wantOpen()) openBrowser(httpUrl);
  process.exit(0);
}
// Backstop for any late bind race / unexpected throw (Bun emits listen errors in a
// way the server's 'error' event + try/catch don't reliably catch).
process.on('uncaughtException', (e) => {
  if (e && (e.code === 'EADDRINUSE' || /eaddrinuse|in use|failed to start server/i.test(e.message || ''))) {
    if (wantOpen()) openBrowser(httpUrl);
    process.exit(0);
  }
  console.error(`server error: ${e?.message || e}`);
  process.exit(1);
});
http.listen(PORT, () => {
  console.log(`ledzeppelin ${httpUrl}`);
  // The phone companion: print the LAN URL so anyone on the network can open it.
  const lan = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (lan) console.log(`control    http://${lan}:${PORT}/control/  (open on a phone on this Wi-Fi)`);
  // Auto-open the browser when launched as a packaged app (double-click), or when
  // OPEN=1 (the launch script). Plain `npm start` / headless / CI stay quiet.
  if (wantOpen()) openBrowser(httpUrl);
});
