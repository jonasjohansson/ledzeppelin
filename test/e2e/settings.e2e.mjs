// Settings-window e2e: the gear opens /settings/ as a real popup; edits made
// there reach the MAIN window over BroadcastChannel('lz-settings') — the
// show-owned fields (composition.audioGain) via targeted merge, the
// localStorage-owned prefs (snap, tooltips) + appearance CSS vars via re-apply.
// Also asserts the old floating #settings-pop is gone and that neither window
// logs a page error. Run manually (not part of `npm test`):
//   node test/e2e/settings.e2e.mjs
import { startServer } from './helpers.mjs';
import { chromium } from 'playwright';

const PORT = 7611;   // unique — never collides with the other e2e scripts

const srv = await startServer(PORT);
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const main = await ctx.newPage();
  const errs = [];
  main.on('pageerror', (e) => errs.push('main: ' + e));
  await main.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await main.waitForFunction(() => !!window.__lz);

  // The floating panel is fully gone.
  if (await main.locator('#settings-pop').count()) throw new Error('#settings-pop still in the DOM');

  // Gear → a real /settings/ popup window.
  const [pop] = await Promise.all([ctx.waitForEvent('page'), main.click('#menu-settings')]);
  pop.on('pageerror', (e) => errs.push('popout: ' + e));
  await pop.waitForLoadState('load');
  if (!/\/settings\/$/.test(pop.url())) throw new Error('gear opened ' + pop.url());
  await pop.waitForSelector('#set-body .accent-swatches');   // build() is async — wait for the last section
  const body = await pop.textContent('#set-body');
  if (!/main window opens the input/i.test(body)) throw new Error('missing the popout audio-capture note');

  // Slider order: Gain · Grid · Distance · Max FPS · Brightness · Tint · Contrast · Translucency · Text size
  const setSlider = (i, v) => pop.evaluate(({ i, v }) => {
    const r = document.querySelectorAll('#set-body input[type=range]')[i];
    r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true }));
  }, { i, v });

  // 1 — GAIN in the popout lands in the main window's LIVE show.
  await setSlider(0, 3.2);
  await main.waitForFunction(() => Math.abs((window.__lz.show().composition?.audioGain ?? 1) - 3.2) < 0.01);
  console.log('· gain: popout edit → main show.composition.audioGain OK');

  // 2 — SNAP grid syncs (persisted lz.snap adopted by the main window).
  await setSlider(1, 48);
  await main.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('lz.snap')).grid === 48; } catch { return false; } });
  console.log('· snap: grid edit adopted OK');

  // 3 — APPEARANCE (brightness) re-themes the MAIN document's CSS vars.
  const bgBefore = await main.evaluate(() => document.documentElement.style.getPropertyValue('--bg'));
  await setSlider(4, 19);
  await main.waitForFunction((prev) => document.documentElement.style.getPropertyValue('--bg') !== prev, bgBefore);
  console.log('· appearance: brightness edit re-themed the main window OK');

  // 4 — a PREFERENCE toggle syncs: turning tooltips OFF strips main-window titles.
  await pop.evaluate(() => {
    const cb = [...document.querySelectorAll('#set-body .set-toggle')]
      .find((l) => /tooltips/i.test(l.textContent)).querySelector('input');
    cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await main.waitForFunction(() => !document.getElementById('menu-save').getAttribute('title'));
  console.log('· prefs: tooltip toggle adopted OK');

  if (errs.length) throw new Error('page errors: ' + errs.join(' | '));
  console.log('SETTINGS E2E OK — window opens, gain/snap/appearance/prefs sync, zero page errors');
} finally {
  await browser.close();
  srv.kill();
}
