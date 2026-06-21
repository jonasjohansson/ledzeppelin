import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normDashboard, dashboardSignals, DASHBOARD_DEFAULT_LINKS } from '../src/model/dashboard.js';
import { setDashboardLinkValue, addDashboardLink, removeDashboardLink, normalizeComposition } from '../src/model/layers.js';

test('normDashboard pads to the default link count + clamps values', () => {
  const d = normDashboard({ links: [{ id: 'd1', name: 'A', value: 2 }] });
  assert.equal(d.links.length, DASHBOARD_DEFAULT_LINKS);
  assert.equal(d.links[0].value, 1);            // clamped 2 → 1
  assert.equal(d.links[0].name, 'A');
  assert.equal(d.links[7].id, 'd8');
});

test('normalizeComposition adds a dashboard with 8 links', () => {
  const s = normalizeComposition({ composition: { layers: [] } });
  assert.equal(s.composition.dashboard.links.length, 8);
});

test('dashboardSignals exposes dash:<id> values', () => {
  const sig = dashboardSignals({ dashboard: { links: [{ id: 'd1', value: 0.5 }, { id: 'd2', value: 1 }] } });
  assert.deepEqual(sig, { 'dash:d1': 0.5, 'dash:d2': 1 });
});

test('link mutators: set value (clamped), add, remove', () => {
  let s = normalizeComposition({ composition: { layers: [] } });
  s = setDashboardLinkValue(s, 'd1', 5);
  assert.equal(s.composition.dashboard.links[0].value, 1);
  const before = s.composition.dashboard.links.length;
  s = addDashboardLink(s);
  assert.equal(s.composition.dashboard.links.length, before + 1);
  s = removeDashboardLink(s, 'd1');
  assert.equal(s.composition.dashboard.links.some((l) => l.id === 'd1'), false);
});
