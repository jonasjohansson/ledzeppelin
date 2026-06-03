import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addChain, removeChain, patchChain, moveChainMember, chainOf, chainOffset, pruneChains,
} from '../src/model/chains.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';

const baseShow = () => ({ fixtures: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], chains: [] });

test('addChain creates an ordered chain from ≥2 members; <2 is a no-op', () => {
  const s = addChain(baseShow(), ['a', 'b', 'c']);
  assert.equal(s.chains.length, 1);
  assert.deepEqual(s.chains[0].members, ['a', 'b', 'c']);
  assert.equal(s.chains[0].axis, 'x');
  const none = addChain(baseShow(), ['a']);
  assert.equal(none.chains.length, 0);
});

test('a fixture belongs to at most one chain (re-chaining moves it)', () => {
  let s = addChain(baseShow(), ['a', 'b']);
  s = addChain(s, ['b', 'c']);          // b leaves the first chain
  // first chain now has only [a] → dropped (<2); second is [b,c]
  assert.equal(s.chains.length, 1);
  assert.deepEqual(s.chains[0].members, ['b', 'c']);
});

test('chainOffset is index*stagger along the axis; 0 when unchained', () => {
  const s = addChain(baseShow(), ['a', 'b', 'c'], { stagger: 0.1, axis: 'x' });
  assert.deepEqual(chainOffset(s, 'a'), [0, 0]);
  assert.ok(Math.abs(chainOffset(s, 'b')[0] - 0.1) < 1e-9);
  assert.ok(Math.abs(chainOffset(s, 'c')[0] - 0.2) < 1e-9);
  assert.deepEqual(chainOffset(s, 'z'), [0, 0]);   // not a member
  const sy = patchChain(s, s.chains[0].id, { axis: 'y' });
  assert.ok(Math.abs(chainOffset(sy, 'b')[1] - 0.1) < 1e-9);
  assert.equal(chainOffset(sy, 'b')[0], 0);
});

test('moveChainMember reorders, changing the stagger index', () => {
  let s = addChain(baseShow(), ['a', 'b', 'c'], { stagger: 0.1 });
  const id = s.chains[0].id;
  s = moveChainMember(s, id, 'c', -1);     // c moves earlier → [a, c, b]
  assert.deepEqual(s.chains[0].members, ['a', 'c', 'b']);
  assert.ok(Math.abs(chainOffset(s, 'c')[0] - 0.1) < 1e-9);
});

test('chainOf finds the chain; removeChain drops it', () => {
  const s = addChain(baseShow(), ['a', 'b']);
  assert.equal(chainOf(s, 'a').id, s.chains[0].id);
  const r = removeChain(s, s.chains[0].id);
  assert.equal(r.chains.length, 0);
  assert.equal(chainOf(r, 'a'), null);
});

test('pruneChains drops dangling members and chains left with <2', () => {
  let s = addChain(baseShow(), ['a', 'b', 'c']);
  s = { ...s, fixtures: [{ id: 'a' }, { id: 'b' }] };   // c deleted
  const pruned = pruneChains(s);
  assert.deepEqual(pruned.chains[0].members, ['a', 'b']);
  // now delete b too → only [a] left → chain removed
  const gone = pruneChains({ ...pruned, fixtures: [{ id: 'a' }] });
  assert.equal(gone.chains.length, 0);
});

test('buildPipelineInputs bakes the chain stagger into the sample UVs', () => {
  const show = {
    devices: [{ id: 'd1', port: 4048, colorOrder: 'GRB' }],
    fixtures: [
      { id: 'a', output: { deviceId: 'd1', pixelOffset: 0, pixelCount: 1 }, input: { points: [[0.2, 0.5], [0.2, 0.5]], samples: 1 } },
      { id: 'b', output: { deviceId: 'd1', pixelOffset: 1, pixelCount: 1 }, input: { points: [[0.2, 0.5], [0.2, 0.5]], samples: 1 } },
    ],
    chains: [{ id: 'c1', name: 'c1', members: ['a', 'b'], stagger: 0.1, axis: 'x' }],
  };
  const { sampleUVs } = buildPipelineInputs(show);
  // a (index 0): u 0.2 ; b (index 1): u 0.2 + 0.1 = 0.3
  assert.ok(Math.abs(sampleUVs[0] - 0.2) < 1e-6);
  assert.ok(Math.abs(sampleUVs[2] - 0.3) < 1e-6);
});
