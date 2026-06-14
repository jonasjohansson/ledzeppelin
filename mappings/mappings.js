// Mappings window — talks to the editor over BroadcastChannel. Click a parameter
// row to ARM it (Ableton-style), then move a control / press a key to bind. Bound
// rows show the live value moving. The editor owns the show.

const bus = new BroadcastChannel('lz-mappings');
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), chipsEl = $('chips'), paramsEl = $('params');

let params = [];                 // [{ id, group, label, osc, channel, min, max }]
let channels = {};               // { channel: value }
let learnId = null;              // row currently armed
let learnBaseline = null;        // channel snapshot at arm time
let rowFills = [];               // [{ channel, el }] live value bars to update
let lastBus = 0;

bus.postMessage({ type: 'hello' });
$('enable-midi').addEventListener('click', () => bus.postMessage({ type: 'enableMidi' }));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (learnId) { learnId = null; renderParams(); } return; }
  if (!e.repeat && !typing(e.target)) bus.postMessage({ type: 'key', code: e.code, down: true });
});
addEventListener('keyup', (e) => { if (!typing(e.target)) bus.postMessage({ type: 'key', code: e.code, down: false }); });
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

bus.onmessage = (e) => {
  const m = e.data || {};
  lastBus = performance.now();
  statusEl.textContent = 'connected';
  if (m.type === 'params') { params = m.data || []; renderParams(); }
  else if (m.type === 'channels') { channels = m.data || {}; renderChips(); updateValues(); tickLearn(); }
  else if (m.type === 'midi') {
    const btn = $('enable-midi'), st = $('midi-status');
    btn.disabled = !!m.enabled; btn.textContent = m.enabled ? 'MIDI on ✓' : 'enable MIDI';
    st.textContent = m.enabled ? (m.inputs?.length ? m.inputs.join(', ') : 'no inputs') : '';
  }
};
setInterval(() => { if (performance.now() - lastBus > 1500) statusEl.textContent = 'editor closed?'; }, 1000);

function renderChips() {
  const names = Object.keys(channels).sort();
  if (!names.length) { chipsEl.innerHTML = '<span class="chip-empty">touch a knob · press a key · send OSC</span>'; return; }
  chipsEl.textContent = '';
  for (const name of names) {
    const v = clamp01(channels[name]);
    const chip = document.createElement('div'); chip.className = 'chip';
    chip.append(el('span', 'chip-name', name));
    const bar = el('div', 'chip-bar'); const fill = el('div', 'chip-fill'); fill.style.width = (v * 100) + '%';
    bar.append(fill); chip.append(bar); chipsEl.append(chip);
  }
}

function renderParams() {
  rowFills = [];
  if (!params.length) { paramsEl.innerHTML = '<span class="chip-empty">add a clip in the editor</span>'; return; }
  paramsEl.textContent = '';
  let lastGroup = null;
  for (const p of params) {
    if (p.group !== lastGroup) { lastGroup = p.group; paramsEl.append(el('div', 'grp', p.group)); }
    const armed = learnId === p.id;
    const row = el('div', 'row' + (armed ? ' armed' : '') + (p.channel ? ' bound' : ''));
    row.append(el('span', 'row-label', p.label));
    // OSC address — click to copy (doesn't arm the row).
    const osc = el('span', 'row-osc', p.osc); osc.title = 'copy';
    osc.addEventListener('click', (ev) => { ev.stopPropagation(); navigator.clipboard?.writeText(p.osc).catch(() => {}); const o = osc.textContent; osc.textContent = '✓'; setTimeout(() => { osc.textContent = o; }, 600); });
    // Value/binding cell: armed → prompt; bound → channel name + live bar; else —.
    const cell = el('div', 'row-chan');
    if (armed) { cell.append(el('span', 'row-arm', 'move a control…')); }
    else if (p.channel) {
      cell.append(el('span', 'row-channame', p.channel));
      const bar = el('div', 'row-bar'); const fill = el('div', 'row-fill'); bar.append(fill); cell.append(bar);
      rowFills.push({ channel: p.channel, el: fill });
      const x = el('button', 'm-x', '×'); x.title = 'clear'; x.addEventListener('click', (ev) => { ev.stopPropagation(); bus.postMessage({ type: 'clear', id: p.id }); }); cell.append(x);
    } else { cell.append(el('span', 'row-none', '—')); }
    row.append(osc, cell);
    row.addEventListener('click', () => { learnId = armed ? null : p.id; learnBaseline = { ...channels }; renderParams(); });
    paramsEl.append(row);
  }
  updateValues();
}

function updateValues() { for (const r of rowFills) r.el.style.width = (clamp01(channels[r.channel]) * 100) + '%'; }

// While armed, bind the channel that moves clearly from its baseline.
function tickLearn() {
  if (!learnId) return;
  let best = null, bestDelta = 0.2;
  for (const name of Object.keys(channels)) {
    const d = Math.abs(clamp01(channels[name]) - (learnBaseline?.[name] ?? 0));
    if (d > bestDelta) { bestDelta = d; best = name; }
  }
  if (best) { bus.postMessage({ type: 'bind', id: learnId, channel: best }); learnId = null; }
}

function clamp01(v) { v = Number(v) || 0; return v < 0 ? 0 : v > 1 ? 1 : v; }
function el(tag, cls, text) { const n = document.createElement(tag === 'span' || tag === 'div' || tag === 'button' ? tag : 'div'); n.className = cls; if (text != null) n.textContent = text; return n; }
