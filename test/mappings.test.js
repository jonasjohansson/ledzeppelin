import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMappables, bindMapping, clearMapping, setMappingMode, applyBindings } from '../src/model/mappings.js';
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
  const src = rows.find((r) => r.animKey && r.animKey.startsWith('line.'));
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

// --- action targets: triggers + layer opacity/bypass -------------------------
test('listMappables includes trigger + layer opacity/bypass rows', () => {
  let s = show1();
  const lid = s.composition.layers[s.composition.layers.length - 1].id;
  s = addClip(s, lid, 'line');
  const rows = listMappables(s);
  assert.ok(rows.find((r) => r.kind === 'opacity'), 'layer opacity row');
  assert.ok(rows.find((r) => r.kind === 'bypass'), 'layer bypass row');
  assert.ok(rows.find((r) => r.kind === 'trigger'), 'clip trigger row');
});

test('a bound trigger fires the clip on a rising edge only', () => {
  let s = show1();
  const lid = s.composition.layers[s.composition.layers.length - 1].id;
  s = addClip(s, lid, 'line'); s = addClip(s, lid, 'gradient');   // clip1 active
  const lay = s.composition.layers.find((L) => L.id === lid);
  const c2 = lay.clips[1].id;
  s = bindMapping(s, `t|${lid}|${c2}`, 'note36');
  // not rising (held) → no change
  let r = applyBindings(s, { note36: 1 }, { note36: 1 });
  assert.equal(r.show, s);
  // rising → fires clip 2
  r = applyBindings(s, { note36: 1 }, { note36: 0 });
  assert.equal(r.fired, true);
  assert.equal(r.show.composition.layers.find((L) => L.id === lid).activeClipId, c2);
});

test('a bound layer opacity follows the channel value (continuous)', () => {
  let s = show1();
  const lid = s.composition.layers[s.composition.layers.length - 1].id;
  s = bindMapping(s, `lo|${lid}`, 'cc7');
  const r = applyBindings(s, { cc7: 0.4 }, {});
  assert.ok(Math.abs(r.show.composition.layers.find((L) => L.id === lid).opacity - 0.4) < 1e-6);
});

test('a bound bypass toggles on press, or follows when momentary', () => {
  let s = show1();
  const lid = s.composition.layers[s.composition.layers.length - 1].id;
  s = bindMapping(s, `lb|${lid}`, 'note40');
  const bp = (x) => x.composition.layers.find((L) => L.id === lid).bypass;
  // toggle: rising flips false→true
  let r = applyBindings(s, { note40: 1 }, { note40: 0 });
  assert.equal(bp(r.show), true);
  // momentary: follows held state
  let s2 = setMappingMode(s, `lb|${lid}`, 'momentary');
  assert.equal(bp(applyBindings(s2, { note40: 1 }, {}).show), true);
  assert.equal(bp(applyBindings(applyBindings(s2, { note40: 1 }, {}).show, { note40: 0 }, { note40: 1 }).show), false);
});
