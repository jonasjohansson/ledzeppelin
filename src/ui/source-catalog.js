// Source tabs for the browser/picker + the pure filtering logic. No DOM — unit-tested.
// Tabs: 2D (canvas generators) · 3D (volumetric per-LED fields) · Shaders (imported ISF).
import { labelOf, getEntry } from '../engine/shaders/manifest.js';

// A generator is 3D if its registry entry is volumetric (a per-LED world-space field);
// everything else is a 2D canvas generator. ISF imports are their own 'Shaders' tab and
// are NOT generators (the browser injects them), so they don't appear here.
export const is3D = (name) => !!getEntry(name)?.volumetric;

export const CATEGORY_TABS = ['2D', '3D', 'Shaders'];
// Muted per-tab hues — a small card dot + a 2px active-tab underline, never a filled tab.
// Desaturated, coordinated category marks (was saturated blue/purple/orange — a
// per-taxonomy rainbow reads amateur). Subtle slate · mauve · amber.
export const CATEGORY_COLORS = { '2D': '#7d8a99', '3D': '#9a8aa0', Shaders: '#b89a5e' };

// The tab a generator belongs to ('2D' or '3D'; ISF/'Shaders' is handled by the browser).
export function sourceCategory(name) { return is3D(name) ? '3D' : '2D'; }

// Ordered generator names to SHOW for a tab + query. A non-empty query filters across ALL
// generators by label/name (overriding the tab). '2D' = non-volumetric; '3D' = volumetric;
// 'Shaders' = none here (the browser adds the ISF examples for that tab).
export function filterSources(allNames, { tab = '2D', query = '' } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (q) return allNames.filter((n) => labelOf(n).toLowerCase().includes(q) || n.toLowerCase().includes(q));
  if (tab === '3D') return allNames.filter(is3D);
  if (tab === 'Shaders') return [];
  return allNames.filter((n) => !is3D(n));   // '2D'
}
