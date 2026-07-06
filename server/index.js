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
import { sendFrame, suppressOutput, setBlackout, getBlackout, setBrightnessOverride, getBrightnessOverrides } from './output.js';
import { VERSION } from '../src/version.js';
import { scanArtnet } from './artpoll.js';
import { getState, postState, scanSubnet, pushConfig, getOutputs } from './wled.js';
import { createApiHandler, readJson, authorized, problem, statusBody, parseManifest, clipsBody, controlsBody } from './api.js';

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
  // Liveness/health probe — for an external uptime check or `curl` cron on the Pi.
  // 200 + JSON snapshot: version, uptime, output fps, connected clients, ms since the
  // last frame was sent (null if never). No auth (LAN-local daemon).
  if (url.pathname === '/health' || url.pathname === '/api/health') {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({
      ok: true,
      version: VERSION,
      pid: process.pid,   // so a newer instance can take over (SIGTERM) — see the port-in-use handler
      uptimeSec: Math.round(process.uptime()),
      fpsOut,
      clients: wss.clients.size,
      lastFrameMsAgo: lastFrameAt ? Date.now() - lastFrameAt : null,
      lastFreshMsAgo: lastFreshAt ? Date.now() - lastFreshAt : null,
      outputStale,
      osc: OSC_PORT,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    }));
  }
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
  if (url.pathname === '/api/wled/outputs') {
    res.setHeader('content-type', 'application/json');
    const ip = url.searchParams.get('ip');
    if (!ip) { res.writeHead(400); return res.end(JSON.stringify({ error: 'missing ip' })); }
    try { res.end(JSON.stringify(await getOutputs(ip))); }
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
  // Control API — versioned surface for external clients (scripts, Home
  // Assistant, later an MCP wrapper). See server/api.js + docs/api.md.
  if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) return handleApi(req, res, url);
  if (await serveStatic(ROOT, req, res)) return;
  res.writeHead(404); res.end('not found');
});
// permessage-deflate OFF: RGB pixel frames are high-entropy (near-incompressible),
// so deflate would burn CPU both ends for ~zero gain. maxPayload caps a malformed
// frame. The daemon, not the browser, paces output (below).
const OUTPUT_FPS = 42, KEEPALIVE_MS = 1000;   // default cap; the editor can override per route (m.fps)
// Stale-frame watchdog: if the editor stops sending FRESH frames (a frozen/crashed tab with
// the socket still open) for STALE_MS, don't keep-alive the frozen frame forever — fade it to
// black over FADE_MS so the wall fails to a deliberate dark state, not stale garbage.
const STALE_MS = 3000, FADE_MS = 1500;
// Both WS paths share the HTTP port, so upgrades are routed manually (an
// ws-attached server would 400 the other path's handshakes): /frames = the
// pixel/ext bridge (open, as before), /api/v1/events = the control-API event
// stream (token-gated like the rest of /api/v1).
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 });
const eventsWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
http.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/frames') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/api/v1/events') {
    if (!authorized(req, API_TOKEN)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\nconnection: close\r\n\r\n'
        + JSON.stringify(problem('unauthorized', 'set header: Authorization: Bearer <LZ_API_TOKEN>')));
      socket.destroy();
      return;
    }
    eventsWss.handleUpgrade(req, socket, head, (ws) => eventsWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
let frames = 0;
let fpsOut = 0;            // frames sent in the last 1s window (for /health)
let lastFrameAt = 0;      // ms epoch of the last frame actually sent
let lastFreshAt = 0;      // ms epoch of the last FRESH frame received from a client
let outputStale = false;  // watchdog tripped (faded to safe state) — surfaced in /health
let safeBuf = null;       // reused buffer for the faded/black safe state
let lastManifest = null;   // cache the editor's latest companion manifest, so a phone gets the show the moment it connects
// Hoisted for the control API (/api/v1): the latest route from any connection
// (only the editor sends routes), its fps cap, and WHICH socket is the editor —
// so /devices answers from cache and relayed writes can 503 honestly when no
// editor is connected to apply them.
let lastRoute = null;
let lastFps = OUTPUT_FPS;
let editorWs = null;
const editorConnected = () => !!editorWs && editorWs.readyState === 1;
// Auto-quit (packaged app only, LZ_AUTOQUIT=1 from the launcher): once the last
// editor window closes, the daemon has no reason to linger — exit so it can't
// become a stale process that holds the port and blocks the next launch/update.
// A grace window survives a reload (Force-update briefly drops the socket). Dev
// (`npm start`) and headless/API runs don't set the flag, so they stay up.
const AUTOQUIT = process.env.LZ_AUTOQUIT === '1';
let quitTimer = null, everHadClient = false;
function armAutoQuit() {
  if (!AUTOQUIT) return;
  clearTimeout(quitTimer);
  if (everHadClient && wss.clients.size === 0) {
    quitTimer = setTimeout(() => {
      if (wss.clients.size === 0) { console.log('[ws] last window closed — exiting'); process.exit(0); }
    }, 8000);
  }
}
wss.on('connection', (ws) => {
  everHadClient = true; clearTimeout(quitTimer);
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
      // WATCHDOG: client stopped sending fresh frames (frozen/crashed tab) → fade the held
      // frame to black over FADE_MS instead of keep-aliving stale garbage indefinitely.
      const staleFor = lastFreshAt ? now - lastFreshAt : 0;
      if (staleFor > STALE_MS) {
        if (!outputStale) { outputStale = true; console.warn('[ws] no fresh frames — fading to safe state'); pushApiStatus(); }
        const k = staleFor >= STALE_MS + FADE_MS ? 0 : 1 - (staleFor - STALE_MS) / FADE_MS;   // 1→0
        if (k <= 0 && now - lastSent < KEEPALIVE_MS) return;   // fully dark → keep-alive black at ~1Hz
        if (!safeBuf || safeBuf.length !== latest.length) safeBuf = Buffer.alloc(latest.length);
        if (k <= 0) safeBuf.fill(0); else for (let i = 0; i < latest.length; i++) safeBuf[i] = Math.round(latest[i] * k);
        lastSent = now; lastFrameAt = now;
        try { sendFrame(safeBuf, route); } catch (e) { console.error('[ws] safe send failed', e.message); }
        return;
      }
      if (outputStale) { outputStale = false; console.log('[ws] fresh frames resumed'); pushApiStatus(); }
      if (!dirty && now - lastSent < KEEPALIVE_MS) return;   // fresh frames at outFps; else ~1Hz keep-alive
      dirty = false; lastSent = now; frames++; lastFrameAt = now;
      try { sendFrame(latest, route); } catch (e) { console.error('[ws] sendFrame failed', e.message); }
    }, frameMs);
  };
  ws.on('message', (data, isBinary) => {
    if (isBinary) { if (route) { latest = data; dirty = true; lastFreshAt = Date.now(); } return; }   // ws gives a fresh Buffer per msg → no copy
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'route') {
        route = m.route; console.log(`[ws] route set: ${route.length} device(s)`);
        // Optional global output framerate cap (clamped); rebuild the pacer if it changed.
        const fps = Math.max(1, Math.min(60, Math.round(Number(m.fps) || OUTPUT_FPS)));
        if (fps !== outFps) { outFps = fps; console.log(`[ws] output fps → ${outFps}`); startTimer(); }
        // Only the editor sends routes → mark it (control API); announce the
        // editor coming online to /api/v1/events subscribers.
        const hadEditor = editorConnected();
        lastRoute = route; lastFps = outFps; editorWs = ws;
        if (!hadEditor) pushApiStatus();
      }
      // External-channel ingest over the socket: any client (an app, a sensor
      // script) can send { type:'ext', channel, value } — relay it to the OTHER
      // clients so the UI(s) pick it up. Same shape the OSC listener broadcasts.
      else if (m.type === 'ext') broadcastExt(m.channel, m.value, ws);
      // Companion remote: the editor publishes { type:'manifest', … } (cached so
      // late-joining phones get it instantly); a phone asks with
      // { type:'manifest-req' } — answered from cache AND relayed to the editor
      // so it republishes fresh values.
      else if (m.type === 'manifest') { lastManifest = data.toString(); relayRaw(lastManifest, ws); pushApiManifest(); }
      else if (m.type === 'manifest-req') {
        if (lastManifest && ws.readyState === 1) { try { ws.send(lastManifest); } catch { /* closing */ } }
        relayRaw(data.toString(), ws);
      }
    } catch (e) { console.error('[ws] bad message', e.message); }
  });
  startTimer();
  ws.on('close', () => {
    if (timer) clearInterval(timer);
    if (editorWs === ws) { editorWs = null; pushApiStatus(); }   // the editor left — relayed API writes now 503
    console.log('[ws] client disconnected');
    armAutoQuit();   // last window gone → exit after the grace window (packaged app only)
  });
});
setInterval(() => { fpsOut = frames; if (frames) { console.log(`[ws] ${frames} fps out`); frames = 0; } }, 1000);

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
// --- Control API (/api/v1) ---------------------------------------------------
// All live daemon state is passed as getters so server/api.js stays pure and
// unit-testable. Auth: optional LZ_API_TOKEN (Bearer). Docs: docs/api.md.
const API_TOKEN = process.env.LZ_API_TOKEN || '';
const apiSnapshot = () => ({
  version: VERSION,
  uptimeSec: Math.round(process.uptime()),
  editorConnected: editorConnected(),
  clients: wss.clients.size,
  fpsOut,
  fpsCap: lastFps,
  outputStale,
  blackout: getBlackout(),
  lastFrameAt,
  osc: OSC_PORT,
  devices: lastRoute ? lastRoute.length : null,
});
const handleApi = createApiHandler({
  token: API_TOKEN,
  status: apiSnapshot,
  route: () => lastRoute,
  manifest: () => lastManifest,
  overrides: getBrightnessOverrides,
  editorConnected,
  relay: (address, value) => broadcastExt(address, value),
  setBlackout: (on) => { const r = setBlackout(on); pushApiStatus(); return r; },
  setBrightness: setBrightnessOverride,
});
// WS /api/v1/events — status on connect + on change (editor connect/disconnect,
// blackout, outputStale flips), manifest when the editor republishes.
function apiEvent(obj) {
  if (!eventsWss.clients.size) return;
  const s = JSON.stringify(obj);
  for (const c of eventsWss.clients) {
    if (c.readyState === 1) { try { c.send(s); } catch { /* closing */ } }
  }
}
function pushApiStatus() { apiEvent({ type: 'status', ...statusBody(apiSnapshot()) }); }
function pushApiManifest() {
  const data = parseManifest(lastManifest);
  if (data) apiEvent({ type: 'manifest', ...clipsBody(data), ...controlsBody(data) });
}
eventsWss.on('connection', (ws) => {
  try { ws.send(JSON.stringify({ type: 'status', ...statusBody(apiSnapshot()) })); } catch { /* closing */ }
});
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
// Ask a running instance who it is (version + pid) so a NEWER launch can take over.
async function fetchHealth(port) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 500);
  try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal }); return await r.json(); }
  catch { return null; } finally { clearTimeout(t); }
}
async function waitForPortFree(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (!(await portInUse(port))) return true; await new Promise((r) => setTimeout(r, 150)); }
  return !(await portInUse(port));
}
// Port busy → LED Zeppelin is probably already there. The PACKAGED app (launcher sets
// LZ_TAKEOVER=1) TAKES OVER: SIGTERM the running daemon — which makes its launcher
// quit too — then binds the port itself, so an UPDATE actually applies and a
// stale/stuck instance can't wedge the port forever. Dev/CLI just opens the existing
// instance (no takeover — don't kill a running app from a terminal).
if (await portInUse(PORT)) {
  const health = process.env.LZ_TAKEOVER === '1' ? await fetchHealth(PORT) : null;
  if (health?.pid) {
    console.error(`port ${PORT} held by pid ${health.pid} (v${health.version}) — taking over`);
    try { process.kill(health.pid, 'SIGTERM'); } catch { /* already gone */ }
    if (!(await waitForPortFree(PORT, 4000))) { try { process.kill(health.pid, 'SIGKILL'); } catch { /* */ } await waitForPortFree(PORT, 2000); }
  }
  if (await portInUse(PORT)) {   // still busy (not ours, or couldn't reclaim) → just open it
    console.error(`port ${PORT} in use — LED Zeppelin already running? opening ${httpUrl}`);
    if (wantOpen()) openBrowser(httpUrl);
    process.exit(0);
  }
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
