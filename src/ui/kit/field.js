// Text + number inputs. `commit` decides WHEN the handler fires:
//   'live'    — on every keystroke (input event)
//   'release' — on blur / Enter (change event), which preserves focus when the
//               handler re-renders the panel (the focus-loss footgun the old
//               *Commit helpers existed to dodge).
import { el } from '../dom.js';

export function NumInput(value, { onInput = () => {}, commit = 'live', step = 'any', min, max } = {}) {
  const i = el('input', { type: 'number', value: String(value ?? 0), step: String(step) });
  if (min != null) i.min = String(min);
  if (max != null) i.max = String(max);
  i.addEventListener(commit === 'release' ? 'change' : 'input',
    () => onInput(i.value === '' ? 0 : Number(i.value)));
  return i;
}

export function TextInput(value, { onInput = () => {}, commit = 'live', placeholder } = {}) {
  const i = el('input', { type: 'text', value: value ?? '' });
  if (placeholder) i.placeholder = placeholder;
  i.addEventListener(commit === 'release' ? 'change' : 'input', () => onInput(i.value));
  return i;
}
