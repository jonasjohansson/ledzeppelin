import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseObj, parseName, objToKagora } from '../src/model/obj-import.js';
import { importKagora } from '../src/model/kagora-import.js';

test('parses vertices grouped by object, ordered by declaration when no l-lines', () => {
  const obj = `
o RunA
v 0 0 0
v 1 0 0
v 2 0 0
o RunB
v 0 1 0
v 0 2 0
`;
  const r = parseObj(obj);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, 'RunA');
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
  assert.equal(r[1].name, 'RunB');
  assert.deepEqual(r[1].points, [[0, 1, 0], [0, 2, 0]]);
});

test('orders points by l (line) elements when present, incl. negative indices', () => {
  // vertices declared out of path order; the l-line gives the true order.
  const obj = `o Bend
v 0 0 0
v 1 1 0
v 2 0 0
l 1 2 3`;
  const r = parseObj(obj);
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 1, 0], [2, 0, 0]]);

  const rel = parseObj(`o R
v 5 0 0
v 6 0 0
l -2 -1`);
  assert.deepEqual(rel[0].points, [[5, 0, 0], [6, 0, 0]]);
});

test('geometry before any o/g goes into a default object; f/vn/vt ignored', () => {
  const r = parseObj(`v 0 0 0\nv 1 0 0\nvn 0 0 1\nf 1 2 1\n`);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 0, 0]]);
});

test('parseName splits base name from __key=val tokens with defaults', () => {
  assert.deepEqual(parseName('Tail__leds=204__order=GRBW__out=oct110.0'),
    { name: 'Tail', leds: 204, lpm: 60, order: 'GRBW', out: { dev: 'oct110', port: 0 }, dir: 'fwd' });
  // minimal: only leds; defaults fill in; no out → null
  assert.deepEqual(parseName('Rib__leds=90'),
    { name: 'Rib', leds: 90, lpm: 60, order: '', out: null, dir: 'fwd' });
  // no leds → leds null (caller drops + warns)
  assert.equal(parseName('Ghost').leds, null);
  // dir + lpm
  const p = parseName('Spine__leds=120__lpm=144__dir=rev');
  assert.equal(p.lpm, 144); assert.equal(p.dir, 'rev');
});

test('objToKagora builds strips/types/controllers/edges + warns on bad runs', () => {
  const objs = [
    { name: 'Tail__leds=3__order=GRBW__out=oct.0', points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
    { name: 'Rib__leds=2__out=oct.0', points: [[0, 1, 0], [0, 2, 0]] },   // same port → daisy-chain
    { name: 'NoLeds', points: [[0, 0, 0], [1, 0, 0]] },                    // dropped + warned
    { name: 'Short__leds=5', points: [[0, 0, 0]] },                        // <2 pts → dropped + warned
  ];
  const { preset, warnings } = objToKagora(objs);
  const strips = preset.instances.filter((i) => i.kind === 'strip');
  assert.equal(strips.length, 2);
  assert.equal(warnings.length, 2);
  // controller present
  assert.ok(preset.instances.some((i) => i.kind === 'controller' && i.id === 'oct'));
  // first run wired to controller data-out-0; second daisy-chains off the first
  const e0 = preset.edges.find((e) => e.to.instId === strips[0].id);
  assert.deepEqual([e0.from.instId, e0.from.id], ['oct', 'data-out-0']);
  const e1 = preset.edges.find((e) => e.to.instId === strips[1].id);
  assert.deepEqual([e1.from.instId, e1.from.id], [strips[0].id, 'data-out']);
});

test('objToKagora reverses points when dir=rev', () => {
  const { preset } = objToKagora([{ name: 'R__leds=2__dir=rev', points: [[0, 0, 0], [9, 0, 0]] }]);
  const s = preset.instances.find((i) => i.kind === 'strip');
  assert.deepEqual([s.points[0].x, s.points[1].x], [9, 0]);
});

test('OBJ text round-trips through importKagora into correct fixtures', () => {
  const objText = `
o Tail__leds=204__order=GRBW__out=oct110.0
v 0 0 1
v 1 0 1
v 2 0 1
o Rib__leds=90__out=oct110.1
v 0 1 0
v 0 2 0
`;
  const { preset, warnings } = objToKagora(parseObj(objText));
  assert.equal(warnings.length, 0);
  const show = importKagora(preset);
  const byName = Object.fromEntries(show.fixtures.map((f) => [f.name, f]));
  // Tail: 204px GRBW, on device oct110 port 0, lifted (z) → polyline
  assert.equal(byName.Tail.pixelCount, 204);
  assert.equal(byName.Tail.colorFormat, 'GRBW');
  assert.equal(byName.Tail.output.deviceId, 'oct110');
  assert.equal(byName.Tail.output.port, 0);
  assert.equal(byName.Tail.input.mode, 'polyline');
  assert.equal(byName.Tail.input.samples, 204);
  assert.ok(byName.Tail.input.points.every((p) => p.length === 3));   // z preserved
  // Rib: 90px on the same device, port 1
  assert.equal(byName.Rib.pixelCount, 90);
  assert.equal(byName.Rib.output.deviceId, 'oct110');
  assert.equal(byName.Rib.output.port, 1);
  // points normalized into 0..1
  for (const f of show.fixtures) for (const p of f.input.points) { assert.ok(p[0] >= 0 && p[0] <= 1); assert.ok(p[1] >= 0 && p[1] <= 1); }
});
