import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture } from '../src/model/show.js';
import { buildPipelineInputs } from '../src/model/pipeline.js';
import { samplePoints } from '../src/model/sampling.js';
import { perspectiveCamera } from '../src/model/project3d.js';

// REGRESSION (critical): a normal 2D show (no composition.view3d) must produce
// UVs byte-identical to today — i.e. exactly samplePoints(input.points, samples)
// for each fixture, in device+pixelOffset order.
test('2D show UVs are unchanged (equal to raw samplePoints)', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  const aPts = [[0, 0], [0, 0.5], [0, 1]];
  const bPts = [[1, 0], [0.5, 0.5], [0, 1]];
  s = addFixture(s, { id: 'a', name: 'a', pixelCount: 3, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 3 },
    input: { mode: 'polyline', points: aPts, samples: 3 } });
  s = addFixture(s, { id: 'b', name: 'b', pixelCount: 4, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 3, pixelCount: 4 },
    input: { mode: 'polyline', points: bPts, samples: 4 } });

  const { sampleUVs, spans } = buildPipelineInputs(s);

  for (const [id, pts, samples] of [['a', aPts, 3], ['b', bPts, 4]]) {
    const sp = spans.find((x) => x.id === id);
    const slice = Array.from(sampleUVs.slice(sp.start * 2, (sp.start + sp.count) * 2));
    // The pipeline stores UVs in a Float32Array, so compare against the raw
    // double-precision sample points cast through Float32 the same way — this is
    // exactly today's output (no 3D path taken), i.e. byte-identical.
    const expect = Array.from(Float32Array.from(samplePoints(pts, samples).flat()));
    assert.equal(slice.length, expect.length);
    slice.forEach((v, i) => assert.equal(v, expect[i], `${id} uv[${i}]`));
  }
});

// FORESHORTENING: a strip tracing a semicircle in the X–Z plane, bulging toward
// −z away from the camera. The physically-even samples DON'T project to even
// screen spacing: where the arc curves INTO depth (its ends, tangent along ±z)
// it foreshortens to almost nothing on screen, while at the apex (tangent across
// screen, along x) it projects at full width. That end-vs-apex spacing contrast
// is the perspective signature — the flat 2D path gives uniform spacing.
test('3D perspective projection foreshortens an arc bending away in depth', () => {
  // Semicircle in X–Z plane: y fixed at 0.5, x sweeps 0→1, z dips to −0.5 at apex.
  // Parametrize by angle so points are physically even along the arc.
  const N = 41;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const ang = Math.PI * (k / (N - 1)); // 0..π
    const x = 0.5 - 0.5 * Math.cos(ang); // 0..1
    const z = -0.5 * Math.sin(ang);      // 0 → -0.5 (apex) → 0
    pts.push([x, 0.5, z]);
  }

  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: '10.0.0.11', colorOrder: 'GRB' });
  s = addFixture(s, { id: 'arc', name: 'arc', pixelCount: N, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: N },
    input: { mode: 'polyline', points: pts, samples: N } });
  s.composition = s.composition || {};
  s.composition.view3d = {
    mode: '3d',
    projectionCamera: perspectiveCamera({ pos: [0.5, 0.5, 1.5], target: [0.5, 0.5, 0], fov: 90, aspect: 1 }),
  };

  const { sampleUVs, spans } = buildPipelineInputs(s);
  const sp = spans.find((x) => x.id === 'arc');
  const uv = [];
  for (let i = sp.start; i < sp.start + sp.count; i++) uv.push([sampleUVs[i * 2], sampleUVs[i * 2 + 1]]);

  // All projected points must be finite (none behind the camera).
  for (const [u, v] of uv) assert.ok(Number.isFinite(u) && Number.isFinite(v));

  const spacing = (i) => Math.hypot(uv[i + 1][0] - uv[i][0], uv[i + 1][1] - uv[i][1]);
  // End spacing (first segment — the arc plunging into depth) vs apex spacing
  // (middle — running across the screen). Real perspective foreshortening ⇒ the
  // end is MEANINGFULLY compressed relative to the apex. The flat 2D path gives
  // uniform spacing (ratio ≈ 1), so a clear drop proves depth is being projected.
  const endSpacing = spacing(0);
  const mid = Math.floor((N - 1) / 2);
  const apexSpacing = spacing(mid);
  assert.ok(endSpacing / apexSpacing < 0.9,
    `end/apex spacing ratio ${endSpacing / apexSpacing} should be well below 1 (foreshortened into depth)`);

  // Sanity: the same fixture WITHOUT the 3D view (flat path) samples uniformly —
  // proving the contrast above comes from projection, not the arc geometry alone.
  const flat = structuredClone(s);
  delete flat.composition.view3d;
  const fr = buildPipelineInputs(flat);
  const fsp = fr.spans.find((x) => x.id === 'arc');
  const fuv = [];
  for (let i = fsp.start; i < fsp.start + fsp.count; i++) fuv.push([fr.sampleUVs[i * 2], fr.sampleUVs[i * 2 + 1]]);
  const fSpacing = (i) => Math.hypot(fuv[i + 1][0] - fuv[i][0], fuv[i + 1][1] - fuv[i][1]);
  assert.ok(fSpacing(0) / fSpacing(mid) > 0.98,
    'flat 2D path should sample the arc with near-uniform spacing');
});
