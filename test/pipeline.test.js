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
    { id: 'a', start: 0, count: 2 },
    { id: 'b', start: 2, count: 2 },
  ]);
  // a: (1,0),(1,1) then b: (0,0),(0,1)
  assert.deepEqual(Array.from(sampleUVs), [1, 0, 1, 1, 0, 0, 0, 1]);
});

test('buildPipelineInputs builds one route entry per device with byte range', () => {
  const { route } = buildPipelineInputs(demo());
  assert.equal(route.length, 1);
  assert.deepEqual(route[0], {
    ip: '10.0.0.11', port: 4048, colorOrder: 'GRB', byteStart: 0, byteEnd: 4 * 3,
  });
});
