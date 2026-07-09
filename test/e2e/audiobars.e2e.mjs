// Audio Bars (audiobars) volumetric source — live WebGL validation (Playwright).
//   node test/e2e/audiobars.e2e.mjs
//
// Proves, against the real app + GPU sampler (SwiftShader/ANGLE headless):
//  1. The audiobars shader COMPILES — clean boot, no shader/page errors, and the
//     sampler produces a buffer with the clip active.
//  2. BAND RESPONSE: injecting uAudioBands = (bass=1, mid=0, high=0) lights the
//     Tail (bass) fixture while the Rib (mid) + Fin (high) fixtures stay dark;
//     swapping to (0,0,1) flips it — high lights, bass/mid go dark.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 7099;
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok  -', m);

// Chromium with software GL so WebGL2 works in headless CI (no real GPU).
const LAUNCH = { headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] };

// Three 2D strips named for the band rules (Tail→bass, Rib→mid, Fin→high) + one
// active audiobars clip. floor 0 so an idle band reads pure black.
function audioShow() {
  return {
    version: 1, deviceTypes: [], devices: [], fixtureTypes: [],
    fixtures: [
      { id: 'tail', name: 'Tail', pixelCount: 8, output: {}, input: { mode: 'polyline', points: [[0.1, 0.2], [0.9, 0.2]], samples: 8 } },
      { id: 'rib', name: 'Rib 1', pixelCount: 8, output: {}, input: { mode: 'polyline', points: [[0.1, 0.5], [0.9, 0.5]], samples: 8 } },
      { id: 'fin', name: 'Fin', pixelCount: 8, output: {}, input: { mode: 'polyline', points: [[0.1, 0.8], [0.9, 0.8]], samples: 8 } },
    ],
    composition: {
      canvas: { w: 640, h: 360 }, blendV2: true, opacityV2: true, opacity: 1,
      layers: [{
        id: 'l1', name: 'Layer 1', blend: 'add', opacity: 1, effects: [], params: {},
        clips: [{ id: 'ab', name: 'bars', generator: 'audiobars',
          params: { 'audiobars.gain': 1, 'audiobars.floor': 0, 'audiobars.colorA': '#ff0000', 'audiobars.colorB': '#0000ff' },
          effects: [] }],
        activeClipId: 'ab',
      }],
    },
  };
}

function startServer() {
  const srv = spawn('node', ['server/index.js'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), OSC_PORT: String(PORT + 2300) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    const onData = (d) => { if (String(d).includes(String(PORT)) || String(d).toLowerCase().includes('listening')) resolve(srv); };
    srv.stdout.on('data', onData); srv.stderr.on('data', onData);
    setTimeout(() => resolve(srv), 1500);
  });
}

// Read the sampled buffer once it's stable (rides out PBO readback latency).
async function stableRGBA(page, tries = 60) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const cur = await page.evaluate(() => Array.from(window.__lz.rgba() || []));
    if (prev && cur.length && cur.join(',') === prev.join(',')) return cur;
    prev = cur; await page.waitForTimeout(80);
  }
  throw new Error('sampled buffer never stabilized');
}

// Average brightness (max channel) over a fixture's LED span [start, start+count).
function spanBrightness(rgba, start, count) {
  let s = 0;
  for (let i = start; i < start + count; i++) s += Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return s / count;
}

const srv = await startServer();
const browser = await chromium.launch(LAUNCH);
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript((s) => {
    localStorage.setItem('ledzeppelin.show', JSON.stringify(s));
    localStorage.setItem('lz.riff', '0'); localStorage.setItem('lz.riff.played', '1');
  }, audioShow());
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lz && window.__lz.rgba() != null, null, { timeout: 15000 });

  // Fixtures sample in order: tail (0..7), rib (8..15), fin (16..23).
  const TAIL = [0, 8], RIB = [8, 8], FIN = [16, 8];

  // --- 1. compiles + samples -------------------------------------------------
  await stableRGBA(page);
  if (errors.some((e) => /shader|compile|link|WebGL/i.test(e))) fail('shader compile/link error on boot:\n  ' + errors.join('\n  '));
  else ok('audiobars shader compiled + sampler produced a buffer (clean boot)');

  // --- 2. band response: bass hit ------------------------------------------
  await page.evaluate(() => window.__lz.setAudioBands([1, 0, 0]));   // bass=1, mid=0, high=0
  await page.waitForTimeout(300);
  let rgba = await stableRGBA(page);
  const bassTail = spanBrightness(rgba, TAIL[0], TAIL[1]);
  const bassRib = spanBrightness(rgba, RIB[0], RIB[1]);
  const bassFin = spanBrightness(rgba, FIN[0], FIN[1]);
  console.log(`    bass=1: Tail=${bassTail.toFixed(1)} Rib=${bassRib.toFixed(1)} Fin=${bassFin.toFixed(1)}`);
  if (bassTail > 200 && bassRib < 5 && bassFin < 5) ok('bass hit lights the Tail (bass) fixture; Rib + Fin stay dark');
  else fail(`bass response wrong (Tail=${bassTail} Rib=${bassRib} Fin=${bassFin})`);

  // --- 3. band response: high hit ------------------------------------------
  await page.evaluate(() => window.__lz.setAudioBands([0, 0, 1]));   // high=1
  await page.waitForTimeout(300);
  rgba = await stableRGBA(page);
  const hiTail = spanBrightness(rgba, TAIL[0], TAIL[1]);
  const hiRib = spanBrightness(rgba, RIB[0], RIB[1]);
  const hiFin = spanBrightness(rgba, FIN[0], FIN[1]);
  console.log(`    high=1: Tail=${hiTail.toFixed(1)} Rib=${hiRib.toFixed(1)} Fin=${hiFin.toFixed(1)}`);
  if (hiFin > 200 && hiTail < 5 && hiRib < 5) ok('high hit lights the Fin (high) fixture; Tail + Rib stay dark');
  else fail(`high response wrong (Tail=${hiTail} Rib=${hiRib} Fin=${hiFin})`);

  // --- 4. colour: bass fixture is RED (colorA), fin is BLUE (colorB) --------
  await page.evaluate(() => window.__lz.setAudioBands([1, 0, 1]));
  await page.waitForTimeout(300);
  rgba = await stableRGBA(page);
  const tailRed = rgba[TAIL[0] * 4] > 200 && rgba[TAIL[0] * 4 + 2] < 30;
  const finBlue = rgba[FIN[0] * 4 + 2] > 200 && rgba[FIN[0] * 4] < 30;
  if (tailRed && finBlue) ok('bass fixture renders colorA (red); high fixture renders colorB (blue)');
  else fail(`band colours wrong (tail rgb=${rgba.slice(0, 3)}, fin rgb=${rgba.slice(FIN[0] * 4, FIN[0] * 4 + 3)})`);

  if (errors.length) fail('page errors during run:\n  ' + errors.join('\n  '));
  console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK');
} finally {
  await browser.close();
  srv.kill();
}
