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
    if (!s.url) return;
    // QR, then the URL with a status dot inline (red = daemon offline, accent =
    // live). No prose — the dot says it.
    head.append(el('div', { className: 'ctrl-qr', innerHTML: qrSvg(s.url, 116) }));
    const dot = el('span', { className: 'ctrl-status-dot' + (s.connected ? ' on' : ''), title: s.connected ? 'daemon live' : 'daemon offline' });
    const a = el('a', { className: 'ctrl-url', href: s.url, target: '_blank', rel: 'noopener', textContent: s.url.replace(/^https?:\/\//, ''), title: 'open the Control surface in a new tab' });
    head.append(el('div', { className: 'ctrl-urlrow' }, [dot, a]));
  }

  function renderBody(force) {
    const m = buildRemoteManifest(getShow());
    const sig = structSig(m);
    if (!force && sig === lastSig) return;     // structure unchanged → don't disturb a finger on a fader
    lastSig = sig;
    body.textContent = '';
    // Control is PARAMETERS ONLY — clip launching / layer mixing stays in the
    // deck (Design). Here you adjust the params you exposed via the ⚙ Control
    // tick, with the same sliders as the rest of the editor.
    if (m.controls.length) {
      const card = el('div', { className: 'ctrl-layer' });
      for (const c of m.controls) {
        const span = (c.max - c.min) || 1;
        card.append(Slider(c.label, c.value ?? c.min, {
          min: c.min, max: c.max, default: c.def ?? c.min,
          onInput: (v) => send(c.address, (v - c.min) / span),   // canonical address wants 0..1
        }));
      }
      body.append(card);
    }
    // (Empty state intentionally blank — no instructional text.)
  }

  return {
    refresh() { renderHead(); renderBody(false); },
    rebuild() { lastSig = ''; renderHead(); renderBody(true); },
  };
}
