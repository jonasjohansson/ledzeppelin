// Moved into the component kit. Kept as a re-export so existing imports keep working.
export { Slider } from './kit/slider.js';

import { el } from './dom.js';

// Segmented toggle — the house control for a small, FIXED choice set (2–3 options),
// used instead of a <select>: both choices stay visible and it's one tap, not two.
// `options` = [[value, label], …]. Returns a .fx-field row (label + button group).
// General rule: any 2-option setting should use this, not a dropdown.
export function Segmented(label, options, getVal, onPick) {
  const group = el('div', { className: 'seg-2' });
  const btns = options.map(([v, text]) => {
    const b = el('button', { className: 'seg-2-btn', type: 'button', textContent: text });
    if (getVal() === v) b.classList.add('is-on');
    b.addEventListener('click', () => {
      onPick(v);
      btns.forEach((x, i) => x.classList.toggle('is-on', options[i][0] === v));
    });
    return b;
  });
  btns.forEach((b) => group.append(b));
  return el('label', { className: 'fx-field seg-field' }, [el('span', { textContent: label }), group]);
}
