import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerMaskBits } from '../src/model/layers.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';
import { emptyShow, addDevice, addFixture } from '../src/model/show.js';

test('controllerMaskBits: include-list → bits by device order; null → -1 (all)', () => {
  const devices = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const UNROUTED = (1 << 31) | 0;   // bit 31 always set — unrouted fixtures are immune
  assert.equal(controllerMaskBits(devices, null), -1);
  assert.equal(controllerMaskBits(devices, undefined), -1);
  assert.equal(controllerMaskBits(devices, ['a']), (0b001 | UNROUTED) | 0);
  assert.equal(controllerMaskBits(devices, ['b', 'c']), (0b110 | UNROUTED) | 0);
  assert.equal(controllerMaskBits(devices, []), UNROUTED);       // explicit nothing (previews still show)
  assert.equal(controllerMaskBits(devices, ['nope']), UNROUTED); // unknown ids don't set bits
});

test('pipeline emits a controller index per LED (device order; unrouted = 31)', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'A', ip: '10.0.0.1', colorOrder: 'GRB' });
  s = addDevice(s, { id: 'c2', name: 'B', ip: '10.0.0.2', colorOrder: 'GRB' });
  const strip = (id, dev, n) => ({ id, name: id, pixelCount: n, colorOrder: 'GRB',
    output: dev ? { deviceId: dev, pixelOffset: 0, pixelCount: n } : undefined,
    input: { mode: 'polyline', points: [[0, 0], [1, 0]], samples: n } });
  s = addFixture(s, strip('f1', 'c1', 3));
  s = addFixture(s, strip('f2', 'c2', 2));
  s = addFixture(s, strip('f3', null, 2));   // unrouted → previews only
  const { sampleUVs, sampleControllers, spans } = buildPipelineInputs(s);
  assert.equal(sampleControllers.length, sampleUVs.length / 2, 'one index per LED');
  const spanOf = (id) => spans.find((x) => x.id === id);
  const idxAt = (span, k) => sampleControllers[span.start + k];
  for (let k = 0; k < 3; k++) assert.equal(idxAt(spanOf('f1'), k), 0, 'f1 on device 0');
  for (let k = 0; k < 2; k++) assert.equal(idxAt(spanOf('f2'), k), 1, 'f2 on device 1');
  for (let k = 0; k < 2; k++) assert.equal(idxAt(spanOf('f3'), k), 31, 'unrouted sentinel');
});
