import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasRemoteControl, toggleRemoteControl, buildRemoteManifest } from '../src/model/remote.js';
import { routeOsc } from '../src/model/osc-map.js';
import { makeClip } from '../src/model/layers.js';

// Deck order: /layer/1 = TOP = last array entry.
function show2() {
  return {
    composition: {
      canvas: { w: 1280, h: 720 },
      layers: [
        { id: 'l2', name: 'Layer 2', blend: 'alpha', opacity: 0.5, transitionMs: 500,
          clips: [makeClip('pulse', undefined, 'c3')], activeClipId: 'c3', effects: [], params: {} },
        { id: 'l1', name: 'Layer 1', blend: 'alpha', opacity: 0.5, bypass: true, transitionMs: 500,
          clips: [makeClip('line', undefined, 'c1'), makeClip('radial', undefined, 'c2')],
          activeClipId: 'c1', effects: [], params: {} },
      ],
    },
  };
}

test('toggleRemoteControl adds then removes an address (tick order preserved)', () => {
  let s = show2();
  assert.equal(hasRemoteControl(s, '/layer/1/clip/1/speed'), false);
  s = toggleRemoteControl(s, '/layer/1/clip/1/speed');
  s = toggleRemoteControl(s, '/layer/1/clip/1/width');
  assert.deepEqual(s.remote.controls, ['/layer/1/clip/1/speed', '/layer/1/clip/1/width']);
  assert.equal(hasRemoteControl(s, '/layer/1/clip/1/speed'), true);
  s = toggleRemoteControl(s, '/layer/1/clip/1/speed');           // untick
  assert.deepEqual(s.remote.controls, ['/layer/1/clip/1/width']);
});

test('buildRemoteManifest emits master layers (opacity + bypass + clip grid)', () => {
  const m = buildRemoteManifest(show2());
  assert.equal(m.layers.length, 2);
  // /layer/1 is the TOP row = l1
  assert.equal(m.layers[0].n, 1);
  assert.equal(m.layers[0].name, 'Layer 1');
  assert.equal(m.layers[0].bypass, true);
  assert.equal(m.layers[0].opacity, 0.5);
  assert.deepEqual(m.layers[0].clips.map((c) => c.m), [1, 2]);
  assert.equal(m.layers[0].clips[0].active, true);   // c1 is active
});

test('buildRemoteManifest resolves ticked custom params with label + range + value', () => {
  let s = show2();
  s = toggleRemoteControl(s, '/layer/1/clip/1/speed');   // line.speed: 0..5, default 1
  const m = buildRemoteManifest(s);
  assert.equal(m.controls.length, 1);
  const c = m.controls[0];
  assert.equal(c.address, '/layer/1/clip/1/speed');
  assert.equal(c.kind, 'param');
  assert.equal(c.min, 0); assert.equal(c.max, 5); assert.equal(c.value, 1);
  assert.match(c.label, /Speed/);
});

test('buildRemoteManifest drops a ticked address whose clip no longer exists', () => {
  let s = show2();
  s = toggleRemoteControl(s, '/layer/9/clip/9/speed');   // nonexistent
  assert.deepEqual(buildRemoteManifest(s).controls, []);
});

test('a phone-style /layer/n/bypass message toggles the layer bypass', () => {
  const r = routeOsc(show2(), null, '/layer/1/bypass', 0);   // un-bypass l1
  assert.ok(r && r.show);
  assert.equal(r.show.composition.layers.find((l) => l.id === 'l1').bypass, false);
  const r2 = routeOsc(show2(), null, '/layer/2/bypass', 1);  // bypass l2
  assert.equal(r2.show.composition.layers.find((l) => l.id === 'l2').bypass, true);
});
