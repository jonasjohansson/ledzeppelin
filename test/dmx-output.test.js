import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipelineInputs } from '../src/model/pipeline.js';
import { dmxProfile } from '../src/model/dmx.js';
import { packDmxUniverses } from '../server/dmx-pack.js';

const showWithDmx = () => ({
  composition: { canvas: { w: 100, h: 100 } },
  devices: [{ id: 'a1', ip: '2.0.0.1', protocol: 'artnet', universe: 0 }],
  fixtures: [{
    id: 'f1', output: { deviceId: 'a1' },
    input: { transform: { x: 50, y: 50 }, points: [[0.5, 0.5]], dmx: { profileId: 'rgb', universe: 2, address: 5 } },
  }],
});

test('pipeline: a DMX fixture adds one sample UV + a dmx route entry', () => {
  const { route, sampleUVs } = buildPipelineInputs(showWithDmx());
  assert.deepEqual([...sampleUVs], [0.5, 0.5]);            // sampled at the fixture centre
  assert.equal(route.length, 1);
  assert.equal(route[0].byteEnd, 0);                       // no pixel strip on this device
  assert.equal(route[0].dmx.length, 1);
  const dmx = route[0].dmx[0];
  assert.equal(dmx.colourIndex, 0);
  assert.equal(dmx.universe, 2);
  assert.equal(dmx.address, 5);
  assert.equal(dmx.channels.length, 3);                   // RGB par
});

test('daemon: pack writes resolved channels at address-1 in the right universe', () => {
  const dmx = [{ colourIndex: 0, universe: 2, address: 5, channels: dmxProfile('rgb').channels, fixed: {} }];
  const rgb = new Uint8Array([100, 50, 0]);               // the fixture's sampled colour at index 0
  const u = packDmxUniverses(rgb, dmx);
  const buf = u.get(2);
  assert.equal(buf.length, 512);
  assert.deepEqual([buf[4], buf[5], buf[6]], [100, 50, 0]);  // address 5 → offset 4
  assert.equal(buf[0], 0);                                   // untouched channels stay 0
});
