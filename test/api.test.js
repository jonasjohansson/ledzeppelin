import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorized, problem, statusBody, devicesBody, parseManifest, clipsBody, controlsBody,
  triggerAddress, createApiHandler,
} from '../server/api.js';

// --- pure body-builders -------------------------------------------------------

test('authorized: open when no token configured, strict Bearer match otherwise', () => {
  assert.equal(authorized({ headers: {} }, ''), true);
  assert.equal(authorized({ headers: {} }, 'secret'), false);
  assert.equal(authorized({ headers: { authorization: 'Bearer secret' } }, 'secret'), true);
  assert.equal(authorized({ headers: { authorization: 'Bearer wrong' } }, 'secret'), false);
  assert.equal(authorized({ headers: { authorization: 'secret' } }, 'secret'), false);   // must be Bearer
});

test('problem: type + detail body', () => {
  assert.deepEqual(problem('no-editor', 'x'), { type: 'no-editor', detail: 'x' });
});

test('statusBody: derives lastFrameMsAgo, defaults devices to null', () => {
  const s = statusBody({
    version: '1.0.0', uptimeSec: 10, editorConnected: true, clients: 2,
    fpsOut: 42, fpsCap: 42, outputStale: false, blackout: false,
    lastFrameAt: 1000, osc: 9000,
  }, 1250);
  assert.equal(s.lastFrameMsAgo, 250);
  assert.equal(s.devices, null);
  assert.equal(s.editorConnected, true);
  // never sent a frame → null, not a huge number
  assert.equal(statusBody({ lastFrameAt: 0 }, 5000).lastFrameMsAgo, null);
});

test('devicesBody: pixels from byte span, defaults, override surfaced', () => {
  const route = [
    { ip: '10.0.0.21', byteStart: 0, byteEnd: 900, brightness: 0.8, gamma: 2.2 },
    { ip: '10.0.0.22', protocol: 'artnet', universe: 4, byteStart: 900, byteEnd: 1800, delayMs: 20 },
  ];
  const { devices } = devicesBody(route, { '10.0.0.21': 0.4 });
  assert.equal(devices.length, 2);
  assert.deepEqual(devices[0], {
    ip: '10.0.0.21', protocol: 'ddp', port: 4048, pixels: 300,
    brightness: 0.8, brightnessOverride: 0.4, gamma: 2.2, delayMs: 0,
  });
  assert.equal(devices[1].protocol, 'artnet');
  assert.equal(devices[1].port, 6454);
  assert.equal(devices[1].pixels, 300);
  assert.equal(devices[1].brightnessOverride, null);
  assert.equal(devices[1].delayMs, 20);
});

const manifestMsg = JSON.stringify({
  type: 'manifest',
  data: {
    layers: [{
      n: 1, name: 'Wash', opacity: 0.8, bypass: false,
      clips: [{ m: 1, name: 'Pulse', active: true, thumb: 'data:image/png;base64,xxx' }],
    }],
    controls: [{ address: '/layer/1/clip/1/speed', label: 'Pulse · Speed', kind: 'param', min: 0, max: 4, value: 1, def: 1 }],
    theme: { accent: '#fff' },
  },
});

test('parseManifest: pulls data out of the cached message; null on garbage/none', () => {
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest('not json'), null);
  assert.equal(parseManifest(manifestMsg).layers.length, 1);
});

test('clipsBody: layers + clips, thumbs stripped', () => {
  const b = clipsBody(parseManifest(manifestMsg));
  assert.deepEqual(b, {
    layers: [{
      n: 1, name: 'Wash', opacity: 0.8, bypass: false,
      clips: [{ m: 1, name: 'Pulse', active: true }],
    }],
  });
});

test('controlsBody: exposed params with range + value', () => {
  const b = controlsBody(parseManifest(manifestMsg));
  assert.deepEqual(b.controls, [
    { address: '/layer/1/clip/1/speed', label: 'Pulse · Speed', kind: 'param', min: 0, max: 4, value: 1, def: 1 },
  ]);
});

// --- request handler (fake req/res) -------------------------------------------

function fakeRes() {
  return {
    headers: {}, code: 200, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(c) { this.code = c; },
    end(s) { this.body = s || ''; this.ended = true; },
    json() { return this.body ? JSON.parse(this.body) : null; },
  };
}
const req = (method, path, headers = {}) => ({ method, headers, url: path });
const u = (path) => new URL(path, 'http://localhost');

const baseCtx = {
  token: '',
  status: () => ({ version: 'v', uptimeSec: 1, editorConnected: false, clients: 0, fpsOut: 0, fpsCap: 42, outputStale: false, blackout: false, lastFrameAt: 0, osc: 9000, devices: null }),
  route: () => null,
  manifest: () => null,
  overrides: () => ({}),
};

test('handler: CORS headers on every response + OPTIONS preflight is 204 and unauthenticated', async () => {
  const h = createApiHandler({ ...baseCtx, token: 'secret' });
  const res = fakeRes();
  await h(req('OPTIONS', '/api/v1/status'), res, u('/api/v1/status'));
  assert.equal(res.code, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.match(res.headers['access-control-allow-headers'], /authorization/);
});

test('handler: 401 problem-json without/with wrong token; 200 with the right one', async () => {
  const h = createApiHandler({ ...baseCtx, token: 'secret' });
  let res = fakeRes();
  await h(req('GET', '/api/v1/status'), res, u('/api/v1/status'));
  assert.equal(res.code, 401);
  assert.equal(res.json().type, 'unauthorized');
  res = fakeRes();
  await h(req('GET', '/api/v1/status', { authorization: 'Bearer secret' }), res, u('/api/v1/status'));
  assert.equal(res.code, 200);
  assert.equal(res.json().version, 'v');
});

test('handler: GET /status is 200 with the snapshot', async () => {
  const h = createApiHandler(baseCtx);
  const res = fakeRes();
  await h(req('GET', '/api/v1/status'), res, u('/api/v1/status'));
  assert.equal(res.code, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  const s = res.json();
  assert.equal(s.editorConnected, false);
  assert.equal(s.osc, 9000);
});

test('handler: /devices 503 no-route before any editor, 200 after', async () => {
  let res = fakeRes();
  await createApiHandler(baseCtx)(req('GET', '/api/v1/devices'), res, u('/api/v1/devices'));
  assert.equal(res.code, 503);
  assert.equal(res.json().type, 'no-route');
  res = fakeRes();
  const h = createApiHandler({ ...baseCtx, route: () => [{ ip: '1.2.3.4', byteStart: 0, byteEnd: 30 }] });
  await h(req('GET', '/api/v1/devices'), res, u('/api/v1/devices'));
  assert.equal(res.code, 200);
  assert.equal(res.json().devices[0].pixels, 10);
});

test('handler: /clips + /controls 503 no-manifest before any editor, 200 from cache', async () => {
  for (const path of ['/api/v1/clips', '/api/v1/controls']) {
    const res = fakeRes();
    await createApiHandler(baseCtx)(req('GET', path), res, u(path));
    assert.equal(res.code, 503);
    assert.equal(res.json().type, 'no-manifest');
  }
  const h = createApiHandler({ ...baseCtx, manifest: () => manifestMsg });
  let res = fakeRes();
  await h(req('GET', '/api/v1/clips'), res, u('/api/v1/clips'));
  assert.equal(res.json().layers[0].clips[0].name, 'Pulse');
  res = fakeRes();
  await h(req('GET', '/api/v1/controls'), res, u('/api/v1/controls'));
  assert.equal(res.json().controls[0].address, '/layer/1/clip/1/speed');
});

test('handler: unknown path → 404 problem-json', async () => {
  const res = fakeRes();
  await createApiHandler(baseCtx)(req('GET', '/api/v1/nope'), res, u('/api/v1/nope'));
  assert.equal(res.code, 404);
  assert.equal(res.json().type, 'not-found');
});

// --- actions -------------------------------------------------------------------

test('triggerAddress: canonical 1-based address; rejects 0/non-int', () => {
  assert.equal(triggerAddress(1, 2), '/layer/1/clip/2/trigger');
  assert.equal(triggerAddress(0, 1), null);
  assert.equal(triggerAddress(1, 0), null);
  assert.equal(triggerAddress(1.5, 1), null);
});

// A fake POST req whose body readJson can consume.
function postReq(path, body, headers = {}) {
  return {
    method: 'POST', headers, url: path,
    on(ev, fn) {
      if (ev === 'data' && body !== undefined) fn(JSON.stringify(body));
      if (ev === 'end') fn();
    },
  };
}
const post = async (ctx, path, body, headers) => {
  const res = fakeRes();
  await createApiHandler(ctx)(postReq(path, body, headers), res, u(path));
  return res;
};

test('POST /blackout: {on:bool} required; toggles via ctx', async () => {
  const calls = [];
  const ctx = { ...baseCtx, setBlackout: (on) => { calls.push(on); return on; } };
  let res = await post(ctx, '/api/v1/blackout', { on: 'yes' });
  assert.equal(res.code, 400);
  assert.equal(res.json().type, 'bad-request');
  res = await post(ctx, '/api/v1/blackout', { on: true });
  assert.equal(res.code, 200);
  assert.deepEqual(res.json(), { blackout: true });
  assert.deepEqual(calls, [true]);
});

test('POST /devices/:ip/brightness: 0..1 or null, override echoed back', async () => {
  const calls = [];
  const ctx = { ...baseCtx, setBrightness: (ip, v) => { calls.push([ip, v]); return v; } };
  let res = await post(ctx, '/api/v1/devices/10.0.0.21/brightness', { value: 1.5 });
  assert.equal(res.code, 400);
  res = await post(ctx, '/api/v1/devices/10.0.0.21/brightness', { value: 0.4 });
  assert.equal(res.code, 200);
  assert.deepEqual(res.json(), { ip: '10.0.0.21', brightnessOverride: 0.4 });
  res = await post(ctx, '/api/v1/devices/10.0.0.21/brightness', { value: null });
  assert.equal(res.code, 200);
  assert.equal(res.json().brightnessOverride, null);
  assert.deepEqual(calls, [['10.0.0.21', 0.4], ['10.0.0.21', null]]);
});

test('POST trigger: 503 no-editor without an editor, 202 + canonical relay with one', async () => {
  let res = await post({ ...baseCtx, editorConnected: () => false }, '/api/v1/clips/1/2/trigger');
  assert.equal(res.code, 503);
  assert.equal(res.json().type, 'no-editor');
  const relayed = [];
  const ctx = { ...baseCtx, editorConnected: () => true, relay: (a, v) => relayed.push([a, v]) };
  res = await post(ctx, '/api/v1/clips/1/2/trigger');
  assert.equal(res.code, 202);
  assert.deepEqual(res.json(), { relayed: true, address: '/layer/1/clip/2/trigger' });
  assert.deepEqual(relayed, [['/layer/1/clip/2/trigger', 1]]);
  // 0 is not a valid 1-based index
  res = await post(ctx, '/api/v1/clips/0/2/trigger');
  assert.equal(res.code, 400);
});

test('POST /params: validates address + value, relays as-is (non-canonical falls through editor-side)', async () => {
  const relayed = [];
  const ctx = { ...baseCtx, editorConnected: () => true, relay: (a, v) => relayed.push([a, v]) };
  let res = await post(ctx, '/api/v1/params', { address: 'layer/1/opacity', value: 0.5 });
  assert.equal(res.code, 400);
  assert.equal(res.json().type, 'bad-address');
  res = await post(ctx, '/api/v1/params', { address: '/layer/1/opacity', value: 'high' });
  assert.equal(res.code, 400);
  assert.equal(res.json().type, 'bad-request');
  res = await post(ctx, '/api/v1/params', { address: '/layer/1/opacity', value: 0.5 });
  assert.equal(res.code, 202);
  assert.deepEqual(relayed, [['/layer/1/opacity', 0.5]]);
  res = await post({ ...baseCtx, editorConnected: () => false }, '/api/v1/params', { address: '/layer/1/opacity', value: 0.5 });
  assert.equal(res.code, 503);
  assert.equal(res.json().type, 'no-editor');
});
