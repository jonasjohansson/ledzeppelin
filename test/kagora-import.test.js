import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importKagora } from '../src/model/kagora-import.js';
import { validate } from '../src/model/show.js';
import { chainOf } from '../src/model/chains.js';

const here = dirname(fileURLToPath(import.meta.url));
const preset = JSON.parse(
  readFileSync(join(here, 'fixtures', 'kagora-sample.json'), 'utf8')
);

test('importKagora maps controllers to devices and strips to fixtures', () => {
  const show = importKagora(preset);
  assert.equal(show.devices.length, 2);
  assert.equal(show.fixtures.length, 3);
});

test('importKagora leaves device ip blank for later assignment', () => {
  const show = importKagora(preset);
  for (const d of show.devices) assert.equal(d.ip, '');
  for (const d of show.devices) assert.equal(d.port, 4048);
});

test('daisy-chained strips on one output get device-local offsets 0 and firstPixelCount', () => {
  const show = importKagora(preset);
  const a1 = show.fixtures.find((f) => f.id === 'sA-1');
  const a2 = show.fixtures.find((f) => f.id === 'sA-2');
  // sA-1 is the chain head (offset 0), sA-2 follows it (offset = sA-1 pixelCount)
  assert.equal(a1.output.pixelOffset, 0);
  assert.equal(a1.pixelCount, 300);
  assert.equal(a2.output.pixelOffset, 300);
  assert.equal(a2.pixelCount, 240);
  // both belong to controller A
  assert.equal(a1.output.deviceId, 'brainA');
  assert.equal(a2.output.deviceId, 'brainA');
});

test('strip on a different controller gets its own device-local offset 0', () => {
  const show = importKagora(preset);
  const b1 = show.fixtures.find((f) => f.id === 'sB-1');
  assert.equal(b1.output.deviceId, 'brainB');
  assert.equal(b1.output.pixelOffset, 0);
});

test('imported show passes validate()', () => {
  const show = importKagora(preset);
  const res = validate(show);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
});

test('input.points are normalized into [0,1]', () => {
  const show = importKagora(preset);
  for (const f of show.fixtures) {
    for (const [x, y] of f.input.points) {
      assert.ok(x >= 0 && x <= 1, `x ${x} out of range`);
      assert.ok(y >= 0 && y <= 1, `y ${y} out of range`);
    }
    assert.ok(f.input.points.length >= 2);
    assert.equal(f.input.samples, f.pixelCount);
  }
});

test('devices carry colorOrder from their strips (GRB default)', () => {
  const show = importKagora(preset);
  for (const d of show.devices) assert.equal(d.colorOrder, 'GRB');
});

test('a daisy-chain run imports as one derived chain (members in data-flow order)', () => {
  const show = importKagora(preset);
  // sA-1 → sA-2 daisy-chain on brainA share an output → one derived chain, in order.
  const ch = chainOf(show, 'sA-1');
  assert.ok(ch, 'expected a chain containing the daisy-chained strips');
  assert.deepEqual(ch.members, ['sA-1', 'sA-2']);
  assert.equal(ch.stagger, 0);   // imported off; operator dials it in
});

// --- Robustness guards (C2) ----------------------------------------------
test('importKagora rejects non-presets with a clear message', () => {
  for (const bad of [null, undefined, 42, 'nope', []]) {
    assert.throws(() => importKagora(bad), /not a LEDger preset/, `expected throw for ${JSON.stringify(bad)}`);
  }
  // an object with none of types/instances/edges as arrays also throws
  assert.throws(() => importKagora({}), /not a LEDger preset/);
});

// --- Duplicate ids (N1) ---------------------------------------------------
test('importKagora throws on duplicate instance ids', () => {
  const dup = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 'dupe', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { kind: 'strip', id: 'dupe', typeId: 't', points: [{ x: 0, y: 5 }, { x: 5, y: 5 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-1' }, to: { instId: 'dupe', id: 'data-in' } },
    ],
  };
  assert.throws(() => importKagora(dup), /duplicate id/);
});

// --- Dangling signal edge (I2) -------------------------------------------
test('importKagora tolerates a signal edge with no `to`', () => {
  const danglesignal = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-1' }, to: { instId: 's1', id: 'data-in' } },
      // dangling: no `to` at all
      { channel: 'signal', from: { instId: 's1', id: 'data-out' } },
    ],
  };
  assert.doesNotThrow(() => importKagora(danglesignal));
});

// --- Cyclic / self-referential chain (C4) --------------------------------
test('a strip with a controller feed AND a loopback edge keeps its controller', () => {
  const loop = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { kind: 'strip', id: 's2', typeId: 't', points: [{ x: 5, y: 0 }, { x: 10, y: 0 }] },
    ],
    edges: [
      // controller → s1
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-1' }, to: { instId: 's1', id: 'data-in' } },
      // s1 → s2 (normal daisy)
      { channel: 'signal', from: { instId: 's1', id: 'data-out' }, to: { instId: 's2', id: 'data-in' } },
      // loopback: s2 → s1 data-in (would overwrite the controller feed in last-writer-wins)
      { channel: 'signal', from: { instId: 's2', id: 'data-out' }, to: { instId: 's1', id: 'data-in' } },
    ],
  };
  const show = importKagora(loop);
  const f1 = show.fixtures.find((f) => f.id === 's1');
  assert.ok(f1, 's1 should still import');
  assert.equal(f1.output.deviceId, 'brain');
});

test('a bent strip (>2 points) imports as a polyline, keeping every bend', () => {
  const bent = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-1' }, to: { instId: 's1', id: 'data-in' } },
    ],
  };
  const show = importKagora(bent);
  const f = show.fixtures.find((x) => x.id === 's1');
  assert.equal(f.input.mode, 'polyline');
  assert.equal(f.input.points.length, 3);          // the bend is preserved, not collapsed to 2
});
