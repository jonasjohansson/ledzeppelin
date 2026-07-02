// HTTP control API — /api/v1 (design: docs/plans/2026-07-02-control-api-design.md).
// Lets external clients (shell scripts, Home Assistant, cron, later an MCP
// wrapper) read daemon state and control the running show over plain HTTP.
//
// Split by who can answer:
//   daemon-native  — status, devices (hoisted route), blackout, brightness override
//   cache-served   — clips/controls from the editor's cached companion manifest
//   relayed        — clip trigger / param set via broadcastExt (same channel as
//                    OSC and the phone remote; the editor applies via routeOsc)
//
// The pure body-builders below are exported for unit tests; createApiHandler
// wires them to live daemon state passed in as a ctx of getters/actions.

// Read a request's JSON body (small payloads only). Shared with server/index.js.
export function readJson(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Minimal problem+json-ish error body. Types: unauthorized, not-found, no-route,
// no-manifest, no-editor, bad-address, bad-request.
export const problem = (type, detail) => ({ type, detail });

// If LZ_API_TOKEN is configured, every /api/v1/* request (HTTP and the events
// WS upgrade) must carry `Authorization: Bearer <token>`. No token = open LAN
// API (same threat model as WLED's own unauthenticated JSON API).
export function authorized(req, token) {
  if (!token) return true;
  return req.headers?.authorization === `Bearer ${token}`;
}

// GET /api/v1/status — daemon + editor + output state (from a plain snapshot
// object so it stays unit-testable).
export function statusBody(s, now = Date.now()) {
  return {
    version: s.version,
    uptimeSec: s.uptimeSec,
    editorConnected: !!s.editorConnected,
    clients: s.clients,
    fpsOut: s.fpsOut,
    fpsCap: s.fpsCap,
    outputStale: !!s.outputStale,
    blackout: !!s.blackout,
    lastFrameMsAgo: s.lastFrameAt ? now - s.lastFrameAt : null,
    osc: s.osc,
    devices: s.devices ?? null,
  };
}

// GET /api/v1/devices — what the daemon KNOWS from the last route message (no
// probing). pixels derived from the frame byte span (3 bytes/pixel RGB in).
export function devicesBody(route, overrides = {}) {
  return {
    devices: (route || []).map((d) => ({
      ip: d.ip,
      protocol: d.protocol === 'artnet' ? 'artnet' : 'ddp',
      port: d.port ?? (d.protocol === 'artnet' ? 6454 : 4048),
      pixels: Math.max(0, Math.round(((d.byteEnd ?? 0) - (d.byteStart ?? 0)) / 3)),
      brightness: d.brightness ?? 1,
      brightnessOverride: overrides[d.ip] ?? null,
      gamma: d.gamma ?? 1,
      delayMs: Number(d.delayMs) || 0,
    })),
  };
}

// The daemon caches the editor's companion manifest as the raw JSON string
// ({ type:'manifest', data:{ layers, controls, theme } }) — pull out `data`.
export function parseManifest(str) {
  if (!str) return null;
  try { return JSON.parse(str).data ?? null; } catch { return null; }
}

// GET /api/v1/clips — layers/clips from the cached manifest (thumbs/theme
// stripped: API clients don't need dataURL thumbnails).
export function clipsBody(data) {
  return {
    layers: (data?.layers || []).map((L) => ({
      n: L.n,
      name: L.name,
      opacity: L.opacity,
      bypass: !!L.bypass,
      clips: (L.clips || []).map((c) => ({ m: c.m, name: c.name, active: !!c.active })),
    })),
  };
}

// GET /api/v1/controls — the exposed custom params from the cached manifest.
export function controlsBody(data) {
  return {
    controls: (data?.controls || []).map(({ address, label, kind, min, max, value, def }) => (
      { address, label, kind, min, max, value, def }
    )),
  };
}

// ctx: { token, status(), route(), manifest(), overrides() } — index.js supplies
// live daemon state. Returns an async (req, res, url) that fully answers any
// /api/v1/* request (caller routes on the path prefix).
export function createApiHandler(ctx) {
  const send = (res, code, body) => { res.writeHead(code); res.end(JSON.stringify(body)); };
  return async function handleApi(req, res, url) {
    const p = url.pathname.replace(/\/+$/, '') || '/api/v1';
    // CORS: a LAN control API — browser dashboards on other origins are a
    // feature; the token (when set) still gates access.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (!authorized(req, ctx.token)) {
      return send(res, 401, problem('unauthorized', 'set header: Authorization: Bearer <LZ_API_TOKEN>'));
    }
    if (req.method === 'GET') {
      if (p === '/api/v1/status') return send(res, 200, statusBody(ctx.status()));
      if (p === '/api/v1/devices') {
        const route = ctx.route();
        if (!route) return send(res, 503, problem('no-route', 'no editor has sent an output route yet'));
        return send(res, 200, devicesBody(route, ctx.overrides?.() || {}));
      }
      if (p === '/api/v1/clips' || p === '/api/v1/controls') {
        const data = parseManifest(ctx.manifest());
        if (!data) return send(res, 503, problem('no-manifest', 'no editor has published a manifest yet'));
        return send(res, 200, p === '/api/v1/clips' ? clipsBody(data) : controlsBody(data));
      }
    }
    return send(res, 404, problem('not-found', `no such endpoint: ${req.method} ${p}`));
  };
}
