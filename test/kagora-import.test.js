import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importKagora } from '../src/model/kagora-import.js';
import { validate } from '../src/model/show.js';

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
