import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMappables, bindMapping, clearMapping } from '../src/model/mappings.js';
import { normalizeComposition, addClip, addLayer, makeClip } from '../src/model/layers.js';
import { emptyShow } from '../src/model/show.js';

function show1() {
  let s = normalizeComposition(emptyShow());
  const lid = s.composition.layers[0]?.id || (s = addLayer(s)).composition.layers[0].id;
  return s;
}

test('listMappables lists a clip\'s source + transform params with OSC + null channel', () => {
  let s = show1();
  const lid = s.composition.layers[s.composition.layers.length - 1].id;   // top layer
  s = addClip(s, lid, 'line');
  const rows = listMappables(s);
  // transform rows always present (x/y/scale/rotation/opacity) for the clip
  const tfx = rows.find((r) => r.animKey === 'tf.x');
  assert.ok(tfx, 'has a tf.x row');
  assert.equal(tfx.osc, '/layer/1/clip/1/tf/x');
  assert.equal(tfx.channel, null);
  // a source param row exists and carries an OSC address + range
  const src = rows.find((r) => r.animKey.startsWith('line.'));
  assert.ok(src, 'has a line.* source row');
  assert.match(src.osc, /^\/layer\/1\/clip\/1\//);
  assert.equal(src.channel, null);
});

test('bindMapping binds a channel via External anim; listMappables reflects it; clear removes', () => {
  let s = show1();
  const lid = s.composition.layers[s.composition.layers.length - 1].id;
  s = addClip(s, lid, 'line');
  const id = listMappables(s).find((r) => r.animKey === 'tf.scale').id;
  s = bindMapping(s, id, 'cc7');
  let row = listMappables(s).find((r) => r.id === id);
  assert.equal(row.channel, 'cc7');
  // the underlying anim is External on tf.scale
  const clip = s.composition.layers[s.composition.layers.length - 1].clips[0];
  assert.equal(clip.anim['tf.scale'].mode, 'external');
  assert.equal(clip.anim['tf.scale'].channel, 'cc7');
  // clear
  s = clearMapping(s, id);
  row = listMappables(s).find((r) => r.id === id);
  assert.equal(row.channel, null);
});

test('bindMapping on an unknown id is a no-op (same reference)', () => {
  const s = show1();
  assert.equal(bindMapping(s, 'c|nope|nope|x', 'cc1'), s);
});
