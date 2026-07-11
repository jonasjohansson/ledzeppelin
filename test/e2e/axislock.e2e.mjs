// Axis-lock (X/Y/Z) when dragging a polyline vertex in 3D: pressing the key mid-drag
// constrains motion to that world axis. Run manually: node test/e2e/axislock.e2e.mjs
import { startServer, openApp } from './helpers.mjs';
const PORT = 7982;
const show = {
  version: 1, deviceTypes: [], devices: [], fixtureTypes: [],
  fixtures: [{ id: 'arc', name: 'arc', pixelCount: 20, output: {},
    input: { mode: 'polyline', points: [[0.3,0.5,0],[0.5,0.5,0.2],[0.7,0.5,0]], samples: 20 } }],
  composition: { canvas: { w: 640, h: 360 }, blendV2: true, opacityV2: true, opacity: 1,
    view3d: { mode: '3d', orbit: { az: -35, el: 28, dist: 1.5 } },
    layers: [{ id: 'l1', name: 'L1', blend: 'alpha', opacity: 1, effects: [], params: {},
      clips: [{ id: 'c1', name: 'w', generator: 'solid', params: { 'solid.color': '#4060c0', 'solid.level': 0.8 }, effects: [] }], activeClipId: 'c1' }] } };
const out = []; const check = (n, ok, d='') => { out.push(ok); console.log(`${ok?'✓':'✗'} ${n}${d?` — ${d}`:''}`); };
const pts = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__lz.show().fixtures[0].input.points)));
const handleAt = (page) => page.evaluate(() => {
  const rs = [...document.querySelectorAll('#ovl rect')].map(r => { const b = r.getBoundingClientRect(); return { cx: b.x + b.width/2, cy: b.y + b.height/2, w: b.width, h: b.height }; })
    .filter(h => h.w > 2 && h.w < 26 && Math.abs(h.w - h.h) < 4);
  return rs[Math.floor(rs.length/2)] || rs[0] || null;   // a middle-ish vertex handle
});
const srv = await startServer(PORT);
const { browser, page, errors } = await openApp(show, PORT);
async function dragAxis(axis, dx, dy) {
  await page.click('.output-row[data-fxid="arc"]'); await page.waitForTimeout(250);
  const h = await handleAt(page);
  if (!h) return null;
  const before = await pts(page);
  await page.mouse.move(h.cx, h.cy); await page.mouse.down(); await page.waitForTimeout(60);
  await page.keyboard.press(axis.toUpperCase()); await page.waitForTimeout(40);
  await page.mouse.move(h.cx + dx, h.cy + dy, { steps: 6 }); await page.waitForTimeout(60);
  const after = await pts(page);
  await page.mouse.up(); await page.waitForTimeout(120);
  // Which vertex changed?
  let vi = -1, best = 0;
  for (let i = 0; i < before.length; i++) { const d = Math.abs((after[i][0]-before[i][0])) + Math.abs((after[i][1]-before[i][1])) + Math.abs((after[i][2]||0)-(before[i][2]||0)); if (d > best) { best = d; vi = i; } }
  if (vi < 0) return { d: [0,0,0] };
  return { d: [after[vi][0]-before[vi][0], after[vi][1]-before[vi][1], (after[vi][2]||0)-(before[vi][2]||0)] };
}
try {
  await page.waitForTimeout(700);
  const TOL = 5e-4;
  const rx = await dragAxis('x', 70, 25);
  check('X-lock: x moved, y & z fixed', rx && Math.abs(rx.d[0]) > 2e-3 && Math.abs(rx.d[1]) < TOL && Math.abs(rx.d[2]) < TOL, JSON.stringify(rx?.d?.map(v=>+v.toFixed(4))));
  const ry = await dragAxis('y', 70, 25);
  check('Y-lock: y moved, x & z fixed', ry && Math.abs(ry.d[1]) > 2e-3 && Math.abs(ry.d[0]) < TOL && Math.abs(ry.d[2]) < TOL, JSON.stringify(ry?.d?.map(v=>+v.toFixed(4))));
  const rz = await dragAxis('z', 20, -70);
  check('Z-lock: z moved, x & y fixed', rz && Math.abs(rz.d[2]) > 2e-3 && Math.abs(rz.d[0]) < TOL && Math.abs(rz.d[1]) < TOL, JSON.stringify(rz?.d?.map(v=>+v.toFixed(4))));
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); srv.kill(); }
const failed = out.filter(x => !x).length;
console.log(failed ? `\nFAILED ${failed}/${out.length}` : `\nALL ${out.length} PASSED`);
process.exit(failed ? 1 : 0);
