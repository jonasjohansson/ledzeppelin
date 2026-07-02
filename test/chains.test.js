import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runsOf, chainOf, chainOffset, setRunStagger, setRunAxis,
  moveFixtureInRun, wireAfter, wireFirst, freePort, pruneChains, controllerColorMap,
} from '../src/model/chains.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';

// Chains are DERIVED now: a chain is the fixtures sharing a controller output
// (deviceId:port), in show.fixtures (= wiring) order. Per-run stagger/axis live
// in show.chainSettings keyed `${deviceId}:${port}`.
const fx = (id, deviceId = 'd1', port = 1) => ({ id, output: { deviceId, port } });
const baseShow = () => ({ fixtures: [fx('a'), fx('b'), fx('c')] });

test('fixtures sharing an output form a derived chain in wiring order', () => {
  const s = baseShow();
  assert.deepEqual(runsOf(s).map((r) => r.key), ['d1:1']);
  assert.deepEqual(chainOf(s, 'b').members, ['a', 'b', 'c']);
  assert.equal(chainOf(s, 'b').index, 1);
});

test('a lone fixture on its own output is not a chain', () => {
  const s = { fixtures: [fx('a'), fx('b', 'd1', 2)] };
  assert.equal(chainOf(s, 'b'), null);
  assert.equal(chainOf(s, 'a'), null);
  assert.equal(chainOf(s, 'z'), null);   // unknown fixture
});

test('wireAfter moves a fixture onto the target run, right after it', () => {
  const s = wireAfter({ fixtures: [fx('a'), fx('b'), fx('c', 'd2', 1)] }, 'c', 'a');
  assert.deepEqual(chainOf(s, 'c').members, ['a', 'c', 'b']);
  assert.equal(s.fixtures.find((f) => f.id === 'c').output.deviceId, 'd1');
});

test('chainOffset is index*stagger along the run axis; 0 when unchained', () => {
  let s = setRunStagger(baseShow(), 'd1:1', 0.1);
  assert.deepEqual(chainOffset(s, 'a'), [0, 0]);
  assert.ok(Math.abs(chainOffset(s, 'b')[0] - 0.1) < 1e-9);
  assert.ok(Math.abs(chainOffset(s, 'c')[0] - 0.2) < 1e-9);
  assert.deepEqual(chainOffset(s, 'z'), [0, 0]);   // not a member
  s = setRunAxis(s, 'd1:1', 'y');
  assert.ok(Math.abs(chainOffset(s, 'b')[1] - 0.1) < 1e-9);
  assert.equal(chainOffset(s, 'b')[0], 0);
});

test('moveFixtureInRun reorders, changing the stagger index', () => {
  let s = setRunStagger(baseShow(), 'd1:1', 0.1);
  s = moveFixtureInRun(s, 'c', -1);     // c moves earlier → [a, c, b]
  assert.deepEqual(chainOf(s, 'c').members, ['a', 'c', 'b']);
  assert.ok(Math.abs(chainOffset(s, 'c')[0] - 0.1) < 1e-9);
});

test('wireFirst makes a fixture the head of its run', () => {
  const s = wireFirst(baseShow(), 'c');
  assert.deepEqual(chainOf(s, 'c').members, ['c', 'a', 'b']);
  assert.equal(chainOf(s, 'c').index, 0);
});

test('freePort returns the next unused output on a device', () => {
  assert.equal(freePort(baseShow(), 'd1'), 2);
  assert.equal(freePort({ fixtures: [fx('a'), fx('b', 'd1', 2)] }, 'd1'), 3);
  assert.equal(freePort(baseShow(), 'd9'), 1);
});

test('pruneChains strips the legacy chains list + settings for dead runs', () => {
  const s = {
    fixtures: [fx('a'), fx('b')],
    chains: [{ id: 'legacy', members: ['a', 'b'] }],
    chainSettings: { 'd1:1': { stagger: 0.1 }, 'gone:1': { stagger: 0.5 } },
  };
  const pruned = pruneChains(s);
  assert.equal(pruned.chains, undefined);                       // legacy field dropped
  assert.deepEqual(Object.keys(pruned.chainSettings), ['d1:1']);   // dead run's settings gone
});

test('buildPipelineInputs bakes the run stagger into the sample UVs', () => {
  const show = {
    devices: [{ id: 'd1', port: 4048, colorOrder: 'GRB' }],
    fixtures: [
      { id: 'a', output: { deviceId: 'd1', port: 1, pixelOffset: 0, pixelCount: 1 }, input: { points: [[0.2, 0.5], [0.2, 0.5]], samples: 1 } },
      { id: 'b', output: { deviceId: 'd1', port: 1, pixelOffset: 1, pixelCount: 1 }, input: { points: [[0.2, 0.5], [0.2, 0.5]], samples: 1 } },
    ],
    chainSettings: { 'd1:1': { stagger: 0.1, axis: 'x' } },
  };
  const { sampleUVs } = buildPipelineInputs(show);
  // a (index 0): u 0.2 ; b (index 1): u 0.2 + 0.1 = 0.3
  assert.ok(Math.abs(sampleUVs[0] - 0.2) < 1e-6);
  assert.ok(Math.abs(sampleUVs[2] - 0.3) < 1e-6);
});

// --- Controller identity colours (C3): assigned device.color wins ------------
test('controllerColorMap prefers the device assigned colour over the generated one', () => {
  const show = {
    devices: [{ id: 'd1', color: '#ff0000' }, { id: 'd2' }],   // d2 has no assigned colour
    fixtures: [fx('a', 'd1', 1), fx('b', 'd2', 1)],
  };
  const { deviceColor, runColor } = controllerColorMap(show);
  assert.equal(deviceColor('d1'), '#ff0000');                  // assigned hex, verbatim
  assert.match(runColor('d1', 1), /^hsl\(0\.0, 100%, 50%\)$/); // run tint derives from it
  assert.match(deviceColor('d2'), /^hsl\(/);                   // fallback: generated hue
});

test('controllerColorMap still ramps per-output lightness for assigned colours', () => {
  const show = {
    devices: [{ id: 'd1', color: '#ff0000' }],
    fixtures: [fx('a', 'd1', 1), fx('b', 'd1', 2)],
  };
  const { runColor } = controllerColorMap(show);
  assert.equal(runColor('d1', 1), 'hsl(0.0, 100%, 44%)');      // 2 ports → 44%..76% ramp
  assert.equal(runColor('d1', 2), 'hsl(0.0, 100%, 76%)');
});
