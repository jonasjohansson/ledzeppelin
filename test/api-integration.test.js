// End-to-end test of the /api/v1 control API against a REAL daemon booted in a
// child process (unique ports — nothing here touches the default 7070/9000).
// A fake editor connects over /frames exactly like src/bridge.js does (route +
// manifest messages) and we assert the API sees it, and that relayed writes
// arrive back on the editor socket as { type:'ext' } messages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = 7191;            // open daemon
const B = 7192;            // token-gated daemon
const TOKEN = 'test-token';
const procs = [];

function boot(port, extraEnv = {}) {
  const p = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), OSC_PORT: String(port + 10000), OPEN: '', ...extraEnv },
    stdio: 'ignore',
  });
  procs.push(p);
}
async function waitHealthy(port, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`daemon on :${port} not healthy in ${ms}ms`);
}
// Poll until `fn` returns truthy (route/manifest ingestion is async).
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
}
const api = async (port, path, opts = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, opts);
  let body = null;
  try { body = await r.json(); } catch { /* no body (e.g. 204) */ }
  return { code: r.status, headers: r.headers, body };
};
const post = (port, path, body, headers = {}) => api(port, path, {
  method: 'POST', body: body === undefined ? undefined : JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...headers },
});

before(async () => {
  boot(A);
  boot(B, { LZ_API_TOKEN: TOKEN });
  await Promise.all([waitHealthy(A), waitHealthy(B)]);
});
after(() => { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } });

// --- before any editor connects ------------------------------------------------

test('GET /status: 200 with daemon state, no editor yet', async () => {
  const { code, body } = await api(A, '/api/v1/status');
  assert.equal(code, 200);
  assert.equal(typeof body.version, 'string');
  assert.equal(typeof body.uptimeSec, 'number');
  assert.equal(body.editorConnected, false);
  assert.equal(body.blackout, false);
  assert.equal(body.devices, null);
  assert.equal(body.osc, A + 10000);
});

test('reads 503 honestly before an editor exists: no-route / no-manifest', async () => {
  const d = await api(A, '/api/v1/devices');
  assert.equal(d.code, 503);
  assert.equal(d.body.type, 'no-route');
  for (const p of ['/api/v1/clips', '/api/v1/controls']) {
    const r = await api(A, p);
    assert.equal(r.code, 503);
    assert.equal(r.body.type, 'no-manifest');
  }
});

test('relays 503 no-editor before an editor exists', async () => {
  const t = await post(A, '/api/v1/clips/1/1/trigger');
  assert.equal(t.code, 503);
  assert.equal(t.body.type, 'no-editor');
  const q = await post(A, '/api/v1/params', { address: '/layer/1/opacity', value: 0.5 });
  assert.equal(q.code, 503);
  assert.equal(q.body.type, 'no-editor');
});

test('CORS: preflight 204 + allow-origin * on responses; unknown path 404 problem-json', async () => {
  const pre = await api(A, '/api/v1/status', { method: 'OPTIONS' });
  assert.equal(pre.code, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  const nf = await api(A, '/api/v1/nope');
  assert.equal(nf.code, 404);
  assert.equal(nf.body.type, 'not-found');
  assert.equal(nf.headers.get('access-control-allow-origin'), '*');
});

test('daemon-native actions work with no editor: blackout + brightness override', async () => {
  const on = await post(A, '/api/v1/blackout', { on: true });
  assert.equal(on.code, 200);
  assert.deepEqual(on.body, { blackout: true });
  assert.equal((await api(A, '/api/v1/status')).body.blackout, true);
  const off = await post(A, '/api/v1/blackout', { on: false });
  assert.deepEqual(off.body, { blackout: false });
  const bri = await post(A, '/api/v1/devices/10.0.0.9/brightness', { value: 0.4 });
  assert.equal(bri.code, 200);
  assert.deepEqual(bri.body, { ip: '10.0.0.9', brightnessOverride: 0.4 });
  await post(A, '/api/v1/devices/10.0.0.9/brightness', { value: null });   // clear
  const bad = await post(A, '/api/v1/blackout', { on: 'yes' });
  assert.equal(bad.code, 400);
  assert.equal(bad.body.type, 'bad-request');
});

// --- with a fake editor (mirrors src/bridge.js message formats) -----------------

test('fake editor populates /devices + /clips + /controls; relays 202 and arrive as ext', async () => {
  const ed = new WebSocket(`ws://127.0.0.1:${A}/frames`);
  const ext = [];
  ed.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.type === 'ext') ext.push(m); } catch { /* binary */ } });
  await new Promise((res, rej) => { ed.on('open', res); ed.on('error', rej); });
  // exactly what bridge.js sends on connect:
  ed.send(JSON.stringify({ type: 'route', route: [{ ip: '127.0.0.1', port: 14048, byteStart: 0, byteEnd: 90, brightness: 0.8, gamma: 2.2 }], fps: 30 }));
  ed.send(JSON.stringify({
    type: 'manifest',
    data: {
      layers: [{ n: 1, name: 'Wash', opacity: 0.8, bypass: false, clips: [{ m: 1, name: 'Pulse', active: true, thumb: null }] }],
      controls: [{ address: '/layer/1/clip/1/speed', label: 'Pulse · Speed', kind: 'param', min: 0, max: 4, value: 1, def: 1 }],
    },
  }));

  const dev = await until(async () => { const r = await api(A, '/api/v1/devices'); return r.code === 200 ? r.body : null; });
  assert.deepEqual(dev.devices, [{
    ip: '127.0.0.1', protocol: 'ddp', port: 14048, pixels: 30,
    brightness: 0.8, brightnessOverride: null, gamma: 2.2, delayMs: 0,
  }]);
  const clips = await until(async () => { const r = await api(A, '/api/v1/clips'); return r.code === 200 ? r.body : null; });
  assert.deepEqual(clips.layers, [{ n: 1, name: 'Wash', opacity: 0.8, bypass: false, clips: [{ m: 1, name: 'Pulse', active: true }] }]);
  const controls = (await api(A, '/api/v1/controls')).body;
  assert.equal(controls.controls[0].address, '/layer/1/clip/1/speed');

  const status = (await api(A, '/api/v1/status')).body;
  assert.equal(status.editorConnected, true);
  assert.equal(status.devices, 1);
  assert.equal(status.fpsCap, 30);

  // relayed writes → 202 and the editor receives the canonical ext messages
  const trig = await post(A, '/api/v1/clips/1/1/trigger');
  assert.equal(trig.code, 202);
  assert.deepEqual(trig.body, { relayed: true, address: '/layer/1/clip/1/trigger' });
  const par = await post(A, '/api/v1/params', { address: '/layer/1/clip/1/speed', value: 0.7 });
  assert.equal(par.code, 202);
  await until(() => ext.length >= 2);
  assert.deepEqual(ext, [
    { type: 'ext', channel: '/layer/1/clip/1/trigger', value: 1 },
    { type: 'ext', channel: '/layer/1/clip/1/speed', value: 0.7 },
  ]);

  // events WS: status on connect, manifest event on republish
  const ev = new WebSocket(`ws://127.0.0.1:${A}/api/v1/events`);
  const events = [];
  ev.on('message', (d) => events.push(JSON.parse(d.toString())));
  await new Promise((res, rej) => { ev.on('open', res); ev.on('error', rej); });
  await until(() => events.length >= 1);
  assert.equal(events[0].type, 'status');
  assert.equal(events[0].editorConnected, true);
  ed.send(JSON.stringify({ type: 'manifest', data: { layers: [], controls: [] } }));
  await until(() => events.some((e) => e.type === 'manifest'));
  ev.close();

  // editor gone → relays 503 again (a status event also fires; covered above)
  ed.close();
  await until(async () => (await api(A, '/api/v1/status')).body.editorConnected === false);
  const gone = await post(A, '/api/v1/clips/1/1/trigger');
  assert.equal(gone.code, 503);
  assert.equal(gone.body.type, 'no-editor');
});

// --- token-gated daemon ---------------------------------------------------------

test('LZ_API_TOKEN: 401 without/with wrong Bearer, 200 with it; /health stays open', async () => {
  const no = await api(B, '/api/v1/status');
  assert.equal(no.code, 401);
  assert.equal(no.body.type, 'unauthorized');
  const wrong = await api(B, '/api/v1/status', { headers: { authorization: 'Bearer nope' } });
  assert.equal(wrong.code, 401);
  const ok = await api(B, '/api/v1/status', { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(ok.code, 200);
  // preflight must not require auth (browsers can't attach headers to it)
  assert.equal((await api(B, '/api/v1/status', { method: 'OPTIONS' })).code, 204);
  // existing surface stays open — editor/phone must work with zero config
  assert.equal((await api(B, '/health')).code, 200);
});

test('LZ_API_TOKEN gates the events WS upgrade too', async () => {
  await new Promise((resolve, reject) => {
    const bad = new WebSocket(`ws://127.0.0.1:${B}/api/v1/events`);
    bad.on('open', () => reject(new Error('events WS opened without token')));
    bad.on('error', (e) => { assert.match(e.message, /401/); resolve(); });
  });
  const ok = new WebSocket(`ws://127.0.0.1:${B}/api/v1/events`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const first = await new Promise((res, rej) => { ok.on('message', (d) => res(JSON.parse(d.toString()))); ok.on('error', rej); });
  assert.equal(first.type, 'status');
  ok.close();
});
