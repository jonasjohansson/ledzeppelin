// Mappings window — talks to the editor over BroadcastChannel. Each row has an
// OSC address plus a MIDI cell and a Key cell: click a cell to ARM it, then move
// a control (MIDI) or press a key. Continuous params have no Key cell (a key
// can't sweep a value). Bound cells show the live value; the editor owns the show.

import { syncAccent } from '../src/ui/sync-accent.js';

const bus = new BroadcastChannel('lz-mappings');
const $ = (id) => document.getElementById(id);
const paramsEl = $('params');

// Mirror the editor's chosen accent (persisted in lz.accent) so Mappings matches the
// theme — shared with the Inventory popout.
syncAccent();

// OSC input PORT — settable here; the daemon rebinds (POST /api/osc/port). Persisted
// so it sticks across reloads (re-applied on load). The Mapping window is served by
// the daemon, so it can hit the API directly.
(function oscPort() {
  const input = $('osc-port'), status = $('osc-port-status'), echo = $('osc-port-echo');
  if (!input) return;
  const setUi = (p) => { input.value = p; if (echo) echo.textContent = p; };
  const flash = (msg, ok) => { if (!status) return; status.textContent = msg; status.style.color = ok ? 'var(--accent)' : 'var(--danger, #e66)'; setTimeout(() => { status.textContent = ''; }, 1600); };
  const saved = (() => { try { return Number(localStorage.getItem('lz.oscport')) || 0; } catch { return 0; } })();
  const post = async (port) => {
    try {
      const r = await fetch('/api/osc/port', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ port }) });
      const d = await r.json();
      if (d.osc) { setUi(d.osc); try { localStorage.setItem('lz.oscport', String(d.osc)); } catch { /* private */ } flash('✓ bound', true); }
      else flash(d.error || 'failed', false);
    } catch { flash('daemon offline', false); }
  };
  // On load: reflect the daemon's current port; if a saved port differs, apply it.
  fetch('/api/info').then((r) => r.json()).then((d) => {
    setUi(d.osc || 9000);
    if (saved && saved !== d.osc) post(saved);
  }).catch(() => {});
  input.addEventListener('change', () => { const p = Math.max(1, Math.min(65535, Math.round(Number(input.value) || 9000))); post(p); });
})();

let params = [];                 // [{ id, kind, keyable, group, label, osc, midi, key, mode }]
let channels = {};               // { channel: value }
let learn = null;                // { id, slot } currently armed
let learnBaseline = null;        // channel snapshot at arm time
let rowFills = [];               // [{ channel, el }] live value bars
let lastBus = 0;

bus.postMessage({ type: 'hello' });
// Liveness ping — the editor gates its 10Hz channel stream on a listening window.
setInterval(() => { try { bus.postMessage({ type: 'ping' }); } catch { /* closed */ } }, 5000);
$('enable-midi').addEventListener('click', () => bus.postMessage({ type: 'enableMidi' }));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (learn) { learn = null; renderParams(); } return; }
  if (!e.repeat && !typing(e.target)) bus.postMessage({ type: 'key', code: e.code, down: true });
});
addEventListener('keyup', (e) => { if (!typing(e.target)) bus.postMessage({ type: 'key', code: e.code, down: false }); });
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

bus.onmessage = (e) => {
  const m = e.data || {};
  lastBus = performance.now();
  if (m.type === 'params') { params = m.data || []; renderParams(); }
  else if (m.type === 'channels') { channels = m.data || {}; updateValues(); tickLearn(); }
  else if (m.type === 'midi') {
    const btn = $('enable-midi'), st = $('midi-status');
    btn.disabled = !!m.enabled; btn.classList.toggle('is-on', !!m.enabled); btn.textContent = m.enabled ? 'MIDI on ✓' : 'enable MIDI';
    st.textContent = m.enabled ? (m.inputs?.length ? m.inputs.join(', ') : 'no inputs') : '';
  }
};

// One MIDI/Key cell: armed prompt, bound channel + live bar + clear, or click-to-arm.
function cell(p, slot) {
  const c = el('div', 'cell');
  const disabled = slot === 'key' && !p.keyable;
  if (disabled) { c.classList.add('disabled'); c.append(el('span', 'cell-none', '—')); return c; }
  const ch = slot === 'midi' ? p.midi : p.key;
  const armed = learn && learn.id === p.id && learn.slot === slot;
  if (armed) { c.classList.add('armed'); c.append(el('span', 'cell-arm', slot === 'midi' ? 'move…' : 'press…')); }
  else if (ch) {
    c.append(el('span', 'cell-chan', slot === 'key' ? ch.replace(/^key:/, '') : ch));
    const bar = el('div', 'cell-bar'); const fill = el('div', 'cell-fill'); bar.append(fill); c.append(bar); rowFills.push({ channel: ch, el: fill });
    const x = el('button', 'm-x', '×'); x.title = 'clear'; x.addEventListener('click', (ev) => { ev.stopPropagation(); bus.postMessage({ type: 'clear', id: p.id, slot }); }); c.append(x);
  } else c.append(el('span', 'cell-none', '+'));
  c.addEventListener('click', () => { learn = armed ? null : { id: p.id, slot }; learnBaseline = { ...channels }; renderParams(); });
  return c;
}

function renderParams() {
  rowFills = [];
  if (!params.length) { paramsEl.innerHTML = '<span class="chip-empty">add a clip in the editor</span>'; return; }
  paramsEl.textContent = '';
  paramsEl.append(headerRow());
  let lastGroup = null;
  for (const p of params) {
    if (p.group !== lastGroup) { lastGroup = p.group; paramsEl.append(el('div', 'grp', p.group)); }
    const row = el('div', 'row' + ((p.midi || p.key) ? ' bound' : ''));
    row.append(el('span', 'row-label', p.label));
    const osc = el('span', 'row-osc', p.osc); osc.title = 'copy';
    osc.addEventListener('click', (ev) => { ev.stopPropagation(); navigator.clipboard?.writeText(p.osc).catch(() => {}); const o = osc.textContent; osc.textContent = '✓'; setTimeout(() => { osc.textContent = o; }, 600); });
    row.append(osc, cell(p, 'midi'), cell(p, 'key'));
    // Bypass: toggle ⇄ momentary.
    if (p.kind === 'bypass' && (p.midi || p.key)) {
      const mb = el('button', 'row-mode', p.mode); mb.title = 'toggle / momentary';
      mb.addEventListener('click', (ev) => { ev.stopPropagation(); bus.postMessage({ type: 'mode', id: p.id, mode: p.mode === 'toggle' ? 'momentary' : 'toggle' }); });
      row.append(mb);
    } else row.append(el('span', 'row-mode-spacer'));
    paramsEl.append(row);
  }
  updateValues();
}
function headerRow() {
  const h = el('div', 'row row-head');
  h.append(el('span', 'row-label', ''), el('span', 'row-osc', 'OSC'), el('span', 'cell-h', 'MIDI'), el('span', 'cell-h', 'Key'), el('span', 'row-mode-spacer'));
  return h;
}

function updateValues() { for (const r of rowFills) r.el.style.width = (clamp01(channels[r.channel]) * 100) + '%'; }

// While armed, bind the moving channel — filtered to the armed slot (MIDI ignores
// keys; Key only accepts keys).
function tickLearn() {
  if (!learn) return;
  let best = null, bestDelta = 0.2;
  for (const name of Object.keys(channels)) {
    if (learn.slot === 'midi' && name.startsWith('key:')) continue;
    if (learn.slot === 'key' && !name.startsWith('key:')) continue;
    const d = Math.abs(clamp01(channels[name]) - (learnBaseline?.[name] ?? 0));
    if (d > bestDelta) { bestDelta = d; best = name; }
  }
  if (best) { bus.postMessage({ type: 'bind', id: learn.id, channel: best, slot: learn.slot }); learn = null; }
}

function clamp01(v) { v = Number(v) || 0; return v < 0 ? 0 : v > 1 ? 1 : v; }
function el(tag, cls, text) { const n = document.createElement(tag === 'button' || tag === 'span' ? tag : 'div'); n.className = cls; if (text != null) n.textContent = text; return n; }
