// Optional output bridge to the Node DDP daemon. The render/preview UI works
// fully standalone — the daemon (and this socket) only carries live LED output.
// So construction must NEVER throw and a missing/failed daemon is a no-op:
//  - use wss:// on an HTTPS page (ws:// would be blocked as mixed content),
//  - swallow connect failures (e.g. static hosting with no daemon),
//  - send() does nothing until the socket is actually open,
//  - AUTO-RECONNECT with backoff so a daemon restart / sleep-wake / Wi-Fi blip
//    recovers on its own (output used to die until the next geometry edit).
export function connectBridge(route) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws = null;
  let closed = false;     // explicit close() → stop reconnecting
  let backoff = 500;      // ms; doubles per failed attempt, capped at 5s
  let timer = null;
  let everOpen = false;   // distinguish "never reached the daemon" from "dropped"
  let lastErr = null;     // surfaced in the HUD instead of being swallowed

  const open = () => {
    if (closed) return;
    try {
      ws = new WebSocket(`${proto}://${location.host}/frames`);
      ws.binaryType = 'arraybuffer';
      // On (re)connect, (re)send the current route so the daemon knows where bytes go.
      ws.addEventListener('open', () => {
        backoff = 500; everOpen = true; lastErr = null;
        try { ws.send(JSON.stringify({ type: 'route', route })); } catch { /* race */ }
      });
      ws.addEventListener('error', () => { lastErr = 'connection error'; });   // a failed connect fires 'close' next
      ws.addEventListener('close', () => {
        if (closed) return;
        if (!lastErr) lastErr = everOpen ? 'daemon disconnected' : 'daemon unreachable';
        ws = null;
        timer = setTimeout(open, backoff);            // retry, backing off
        backoff = Math.min(backoff * 2, 5000);
      });
    } catch {
      ws = null; lastErr = 'insecure context';   // construction failure → run UI-only, no retry loop
    }
  };
  open();

  return {
    send(rgba) {
      if (!ws || ws.readyState !== 1) return;
      const n = rgba.length / 4; const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
      ws.send(rgb);
    },
    // Live route update over the EXISTING socket — no teardown/reconnect blip
    // (the daemon just reassigns its route). Used on every geometry edit.
    setRoute(next) {
      route = next;
      if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify({ type: 'route', route })); } catch { /* race */ } }
    },
    connected: () => !!ws && ws.readyState === 1,
    lastError: () => lastErr,
    close() { closed = true; if (timer) clearTimeout(timer); try { ws?.close(); } catch { /* already closing */ } },
  };
}
