import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DMX_PROFILES, dmxProfile, dmxFootprint, resolveDmxChannels,
  colorFormatChannels, fixtureTypeChannels, fixtureParamChannelIndices } from '../src/model/dmx.js';

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

// --- Unified type → channel-block --------------------------------------------
test('colorFormatChannels maps each letter to a colour channel', () => {
  assert.deepEqual(colorFormatChannels('RGB').map((c) => c.kind), ['red', 'green', 'blue']);
  assert.deepEqual(colorFormatChannels('GRBW').map((c) => c.kind), ['green', 'red', 'blue', 'white']);
  assert.deepEqual(colorFormatChannels('RGBWA').map((c) => c.kind), ['red', 'green', 'blue', 'white', 'amber']);
  // '' (inherit from controller) defaults to plain RGB so a layout always has colour.
  assert.deepEqual(colorFormatChannels('').map((c) => c.kind), ['red', 'green', 'blue']);
  // 'NONE' = a params-only fixture (dimmer/generic): no colour channels.
  assert.deepEqual(colorFormatChannels('NONE'), []);
});

test('fixtureTypeChannels: a NONE (params-only) type is just its parameters', () => {
  const dimmer = { colorFormat: 'NONE', params: [{ name: 'Dimmer', kind: 'dimmer', value: 0 }] };
  assert.deepEqual(fixtureTypeChannels(dimmer), [{ kind: 'dimmer' }]);
});

test('fixtureParamChannelIndices: each param maps to its channel index in the block', () => {
  // 8-CH RGBWA: Dimming(before), Strobe(before), UV(after) → channels 0,1,[2..6],7
  const par = { colorFormat: 'RGBWA', params: [
    { name: 'Dimming', kind: 'fixed', value: 255, before: true },
    { name: 'Strobe', kind: 'fixed', value: 0, before: true },
    { name: 'UV', kind: 'fixed', value: 0, before: false },
  ] };
  assert.deepEqual(fixtureParamChannelIndices(par), [0, 1, 7]);
  // FOS 6-CH (RGBWA + UV after) → UV is channel index 5
  const fos = { colorFormat: 'RGBWA', params: [{ name: 'UV', kind: 'fixed', value: 0, before: false }] };
  assert.deepEqual(fixtureParamChannelIndices(fos), [5]);
});

test('resolveDmxChannels: an override drives ANY channel kind (manual fader)', () => {
  const prof = { channels: fixtureTypeChannels({ colorFormat: 'RGB', params: [{ name: 'Dimmer', kind: 'dimmer', before: true }] }) };
  // channels: [dimmer, red, green, blue]; override the dimmer (index 0) to 100
  const out = [...resolveDmxChannels(prof, [255, 0, 0], { 0: 100 })];
  assert.equal(out[0], 100);                 // manual dimmer override wins over computed
  // override a colour channel too (red index 1 → 50, overriding sampled 255)
  assert.equal([...resolveDmxChannels(prof, [255, 0, 0], { 1: 50 })][1], 50);
});

test('fixtureTypeChannels: params can sit BEFORE and AFTER the pixel block (8-ch spec)', () => {
  // The exact Resolume 8-CH RGBWA par: Dimming, Strobe, [R G B W A], UV.
  const par = { colorFormat: 'RGBWA', params: [
    { name: 'Dimming', kind: 'fixed', value: 255, before: true },
    { name: 'Strobe', kind: 'fixed', value: 0, before: true },
    { name: 'UV', kind: 'fixed', value: 0, before: false },
  ] };
  assert.deepEqual(fixtureTypeChannels(par), [
    { kind: 'fixed', value: 255 },   // 1 Dimming
    { kind: 'fixed', value: 0 },     // 2 Strobe
    { kind: 'red' }, { kind: 'green' }, { kind: 'blue' }, { kind: 'white' }, { kind: 'amber' },  // 3-7
    { kind: 'fixed', value: 0 },     // 8 UV
  ]);
});

test('fixtureTypeChannels = colour channels then Parameters', () => {
  const type = { colorFormat: 'RGBW', params: [
    { name: 'Dimmer', kind: 'dimmer', value: 0 },
    { name: 'Strobe', kind: 'fixed', value: 128 },
  ] };
  assert.deepEqual(fixtureTypeChannels(type), [
    { kind: 'red' }, { kind: 'green' }, { kind: 'blue' }, { kind: 'white' },
    { kind: 'dimmer' }, { kind: 'fixed', value: 128 },
  ]);
  // A pure colour fixture (no params, inherited format) is just RGB.
  assert.deepEqual(fixtureTypeChannels({}), [{ kind: 'red' }, { kind: 'green' }, { kind: 'blue' }]);
  // The derived block resolves end-to-end: RGBW pull + dimmer + fixed default.
  const out = [...resolveDmxChannels({ channels: fixtureTypeChannels(type) }, [100, 100, 80])];
  // white=min(100,100,80)=80 (rgb→20,20,0); dimmer=max(20,20,0,80)=80, colour ×255/80.
  assert.deepEqual(out, [64, 64, 0, 255, 80, 128]);
});
