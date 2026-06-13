import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { parseOsc } from './osc.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveStatic } from './static.js';
import { sendFrame, suppressOutput } from './output.js';
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
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 7070;
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/wled/state') return handleWled(req, res, url.searchParams.get('ip'));
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
const OUTPUT_FPS = 42, FRAME_MS = 1000 / OUTPUT_FPS, KEEPALIVE_MS = 1000;
const wss = new WebSocketServer({ server: http, path: '/frames', perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 });
let frames = 0;
wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  // Hold the LATEST frame + route and emit DDP on the daemon's OWN fixed-rate
  // timer (not on WS arrival). This is the authoritative clock: bursts from a
  // fast/uneven browser coalesce to the newest frame, a backgrounded tab can't
  // freeze the wall (we keep-alive the last frame so WLED stays in realtime), and
  // slow downstream can't pile frames up in the receive path.
  let route = null, latest = null, dirty = false, lastSent = 0;
  ws.on('message', (data, isBinary) => {
    if (isBinary) { if (route) { latest = data; dirty = true; } return; }   // ws gives a fresh Buffer per msg → no copy
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'route') { route = m.route; console.log(`[ws] route set: ${route.length} device(s)`); }
      // External-channel ingest over the socket: any client (an app, a sensor
      // script) can send { type:'ext', channel, value } — relay it to the OTHER
      // clients so the UI(s) pick it up. Same shape the OSC listener broadcasts.
      else if (m.type === 'ext') broadcastExt(m.channel, m.value, ws);
      // Companion remote: the editor publishes { type:'manifest', … }; a phone
      // asks with { type:'manifest-req' }. Relay both verbatim to every OTHER
      // client (editor ⇄ phones), same fan-out as ext.
      else if (m.type === 'manifest' || m.type === 'manifest-req') relayRaw(data.toString(), ws);
    } catch (e) { console.error('[ws] bad message', e.message); }
  });
  const timer = setInterval(() => {
    if (!route || !latest) return;
    const now = Date.now();
    if (!dirty && now - lastSent < KEEPALIVE_MS) return;   // fresh frames at OUTPUT_FPS; else ~1Hz keep-alive
    dirty = false; lastSent = now; frames++;
    try { sendFrame(latest, route); } catch (e) { console.error('[ws] sendFrame failed', e.message); }
  }, FRAME_MS);
  ws.on('close', () => { clearInterval(timer); console.log('[ws] client disconnected'); });
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
const OSC_PORT = Number(process.env.OSC_PORT) || 9000;
const osc = createSocket('udp4');
let oscSeen = false;
osc.on('message', (buf) => {
  if (!oscSeen) { oscSeen = true; console.log(`[osc] receiving on :${OSC_PORT}`); }
  for (const { address, value } of parseOsc(buf)) broadcastExt(address, value);
});
osc.on('error', (e) => { console.error(`[osc] listener error: ${e.message}`); try { osc.close(); } catch { /* already closed */ } });
osc.bind(OSC_PORT);
http.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`ledzeppelin ${url}`);
  // The phone companion: print the LAN URL so anyone on the network can open it.
  const lan = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (lan) console.log(`companion  http://${lan}:${PORT}/remote/  (open on a phone on this Wi-Fi)`);
  if (process.env.OPEN) openBrowser(url);
});
