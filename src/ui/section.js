// Shared UI kit: the collapsible disclosure SECTION (Resolume-style group) used
// across the Composition inspector, the Fixtures tab, and the Output tab so all
// three read as the same instrument. Open/closed state lives in a module Set so
// it survives the structural re-renders that each panel does; toggling is pure
// show/hide (no re-render) so a mid-drag slider or scroll position is never
// disturbed. The matching .insp-sec / .insp-sec-head / .insp-tri CSS is in
// ui.css.

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};

// Keys listed here render OPEN on first paint; everything else starts collapsed.
// Membership is toggled live as the user opens/closes a section.
export const SEC_OPEN = new Set([
  // Composition inspector
  'transport', 'transform', 'effects', 'autopilot', 'layer-comp', 'comp-fx',
  // Fixtures / Output tabs
  'devices', 'fixtures', 'position', 'chains', 'routing', 'identity',
]);

export function Section(title, key, build) {
  const sec = el('div', { className: 'insp-sec' + (SEC_OPEN.has(key) ? ' is-open' : '') });
  sec.dataset.sec = key;
  const head = el('button', { className: 'insp-sec-head', type: 'button' }, [
    el('span', { className: 'insp-tri' }),
    el('span', { className: 'insp-sec-title', textContent: title.toUpperCase() }),
  ]);
  head.addEventListener('click', () => {
    if (SEC_OPEN.has(key)) SEC_OPEN.delete(key); else SEC_OPEN.add(key);
    sec.classList.toggle('is-open');
  });
  const body = el('div', { className: 'insp-sec-body' });
  build(body);
  sec.append(head, body);
  return sec;
}
