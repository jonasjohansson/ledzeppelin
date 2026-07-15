import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture } from '../src/model/show.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';
import { samplePoints3D } from '../src/model/sampling.js';

// samplePositions: per-LED WORLD xyz alongside sampleUVs — the volumetric field
// pass evaluates fields at these. Layout invariant: 3 floats per LED, exactly
// the LED order of the uv pairs (count×3 vs count×2).

const strip = (id, points, samples, extra = {}) => ({
  id, name: id, pixelCount: samples, colorOrder: 'GRB',
  output: { deviceId: 'c1', pixelOffset: 0, pixelCount: samples },
  input: { mode: 'polyline', points, samples }, ...extra,
});

function baseShow(fx) {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  for (const f of fx) s = addFixture(s, f);
  return s;
}

test('samplePositions parallels sampleUVs: count×3 vs count×2, same LED order', () => {
  const s = baseShow([strip('a', [[0, 0], [1, 1]], 5)]);
  const { sampleUVs, samplePositions } = buildPipelineInputs(s);
  assert.equal(sampleUVs.length, 5 * 2);
  assert.equal(samplePositions.length, 5 * 3);
  // 2D strip: positions are the 2D sample points on the canvas plane (z = 0).
  for (let i = 0; i < 5; i++) {
    assert.equal(samplePositions[i * 3], sampleUVs[i * 2], `x[${i}]`);
    assert.equal(samplePositions[i * 3 + 1], sampleUVs[i * 2 + 1], `y[${i}]`);
    assert.equal(samplePositions[i * 3 + 2], 0, `z[${i}]`);
  }
});

test('a lifted arch in 3D carries real z (samplePoints3D before projection)', () => {
  const pts = [[0.2, 0.8, 0], [0.5, 0.8, 0.5], [0.8, 0.8, 0]];   // lifted midpoint
  const s = baseShow([strip('arc', pts, 7)]);
  s.composition.view3d = { mode: '3d' };   // 3D mode = the fixed front-ortho camera
  const { sampleUVs, samplePositions, spans } = buildPipelineInputs(s);
  const sp = spans.find((x) => x.id === 'arc');
  assert.equal(sp.count, 7);
  assert.equal(samplePositions.length, sampleUVs.length / 2 * 3);
  // Positions = the raw 3D arc-length resample, unprojected — with z RESCALED so the
  // rig's highest point sits at z = 1 ("volume height fits the rig", v1.0.551).
  const expect = samplePoints3D(pts, 7);
  const zMax = Math.max(...expect.map((p) => Math.abs(p[2])));
  for (let i = 0; i < 7; i++) {
    assert.equal(samplePositions[i * 3], Math.fround(expect[i][0]), `x[${i}]`);
    assert.equal(samplePositions[i * 3 + 1], Math.fround(expect[i][1]), `y[${i}]`);
    assert.equal(samplePositions[i * 3 + 2], Math.fround(Math.fround(expect[i][2]) / zMax), `z[${i}]`);
  }
  // The apex actually left the plane — and after the rescale it IS the volume top.
  const zs = [];
  for (let i = 0; i < 7; i++) zs.push(samplePositions[i * 3 + 2]);
  assert.ok(Math.abs(Math.max(...zs) - 1) < 1e-6, 'arch apex sits at z = 1');
});

test('a plain 2D show is all z = 0 (and chain-free positions equal the UVs)', () => {
  const s = baseShow([
    strip('a', [[0, 0], [1, 0]], 3),
    { id: 'g', name: 'g', pixelCount: 4, colorOrder: 'GRB', cols: 2, rows: 2,
      output: { deviceId: 'c1', pixelOffset: 3, pixelCount: 4 },
      input: { mode: 'grid', transform: { x: 0, y: 0, w: 640, h: 360, rotation: 0 }, samples: 4 } },
  ]);
  const { samplePositions } = buildPipelineInputs(s);
  assert.equal(samplePositions.length, (3 + 4) * 3);
  for (let i = 0; i < 7; i++) assert.equal(samplePositions[i * 3 + 2], 0, `z[${i}]`);
});

test('a DMX fixture contributes its centre at z = 0', () => {
  const s = {
    composition: { canvas: { w: 100, h: 100 } },
    devices: [{ id: 'a1', ip: '2.0.0.1', protocol: 'artnet', universe: 0 }],
    fixtures: [{
      id: 'par', output: { deviceId: 'a1' },
      input: { transform: { x: 50, y: 50 }, points: [[0.5, 0.5]], dmx: { profileId: 'rgb', universe: 2, address: 5 } },
    }],
  };
  const { sampleUVs, samplePositions } = buildPipelineInputs(s);
  assert.equal(sampleUVs.length, 2);
  assert.deepEqual([...samplePositions], [sampleUVs[0], sampleUVs[1], 0]);
});

test('chain stagger shifts the UVs but never the world positions', () => {
  const s = {
    devices: [{ id: 'd1', port: 4048, colorOrder: 'GRB' }],
    fixtures: [
      { id: 'a', output: { deviceId: 'd1', port: 1, pixelOffset: 0, pixelCount: 1 }, input: { points: [[0.2, 0.5], [0.2, 0.5]], samples: 1 } },
      { id: 'b', output: { deviceId: 'd1', port: 1, pixelOffset: 1, pixelCount: 1 }, input: { points: [[0.2, 0.5], [0.2, 0.5]], samples: 1 } },
    ],
    chainSettings: { 'd1:1': { stagger: 0.1, axis: 'x' } },
  };
  const { sampleUVs, samplePositions } = buildPipelineInputs(s);
  // Fixture b (run index 1) SAMPLES shifted by +0.1 in u…
  assert.ok(Math.abs(sampleUVs[2] - 0.3) < 1e-6);
  // …but its world position is its true geometry (u = 0.2, unshifted).
  assert.ok(Math.abs(samplePositions[3] - 0.2) < 1e-6);
  assert.equal(samplePositions[5], 0);
});
