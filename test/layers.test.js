import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeLayer, addLayer, removeLayer, moveLayer, patchLayer, setLayerParam,
  changeGenerator, addEffect, removeEffect, moveEffect, prefixedDefaults,
} from '../src/model/layers.js';

test('prefixedDefaults namespaces keys with the entry name', () => {
  assert.deepEqual(prefixedDefaults('line'),
    { 'line.pos': 0.5, 'line.width': 0.08, 'line.angle': 90 });
});

test('makeLayer seeds prefixed generator params and defaults', () => {
  const l = makeLayer('l1');
  assert.equal(l.id, 'l1');
  assert.equal(l.generator, 'line');
  assert.equal(l.blend, 'add');
  assert.equal(l.opacity, 1);
  assert.deepEqual(l.effects, []);
  assert.equal(l.params['line.pos'], 0.5);
});

test('addLayer appends immutably with a unique id', () => {
  const a = [];
  const b = addLayer(a);
  assert.equal(a.length, 0);            // original untouched
  assert.equal(b.length, 1);
  const c = addLayer(b);
  assert.notEqual(b[0].id, c[1].id);
});

test('removeLayer / moveLayer are immutable and clamp', () => {
  const ls = [makeLayer('a'), makeLayer('b'), makeLayer('c')];
  assert.deepEqual(removeLayer(ls, 1).map((l) => l.id), ['a', 'c']);
  assert.equal(removeLayer(ls, 9), ls);                       // out of range → unchanged
  assert.deepEqual(moveLayer(ls, 0, +1).map((l) => l.id), ['b', 'a', 'c']);
  assert.equal(moveLayer(ls, 0, -1), ls);                     // clamp → unchanged
  assert.equal(ls.map((l) => l.id).join(''), 'abc');          // original untouched
});

test('patchLayer / setLayerParam mutate only the target immutably', () => {
  const ls = [makeLayer('a'), makeLayer('b')];
  const p = patchLayer(ls, 1, { opacity: 0.5 });
  assert.equal(p[1].opacity, 0.5);
  assert.equal(p[0], ls[0]);            // untouched layer is reused by reference
  assert.equal(ls[1].opacity, 1);       // original untouched
  const sp = setLayerParam(ls, 0, 'line.pos', 0.9);
  assert.equal(sp[0].params['line.pos'], 0.9);
  assert.equal(ls[0].params['line.pos'], 0.5);
});

test('changeGenerator resets generator params but keeps effect params', () => {
  let ls = [makeLayer('a')];
  ls = addEffect(ls, 0, 'displace');
  ls = setLayerParam(ls, 0, 'displace.amt', 0.7);
  const next = changeGenerator(ls, 0, 'gradient');
  assert.equal(next[0].generator, 'gradient');
  assert.equal(next[0].params['gradient.angle'], 0);          // new gen default seeded
  assert.equal(next[0].params['line.pos'], undefined);        // old gen params dropped
  assert.equal(next[0].params['displace.amt'], 0.7);          // effect params kept
});

test('addEffect appends and seeds defaults; removeEffect drops orphan params', () => {
  let ls = [makeLayer('a')];
  ls = addEffect(ls, 0, 'displace');
  assert.deepEqual(ls[0].effects, ['displace']);
  assert.equal(ls[0].params['displace.amt'], 0.2);
  const rm = removeEffect(ls, 0, 0);
  assert.deepEqual(rm[0].effects, []);
  assert.equal(rm[0].params['displace.amt'], undefined);
});

test('removeEffect keeps params when a duplicate effect remains', () => {
  let ls = [makeLayer('a')];
  ls = addEffect(ls, 0, 'displace');
  ls = addEffect(ls, 0, 'displace');
  const rm = removeEffect(ls, 0, 0);
  assert.deepEqual(rm[0].effects, ['displace']);
  assert.equal(rm[0].params['displace.amt'], 0.2);            // still used → kept
});

test('moveEffect reorders the chain immutably and clamps', () => {
  let ls = [makeLayer('a')];
  ls = addEffect(ls, 0, 'displace');
  ls = addEffect(ls, 0, 'repeat');
  const mv = moveEffect(ls, 0, 0, +1);
  assert.deepEqual(mv[0].effects, ['repeat', 'displace']);
  assert.equal(moveEffect(ls, 0, 0, -1), ls);                 // clamp → unchanged
});
