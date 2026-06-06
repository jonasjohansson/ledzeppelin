import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
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
const PORT = 7070;
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
const wss = new WebSocketServer({ server: http, path: '/frames' });
let frames = 0;
wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  let route = null;
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (route) { frames++; sendFrame(Buffer.from(data), route); }
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'route') { route = m.route; console.log(`[ws] route set: ${route.length} device(s)`); }
    } catch (e) { console.error('[ws] bad message', e.message); }
  });
  ws.on('close', () => console.log('[ws] client disconnected'));
});
setInterval(() => { if (frames) { console.log(`[ws] ${frames} fps`); frames = 0; } }, 1000);
http.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`ledzeppelin ${url}`);
  if (process.env.OPEN) openBrowser(url);
});
