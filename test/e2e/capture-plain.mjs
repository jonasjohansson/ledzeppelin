// Capture the sampled output buffer for the PLAIN (no-volumetric) show and
// write it to the path given as argv[2]. Run once BEFORE a sampler change and
// once after; byte-compare the two files to prove the no-volumetric invariant:
//   node test/e2e/capture-plain.mjs /tmp/before.json
//   …make the change…
//   node test/e2e/capture-plain.mjs /tmp/after.json && diff /tmp/before.json /tmp/after.json
import { writeFileSync } from 'node:fs';
import { startServer, openApp, stableRGBA, plainShow } from './helpers.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: node capture-plain.mjs <out.json>'); process.exit(2); }

const srv = await startServer();
let code = 0;
try {
  const { browser, page, errors } = await openApp(plainShow());
  const rgba = await stableRGBA(page);
  await browser.close();
  if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); code = 1; }
  writeFileSync(out, JSON.stringify(rgba));
  console.log(`captured ${rgba.length / 4} LEDs (${rgba.length} bytes) -> ${out}`);
} catch (e) {
  console.error(e); code = 1;
} finally {
  srv.kill();
}
process.exit(code);
