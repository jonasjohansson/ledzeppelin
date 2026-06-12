import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runsOf, runKey, chainOf, chainOffset, setRunStagger, setRunAxis,
  moveFixtureInRun, wireAfter, wireFirst, freePort, pruneChains,
} from '../src/model/chains.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';

// Chains are DERIVED, not stored: a chain = the fixtures sharing a controller
// output — same (deviceId, port) — in show.fixtures order (= wiring order).
const fx = (id, port = 1, deviceId = 'd1') => ({ id, output: { deviceId, port } });
const baseShow = () => ({ fixtures: [fx('a'), fx('b'), fx('c', 2)] });

test('runsOf groups fixtures by (device, port) in wiring order', () => {
  const runs = runsOf(baseShow());
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.find((r) => r.key === 'd1:1').members, ['a', 'b']);
  assert.deepEqual(runs.find((r) => r.key === 'd1:2').members, ['c']);
});

test('chainOf returns the run only when it is an actual chain (≥2 members)', () => {
  const s = baseShow();
  const ch = chainOf(s, 'b');
  assert.deepEqual(ch.members, ['a', 'b']);
  assert.equal(ch.index, 1);
  assert.equal(chainOf(s, 'c'), null);   // alone on its output → not chained
  assert.equal(chainOf(s, 'z'), null);   // unknown fixture
});

test('chainOffset is index*stagger along the run axis; 0 when unchained', () => {
  let s = setRunStagger(baseShow(), 'd1:1', 0.1);
  assert.deepEqual(chainOffset(s, 'a'), [0, 0]);
  assert.ok(Math.abs(chainOffset(s, 'b')[0] - 0.1) < 1e-9);
  assert.deepEqual(chainOffset(s, 'c'), [0, 0]);   // not a chain
  s = setRunAxis(s, 'd1:1', 'y');
  assert.ok(Math.abs(chainOffset(s, 'b')[1] - 0.1) < 1e-9);
  assert.equal(chainOffset(s, 'b')[0], 0);
});

test('moveFixtureInRun reorders within the run, changing the stagger index', () => {
  let s = setRunStagger(baseShow(), 'd1:1', 0.1);
  s = moveFixtureInRun(s, 'b', -1);   // b moves earlier → [b, a]
  assert.deepEqual(chainOf(s, 'a').members, ['b', 'a']);
  assert.ok(Math.abs(chainOffset(s, 'a')[0] - 0.1) < 1e-9);
  // at the edge it's a no-op
  assert.equal(moveFixtureInRun(s, 'b', -1), s);
});

test('wireAfter moves a fixture onto the target run, right after it; wireFirst heads it', () => {
  let s = wireAfter(baseShow(), 'c', 'a');   // c leaves port 2, lands after a on port 1
  assert.deepEqual(chainOf(s, 'a').members, ['a', 'c', 'b']);
  assert.equal(s.fixtures.find((f) => f.id === 'c').output.port, 1);
  s = wireFirst(s, 'b');
  assert.deepEqual(chainOf(s, 'a').members, ['b', 'a', 'c']);
});

test('freePort returns the next unused output number on a device', () => {
  assert.equal(freePort(baseShow(), 'd1'), 3);
  assert.equal(freePort(baseShow(), 'd9'), 1);
});

test('pruneChains strips the legacy chains list and dead chainSettings', () => {
  const s = {
    ...baseShow(),
    chains: [{ id: 'legacy', members: ['a', 'b'] }],
    chainSettings: { 'd1:1': { stagger: 0.1 }, 'gone:9': { stagger: 0.5 } },
  };
  const pruned = pruneChains(s);
  assert.equal('chains' in pruned, false);
  assert.deepEqual(Object.keys(pruned.chainSettings), ['d1:1']);
});

test('buildPipelineInputs bakes the run stagger into the sample UVs', () => {
  let show = {
    devices: [{ id: 'd1', port: 4048, colorOrder: 'GRB' }],
    fixtures: [
      { id: 'a', output: { deviceId: 'd1', port: 1, pixelOffset: 0, pixelCount: 1 }, input: { points: [[0.2, 0.5], [0.2, 0.5]], samples: 1 } },
      { id: 'b', output: { deviceId: 'd1', port: 1, pixelOffset: 1, pixelCount: 1 }, input: { points: [[0.2, 0.5], [0.2, 0.5]], samples: 1 } },
    ],
  };
  show = setRunStagger(show, runKey(show.fixtures[0]), 0.1);
  const { sampleUVs } = buildPipelineInputs(show);
  // a (index 0): u 0.2 ; b (index 1): u 0.2 + 0.1 = 0.3
  assert.ok(Math.abs(sampleUVs[0] - 0.2) < 1e-6);
  assert.ok(Math.abs(sampleUVs[2] - 0.3) < 1e-6);
});
