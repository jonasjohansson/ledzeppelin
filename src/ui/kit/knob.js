import { el } from '../dom.js';

// A small rotary knob (0..1). Drag up/down to change; double-click resets to 0.
// SVG arc indicator (270° sweep). onInput fires live during drag, onCommit on release.
const NS = 'http://www.w3.org/2000/svg';
const A0 = 135, SWEEP = 270;   // start lower-left, sweep clockwise leaving a bottom gap
const pol = (deg) => { const a = deg * Math.PI / 180; return [20 + 15 * Math.cos(a), 20 + 15 * Math.sin(a)]; };
const arcPath = (frac) => {
  const [x0, y0] = pol(A0), [x1, y1] = pol(A0 + SWEEP * Math.max(0.0001, frac));
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A 15 15 0 ${SWEEP * frac > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

export function Knob(label, value, { onInput, onCommit, size = 38 } = {}) {
  let v = Math.max(0, Math.min(1, Number(value) || 0));
  const wrap = el('div', { className: 'knob' });
  const dial = el('div', { className: 'knob-dial', title: 'drag to change · double-click to reset' });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  const mk = (cls) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('class', cls); p.setAttribute('fill', 'none'); return p; };
  const track = mk('knob-track'), fill = mk('knob-fill');
  track.setAttribute('d', arcPath(1));
  svg.append(track, fill);
  dial.append(svg);
  wrap.append(dial, el('div', { className: 'knob-label', textContent: label }));
  const draw = () => fill.setAttribute('d', arcPath(v));
  draw();
  let dragging = false, startY = 0, startV = 0;
  dial.addEventListener('pointerdown', (e) => { dragging = true; startY = e.clientY; startV = v; try { dial.setPointerCapture(e.pointerId); } catch { /* */ } e.preventDefault(); });
  dial.addEventListener('pointermove', (e) => { if (!dragging) return; v = Math.max(0, Math.min(1, startV + (startY - e.clientY) / 160)); draw(); onInput?.(v); });
  const end = (e) => { if (!dragging) return; dragging = false; try { dial.releasePointerCapture(e.pointerId); } catch { /* */ } onCommit?.(v); };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener('dblclick', () => { v = 0; draw(); onInput?.(v); onCommit?.(v); });
  return wrap;
}
