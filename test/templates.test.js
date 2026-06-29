import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampFixture, stampDevice } from '../src/model/templates.js';
import { makeFixtureType, makeGridType, makeDeviceType, validate, emptyShow } from '../src/model/show.js';

// --- stampFixture ------------------------------------------------------------

test('stampFixture inlines the template spec onto a standalone instance', () => {
  const tmpl = makeFixtureType(60, 2, 'RGB', 'tA', 'Strip A');   // pixelCount 120, cols 120, rows 1
  const fx = stampFixture(tmpl, 'f7');

  assert.equal(fx.id, 'f7');
  // Spec fields inlined directly on the instance.
  assert.equal(fx.pixelCount, tmpl.pixelCount);
  assert.equal(fx.cols, tmpl.cols);
  assert.equal(fx.rows, tmpl.rows);
  assert.equal(fx.colorOrder, tmpl.colorOrder);
  assert.equal(fx.ledsPerMeter, tmpl.ledsPerMeter);
  assert.equal(fx.meters, tmpl.meters);
  assert.equal(fx.distribution, tmpl.distribution);
  // Provenance tag (record, not a live link).
  assert.equal(fx.fromTemplate, tmpl.id);
});

test('stampFixture produces a default patch/placement that validates once placed', () => {
  const tmpl = makeFixtureType(60, 2, 'GRB', 'tA');
  const fx = stampFixture(tmpl, 'f1');

  assert.equal(fx.output.deviceId, '');
  assert.equal(fx.output.port, 1);
  assert.equal(fx.output.pixelOffset, 0);
  assert.equal(fx.output.pixelCount, tmpl.pixelCount);   // validate(): output.pixelCount === pixelCount
  assert.ok(fx.input.points.length >= 2);                // validate(): input needs ≥2 points

  // Unassigned (deviceId '') standalone fixture must pass validate().
  const show = { ...emptyShow(), fixtures: [fx] };
  assert.equal(validate(show).ok, true, JSON.stringify(validate(show).errors));
});

test('stampFixture handles a matrix template (rows > 1) with grid placement', () => {
  const tmpl = makeGridType(8, 4, 'GRB', 'tG', 'Matrix');   // pixelCount 32
  const fx = stampFixture(tmpl, 'fg');
  assert.equal(fx.cols, 8);
  assert.equal(fx.rows, 4);
  assert.equal(fx.pixelCount, 32);
  assert.equal(fx.output.pixelCount, 32);
  assert.ok(fx.input.points.length >= 2);
});

test('editing the template AFTER stamping does NOT change the stamped fixture (no shared refs)', () => {
  const tmpl = makeFixtureType(60, 2, 'RGB', 'tA');
  const fx = stampFixture(tmpl, 'f1');
  const before = JSON.parse(JSON.stringify(fx));

  tmpl.pixelCount = 9999;
  tmpl.colorOrder = 'BGR';
  tmpl.cols = 9999;
  tmpl.name = 'mutated';

  assert.deepEqual(fx, before);
  assert.equal(fx.pixelCount, 120);
  assert.equal(fx.colorOrder, 'RGB');
  // Fresh nested objects — not the template's.
  assert.notEqual(fx.output, tmpl.output);
  assert.notEqual(fx.input, tmpl.input);
});

test('stampFixture does not mutate the template', () => {
  const tmpl = makeFixtureType(60, 2, 'RGB', 'tA');
  const snapshot = JSON.parse(JSON.stringify(tmpl));
  stampFixture(tmpl, 'f1');
  assert.deepEqual(tmpl, snapshot);
});

// --- stampDevice -------------------------------------------------------------

test('stampDevice inlines outputs/maxPerOutput onto a standalone device', () => {
  const tmpl = makeDeviceType('DigQuad', 4, 830, 'digquad');
  const d = stampDevice(tmpl, 'd3');

  assert.equal(d.id, 'd3');
  assert.equal(d.name, 'DigQuad');
  assert.equal(d.outputs, 4);
  assert.equal(d.maxPerOutput, 830);
  assert.equal(d.protocol, 'ddp');
  assert.equal(d.port, 4048);
  assert.equal(d.fromTemplate, 'digquad');
});

test('stampDevice name falls back to the template id, then the new id', () => {
  assert.equal(stampDevice({ id: 'digocta', outputs: 8 }, 'd1').name, 'digocta');
  assert.equal(stampDevice({ outputs: 8 }, 'd1').name, 'd1');
});

test('stampDevice carries artnetSync only when the template has it', () => {
  const withSync = stampDevice({ id: 'x', outputs: 4, maxPerOutput: 0, artnetSync: true }, 'd1');
  assert.equal(withSync.artnetSync, true);
  const without = stampDevice({ id: 'x', outputs: 4, maxPerOutput: 0 }, 'd1');
  assert.equal('artnetSync' in without, false);
});

test('stampDevice does not mutate the template', () => {
  const tmpl = makeDeviceType('DigQuad', 4, 830, 'digquad');
  const snapshot = JSON.parse(JSON.stringify(tmpl));
  stampDevice(tmpl, 'd3');
  assert.deepEqual(tmpl, snapshot);
});
