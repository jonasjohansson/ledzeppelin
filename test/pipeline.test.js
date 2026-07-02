import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture } from '../src/model/show.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';

function demo() {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  // Added out of pixelOffset order on purpose to verify sorting.
  s = addFixture(s, { id: 'b', name: 'b', pixelCount: 2, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 2, pixelCount: 2 },
    input: { points: [[0, 0], [0, 1]], samples: 2 } });
  s = addFixture(s, { id: 'a', name: 'a', pixelCount: 2, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 2 },
    input: { points: [[1, 0], [1, 1]], samples: 2 } });
  return s;
}

test('buildPipelineInputs orders fixtures by pixelOffset and flattens UVs', () => {
  const { sampleUVs, spans, fixtureOrder } = buildPipelineInputs(demo());
  // 'a' (offset 0) comes before 'b' (offset 2).
  assert.deepEqual(fixtureOrder.map((f) => f.id), ['a', 'b']);
  assert.deepEqual(spans, [
    { id: 'a', start: 0, count: 2, hidden: false },
    { id: 'b', start: 2, count: 2, hidden: false },
  ]);
  // a: (1,0),(1,1) then b: (0,0),(0,1)
  assert.deepEqual(Array.from(sampleUVs), [1, 0, 1, 1, 0, 0, 0, 1]);
});

test('buildPipelineInputs builds one route entry per device with byte range', () => {
  const { route } = buildPipelineInputs(demo());
  assert.equal(route.length, 1);
  assert.deepEqual(route[0], {
    ip: '10.0.0.11', port: 4048, protocol: 'ddp', universe: 0, artnetSync: false, colorOrder: 'GRB', byteStart: 0, byteEnd: 4 * 3,
    segments: [
      { start: 0, count: 2, colorOrder: 'GRB' },
      { start: 2, count: 2, colorOrder: 'GRB' },
    ],
    gamma: 1, brightness: 1, delayMs: 0,
  });
});

test('single device still yields byteStart 0', () => {
  const { route } = buildPipelineInputs(demo());
  assert.equal(route[0].byteStart, 0);
});

test('the device colorOrder is authoritative for every segment on it', () => {
  // Colour order is a CONTROLLER setting, so the device's order wins even when a
  // fixture carries its own (cached from its type) — see pipeline.js.
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  s = addFixture(s, { id: 'a', name: 'a', pixelCount: 2, colorOrder: 'RGB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 2 }, input: { points: [[0, 0], [0, 1]], samples: 2 } });
  s = addFixture(s, { id: 'b', name: 'b', pixelCount: 2, colorOrder: 'BGR',
    output: { deviceId: 'c1', pixelOffset: 2, pixelCount: 2 }, input: { points: [[1, 0], [1, 1]], samples: 2 } });
  const { route } = buildPipelineInputs(s);
  assert.deepEqual(route[0].segments, [
    { start: 0, count: 2, colorOrder: 'GRB' },
    { start: 2, count: 2, colorOrder: 'GRB' },
  ]);
});

test('hidden fixtures are flagged in spans (zeroed downstream, not skipped)', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  s = addFixture(s, { id: 'a', name: 'a', pixelCount: 2, colorOrder: 'GRB', hidden: true,
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 2 }, input: { points: [[0, 0], [0, 1]], samples: 2 } });
  s = addFixture(s, { id: 'b', name: 'b', pixelCount: 2, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 2, pixelCount: 2 }, input: { points: [[1, 0], [1, 1]], samples: 2 } });
  const { spans } = buildPipelineInputs(s);
  assert.equal(spans.find((sp) => sp.id === 'a').hidden, true);
  assert.equal(spans.find((sp) => sp.id === 'b').hidden, false);
  assert.equal(spans.find((sp) => sp.id === 'b').start, 2);   // 'a' still occupies its indices
});

// Two devices, each using DEVICE-LOCAL pixel offsets that reset to 0. The flat
// buffer must give each device a GLOBAL base independent of the local offset.
function multiDemo() {
  let s = addDevice(emptyShow(), { id: 'A', name: 'devA', ip: '10.0.0.1', colorOrder: 'GRB' });
  s = addDevice(s, { id: 'B', name: 'devB', ip: '10.0.0.2', colorOrder: 'RGB' });
  // devA: fixture a0 (0..99, 100px), a1 (100..199, 100px)
  s = addFixture(s, { id: 'a1', name: 'a1', pixelCount: 100, colorOrder: 'GRB',
    output: { deviceId: 'A', pixelOffset: 100, pixelCount: 100 },
    input: { points: [[0, 0], [1, 1]], samples: 100 } });
  s = addFixture(s, { id: 'a0', name: 'a0', pixelCount: 100, colorOrder: 'GRB',
    output: { deviceId: 'A', pixelOffset: 0, pixelCount: 100 },
    input: { points: [[0, 0], [1, 0]], samples: 100 } });
  // devB: fixture b0 (0..49, 50px), b1 (50..89, 40px) — DEVICE-LOCAL offsets reset to 0
  s = addFixture(s, { id: 'b1', name: 'b1', pixelCount: 40, colorOrder: 'RGB',
    output: { deviceId: 'B', pixelOffset: 50, pixelCount: 40 },
    input: { points: [[0, 0], [0, 1]], samples: 40 } });
  s = addFixture(s, { id: 'b0', name: 'b0', pixelCount: 50, colorOrder: 'RGB',
    output: { deviceId: 'B', pixelOffset: 0, pixelCount: 50 },
    input: { points: [[1, 0], [1, 1]], samples: 50 } });
  return s;
}

test('buildPipelineInputs assigns global buffer bases across devices', () => {
  const { route, sampleUVs, spans, fixtureOrder } = buildPipelineInputs(multiDemo());
  assert.equal(route.length, 2);
  // devA: global base 0, 200 pixels
  assert.deepEqual(route[0], {
    ip: '10.0.0.1', port: 4048, protocol: 'ddp', universe: 0, artnetSync: false, colorOrder: 'GRB', byteStart: 0, byteEnd: 200 * 3,
    segments: [
      { start: 0, count: 100, colorOrder: 'GRB' },
      { start: 100, count: 100, colorOrder: 'GRB' },
    ],
    gamma: 1, brightness: 1, delayMs: 0,
  });
  // devB: global base 200 (NOT device-local 0), 90 pixels
  assert.deepEqual(route[1], {
    ip: '10.0.0.2', port: 4048, protocol: 'ddp', universe: 0, artnetSync: false, colorOrder: 'RGB', byteStart: 200 * 3, byteEnd: 290 * 3,
    segments: [
      { start: 0, count: 50, colorOrder: 'RGB' },
      { start: 50, count: 40, colorOrder: 'RGB' },
    ],
    gamma: 1, brightness: 1, delayMs: 0,
  });
  // 2 floats per pixel, (200 + 90) pixels
  assert.equal(sampleUVs.length, (200 + 90) * 2);
  // concatenation order: device order, then pixelOffset order
  assert.deepEqual(fixtureOrder.map((f) => f.id), ['a0', 'a1', 'b0', 'b1']);
  // devB's first fixture (b0) starts at global pixel index 200
  const b0 = spans.find((sp) => sp.id === 'b0');
  assert.equal(b0.start, 200);
  assert.equal(b0.count, 50);
});

test('a grid fixture samples cols*rows pixels in wiring order', () => {
  // A 2×2 matrix, unrouted, centred on a 1280×720 canvas, distribution 1
  // (TL row-major LINE) → order [0,0],[1,0],[0,1],[1,1] = quadrant centres.
  let s = emptyShow();
  s = addFixture(s, {
    id: 'm', name: 'matrix', cols: 2, rows: 2, distribution: 1, pixelCount: 4, colorOrder: 'RGB',
    output: {}, input: { mode: 'grid', transform: { x: 640, y: 360, w: 1280, h: 720, rotation: 0 }, samples: 4, points: [[0, 0], [1, 1]] },
  });
  const { sampleUVs, spans } = buildPipelineInputs(s);
  assert.equal(sampleUVs.length, 4 * 2);
  assert.equal(spans.find((sp) => sp.id === 'm').count, 4);
  const got = Array.from(sampleUVs);
  const expect = [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75];
  expect.forEach((v, i) => assert.ok(Math.abs(got[i] - v) < 1e-9, `uv[${i}] ${got[i]} ≈ ${v}`));
});

// Offsets are OUTPUT-LOCAL (each port's chain addresses from 0); the wire layout
// concatenates ports in ascending order, identical bytes to the old stacking.
test('per-output offsets: ports concatenate in order, each port from 0', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  s = addFixture(s, { id: 'p2', name: 'p2', pixelCount: 2, colorOrder: 'GRB',
    output: { deviceId: 'c1', port: 2, pixelOffset: 0, pixelCount: 2 },
    input: { points: [[0, 0], [0, 1]], samples: 2 } });
  s = addFixture(s, { id: 'p1', name: 'p1', pixelCount: 2, colorOrder: 'GRB',
    output: { deviceId: 'c1', port: 1, pixelOffset: 0, pixelCount: 2 },
    input: { points: [[1, 0], [1, 1]], samples: 2 } });
  const { spans, fixtureOrder, route } = buildPipelineInputs(s);
  // Port 1 first on the wire even though both offsets are 0.
  assert.deepEqual(fixtureOrder.map((f) => f.id), ['p1', 'p2']);
  assert.deepEqual(spans, [
    { id: 'p1', start: 0, count: 2, hidden: false },
    { id: 'p2', start: 2, count: 2, hidden: false },
  ]);
  assert.equal(route[0].byteEnd, 4 * 3);   // one dense device slice: 4 px
});
