import os from 'node:os';
import { suppressOutput } from './output.js';

// Minimal WLED JSON-API proxy, run by the daemon so the BROWSER can reach
// controllers without tripping CORS (a fetch from localhost:7070 → the device IP
// is cross-origin and WLED sends no CORS headers). The daemon has no such limit.
//
// WLED API: GET http://<ip>/json → { state, info, effects, palettes };
//           POST http://<ip>/json/state with a partial state to change it.
// Docs: https://kno.wled.ge/interfaces/json-api/

const TIMEOUT_MS = 4000;
// Accept a bare IPv4 or a hostname (e.g. wled-xxxx.local). Guards against the
// `ip` query param being abused to point the daemon at arbitrary URLs.
const HOST_RE = /^[a-zA-Z0-9.\-]{1,253}$/;

async function wledFetch(ip, path, opts = {}) {
  if (!ip || !HOST_RE.test(ip)) throw new Error('invalid host');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`http://${ip}${path}`, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json().catch(() => ({}));
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timeout' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// Full snapshot (state + info) — used for the monitoring readout.
export const getState = (ip) => wledFetch(ip, '/json');

// Apply a partial state change (brightness, on/off, identify colour, …).
export const postState = (ip, body) => wledFetch(ip, '/json/state', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
});

// --- Network discovery -------------------------------------------------------
// Sweep every non-internal IPv4 /24 the daemon is on, probing /json/info in
// parallel. WLED answers with { ver, name, leds:{count}, mac, arch, … }; we keep
// only hosts that look like WLED. Dependency-free (no mDNS lib); the daemon runs
// on the LAN so it can reach devices the browser can't.
async function probeWled(ip, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://${ip}/json/info`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const info = await r.json();
    if (!info || (info.ver == null && info.leds == null && info.brand == null)) return null;  // not WLED
    return { ip, name: info.name || 'WLED', ver: info.ver || '', mac: info.mac || '',
      leds: info.leds?.count ?? null, arch: info.arch || '' };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// WLED colour-order codes (cfg.hw.led.ins[].order). From WLED const.h.
const COL_ORDER_CODE = { GRB: 0, RGB: 1, BRG: 2, RBG: 3, BGR: 4, GBR: 5 };

// Push per-OUTPUT LED config (length + colour order) to a controller, MERGING
// into its existing hw.led.ins so pins/other settings are preserved. `outs` is
// [{ len, order }] in output order. Re-packs contiguous `start` indices + total.
// Returns { applied, outputs, total }. Throws on a non-WLED / no-output device.
export async function pushConfig(ip, outs = []) {
  // Pause the DDP stream so WLED's HTTP server (starved while packets flood in)
  // can actually answer the cfg GET/POST. Wait long enough for the packet flood to
  // fully clear and the ESP's web server to catch up before the first request.
  // 12s is the SAFETY CAP (covers the GET+POST fetch timeouts); the `finally`
  // resumes output shortly after the push actually finishes, so a live-show config
  // push blacks the controller out only for as long as the write takes (+brief
  // settle), not a fixed 12s.
  suppressOutput(ip, 12000);
  await new Promise((r) => setTimeout(r, 700));
  try {
    const cfg = await wledFetch(ip, '/json/cfg');
    const ins = cfg?.hw?.led?.ins;
    if (!Array.isArray(ins) || !ins.length) throw new Error('device reports no LED outputs');
    let applied = 0, start = 0;
    for (let i = 0; i < ins.length; i++) {
      const o = outs[i];
      if (o) {
        if (Number.isFinite(o.len)) ins[i].len = Math.max(0, Math.round(o.len));
        if (o.order != null && COL_ORDER_CODE[o.order] != null) ins[i].order = COL_ORDER_CODE[o.order];
        applied++;
      }
      ins[i].start = start;
      start += ins[i].len || 0;
    }
    await wledFetch(ip, '/json/cfg', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hw: { led: { total: start, ins } } }),
    });
    return { applied, outputs: ins.length, total: start };
  } finally {
    suppressOutput(ip, 800);   // push done (ok or fail) → resume DDP after a short settle
  }
}

// Real LAN interfaces only: skip CGNAT/VPN (100.64.0.0/10, e.g. Tailscale) and
// link-local/APIPA (169.254.0.0/16). WLED never lives on those, and scanning a
// VPN's /24 just doubles the time and finds nothing (the "scan does nothing" trap).
function isLanAddress(addr) {
  const [a, b] = addr.split('.').map(Number);
  if (a === 169 && b === 254) return false;            // link-local / APIPA
  if (a === 100 && b >= 64 && b <= 127) return false;  // 100.64/10 CGNAT (Tailscale et al.)
  return true;
}

export async function scanSubnet({ timeoutMs = 1200, concurrency = 48 } = {}) {
  const bases = new Set();
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && isLanAddress(ni.address)) {
        const p = ni.address.split('.');
        if (p.length === 4) bases.add(`${p[0]}.${p[1]}.${p[2]}`);
      }
    }
  }
  const ips = [];
  for (const base of bases) for (let h = 1; h <= 254; h++) ips.push(`${base}.${h}`);
  const found = [];
  let i = 0;
  const worker = async () => { while (i < ips.length) { const r = await probeWled(ips[i++], timeoutMs); if (r) found.push(r); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, ips.length || 1) }, worker));
  found.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return { subnets: [...bases], scanned: ips.length, devices: found };
}
