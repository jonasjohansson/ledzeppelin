import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_COLORS, CATEGORY_TABS, sourceCategory, filterSources, is3D } from '../src/ui/source-catalog.js';
import { generatorNames, descOf } from '../src/engine/shaders/manifest.js';

test('sourceCategory: volumetric → 3D, else 2D', () => {
  assert.equal(sourceCategory('solid'), '2D');
  assert.equal(sourceCategory('plasma'), '2D');
  assert.equal(sourceCategory('flowfield'), '3D');
  assert.equal(sourceCategory('noise3d'), '3D');
});
test('CATEGORY_TABS = 2D / 3D / Shaders, each coloured', () => {
  assert.deepEqual(CATEGORY_TABS, ['2D', '3D', 'Shaders']);
  for (const t of CATEGORY_TABS) assert.ok(CATEGORY_COLORS[t], `color for ${t}`);
});
test('filterSources: 3D = volumetric, 2D = the rest, Shaders = none (ISF added by the browser)', () => {
  const all = generatorNames();
  const threeD = filterSources(all, { tab: '3D' });
  const twoD = filterSources(all, { tab: '2D' });
  assert.ok(threeD.includes('flowfield') && threeD.every(is3D));
  assert.ok(twoD.includes('solid') && twoD.includes('plasma') && !twoD.some(is3D));
  assert.equal(threeD.length + twoD.length, all.length);   // partition, no overlap/loss
  assert.deepEqual(filterSources(all, { tab: 'Shaders' }), []);
});
test('filterSources: a query filters across ALL sources by label/name, overriding tab', () => {
  const all = generatorNames();
  const hits = filterSources(all, { tab: '2D', query: 'noise' });
  assert.ok(hits.includes('noise'));
  assert.ok(hits.includes('noise3d'));   // across tabs despite tab=2D
  assert.ok(!hits.includes('solid'));
});
test('descOf returns a short description for a source, else empty', () => {
  assert.ok(descOf('solid').length > 0);
  assert.ok(descOf('flowfield').length > 0);
  assert.equal(descOf('nope-xyz'), '');
});
