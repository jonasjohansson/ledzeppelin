// Browser-side WLED control, via the daemon's proxy (src ../server/wled.js) so
// there's no CORS problem talking to controllers. Every call resolves to
// { ok, data } | { ok:false, error } and NEVER throws — a controller being
// offline must not break the UI.

async function call(ip, opts) {
  if (!ip) return { ok: false, error: 'no ip' };
  try {
    const r = await fetch(`/api/wled/state?ip=${encodeURIComponent(ip)}`, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) return { ok: false, error: data.error || `HTTP ${r.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };   // daemon down / network error
  }
}

// Full snapshot (state + info) for the monitoring readout.
export const getDeviceState = (ip) => call(ip);

// Apply a partial WLED state (brightness, on/off, identify colour, …).
export const setDeviceState = (ip, state) => call(ip, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state),
});

// Flash the whole strip a solid colour to locate which physical controller this
// is. NOTE: while live DDP output is streaming, WLED is in realtime mode and
// ignores this — identify is for setup/when output is paused.
export const identify = (ip, col = [255, 0, 0]) =>
  setDeviceState(ip, { on: true, bri: 200, seg: [{ fx: 0, col: [col] }] });

// Push per-output LED config (length + colour order) to a controller's WLED
// config. `outs` = [{ len, order }] in output order. { ok, data:{applied,outputs,total} } | { ok:false, error }.
export async function pushDeviceConfig(ip, outs) {
  if (!ip) return { ok: false, error: 'no ip' };
  try {
    const r = await fetch(`/api/wled/config?ip=${encodeURIComponent(ip)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outs }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) return { ok: false, error: data.error || `HTTP ${r.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Scan the local network (via the daemon) for WLED controllers. Resolves to
// { ok, data:{ subnets, scanned, devices:[{ip,name,leds,mac,…}] } } | { ok:false, error }.
export async function scanDevices() {
  try {
    const r = await fetch('/api/wled/scan');
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) return { ok: false, error: data.error || `HTTP ${r.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };   // daemon down
  }
}
