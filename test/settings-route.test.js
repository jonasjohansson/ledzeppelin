// The Settings popout route (/settings/) — file-level guards that keep the
// window from silently 404ing: the page + its module must exist and reference
// each other, and BOTH packagers must stage the `settings` directory (the
// packaged app serves only the staged asset list; forgetting a route there was
// the exact failure mode this protects against).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('settings/ route: page and module exist and are wired together', () => {
  const html = read('settings/index.html');
  assert.match(html, /<script type="module" src="\.\/settings\.js">/);
  assert.match(html, /\.\.\/src\/ui\/ui\.css/);           // shared design tokens
  const js = read('settings/settings.js');
  assert.match(js, /from '\.\.\/src\/ui\/settings\.js'/); // mounts the shared panel
  assert.match(js, /BroadcastChannel\('lz-settings'\)/);  // sync channel to the main window
});

test('shared settings panel module exports createSettingsPanel', () => {
  assert.match(read('src/ui/settings.js'), /export function createSettingsPanel\(/);
});

test('packagers stage the settings route (packaged app must serve /settings/)', () => {
  assert.match(read('scripts/build-macapp.sh'), /\bmappings inventory settings\b/);
  assert.match(read('scripts/build-app.sh'), /\bmappings inventory settings\b/);
});
