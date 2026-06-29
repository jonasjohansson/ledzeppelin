import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture, validate, syncDeviceTypes, syncFixtureTypes } from '../src/model/show.js';

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

test('editing a device type does NOT change an existing device (standalone)', () => {
  const show = {
    deviceTypes: [{ id: 'dt1', name: 'Quad', outputs: 4, maxPerOutput: 830 }],
    devices: [{ id: 'c1', name: 'C1', typeId: 'dt1', outputs: 4, maxPerOutput: 830, protocol: 'ddp' }],
    fixtures: [],
  };
  show.deviceTypes[0].outputs = 8;          // edit the MODEL
  const out = syncDeviceTypes(show);
  assert.equal(out.devices[0].outputs, 4);  // instance keeps its own
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

test('output kind is an instance property: the type does NOT change it', () => {
  // An instance carrying its own DMX config keeps it, even though its type is a pixel strip.
  const s = syncFixtureTypes({
    ...emptyShow(),
    devices: [{ id: 'd1', protocol: 'artnet', universe: 0 }],
    fixtureTypes: [{ id: 'strip', name: 'Strip', cols: 60, rows: 1 }],
    fixtures: [{ id: 'f1', typeId: 'strip', input: { mode: 'dmx', dmx: { channels: [{ kind: 'red' }], universe: 0, address: 1, fixed: {} } }, output: { deviceId: 'd1' } }],
  });
  const f1 = s.fixtures.find((x) => x.id === 'f1');
  assert.equal(!!f1.input.dmx, true);    // instance owns its DMX config → preserved
  assert.equal(f1.input.mode, 'dmx');

  // A plain (pixel) instance stays a pixel fixture even though its type is a DMX profile.
  const s2 = syncFixtureTypes({
    ...emptyShow(),
    devices: [{ id: 'd1', protocol: 'artnet', universe: 0 }],
    fixtureTypes: [{ id: 'par', name: 'Par', cols: 1, rows: 1, params: [{ name: 'RGB', count: 3 }] }],
    fixtures: [{ id: 'f2', typeId: 'par', input: { mode: 'bar' }, output: { deviceId: 'd1' } }],
  });
  const f2 = s2.fixtures.find((x) => x.id === 'f2');
  assert.equal(f2.input.mode, 'bar');
  assert.equal(!!f2.input.dmx, false);
});

test('editing a type does NOT change an existing instance (standalone)', () => {
  const show = {
    fixtureTypes: [{ id: 't1', name: 'Strip', ledsPerMeter: 60, meters: 1, pixelCount: 60, colorOrder: 'GRB', cols: 60, rows: 1, distribution: 0 }],
    fixtures: [{ id: 'f1', typeId: 't1', pixelCount: 60, cols: 60, rows: 1, ledsPerMeter: 60, meters: 1, colorOrder: 'GRB', colorFormat: '', output: { deviceId: '', pixelCount: 60 }, input: { points: [[0,0],[1,0]], samples: 60 } }],
    devices: [],
  };
  show.fixtureTypes[0].pixelCount = 144; show.fixtureTypes[0].cols = 144; show.fixtureTypes[0].ledsPerMeter = 144;
  const out = syncFixtureTypes(show);
  assert.equal(out.fixtures[0].pixelCount, 60);
  assert.equal(out.fixtures[0].output.pixelCount, 60);
});

test('editing a matrix type does NOT change an existing grid instance (owns its grid)', () => {
  const show = {
    fixtureTypes: [{ id: 'm1', name: 'Matrix', cols: 8, rows: 4, distribution: 1 }],
    fixtures: [{ id: 'g1', typeId: 'm1', cols: 8, rows: 4, distribution: 1, pixelCount: 32, colorOrder: 'GRB',
      output: { deviceId: '', pixelCount: 32 }, input: { points: [[0,0],[1,0]], samples: 32 } }],
    devices: [],
  };
  // Edit the type into a bigger, differently-wired matrix.
  show.fixtureTypes[0].cols = 16; show.fixtureTypes[0].rows = 8; show.fixtureTypes[0].distribution = 2;
  const g = syncFixtureTypes(show).fixtures[0];
  assert.equal(g.cols, 8);
  assert.equal(g.rows, 4);
  assert.equal(g.distribution, 1);
  assert.equal(g.pixelCount, 32);
  assert.equal(g.output.pixelCount, 32);
});

test('a bare-pixelCount legacy instance under a matrix type stays a strip (rows not multiplied)', () => {
  const show = {
    fixtureTypes: [{ id: 'm1', name: 'Matrix', cols: 8, rows: 4 }],
    // Legacy instance: only a flat pixelCount, no cols/rows of its own.
    fixtures: [{ id: 'f1', typeId: 'm1', pixelCount: 60, colorOrder: 'GRB',
      output: { deviceId: '' }, input: { points: [[0,0],[1,0]] } }],
    devices: [],
  };
  const f = syncFixtureTypes(show).fixtures[0];
  assert.equal(f.rows, 1);          // defaulted to a strip, NOT the type's rows=4
  assert.equal(f.cols, 60);
  assert.equal(f.pixelCount, 60);   // not 60 * 4
});
