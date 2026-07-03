import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importKagora } from '../src/model/kagora-import.js';
import { validate, repackOffsets } from '../src/model/show.js';
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

// --- Real port index (C1) -------------------------------------------------
test('a strip wired to data-out-3 imports with output.port === 3', () => {
  const p = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-3' }, to: { instId: 's1', id: 'data-in' } },
    ],
  };
  const show = importKagora(p);
  assert.equal(show.fixtures.find((f) => f.id === 's1').output.port, 3);
});

test('a SOLO strip on data-out-2 gets output.port === 2 (not a sequential 1)', () => {
  const p = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-2' }, to: { instId: 's1', id: 'data-in' } },
    ],
  };
  const show = importKagora(p);
  assert.equal(show.fixtures.find((f) => f.id === 's1').output.port, 2);
});

test('two solo strips on different outputs of one controller keep distinct real ports', () => {
  const p = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { kind: 'strip', id: 's2', typeId: 't', points: [{ x: 0, y: 5 }, { x: 5, y: 5 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-2' }, to: { instId: 's1', id: 'data-in' } },
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-4' }, to: { instId: 's2', id: 'data-in' } },
    ],
  };
  const show = importKagora(p);
  assert.equal(show.fixtures.find((f) => f.id === 's1').output.port, 2);
  assert.equal(show.fixtures.find((f) => f.id === 's2').output.port, 4);
  assert.equal(validate(show).ok, true, JSON.stringify(validate(show).errors));
});

// --- Fan-out + orphan strips (I3) ----------------------------------------
test('an orphan strip imports as an UNASSIGNED fixture and still validates', () => {
  const p = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 90, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      // orphan: never wired to a controller
      { kind: 'strip', id: 'orphan', typeId: 't', points: [{ x: 0, y: 9 }, { x: 5, y: 9 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-1' }, to: { instId: 's1', id: 'data-in' } },
    ],
  };
  const show = importKagora(p);
  const o = show.fixtures.find((f) => f.id === 'orphan');
  assert.ok(o, 'orphan strip should still be emitted');
  assert.equal(o.output.deviceId, '', 'orphan is unassigned');
  assert.ok(o.input.points.length >= 2);
  assert.equal(o.pixelCount, 90);
  // controller-attached fixture is unaffected
  const s1 = show.fixtures.find((f) => f.id === 's1');
  assert.equal(s1.output.deviceId, 'brain');
  assert.equal(validate(show).ok, true, JSON.stringify(validate(show).errors));
});

test('a fan-out strip keeps a deterministic primary and warns about the dropped branch', () => {
  const p = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { kind: 'strip', id: 'a', typeId: 't', points: [{ x: 5, y: 0 }, { x: 10, y: 0 }] },
      { kind: 'strip', id: 'b', typeId: 't', points: [{ x: 5, y: 1 }, { x: 10, y: 1 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-1' }, to: { instId: 's1', id: 'data-in' } },
      // s1 fans out to BOTH a and b
      { channel: 'signal', from: { instId: 's1', id: 'data-out' }, to: { instId: 'a', id: 'data-in' } },
      { channel: 'signal', from: { instId: 's1', id: 'data-out' }, to: { instId: 'b', id: 'data-in' } },
    ],
  };
  const show = importKagora(p);
  assert.ok(Array.isArray(show.warnings) && show.warnings.some((w) => /fan-?out|drop/i.test(w)),
    `expected a fan-out warning, got: ${JSON.stringify(show.warnings)}`);
  assert.equal(validate(show).ok, true, JSON.stringify(validate(show).errors));
});

// --- Warnings channel (I4) ------------------------------------------------
test('importing a preset with an orphan strip yields a warning mentioning it', () => {
  const p = {
    types: [
      { kind: 'stripType', id: 't', pixelCount: 60, colorOrder: 'GRB' },
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 't', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { kind: 'strip', id: 'orphan', typeId: 't', points: [{ x: 0, y: 9 }, { x: 5, y: 9 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-1' }, to: { instId: 's1', id: 'data-in' } },
    ],
  };
  const show = importKagora(p);
  assert.ok(Array.isArray(show.warnings) && show.warnings.length > 0);
  assert.ok(show.warnings.some((w) => /orphan/.test(w)), JSON.stringify(show.warnings));
});

test('a strip with a missing stripType falls back to a default and warns', () => {
  const p = {
    types: [
      { kind: 'controllerType', id: 'ct' },
    ],
    instances: [
      { kind: 'controller', id: 'brain', typeId: 'ct' },
      { kind: 'strip', id: 's1', typeId: 'no-such-type', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
    ],
    edges: [
      { channel: 'signal', from: { instId: 'brain', id: 'data-out-1' }, to: { instId: 's1', id: 'data-in' } },
    ],
  };
  const show = importKagora(p);
  const f = show.fixtures.find((x) => x.id === 's1');
  assert.ok(f, 'strip with missing type should still import');
  assert.ok(f.pixelCount > 0, 'should fall back to a non-zero default pixel count');
  assert.ok(show.warnings.some((w) => /stripType/i.test(w)), JSON.stringify(show.warnings));
  assert.equal(validate(show).ok, true, JSON.stringify(validate(show).errors));
});

// --- Pipeline parity (I1) -------------------------------------------------
test('imported pixelOffsets match repackOffsets and the chain validates', () => {
  const show = importKagora(preset);
  // Offsets the importer emits must already equal what repackOffsets derives.
  const repacked = repackOffsets(show);
  for (const f of show.fixtures) {
    const r = repacked.fixtures.find((x) => x.id === f.id);
    assert.equal(f.output.pixelOffset, r.output.pixelOffset, `offset drift on ${f.id}`);
  }
  // Per-device offsets are contiguous from 0.
  for (const d of show.devices) {
    const fs = show.fixtures
      .filter((f) => f.output.deviceId === d.id)
      .sort((a, b) => a.output.pixelOffset - b.output.pixelOffset);
    let expected = 0;
    for (const f of fs) {
      assert.equal(f.output.pixelOffset, expected, `device ${d.id} non-contiguous at ${f.id}`);
      expected += f.output.pixelCount;
    }
  }
  assert.equal(validate(show).ok, true, JSON.stringify(validate(show).errors));
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

test('strip points with z import as whole-polyline 3-tuples (z in canvas-height units)', () => {
  // Two lifted arcs + one flat strip.
  const p = structuredClone(preset);
  const sA1 = p.instances.find((i) => i.id === 'sA-1');
  const sA2 = p.instances.find((i) => i.id === 'sA-2');
  sA1.points = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 50, z: 30 }, { x: 200, y: 100, z: 0 }];
  sA2.points = [{ x: 0, y: 100, z: 0 }, { x: 200, y: 0, z: 50 }];
  // z normalizes by the RIG bbox's y-span (over ALL strips, incl. the flat one)
  const ys = p.instances.filter((i) => i.kind === 'strip')
    .flatMap((s) => (s.points ?? []).map((q) => q.y));
  const spanY = Math.max(...ys) - Math.min(...ys);
  const show = importKagora(p);
  const f1 = show.fixtures.find((f) => f.id === 'sA-1');
  // whole polyline promoted: feet at z 0 are 3-tuples too
  assert.deepEqual(f1.input.points.map((q) => q.length), [3, 3, 3]);
  assert.equal(f1.input.points[1][2], 30 / spanY);
  assert.equal(f1.input.points[0][2], 0);
  const f2 = show.fixtures.find((f) => f.id === 'sA-2');
  assert.equal(f2.input.points[1][2], 50 / spanY);
  // a strip with no z stays clean 2-tuples (byte-identical 2D guard)
  const f3 = show.fixtures.find((f) => f.id === 'sB-1');
  assert.ok(f3.input.points.every((q) => q.length === 2));
});
