// Volumetric sources e2e (Playwright, run manually):
//   node test/e2e/volumetric.e2e.mjs [screenshot-dir]
//
// Verifies, against the real app + GPU sampler:
//  1. 3D: a lifted arch with a Plane Sweep clip (axis z) — the band lights only
//     PART of the arch, moving `pos` moves the band (buffer changes), z=0 bars
//     stay dark, and the GPU bytes match the JS reference (evalPacked) exactly.
//  2. 2D: a plane sweep along X on a plain 2D show works on the z=0 plane.
//  3. UI: the source picker shows the "Volumetric" group; picking Plane Sweep
//     creates a clip whose cell carries the 3D badge.
//  4. The wall Preview (LED dots off the sampled buffer) shows the band —
//     screenshot saved for eyeballing.
//  5. No page errors anywhere along the way.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, openApp, stableRGBA, plainShow } from './helpers.mjs';
import { buildPipelineInputs } from '../../src/model/pipeline.js';
import { packVolumetrics, evalPacked } from '../../src/engine/fields.js';

const shotDir = process.argv[2] || 'test/e2e/shots';
mkdirSync(shotDir, { recursive: true });

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok  -', msg);

// A 3D show: nothing on the canvas (layer 1 ejected), one volumetric plane
// sweep (axis z) active — only the arch's lifted LEDs should light.
function volShow(pos) {
  const s = plainShow();
  s.composition.layers[0].activeClipId = null;
  s.composition.layers.push({
    id: 'l2', name: 'Vol', blend: 'add', opacity: 1, effects: [], params: {},
    clips: [{ id: 'v1', name: 'sweep', generator: 'planesweep',
      params: { 'planesweep.axis': 2, 'planesweep.pos': pos, 'planesweep.thickness': 0.3, 'planesweep.softness': 0, 'planesweep.color': '#00ff00' },
      effects: [] }],
    activeClipId: 'v1',
  });
  return s;
}

const srv = await startServer();
try {
  // --- 1. the lifted arch + z plane sweep at two positions -------------------
  const bufAt = async (pos) => {
    const { browser, page, errors } = await openApp(volShow(pos));
    const rgba = await stableRGBA(page);
    if (pos === 0.5) {
      // While we're here: wall Preview screenshot (LED dots off the sampled
      // buffer — volumetrics come for free) + the picker's Volumetric group.
      // Show fixture LEDs (in 3D mode the overlay is ALWAYS on — the button is
      // disabled — so only click it when it's actually a toggle).
      if (await page.locator('#overlay-toggle').isEnabled()) await page.click('#overlay-toggle');
      await page.click('#wall-btn');                  // wall view: dim composite, light the pixels
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(shotDir, 'preview-arch-sweep.png'), clip: { x: 300, y: 40, width: 1000, height: 620 } });
      // Picker: click an empty deck slot → the source picker must offer the
      // Volumetric group; pick Plane Sweep → a new clip cell with the 3D badge.
      const empty = page.locator('.clip-empty').first();
      await empty.click();
      const group = page.locator('.pick-group', { hasText: 'Volumetric' });
      if (await group.count() === 0) fail('picker: no "Volumetric" group'); else ok('picker shows the Volumetric group');
      await page.locator('.pick-item', { hasText: 'Plane Sweep' }).first().click();
      await page.waitForTimeout(200);
      if (await page.locator('.clip-vol').count() === 0) fail('new volumetric clip cell has no 3D badge');
      else ok('volumetric clip cell carries the 3D badge');
      await page.screenshot({ path: join(shotDir, 'deck-volumetric-clip.png') });
    }
    await browser.close();
    if (errors.length) fail(`page errors (pos=${pos}):\n  ` + errors.join('\n  '));
    return rgba;
  };

  const bufLow = await bufAt(0.15);
  const bufMid = await bufAt(0.5);
  if (bufLow.join(',') === bufMid.join(',')) fail('moving planesweep pos did not change the sampled buffer');
  else ok('sampled buffer changes between pos=0.15 and pos=0.5 (the band moves)');

  const { samplePositions, spans } = buildPipelineInputs(volShow(0.5));
  const arc = spans.find((s) => s.id === 'arc');
  const litIdx = [];
  for (let i = arc.start; i < arc.start + arc.count; i++) if (bufMid[i * 4 + 1] > 8) litIdx.push(i - arc.start);
  if (litIdx.length === 0 || litIdx.length === arc.count) fail(`band must light only PART of the arch (lit ${litIdx.length}/${arc.count})`);
  else ok(`band lights only part of the arch (${litIdx.length}/${arc.count} LEDs, indices ${litIdx[0]}–${litIdx[litIdx.length - 1]})`);
  // z=0 bars must be dark under a z-band at 0.5±0.15.
  const barLit = bufMid.slice(0, spans.find((s) => s.id === 'bar').count * 4).some((v, j) => j % 4 !== 3 && v > 0);
  if (barLit) fail('z=0 bar lit by a z band at 0.5'); else ok('z=0 bars stay dark under the z band');

  // GPU vs JS reference, byte-exact (base is black, blend add).
  const packed = packVolumetrics([{ generator: 'planesweep', params: volShow(0.5).composition.layers[1].clips[0].params, blend: 'add', opacity: 1 }]);
  let maxErr = 0;
  for (let i = 0; i < bufMid.length / 4; i++) {
    const f = evalPacked(packed, 0, [samplePositions[i * 3], samplePositions[i * 3 + 1], samplePositions[i * 3 + 2]], 0);
    for (let ch = 0; ch < 3; ch++) maxErr = Math.max(maxErr, Math.abs(bufMid[i * 4 + ch] - Math.round(f[ch] * 255)));
  }
  if (maxErr > 2) fail(`GPU vs JS reference mismatch (maxErr ${maxErr})`); else ok(`GPU matches the JS field reference (max channel error ${maxErr})`);

  // --- 2. plain 2D show: a plane sweep along X on the z=0 plane --------------
  const s2 = volShow(0.5);
  delete s2.composition.view3d;                                   // plain 2D
  s2.fixtures = s2.fixtures.filter((f) => f.id !== 'arc');        // 2D bars only
  Object.assign(s2.composition.layers[1].clips[0].params, { 'planesweep.axis': 0, 'planesweep.pos': 0.5, 'planesweep.thickness': 0.4 });
  {
    const { browser, page, errors } = await openApp(s2);
    const rgba = await stableRGBA(page);
    await page.screenshot({ path: join(shotDir, 'preview-2d-x-sweep.png') });
    await browser.close();
    if (errors.length) fail('page errors (2D show):\n  ' + errors.join('\n  '));
    // bar spans x 0.1..0.9 over 20 LEDs; the band |x−0.5| ≤ 0.2 lights the middle only.
    const g = [];
    for (let i = 0; i < 20; i++) g.push(rgba[i * 4 + 1]);
    const midLit = g[10] > 200, endsDark = g[0] === 0 && g[19] === 0;
    if (midLit && endsDark) ok('2D show: an X plane sweep lights the middle of the bar (z=0 plane works)');
    else fail(`2D X sweep wrong (g[0]=${g[0]} g[10]=${g[10]} g[19]=${g[19]})`);
  }

  writeFileSync(join(shotDir, 'README.txt'), 'screenshots from test/e2e/volumetric.e2e.mjs\n');
  console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK', '· screenshots in', shotDir);
} finally {
  srv.kill();
}
