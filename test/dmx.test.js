import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DMX_PROFILES, dmxProfile, dmxFootprint, resolveDmxChannels } from '../src/model/dmx.js';

const prof = (id) => dmxProfile(id);

test('built-in profiles + footprint', () => {
  assert.equal(dmxFootprint(prof('rgb')), 3);
  assert.equal(dmxFootprint(prof('rgbw')), 4);
  assert.equal(dmxFootprint(prof('dimmer')), 1);
  assert.ok(DMX_PROFILES.some((p) => p.id === 'generic'));
});

test('RGB par: colour passes straight through (carries brightness)', () => {
  assert.deepEqual([...resolveDmxChannels(prof('rgb'), [100, 50, 0])], [100, 50, 0]);
});

test('RGBW par: white pulls the shared component out of RGB', () => {
  // min(100,100,80)=80 → W=80, RGB become 20,20,0
  assert.deepEqual([...resolveDmxChannels(prof('rgbw'), [100, 100, 80])], [20, 20, 0, 80]);
});

test('Dimmer + RGB: dimmer carries brightness, colour normalises to full', () => {
  // max=100 → dimmer=100, colour scaled ×2.55 → 255,128,0 (dimmer×colour ≈ original)
  assert.deepEqual([...resolveDmxChannels(prof('dimrgb'), [100, 50, 0])], [100, 255, 127, 0]);
});

test('Dimmer alone = brightness (max of rgb)', () => {
  assert.deepEqual([...resolveDmxChannels(prof('dimmer'), [10, 200, 30])], [200]);
});

test('RGBA par: amber pulls min(r,g)', () => {
  // min(120,80)=80 → amber=80, r=40,g=0,b=0
  assert.deepEqual([...resolveDmxChannels(prof('rgba'), [120, 80, 0])], [40, 0, 0, 80]);
});

test('fixed channel uses its value, overridable', () => {
  const p = { channels: [{ kind: 'fixed', value: 200 }, { kind: 'red' }] };
  assert.deepEqual([...resolveDmxChannels(p, [50, 0, 0])], [200, 50]);
  assert.deepEqual([...resolveDmxChannels(p, [50, 0, 0], { 0: 10 })], [10, 50]);
});
