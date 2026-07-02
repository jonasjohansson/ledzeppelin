// Shared Playwright e2e plumbing: start the app server, open a page with a
// seeded show in localStorage, read the sampled output buffer via the
// window.__lz test hook. Run manually (not part of `npm test`):
//   node test/e2e/<script>.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// Default port; scripts that run alongside others pass their own (72xx range).
export const PORT = 7181;

// A deterministic show: two 2D strips + a LIFTED ARCH in 3D mode with the
// 'front' ortho projection (so the arch samples through real 3D geometry and
// its world z is carried to the sampler). Sources are STATIC (solid, gradient)
// so the sampled bytes are frame-stable — comparable across runs and commits.
export function plainShow() {
  return {
    version: 1, deviceTypes: [], devices: [], fixtureTypes: [],
    fixtures: [
      { id: 'bar', name: 'bar', pixelCount: 20,
        output: {}, input: { mode: 'polyline', points: [[0.1, 0.2], [0.9, 0.2]], samples: 20 } },
      { id: 'bar2', name: 'bar2', pixelCount: 16,
        output: {}, input: { mode: 'polyline', points: [[0.1, 0.6], [0.9, 0.6]], samples: 16 } },
      { id: 'arc', name: 'arc', pixelCount: 21,
        output: {}, input: { mode: 'polyline', points: [[0.2, 0.85, 0], [0.35, 0.85, 0.4], [0.5, 0.85, 0.55], [0.65, 0.85, 0.4], [0.8, 0.85, 0]], samples: 21 } },
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
        clips: [
          { id: 'c1', name: 'wash', generator: 'solid', params: { 'solid.color': '#4060c0', 'solid.level': 0.8 }, effects: [] },
          { id: 'c2', name: 'ramp', generator: 'gradient', params: { 'gradient.angle': 0 }, effects: [] },
        ],
        activeClipId: 'c1',
      }],
    },
  };
}

// Boot the daemon (static file server + WS bridge) on PORT.
export function startServer(port = PORT) {
  const srv = spawn('node', ['server/index.js'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), OSC_PORT: String(port + 2300) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const onData = (d) => { if (String(d).includes(String(port)) || String(d).toLowerCase().includes('listening')) resolve(srv); };
    srv.stdout.on('data', onData); srv.stderr.on('data', onData);
    setTimeout(() => resolve(srv), 1500);   // fallback: assume up
    srv.on('error', reject);
  });
}

// Open the app with `show` seeded; returns { browser, page, errors }.
// `errors` collects page errors + console errors for the no-page-errors check.
export async function openApp(show, port = PORT) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript((s) => {
    localStorage.setItem('ledzeppelin.show', JSON.stringify(s));
    localStorage.setItem('lz.riff', '0');            // no startup sound
    localStorage.setItem('lz.riff.played', '1');
  }, show);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lz && window.__lz.rgba() != null, null, { timeout: 15000 });
  return { browser, page, errors };
}

// Read the sampled per-LED RGBA buffer once it's STABLE (same bytes on two
// consecutive polls ~3 frames apart) — rides out PBO readback latency.
export async function stableRGBA(page, tries = 60) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const cur = await page.evaluate(() => Array.from(window.__lz.rgba() || []));
    if (prev && cur.length && cur.join(',') === prev.join(',')) return cur;
    prev = cur;
    await page.waitForTimeout(80);
  }
  throw new Error('sampled buffer never stabilized');
}
