import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_CATEGORIES, CATEGORY_COLORS, CATEGORY_TABS, sourceCategory, filterSources } from '../src/ui/source-catalog.js';
import { generatorNames } from '../src/engine/shaders/manifest.js';

test('sourceCategory maps a source to its family, else More', () => {
  assert.equal(sourceCategory('solid'), 'Basic');
  assert.equal(sourceCategory('flowfield'), 'Volumetric');
  assert.equal(sourceCategory('nope-xyz'), 'More');
});
test('CATEGORY_TABS = All + families + More', () => {
  assert.deepEqual(CATEGORY_TABS, ['All', 'Basic', 'Pattern', 'Motion', 'Liquid', 'Organic', 'Volumetric', 'More']);
  for (const t of CATEGORY_TABS) assert.ok(CATEGORY_COLORS[t] || t === 'All', `color for ${t}`);
});
test('filterSources: a tab returns its members (in order); All returns everything', () => {
  const all = generatorNames();
  assert.deepEqual(filterSources(all, { tab: 'Basic' }), ['solid', 'gradient', 'line'].filter((n) => all.includes(n)));
  assert.ok(filterSources(all, { tab: 'Volumetric' }).includes('flowfield'));
  assert.equal(filterSources(all, { tab: 'All' }).length, all.length);
  assert.equal(new Set(filterSources(all, { tab: 'All' })).size, all.length);
});
test('filterSources: a query filters across ALL sources by label/name, overriding tab', () => {
  const all = generatorNames();
  const hits = filterSources(all, { tab: 'Basic', query: 'noise' });
  assert.ok(hits.includes('noise'));
  assert.ok(hits.includes('noise3d'));
  assert.ok(!hits.includes('solid'));
});
test('filterSources: More = uncategorised generators only', () => {
  const cat = new Set(SOURCE_CATEGORIES.flatMap(([, ns]) => ns));
  for (const n of filterSources(generatorNames(), { tab: 'More' })) assert.ok(!cat.has(n), n);
});
