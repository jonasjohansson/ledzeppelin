// CONTROL pane — the companion surface, inside the editor. Mirrors what the
// phone (/remote/) shows: the MASTER controls (each layer's opacity + Block +
// clip-trigger grid) and the ticked CUSTOM params, but drives them LOCALLY via
// `send(address, value)` (the same canonical OSC addresses → handleExt). It also
// shows the phone-companion URL + QR + a live connection status, so this tab
// doubles as the "point your phone here" screen.

import { el } from './dom.js';
import { Slider } from './controls.js';
import { buildRemoteManifest } from '../model/remote.js';
import { qrSvg } from './qr.js';

export function createControlPanel({ mount, getShow, send, status }) {
  const head = el('div', { className: 'ctrlpane-head' });
  const body = el('div', { className: 'ctrlpane-body' });
  mount.append(head, body);
  let lastSig = '';

  const structSig = (m) => JSON.stringify([
    (m.layers || []).map((L) => [L.n, L.name, L.bypass, (L.clips || []).map((c) => [c.m, c.name, c.active])]),
    (m.controls || []).map((c) => [c.address, c.label]),
  ]);


  function renderHead() {
    head.textContent = '';
    const s = status?.() || {};
    const dot = el('span', { className: 'ctrl-status-dot' + (s.connected ? ' on' : '') });
    head.append(el('div', { className: 'ctrl-status' }, [
      dot, el('span', { textContent: s.connected ? 'companion live' : 'daemon offline — start it to serve phones' }),
    ]));
    if (s.url) {
      head.append(el('div', { className: 'ctrl-qr', innerHTML: qrSvg(s.url, 116) }));
      const a = el('a', { className: 'ctrl-url', href: s.url, target: '_blank', rel: 'noopener', textContent: s.url.replace(/^https?:\/\//, ''), title: 'open the companion in a new tab' });
      head.append(a);
      head.append(el('div', { className: 'ctrl-hint', textContent: 'open on any phone on this network' }));
    }
  }

  function renderBody(force) {
    const m = buildRemoteManifest(getShow());
    const sig = structSig(m);
    if (!force && sig === lastSig) return;     // structure unchanged → don't disturb a finger on a fader
    lastSig = sig;
    body.textContent = '';
    for (const L of m.layers) {
      const card = el('div', { className: 'ctrl-layer' });
      const blk = el('button', { className: 'ctrl-blk' + (L.bypass ? ' on' : ''), textContent: 'B', title: 'block (mute) this layer' });
      blk.onclick = () => { const next = !blk.classList.contains('on'); send(`/layer/${L.n}/bypass`, next ? 1 : 0); };
      card.append(el('div', { className: 'ctrl-layer-head' }, [el('div', { className: 'ctrl-layer-name', textContent: L.name }), blk]));
      if ((L.clips || []).length) {
        const grid = el('div', { className: 'ctrl-clips' });
        for (const c of L.clips) {
          const btn = el('button', { className: 'ctrl-clip' + (c.active ? ' active' : ''), textContent: c.name });
          btn.onclick = () => send(`/layer/${L.n}/clip/${c.m}/trigger`, 1);
          grid.append(btn);
        }
        card.append(grid);
      }
      // Opacity uses the SAME slider as the rest of the editor (compact track +
      // readout + shift-snap + right-click reset). The phone keeps its big fader.
      card.append(Slider('Opacity', L.opacity ?? 1, { min: 0, max: 1, default: 1, onInput: (v) => send(`/layer/${L.n}/opacity`, v) }));
      body.append(card);
    }
    if (m.controls.length) {
      body.append(el('div', { className: 'ctrl-section', textContent: 'Parameters' }));
      const card = el('div', { className: 'ctrl-layer' });
      for (const c of m.controls) {
        const span = (c.max - c.min) || 1;
        // Editor slider in the param's own units; the canonical address wants 0..1.
        card.append(Slider(c.label, c.value ?? c.min, {
          min: c.min, max: c.max, default: c.def ?? c.min,
          onInput: (v) => send(c.address, (v - c.min) / span),
        }));
      }
      body.append(card);
    }
    if (!m.layers.length) body.append(el('div', { className: 'ctrl-empty', textContent: 'No layers yet.' }));
  }

  return {
    refresh() { renderHead(); renderBody(false); },
    rebuild() { lastSig = ''; renderHead(); renderBody(true); },
  };
}
