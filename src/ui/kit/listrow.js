// A list row + its boxed chips — the master-detail item used across Inventory,
// Devices and the Output list. Full-bleed, hairline-separated, filled-accent when
// selected (the look is in .output-row / .fx-badge; this just emits them).
import { el } from '../dom.js';

export function Badge(text) {
  return el('span', { className: 'fx-badge', textContent: text });
}

export function ListRow(label, { badges = [], selected = false, onClick, lead } = {}) {
  const row = el('div', { className: 'output-row' + (selected ? ' selected' : '') });
  if (lead) row.append(lead);
  row.append(el('span', { textContent: label }));          // flex-grow name
  for (const b of badges) row.append(typeof b === 'string' ? Badge(b) : b);
  if (onClick) row.onclick = onClick;
  return row;
}
