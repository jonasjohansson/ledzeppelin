// Mappings window — a separate browser window that talks to the editor over a
// BroadcastChannel. It shows live channel values (MIDI/OSC/keyboard) and a table
// of every bindable parameter with its OSC address + current binding, and lets
// you Learn (move a control → bind) or Clear. The editor owns the show; this
// window only sends bind/clear/key/enableMidi and renders what the editor streams.

const bus = new BroadcastChannel('lz-mappings');
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), chipsEl = $('chips'), paramsEl = $('params');

let params = [];                 // [{ id, group, label, osc, channel, min, max }]
let channels = {};               // { channel: value }
let learnId = null;              // row currently learning
let learnBaseline = null;        // channel snapshot captured when Learn armed
let lastBus = 0;

bus.postMessage({ type: 'hello' });
$('enable-midi').addEventListener('click', () => bus.postMessage({ type: 'enableMidi' }));

// Keys pressed in THIS window also register (relayed to the editor as channels).
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
addEventListener('keydown', (e) => { if (!e.repeat && !typing(e.target)) bus.postMessage({ type: 'key', code: e.code, down: true }); });
addEventListener('keyup', (e) => { if (!typing(e.target)) bus.postMessage({ type: 'key', code: e.code, down: false }); });

bus.onmessage = (e) => {
  const m = e.data || {};
  lastBus = performance.now();
  statusEl.textContent = 'connected to editor';
  if (m.type === 'params') { params = m.data || []; renderParams(); }
  else if (m.type === 'channels') { channels = m.data || {}; renderChips(); tickLearn(); }
};
setInterval(() => { if (performance.now() - lastBus > 1500) statusEl.textContent = 'editor not responding — is it open?'; }, 1000);

function renderChips() {
  const names = Object.keys(channels).sort();
  if (!names.length) { chipsEl.innerHTML = '<span class="chip-empty">no channels yet — enable MIDI / send OSC / press a mapped key</span>'; return; }
  chipsEl.textContent = '';
  for (const name of names) {
    const v = Math.max(0, Math.min(1, Number(channels[name]) || 0));
    const chip = document.createElement('div'); chip.className = 'chip';
    const n = document.createElement('span'); n.className = 'chip-name'; n.textContent = name;
    const bar = document.createElement('div'); bar.className = 'chip-bar';
    const fill = document.createElement('div'); fill.className = 'chip-fill'; fill.style.width = (v * 100) + '%';
    bar.append(fill); chip.append(n, bar); chipsEl.append(chip);
  }
}

function renderParams() {
  if (!params.length) { paramsEl.innerHTML = '<span class="hint">no parameters — add a clip in the editor</span>'; return; }
  paramsEl.textContent = '';
  let lastGroup = null;
  for (const p of params) {
    if (p.group !== lastGroup) { lastGroup = p.group; const g = document.createElement('div'); g.className = 'grp'; g.textContent = p.group; paramsEl.append(g); }
    const row = document.createElement('div'); row.className = 'row';
    const label = document.createElement('span'); label.className = 'row-label'; label.textContent = p.label;
    const osc = document.createElement('span'); osc.className = 'row-osc'; osc.textContent = p.osc; osc.title = 'click to copy';
    osc.addEventListener('click', () => { navigator.clipboard?.writeText(p.osc).catch(() => {}); const o = osc.textContent; osc.textContent = 'copied ✓'; setTimeout(() => { osc.textContent = o; }, 700); });
    const chan = document.createElement('span'); chan.className = 'row-chan' + (p.channel ? '' : ' none'); chan.textContent = p.channel || '—';
    const acts = document.createElement('div'); acts.className = 'row-acts';
    const learn = document.createElement('button'); learn.className = 'm-btn' + (learnId === p.id ? ' learning' : '');
    learn.textContent = learnId === p.id ? 'move a control…' : 'learn';
    learn.addEventListener('click', () => (learnId === p.id ? cancelLearn() : armLearn(p.id)));
    acts.append(learn);
    if (p.channel) { const clr = document.createElement('button'); clr.className = 'm-btn'; clr.textContent = 'clear'; clr.addEventListener('click', () => bus.postMessage({ type: 'clear', id: p.id })); acts.append(clr); }
    row.append(label, osc, chan, acts); paramsEl.append(row);
  }
}

function armLearn(id) { learnId = id; learnBaseline = { ...channels }; renderParams(); }
function cancelLearn() { learnId = null; learnBaseline = null; renderParams(); }

// While learning, watch for the channel that moved most from its baseline and bind it.
function tickLearn() {
  if (!learnId) return;
  let best = null, bestDelta = 0.2;   // require a clear move (avoids noise)
  for (const name of Object.keys(channels)) {
    const base = learnBaseline?.[name] ?? 0;
    const delta = Math.abs((Number(channels[name]) || 0) - base);
    if (delta > bestDelta) { bestDelta = delta; best = name; }
  }
  if (best) { bus.postMessage({ type: 'bind', id: learnId, channel: best }); learnId = null; learnBaseline = null; }
}
