// Optional output bridge to the Node DDP daemon. The render/preview UI works
// fully standalone — the daemon (and this socket) only carries live LED output.
// So construction must NEVER throw and a missing/failed daemon is a no-op:
//  - use wss:// on an HTTPS page (ws:// would be blocked as mixed content),
//  - swallow connect failures (e.g. static hosting with no daemon),
//  - send() does nothing until the socket is actually open.
export function connectBridge(route) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws = null;
  try {
    ws = new WebSocket(`${proto}://${location.host}/frames`);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'route', route })));
    ws.addEventListener('error', () => {}); // no daemon → output disabled, not an error
  } catch {
    ws = null; // insecure-context / construction failure → run UI-only
  }
  return {
    send(rgba) {
      if (!ws || ws.readyState !== 1) return;
      const n = rgba.length / 4; const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i*3]=rgba[i*4]; rgb[i*3+1]=rgba[i*4+1]; rgb[i*3+2]=rgba[i*4+2]; }
      ws.send(rgb);
    },
    connected: () => !!ws && ws.readyState === 1,
    close() { try { ws?.close(); } catch { /* already closing */ } },
  };
}
