// A list row + its boxed chips — the master-detail item used across Inventory,
// Devices and the Output list. Full-bleed, hairline-separated, filled-accent when
// selected (the look is in .output-row / .fx-badge; this just emits them).
import { el } from '../dom.js';

export function Badge(text) {
  return el('span', { className: 'fx-badge', textContent: text });
}

export function ListRow(label, { badges = [], selected = false, onClick, lead, suffix } = {}) {
  const row = el('div', { className: 'output-row' + (selected ? ' selected' : '') });
  if (lead) row.append(lead);
  // Name (flex-grow, truncates w/ ellipsis) + an optional greyed, non-editable suffix
  // (e.g. a "(6ch)" / "(60px)" size tag that lives in the name but isn't part of it).
  row.append(el('span', { className: 'lr-name', textContent: label, title: suffix ? `${label} ${suffix}` : label }));
  if (suffix) row.append(el('span', { className: 'lr-suffix', textContent: suffix }));
  for (const b of badges) row.append(typeof b === 'string' ? Badge(b) : b);
  if (onClick) row.onclick = onClick;
  return row;
}
