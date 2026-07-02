// Volumetric FIELD GHOSTS e2e (Playwright, run manually):
//   node test/e2e/fieldghosts.e2e.mjs [screenshot-dir]
//
// Verifies, against the real app, that the 3D viewport draws a schematic ghost
// of each active volumetric field (preview.js drawFieldGhosts):
//  1. A plane-sweep clip (axis z) ghosts as a translucent quad hovering over
//     the canvas grid; moving `pos` moves the quad up/down on screen.
//  2. The FIELDS chip (projection row) toggles the ghosts off/on and persists.
//  3. A sphere-pulse clip ghosts as wireframe rings.
//  4. 2D mode never draws ghosts.
//  5. No page errors anywhere along the way.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, openApp, stableRGBA, plainShow } from './helpers.mjs';

const PORT = 7284;                       // unique — never collides with other e2e daemons
const shotDir = process.argv[2] || 'test/e2e/shots';
mkdirSync(shotDir, { recursive: true });

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok  -', msg);

// A show with layer 1 silent and one volumetric clip active.
function volShow(generator, params, { mode3d = true } = {}) {
  const s = plainShow();
  s.composition.layers[0].activeClipId = null;
  if (!mode3d) delete s.composition.view3d;
  s.composition.layers.push({
    id: 'l2', name: 'Vol', blend: 'add', opacity: 1, effects: [], params: {},
    clips: [{ id: 'v1', name: 'vol', generator, params, effects: [] }],
    activeClipId: 'v1',
  });
  return s;
}
const sweepShow = (pos, opts) => volShow('planesweep', {
  'planesweep.axis': 2, 'planesweep.pos': pos, 'planesweep.thickness': 0.3,
  'planesweep.softness': 0, 'planesweep.color': '#00ff00',
}, opts);

// Count ghost-coloured pixels on the #preview overlay canvas (where the ghosts
// draw) and their y centroid. `chan` picks the signature: green (plane) or
// magenta (sphere) — chosen so nothing else in the scene matches.
async function ghostPixels(page, chan) {
  return page.evaluate((c) => {
    const cv = document.getElementById('preview');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, sy = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 4) continue;
      const hit = c === 'green' ? (g > 150 && r < 80 && b < 80)
        // The z arrow samples the REAL ramp: z tops out at 0.6 → b ≈ 153, so a
        // lower bar than the pure-colour signatures.
        : c === 'blue' ? (b > 110 && r < 60 && g < 60)
        : (r > 150 && b > 150 && g < 80);
      if (hit) { n++; sy += ((i / 4) / cv.width) | 0; }
    }
    return { n, cy: n ? sy / n : 0 };
  }, chan);
}
const shoot = (page, name) => page.screenshot({ path: join(shotDir, name), clip: { x: 300, y: 40, width: 1000, height: 620 } });

const srv = await startServer(PORT);
try {
  // --- 1. plane-sweep ghost present, and it MOVES with pos --------------------
  const quadAt = async (pos, name) => {
    const { browser, page, errors } = await openApp(sweepShow(pos), PORT);
    await stableRGBA(page);
    await page.waitForTimeout(300);
    const px = await ghostPixels(page, 'green');
    if (name) await shoot(page, name);
    const out = { px, page, browser, errors };
    return out;
  };

  const lo = await quadAt(0.1, 'ghost-plane-pos10.png');
  if (lo.px.n > 3000) ok(`plane ghost visible at pos 0.1 (${lo.px.n} px)`);
  else fail(`plane ghost too small/absent at pos 0.1 (${lo.px.n} px)`);

  // --- 2. FIELDS chip toggles the ghost off/on (and persists) -----------------
  const chip = lo.page.locator('#field-ghosts-btn');
  if (await chip.isVisible()) ok('FIELDS chip visible in the 3D projection row');
  else fail('FIELDS chip not visible in 3D mode');
  await chip.click(); await lo.page.waitForTimeout(250);
  const offPx = await ghostPixels(lo.page, 'green');
  if (offPx.n < lo.px.n * 0.2) ok(`FIELDS off hides the ghost (${lo.px.n} → ${offPx.n} px)`);
  else fail(`FIELDS off left ghost pixels (${lo.px.n} → ${offPx.n} px)`);
  const stored = await lo.page.evaluate(() => localStorage.getItem('lz.fieldghosts'));
  if (stored === '0') ok('lz.fieldghosts persisted');
  else fail(`lz.fieldghosts not persisted (${stored})`);
  await chip.click(); await lo.page.waitForTimeout(250);
  const backPx = await ghostPixels(lo.page, 'green');
  if (backPx.n > lo.px.n * 0.5) ok(`FIELDS back on restores the ghost (${backPx.n} px)`);
  else fail(`FIELDS on did not restore the ghost (${backPx.n} px)`);
  if (lo.errors.length) fail('page errors (plane): ' + lo.errors.join(' | '));
  await lo.browser.close();

  const hi = await quadAt(0.5, 'ghost-plane-pos50.png');
  // Higher z projects UP the screen through the default orbit → smaller y centroid.
  if (hi.px.n > 3000 && hi.px.cy < lo.px.cy - 10) ok(`moving pos moves the quad (cy ${lo.px.cy.toFixed(0)} → ${hi.px.cy.toFixed(0)})`);
  else fail(`quad did not track pos (n ${hi.px.n}, cy ${lo.px.cy.toFixed(0)} → ${hi.px.cy.toFixed(0)})`);
  if (hi.errors.length) fail('page errors (plane hi): ' + hi.errors.join(' | '));
  await hi.browser.close();

  // --- 3. sphere-pulse ghost: wireframe rings ---------------------------------
  {
    const { browser, page, errors } = await openApp(volShow('spherepulse', {
      'spherepulse.centerX': 0.5, 'spherepulse.centerY': 0.5, 'spherepulse.centerZ': 0.25,
      'spherepulse.radius': 0.35, 'spherepulse.thickness': 0.15, 'spherepulse.softness': 0.5,
      'spherepulse.color': '#ff00ff',
    }), PORT);
    await stableRGBA(page);
    await page.waitForTimeout(300);
    const px = await ghostPixels(page, 'magenta');
    await shoot(page, 'ghost-sphere.png');
    if (px.n > 150) ok(`sphere ghost rings visible (${px.n} px)`);
    else fail(`sphere ghost rings absent (${px.n} px)`);
    if (errors.length) fail('page errors (sphere): ' + errors.join(' | '));
    await browser.close();
  }

  // --- 3b. axis-gradient arrow + noise lattice render without errors ----------
  {
    const s = volShow('axisgradient', {
      'axisgradient.axis': 2, 'axisgradient.scroll': 0,
      'axisgradient.colorA': '#000000', 'axisgradient.colorB': '#0000ff',
    });
    s.composition.layers.push({
      id: 'l3', name: 'Noise', blend: 'add', opacity: 1, effects: [], params: {},
      clips: [{ id: 'v2', name: 'noise', generator: 'noise3d',
        params: { 'noise3d.scale': 3, 'noise3d.speed': 0, 'noise3d.color': '#ffffff' }, effects: [] }],
      activeClipId: 'v2',
    });
    const { browser, page, errors } = await openApp(s, PORT);
    await stableRGBA(page);
    await page.waitForTimeout(300);
    const px = await ghostPixels(page, 'blue');
    await shoot(page, 'ghost-gradient-noise.png');
    if (px.n > 50) ok(`gradient arrow visible (${px.n} blue px)`);
    else fail(`gradient arrow absent (${px.n} blue px)`);
    if (errors.length) fail('page errors (gradient+noise): ' + errors.join(' | '));
    await browser.close();
  }

  // --- 4. 2D mode: no ghosts ---------------------------------------------------
  {
    const { browser, page, errors } = await openApp(sweepShow(0.5, { mode3d: false }), PORT);
    await stableRGBA(page);
    await page.waitForTimeout(300);
    const px = await ghostPixels(page, 'green');
    if (px.n < 50) ok(`2D mode draws no ghosts (${px.n} px)`);
    else fail(`2D mode drew ghost pixels (${px.n} px)`);
    if (errors.length) fail('page errors (2D): ' + errors.join(' | '));
    await browser.close();
  }
} finally {
  srv.kill();
}
console.log(process.exitCode ? 'FIELD GHOSTS E2E: FAIL' : 'FIELD GHOSTS E2E: PASS');
