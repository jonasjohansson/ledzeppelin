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
  // Composition inspector (clip)
  'playback', 'source', 'transform', 'effects',
  // Composition inspector (layer / composition)
  'autopilot', 'layer-comp', 'layer-effects', 'comp-master', 'comp-fx',
  // Fixtures / Output tabs
  'devices', 'fixtures', 'position', 'chains', 'routing', 'identity',
]);

// Section(title, key, build, onReset?, locked?). When onReset is given, a small
// ↺ shows in the header (on hover) that resets the group. When `locked` is true
// the section is forced open and can't be collapsed (no toggle) — e.g. an empty
// Effects group, where collapsing would hide the only "drop effect" target.
export function Section(title, key, build, onReset, locked) {
  const open = locked || SEC_OPEN.has(key);
  const sec = el('div', { className: 'insp-sec' + (open ? ' is-open' : '') + (locked ? ' is-locked' : '') });
  sec.dataset.sec = key;
  // A div (not a button) so the reset button can nest inside the header.
  const head = el('div', { className: 'insp-sec-head' }, [
    el('span', { className: 'insp-tri' }),
    el('span', { className: 'insp-sec-title', textContent: title.toUpperCase() }),
  ]);
  if (!locked) head.addEventListener('click', () => {
    if (SEC_OPEN.has(key)) SEC_OPEN.delete(key); else SEC_OPEN.add(key);
    sec.classList.toggle('is-open');
  });
  if (onReset) {
    const rst = el('button', {
      className: 'insp-sec-reset', type: 'button', textContent: '↺', title: 'reset this group',
    });
    rst.addEventListener('click', (e) => { e.stopPropagation(); onReset(); });
    head.append(rst);
  }
  const body = el('div', { className: 'insp-sec-body' });
  build(body);
  sec.append(head, body);
  return sec;
}
