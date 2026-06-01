import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveStatic } from './static.js';
import { sendFrame } from './output.js';
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
http.listen(PORT, () => console.log(`ledzeppelin http://localhost:${PORT}`));
