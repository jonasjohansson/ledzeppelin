import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeOsc, addressFor } from '../src/model/osc-map.js';
import { makeClip } from '../src/model/layers.js';

// Two layers, deck order: /layer/1 = TOP deck row = LAST array entry.
//   array[0] = bottom (l2: one 'pulse' clip) · array[1] = top (l1: line + radial)
function show2() {
  return {
    composition: {
      canvas: { w: 1280, h: 720 },
      layers: [
        { id: 'l2', name: 'Layer 2', blend: 'add', opacity: 1, transitionMs: 500,
          clips: [makeClip('pulse', undefined, 'c3')], activeClipId: 'c3', effects: [], params: {} },
        { id: 'l1', name: 'Layer 1', blend: 'add', opacity: 1, transitionMs: 500,
          clips: [makeClip('line', undefined, 'c1'), makeClip('radial', undefined, 'c2')],
          activeClipId: 'c1', effects: [], params: {} },
      ],
    },
  };
}
const layer = (s, id) => s.composition.layers.find((l) => l.id === id);
const clip = (s, lid, cid) => layer(s, lid).clips.find((c) => c.id === cid);

// --- address parsing: the five forms, 1-based deck indices --------------------

test('clip SOURCE param: 0..1 maps onto the manifest range of THAT clip generator', () => {
  // line.speed: min -5, max 5 (speed is symmetric now) → 0.5 → 0 (the middle). l1/c1.
  const r = routeOsc(show2(), null, '/layer/1/clip/1/speed', 0.5);
  assert.ok(r && r.show);
  assert.equal(clip(r.show, 'l1', 'c1').params['line.speed'], 0);
});

test('layer index 2 reaches the BOTTOM deck row (array start)', () => {
  // pulse.speed: min 0.1, max 4 → 1.0 → 4.
  const r = routeOsc(show2(), null, '/layer/2/clip/1/speed', 1);
  assert.equal(clip(r.show, 'l2', 'c3').params['pulse.speed'], 4);
});

test('clip transform: tf keys map onto the UI slider ranges', () => {
  let r = routeOsc(show2(), null, '/layer/1/clip/2/tf/x', 0.75);     // x ∈ [-1,1] → 0.5
  assert.equal(clip(r.show, 'l1', 'c2').transform.x, 0.5);
  r = routeOsc(show2(), null, '/layer/1/clip/2/tf/scale', 0.5);      // scale ∈ [0,3] → 1.5
  assert.equal(clip(r.show, 'l1', 'c2').transform.scale, 1.5);
  r = routeOsc(show2(), null, '/layer/1/clip/2/tf/rotation', 0);     // rotation ∈ [-180,180] → -180
  assert.equal(clip(r.show, 'l1', 'c2').transform.rotation, -180);
  r = routeOsc(show2(), null, '/layer/1/clip/2/tf/opacity', 0.25);   // opacity ∈ [0,1]
  assert.equal(clip(r.show, 'l1', 'c2').opacity, 0.25);
});

test('clip trigger: ≥0.5 fires, <0.5 is consumed as a no-op', () => {
  const s = show2();
  assert.deepEqual(routeOsc(s, null, '/layer/1/clip/2/trigger', 1),
    { trigger: { layerId: 'l1', clipId: 'c2' } });
  const off = routeOsc(s, null, '/layer/1/clip/2/trigger', 0.2);
  assert.equal(off.show, s);          // consumed, unchanged (no channel-store leak)
  assert.equal(off.trigger, undefined);
});

test('layer opacity: /layer/<n>/opacity writes 0..1 directly', () => {
  const r = routeOsc(show2(), null, '/layer/1/opacity', 0.3);
  assert.equal(layer(r.show, 'l1').opacity, 0.3);
});

test('non-canonical addresses fall through (null)', () => {
  const s = show2();
  assert.equal(routeOsc(s, null, '/fader1', 0.5), null);                   // free channel
  assert.equal(routeOsc(s, null, 'speed', 0.5), null);                     // no leading slash
  assert.equal(routeOsc(s, null, '/layer/9/clip/1/speed', 0.5), null);     // layer out of range
  assert.equal(routeOsc(s, null, '/layer/0/clip/1/speed', 0.5), null);     // 1-based, not 0
  assert.equal(routeOsc(s, null, '/layer/1/clip/7/speed', 0.5), null);     // clip out of range
  assert.equal(routeOsc(s, null, '/layer/1/clip/1/nosuch', 0.5), null);    // unknown param key
  assert.equal(routeOsc(s, null, '/layer/1/clip/1/tf/nope', 0.5), null);   // unknown tf key
  assert.equal(routeOsc(s, null, '/layer/1/clip/1/speed/extra', 0.5), null); // trailing junk
  assert.equal(routeOsc(s, null, '/layer/1/clip/1/speed', 'x'), null);     // non-numeric value
});

// --- range mapping: clamp + bool ----------------------------------------------

test('incoming values clamp to 0..1 before mapping', () => {
  let r = routeOsc(show2(), null, '/layer/1/clip/1/speed', 7);
  assert.equal(clip(r.show, 'l1', 'c1').params['line.speed'], 5);    // max
  r = routeOsc(show2(), null, '/layer/1/clip/1/speed', -3);
  assert.equal(clip(r.show, 'l1', 'c1').params['line.speed'], -5);    // min (speed symmetric)
});

test('bool params: ≥0.5 = true, <0.5 = false', () => {
  // pulse.autoFire is a bool (default false) — on the bottom row's clip.
  let r = routeOsc(show2(), null, '/layer/2/clip/1/autoFire', 0.9);
  assert.equal(clip(r.show, 'l2', 'c3').params['pulse.autoFire'], true);
  r = routeOsc(r.show, null, '/layer/2/clip/1/autoFire', 0.1);
  assert.equal(clip(r.show, 'l2', 'c3').params['pulse.autoFire'], false);
});

test('color params are not float-addressable → null', () => {
  const s = show2();
  s.composition.layers[1].clips[0] = makeClip('gradient', undefined, 'c1');
  assert.equal(routeOsc(s, null, '/layer/1/clip/1/colorA', 0.5), null);
});

// --- /selected/… alias ----------------------------------------------------------

test('/selected/<paramKey> resolves the selected clip at message time', () => {
  // c2 (radial) is selected: radial.width min 0.01 max 1 → 0.5 → 0.505.
  const r = routeOsc(show2(), 'c2', '/selected/width', 0.5);
  assert.equal(clip(r.show, 'l1', 'c2').params['radial.width'], 0.505);
});

test('/selected/tf/<key> routes the selected clip transform', () => {
  const r = routeOsc(show2(), 'c3', '/selected/tf/y', 1);    // y ∈ [-1,1] → 1
  assert.equal(clip(r.show, 'l2', 'c3').transform.y, 1);
});

test('/selected/… with no selection falls through (null)', () => {
  assert.equal(routeOsc(show2(), null, '/selected/speed', 0.5), null);
  assert.equal(routeOsc(show2(), 'gone', '/selected/speed', 0.5), null);
});

// --- addressFor round-trips through routeOsc -----------------------------------

test('addressFor builds canonical strings the router accepts', () => {
  const s = show2();
  const cases = [
    [addressFor({ kind: 'param', layerIndex: 1, clipIndex: 1, key: 'speed' }), '/layer/1/clip/1/speed'],
    [addressFor({ kind: 'tf', layerIndex: 1, clipIndex: 2, key: 'scale' }), '/layer/1/clip/2/tf/scale'],
    [addressFor({ kind: 'trigger', layerIndex: 2, clipIndex: 1 }), '/layer/2/clip/1/trigger'],
    [addressFor({ kind: 'layerOpacity', layerIndex: 2 }), '/layer/2/opacity'],
  ];
  for (const [addr, expect] of cases) {
    assert.equal(addr, expect);
    assert.notEqual(routeOsc(s, null, addr, 1), null, `router rejected ${addr}`);
  }
});
