// MULTI-SELECT bulk arc e2e (Playwright, run manually):
//   node test/e2e/multiarc.e2e.mjs [screenshot-dir]
//
// The user goal end-to-end: three strips spread across the canvas → select all
// → in the MULTI editor set Width, lift with Z, flip the whole selection to
// BEZIER, then type ONE shared "Arc Z" — all three stand up as arches.
//  1. Range-select via the list (click first row, shift-click last) → "3 fixtures".
//  2. X is "— mixed —" (they're spread), Width commits to ALL (one undo entry).
//  3. Z lifts every strip (each fixture's points carry z).
//  4. Shape row → Bezier converts ALL (c seeded at the chord midpoint, z carried).
//  5. Arc Z = one shared value → every input.bezier.c[2] matches; screenshot of
//     the 3D viewport shows three arches.
//  6. Cmd+Z restores the pre-Arc-Z control height (one snapshot per commit).
//  7. No page errors anywhere along the way.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, openApp, stableRGBA } from './helpers.mjs';

const PORT = 7317;                       // unique — never collides with other e2e daemons
const shotDir = process.argv[2] || 'test/e2e/shots';
mkdirSync(shotDir, { recursive: true });

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok  -', msg);

// Three flat bars spread across the canvas (different X AND Y), 3D mode on so
// the arches are visible in the viewport. Canvas 640×360 → px/normalized is easy
// arithmetic: Z 72px = 0.2, Arc Z 126px = 0.35.
function threeStrips() {
  return {
    version: 1, deviceTypes: [], devices: [], fixtureTypes: [],
    fixtures: [
      { id: 's1', name: 's1', pixelCount: 20, output: {}, input: { points: [[0.15, 0.30], [0.55, 0.30]], samples: 20 } },
      { id: 's2', name: 's2', pixelCount: 20, output: {}, input: { points: [[0.25, 0.55], [0.65, 0.55]], samples: 20 } },
      { id: 's3', name: 's3', pixelCount: 20, output: {}, input: { points: [[0.35, 0.80], [0.75, 0.80]], samples: 20 } },
    ],
    composition: {
      canvas: { w: 640, h: 360 },
      blendV2: true, opacityV2: true, opacity: 1,
      view3d: {
        mode: '3d',
        projectionCamera: { mode: 'ortho', pos: [0.5, 0.5, -1], target: [0.5, 0.5, 0], up: [0, -1, 0], orthoHeight: 1, aspect: 1, preset: 'front' },
        orbit: { az: -30, el: 20, dist: 1.6 },
      },
      layers: [{
        id: 'l1', name: 'Layer 1', blend: 'alpha', opacity: 1, effects: [], params: {},
        clips: [{ id: 'c1', name: 'wash', generator: 'solid', params: { 'solid.color': '#4060c0', 'solid.level': 0.8 }, effects: [] }],
        activeClipId: 'c1',
      }],
    },
  };
}

const srv = await startServer(PORT);
const { browser, page, errors } = await openApp(threeStrips(), PORT);
try {
  await stableRGBA(page);

  // The multi editor's fields, addressed by their exact label.
  const field = (label) => page.locator(`#fxinsp-body .fx-field:has(span:text-is("${label}")) input`);
  const fixtures = () => page.evaluate(() => window.__lz.show().fixtures);
  // Commit a value into a labelled field. Each commit is > 500 ms apart so undo
  // snapshots never coalesce (one entry per field edit, not per test run).
  const commit = async (label, v) => {
    await field(label).fill(String(v));
    await field(label).press('Enter');
    await page.waitForTimeout(650);
  };

  // --- 1. select all three via the list (click + shift-click range) -----------
  await page.locator('[data-fxid="s1"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-fxid="s3"]').click({ modifiers: ['Shift'] });
  await page.waitForTimeout(300);
  const nSel = await page.locator('.output-row.selected').count();
  if (nSel === 3) ok('range select → all 3 rows selected');
  else fail(`range select picked ${nSel} rows`);
  if (await page.locator('#fxinsp-body .shape-row').count()) ok('multi editor up (shape row present)');
  else fail('multi editor / shape row not shown for the multi-selection');

  // --- 2. mixed dimming + bulk Width ------------------------------------------
  const xMixed = await page.locator('#fxinsp-body .fx-field.is-mixed:has(span:text-is("X"))').count();
  if (xMixed === 1) ok('X shows "— mixed —" (strips are spread)');
  else fail('X not flagged mixed despite differing positions');
  await commit('Width', 200);
  let fx = await fixtures();
  if (fx.every((f) => f.input.transform?.w === 200)) ok('Width=200 resized all three');
  else fail('Width did not apply to all: ' + fx.map((f) => f.input.transform?.w).join(','));

  // --- 3. bulk Z lifts every strip (72 px on a 360-high canvas = z 0.2) --------
  await commit('Z', 72);
  fx = await fixtures();
  if (fx.every((f) => (f.input.points || []).every((p) => p[2] === 0.2))) ok('Z=72px lifted all points to z 0.2');
  else fail('Z lift wrong: ' + JSON.stringify(fx.map((f) => f.input.points)));

  // --- 4. shape row → Bezier converts ALL selected ------------------------------
  await page.locator('#fxinsp-body .shape-row button:text-is("Bezier")').click();
  await page.waitForTimeout(650);
  fx = await fixtures();
  if (fx.every((f) => f.input.mode === 'bezier' && Array.isArray(f.input.bezier?.c))) ok('Bezier converted all three (c seeded)');
  else fail('bezier conversion incomplete: ' + fx.map((f) => f.input.mode).join(','));
  if (fx.every((f) => f.input.bezier.c[2] === 0.2)) ok('seeded controls carried the z 0.2 lift');
  else fail('control z not carried: ' + fx.map((f) => f.input.bezier.c[2]).join(','));
  const bez = await page.locator('#fxinsp-body .shape-row button:text-is("Bezier")').getAttribute('class');
  if (bez.includes('on')) ok('shape row highlights the shared Bezier mode');
  else fail('Bezier button not highlighted after bulk convert');

  // --- 5. ONE shared Arc Z stands them all up (126 px = 0.35) -------------------
  await commit('Arc Z', 126);
  fx = await fixtures();
  if (fx.every((f) => f.input.mode === 'bezier' && f.input.bezier.c[2] === 0.35)) ok('Arc Z=126px → every c[2] = 0.35 (three standing arches)');
  else fail('Arc Z wrong: ' + fx.map((f) => f.input.bezier?.c?.[2]).join(','));
  if (fx.every((f) => (f.input.points || []).every((p) => p[2] === 0.2))) ok('Arc Z left the endpoints untouched');
  else fail('Arc Z moved the endpoints');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shotDir, 'multiarc-arches.png'), clip: { x: 300, y: 40, width: 1000, height: 620 } });
  ok('screenshot: multiarc-arches.png (3D viewport, three arches)');

  // --- 6. undo = one snapshot per field commit ----------------------------------
  await page.evaluate(() => document.activeElement?.blur());   // Cmd+Z is ignored while typing in a field
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  fx = await fixtures();
  if (fx.every((f) => f.input.bezier?.c?.[2] === 0.2)) ok('undo restored the pre-Arc-Z controls in one step');
  else fail('undo did not restore Arc Z: ' + fx.map((f) => f.input.bezier?.c?.[2]).join(','));
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  fx = await fixtures();
  if (fx.every((f) => f.input.mode !== 'bezier')) ok('second undo reverted the bulk Bezier conversion');
  else fail('second undo left beziers: ' + fx.map((f) => f.input.mode).join(','));

  if (errors.length) fail('page errors: ' + errors.join(' | '));
  else ok('no page errors');
} finally {
  await browser.close();
  srv.kill();
}
console.log(process.exitCode ? 'MULTI ARC E2E: FAIL' : 'MULTI ARC E2E: PASS');
