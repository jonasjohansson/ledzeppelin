import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture } from '../src/model/show.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';
import { fixtureBand, fixtureBandIndex, BAND_INDEX } from '../src/model/audio-bands.js';
import { audiobars, packVolumetrics, evalPacked, FIELD_IDS } from '../src/engine/fields.js';
import { hexToRgb } from '../src/engine/shaders/manifest.js';

// --- fixtureBand: name → band ------------------------------------------------

test('fixtureBand: maps names to bands by keyword (tail→bass, rib→mid, fin→high)', () => {
  assert.equal(fixtureBand('Tail'), 'bass');
  assert.equal(fixtureBand('tail fin'), 'bass');        // tail wins (higher priority)
  assert.equal(fixtureBand('Rib 7'), 'mid');
  assert.equal(fixtureBand('Left Fin'), 'high');
  assert.equal(fixtureBand('Dorsal Fin'), 'high');
  assert.equal(fixtureBand('Spline A'), 'mid');
});

test('fixtureBand: unmatched / blank names default to mid', () => {
  assert.equal(fixtureBand('Nose'), 'mid');
  assert.equal(fixtureBand(''), 'mid');
  assert.equal(fixtureBand(undefined), 'mid');
  assert.equal(fixtureBand(null), 'mid');
});

test('fixtureBand: an explicit override wins over the name rule', () => {
  assert.equal(fixtureBand('Tail', 'high'), 'high');
  assert.equal(fixtureBand('Rib 1', 'bass'), 'bass');
  // 'auto' / junk overrides fall through to the name rule.
  assert.equal(fixtureBand('Tail', 'auto'), 'bass');
  assert.equal(fixtureBand('Tail', 'nonsense'), 'bass');
  assert.equal(fixtureBand('Fin', undefined), 'high');
});

test('fixtureBandIndex: numeric 0/1/2 mirrors fixtureBand', () => {
  assert.equal(fixtureBandIndex('Tail'), 0);
  assert.equal(fixtureBandIndex('Rib 3'), 1);
  assert.equal(fixtureBandIndex('Fin'), 2);
  assert.equal(fixtureBandIndex('Tail', 'mid'), BAND_INDEX.mid);
  assert.deepEqual(BAND_INDEX, { bass: 0, mid: 1, high: 2 });
});

// --- per-LED band array (pipeline) -------------------------------------------

const strip = (id, name, samples, extra = {}) => ({
  id, name, pixelCount: samples, colorOrder: 'GRB',
  output: { deviceId: 'c1', pixelOffset: 0, pixelCount: samples },
  input: { mode: 'polyline', points: [[0, 0], [1, 1]], samples }, ...extra,
});

function baseShow(fx) {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  for (const f of fx) s = addFixture(s, f);
  return s;
}

test('sampleBands: one band index per LED, in LED order, mirroring sampleUVs', () => {
  const s = baseShow([
    strip('a', 'Tail', 3),        // bass = 0
    strip('b', 'Rib 2', 2),       // mid  = 1
    strip('c', 'Left Fin', 4),    // high = 2
  ]);
  const { sampleUVs, sampleBands } = buildPipelineInputs(s);
  assert.equal(sampleBands.length, sampleUVs.length / 2);   // one scalar per LED
  assert.deepEqual([...sampleBands], [0, 0, 0, 1, 1, 2, 2, 2, 2]);
});

test('sampleBands: a per-fixture audioBand override beats the name', () => {
  const s = baseShow([
    strip('a', 'Tail', 2, { audioBand: 'high' }),   // override → 2
    strip('b', 'Nose', 2),                          // default → mid = 1
  ]);
  const { sampleBands } = buildPipelineInputs(s);
  assert.deepEqual([...sampleBands], [2, 2, 1, 1]);
});

// --- audiobars field twin ----------------------------------------------------

test('audiobars: brightness = clamp(floor + level·gain); premultiplied', () => {
  const bands = [0.4, 0.2, 0.8];   // bass, mid, high
  // bass LED (band 0) reads bands[0]=0.4 → v = 0.1 + 0.4*2 = 0.9, colour = colorA.
  const bass = audiobars(0, bands, { gain: 2, floor: 0.1, colorA: [1, 0, 0], colorB: [0, 0, 1] });
  assert.ok(Math.abs(bass[3] - 0.9) < 1e-9);
  assert.deepEqual([bass[0], bass[1], bass[2]], [0.9, 0, 0]);   // premultiplied red
  // high LED (band 2) reads bands[2]=0.8 → clamp(0.1 + 1.6) = 1, colour = colorB.
  const high = audiobars(2, bands, { gain: 2, floor: 0.1, colorA: [1, 0, 0], colorB: [0, 0, 1] });
  assert.equal(high[3], 1);
  assert.deepEqual([high[0], high[1], high[2]], [0, 0, 1]);
});

test('audiobars: mid band reads bands[1] and colours as the A/B midpoint', () => {
  const mid = audiobars(1, [1, 0.5, 1], { gain: 1, floor: 0, colorA: [1, 0, 0], colorB: [0, 0, 1] });
  assert.ok(Math.abs(mid[3] - 0.5) < 1e-9);          // level = bands[1] = 0.5
  // straight colour = midpoint (0.5,0,0.5); premultiplied by 0.5 → (0.25,0,0.25).
  assert.ok(Math.abs(mid[0] - 0.25) < 1e-9 && mid[1] === 0 && Math.abs(mid[2] - 0.25) < 1e-9);
});

test('audiobars: only the LED\'s own band drives it (bass on, mid/high off)', () => {
  const bands = [1, 0, 0];   // bass hit only
  assert.equal(audiobars(0, bands, { gain: 1, floor: 0 })[3], 1);   // bass LED lit
  assert.equal(audiobars(1, bands, { gain: 1, floor: 0 })[3], 0);   // mid LED dark
  assert.equal(audiobars(2, bands, { gain: 1, floor: 0 })[3], 0);   // high LED dark
});

test('audiobars: packs into A=(gain,floor) + colA/colB and round-trips via evalPacked', () => {
  const p = packVolumetrics([{ generator: 'audiobars',
    params: { 'audiobars.gain': 2, 'audiobars.floor': 0.1, 'audiobars.colorA': '#ff0000', 'audiobars.colorB': '#0000ff' },
    blend: 'add', opacity: 1 }]);
  assert.equal(p.meta[0], FIELD_IDS.audiobars);
  assert.deepEqual([...p.a.slice(0, 4)], [2, Math.fround(0.1), 0, 0]);
  assert.deepEqual([...p.colA.slice(0, 3)], hexToRgb('#ff0000'));
  assert.deepEqual([...p.colB.slice(0, 3)], hexToRgb('#0000ff'));
  const bands = [0.5, 0.25, 0.75];
  for (const band of [0, 1, 2]) {
    const got = evalPacked(p, 0, [0, 0, 0], 0, [], band, bands);
    const want = audiobars(band, bands, { gain: 2, floor: Math.fround(0.1), colorA: [1, 0, 0], colorB: [0, 0, 1] });
    got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-6, `${got} != ${want}`));
  }
});
