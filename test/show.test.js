import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture, validate, syncDeviceTypes } from '../src/model/show.js';

test('valid minimal show passes validation', () => {
  let s = emptyShow();
  s = addDevice(s, { id: 'c1', name: 'DQ1', ip: '10.0.0.11' });
  s = addFixture(s, { id: 't1', name: 'T1', pixelCount: 300, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 300 },
    input: { points: [[0.1,0.2],[0.1,0.8]], samples: 300 } });
  assert.equal(validate(s).ok, true);
});

test('fixture referencing unknown device fails', () => {
  let s = addFixture(emptyShow(), { id: 't1', name: 'T1', pixelCount: 10, colorOrder: 'GRB',
    output: { deviceId: 'nope', pixelOffset: 0, pixelCount: 10 }, input: { points: [[0,0],[1,1]], samples: 10 } });
  const r = validate(s);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /unknown device/);
});

test('non-zero starting pixel offset fails contiguity validation', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: 'x' });
  s = addFixture(s, { id: 't1', name: 'T1', pixelCount: 150, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 150, pixelCount: 150 },
    input: { points: [[0,0],[1,1]], samples: 150 } });
  const r = validate(s);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /must start at 0 and be contiguous/);
});

// --- Output protocol (DDP default | Art-Net + base universe) -------------------
test('syncDeviceTypes defaults protocol to ddp / universe 0 for legacy devices', () => {
  const s = syncDeviceTypes(addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: 'x' }));
  assert.equal(s.devices[0].protocol, 'ddp');
  assert.equal(s.devices[0].universe, 0);
});

test('syncDeviceTypes preserves artnet protocol + universe and sanitises bad values', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'A', ip: 'x', protocol: 'artnet', universe: 4 });
  s = addDevice(s, { id: 'c2', name: 'B', ip: 'y', protocol: 'bogus', universe: -3.7 });
  s = syncDeviceTypes(s);
  assert.equal(s.devices[0].protocol, 'artnet');
  assert.equal(s.devices[0].universe, 4);
  assert.equal(s.devices[1].protocol, 'ddp');     // unknown protocol collapses to ddp
  assert.equal(s.devices[1].universe, 0);         // universe clamped to int ≥ 0
});

test('fixture types carry normalised Parameters (extra DMX channels)', async () => {
  const { syncFixtureTypes } = await import('../src/model/show.js');
  const s = syncFixtureTypes({
    ...emptyShow(),
    fixtureTypes: [{ id: 'par', name: 'Par', cols: 1, rows: 1, colorFormat: 'RGB',
      params: [{ name: 'Dimmer', kind: 'dimmer' }, { name: 'Strobe', kind: 'bogus', value: 300 }, {}] }],
  });
  const t = s.fixtureTypes.find((x) => x.id === 'par');
  assert.equal(t.params.length, 3);
  assert.deepEqual(t.params[0], { name: 'Dimmer', kind: 'dimmer', value: 0, before: false });
  assert.deepEqual(t.params[1], { name: 'Strobe', kind: 'fixed', value: 255, before: false });   // bad kind→fixed, value clamped
  assert.equal(t.params[2].name, 'Param 3');                                       // defaulted name
  // A type declared without params normalises to an empty array.
  const noP = syncFixtureTypes({ ...emptyShow(), fixtureTypes: [{ id: 'x', name: 'X', cols: 1, rows: 1 }] });
  assert.deepEqual(noP.fixtureTypes.find((x) => x.id === 'x').params, []);
});
