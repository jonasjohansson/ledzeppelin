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
    ip: '10.0.0.11', port: 4048, colorOrder: 'GRB', byteStart: 0, byteEnd: 4 * 3,
    segments: [
      { start: 0, count: 2, colorOrder: 'GRB' },
      { start: 2, count: 2, colorOrder: 'GRB' },
    ],
    gamma: 1, brightness: 1,
  });
});

test('single device still yields byteStart 0', () => {
  const { route } = buildPipelineInputs(demo());
  assert.equal(route[0].byteStart, 0);
});

test('a fixture colorOrder overrides the device default in its segment', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  s = addFixture(s, { id: 'a', name: 'a', pixelCount: 2, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 2 }, input: { points: [[0, 0], [0, 1]], samples: 2 } });
  s = addFixture(s, { id: 'b', name: 'b', pixelCount: 2, colorOrder: 'RGB',   // different chip on same controller
    output: { deviceId: 'c1', pixelOffset: 2, pixelCount: 2 }, input: { points: [[1, 0], [1, 1]], samples: 2 } });
  const { route } = buildPipelineInputs(s);
  assert.deepEqual(route[0].segments, [
    { start: 0, count: 2, colorOrder: 'GRB' },
    { start: 2, count: 2, colorOrder: 'RGB' },
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
    ip: '10.0.0.1', port: 4048, colorOrder: 'GRB', byteStart: 0, byteEnd: 200 * 3,
    segments: [
      { start: 0, count: 100, colorOrder: 'GRB' },
      { start: 100, count: 100, colorOrder: 'GRB' },
    ],
    gamma: 1, brightness: 1,
  });
  // devB: global base 200 (NOT device-local 0), 90 pixels
  assert.deepEqual(route[1], {
    ip: '10.0.0.2', port: 4048, colorOrder: 'RGB', byteStart: 200 * 3, byteEnd: 290 * 3,
    segments: [
      { start: 0, count: 50, colorOrder: 'RGB' },
      { start: 50, count: 40, colorOrder: 'RGB' },
    ],
    gamma: 1, brightness: 1,
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
