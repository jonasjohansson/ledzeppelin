// Source families for the browser/picker tabs + the pure filtering logic. No DOM —
// unit-tested. Category source-of-truth (moved out of layers.js so it's shared + testable).
import { labelOf } from '../engine/shaders/manifest.js';

export const SOURCE_CATEGORIES = [
  ['Basic', ['solid', 'gradient', 'line']],
  ['Pattern', ['grid', 'checkers', 'spectrum']],
  ['Motion', ['sine', 'pulse', 'radial', 'plasma', 'tunnel']],
  ['Liquid', ['domainwarp', 'metaballs']],
  ['Organic', ['noise']],
  ['Volumetric', ['planesweep', 'axisgradient', 'noise3d', 'spherepulse', 'bodywave', 'planepulse', 'flowfield']],
];
export const CATEGORY_COLORS = {
  Basic: '#8a94a6', Pattern: '#5cb8e8', Motion: '#e8a35c', Liquid: '#5ce8c8',
  Organic: '#6ee07d', Volumetric: '#b98cff', More: '#737a84',
};
export const CATEGORY_TABS = ['All', ...SOURCE_CATEGORIES.map(([l]) => l), 'More'];

export function sourceCategory(name) {
  for (const [label, names] of SOURCE_CATEGORIES) if (names.includes(name)) return label;
  return 'More';
}
export function filterSources(allNames, { tab = 'All', query = '' } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (q) return allNames.filter((n) => labelOf(n).toLowerCase().includes(q) || n.toLowerCase().includes(q));
  if (tab === 'All') {
    const ordered = [];
    for (const [, names] of SOURCE_CATEGORIES) for (const n of names) if (allNames.includes(n) && !ordered.includes(n)) ordered.push(n);
    for (const n of allNames) if (!ordered.includes(n)) ordered.push(n);
    return ordered;
  }
  if (tab === 'More') {
    const cat = new Set(SOURCE_CATEGORIES.flatMap(([, ns]) => ns));
    return allNames.filter((n) => !cat.has(n));
  }
  const entry = SOURCE_CATEGORIES.find(([label]) => label === tab);
  return entry ? entry[1].filter((n) => allNames.includes(n)) : [];
}
