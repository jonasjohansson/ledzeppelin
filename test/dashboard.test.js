import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normDashboard, dashboardSignals, dashboardLinkLabels, DASHBOARD_DEFAULT_LINKS } from '../src/model/dashboard.js';
import { setDashboardLinkValue, normalizeComposition } from '../src/model/layers.js';

test('normDashboard is a fixed bank of the default link count + clamps values', () => {
  const d = normDashboard({ links: [{ id: 'd1', name: 'A', value: 2 }] });
  assert.equal(d.links.length, DASHBOARD_DEFAULT_LINKS);
  assert.equal(d.links[0].value, 1);            // clamped 2 → 1
  assert.equal(d.links[0].name, 'A');
  // Caps an over-long saved list back to the fixed count.
  const extra = Array.from({ length: 99 }, (_, i) => ({ id: `d${i + 1}`, value: 0 }));
  assert.equal(normDashboard({ links: extra }).links.length, DASHBOARD_DEFAULT_LINKS);
});

test('normalizeComposition adds the fixed dashboard bank', () => {
  const s = normalizeComposition({ composition: { layers: [] } });
  assert.equal(s.composition.dashboard.links.length, DASHBOARD_DEFAULT_LINKS);
});

test('dashboardSignals exposes dash:<id> values', () => {
  const sig = dashboardSignals({ dashboard: { links: [{ id: 'd1', value: 0.5 }, { id: 'd2', value: 1 }] } });
  assert.deepEqual(sig, { 'dash:d1': 0.5, 'dash:d2': 1 });
});

test('dashboardLinkLabels: a link is labelled by what it drives', () => {
  const show = {
    composition: {
      layers: [
        { anim: { 'fx.opacity': { mode: 'dashboard', link: 'd2' } },
          clips: [{ anim: { 'line.speed': { mode: 'dashboard', link: 'd1' }, 'line.zoom': { mode: 'timeline' } } }] },
      ],
    },
    fixtures: [{ id: 'fx9', name: 'FOS', input: { dmx: { bind: { 0: 'dash:d3' } } } }],
  };
  const labels = dashboardLinkLabels(show);
  assert.equal(labels.d1, 'Speed');     // clip param key → pretty label
  assert.equal(labels.d2, 'Opacity');   // layer param
  assert.equal(labels.d3, 'FOS');       // DMX bind → fixture name
  assert.equal(labels.d4, undefined);   // unused link → no label
});

test('setDashboardLinkValue clamps to 0..1', () => {
  let s = normalizeComposition({ composition: { layers: [] } });
  s = setDashboardLinkValue(s, 'd1', 5);
  assert.equal(s.composition.dashboard.links[0].value, 1);
});
