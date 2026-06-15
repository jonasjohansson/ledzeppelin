// Companion phone remote — a lightweight standalone page (NO engine imports).
//
// Connects to the daemon's /frames WebSocket (the same one the editor uses),
// asks for the control manifest, renders the MASTER controls (every layer's
// opacity + bypass + a clip-trigger grid) and the CUSTOM params the editor
// ticked, and drives everything by sending the canonical OSC addresses back as
// { type:'ext', channel, value } — the daemon relays them to the editor, which
// routes them through the same address map. Values are normalized 0..1.

const app = document.getElementById('app');
const dot = document.getElementById('dot');
const title = document.getElementById('title');

let ws = null, reqTimer = null, gotManifest = false, backoff = 500, lastSig = '';

// A signature of the manifest's STRUCTURE (ignores live values) so we only
// rebuild the DOM when the layout actually changes.
const structSig = (m) => JSON.stringify([
  (m.layers || []).map((L) => [L.n, L.name, L.bypass, (L.clips || []).map((c) => [c.m, c.name, c.active])]),
  (m.controls || []).map((c) => [c.address, c.label]),
]);

function setStatus(on, text) {
  dot.classList.toggle('on', on);
  title.textContent = text;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/frames`);
  ws.addEventListener('open', () => {
    backoff = 500;
    setStatus(true, 'Control — connected');
    // Ask for the manifest, and keep asking until one arrives (the editor may
    // connect after us).
    askManifest();
    reqTimer = setInterval(() => { if (!gotManifest) askManifest(); }, 1000);
  });
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return;          // binary frames aren't for us
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'manifest' && m.data) {
      gotManifest = true;
      // Re-render only when the STRUCTURE changes (layers/clips/bypass/exposed
      // params) — not on every value tick, which would rebuild the DOM and
      // interrupt a finger on a slider. The phone owns its own slider positions.
      const sig = structSig(m.data);
      if (sig !== lastSig) { lastSig = sig; render(m.data); }
    }
  });
  ws.addEventListener('close', () => {
    clearInterval(reqTimer); reqTimer = null;
    setStatus(false, 'Control — reconnecting…');
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  });
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* */ } });
}

const send = (channel, value) => { try { ws?.send(JSON.stringify({ type: 'ext', channel, value })); } catch { /* */ } };
const askManifest = () => { try { ws?.send(JSON.stringify({ type: 'manifest-req' })); } catch { /* */ } };

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const k in props) n[k] = props[k];
  for (const k of kids) n.append(k);
  return n;
};

function fader(value, onInput) {
  const r = el('input', { type: 'range', min: '0', max: '1', step: '0.001', value: String(value) });
  r.addEventListener('input', () => onInput(Number(r.value)));
  return r;
}

function render(manifest) {
  app.textContent = '';
  const layers = manifest.layers || [];
  const controls = manifest.controls || [];
  if (!layers.length) {
    app.append(el('div', { className: 'empty', textContent: 'No layers in the show yet.' }));
    return;
  }

  // MASTER: one card per layer — name, Block (bypass), opacity, clip triggers.
  for (const L of layers) {
    const card = el('div', { className: 'layer' });
    const blk = el('button', { className: 'blk' + (L.bypass ? ' on' : ''), textContent: 'B', title: 'block (mute) this layer' });
    blk.onclick = () => { const next = !blk.classList.contains('on'); blk.classList.toggle('on', next); send(`/layer/${L.n}/bypass`, next ? 1 : 0); };
    card.append(el('div', { className: 'layer-head' }, [el('div', { className: 'layer-name', textContent: L.name }), blk]));

    if ((L.clips || []).length) {
      const grid = el('div', { className: 'clips' });
      for (const c of L.clips) {
        const btn = el('button', { className: 'clip' + (c.active ? ' active' : '') });
        const thumb = el('div', { className: 'clip-thumb' });
        if (c.thumb) thumb.style.backgroundImage = `url(${c.thumb})`;
        btn.append(thumb, el('div', { className: 'clip-name', textContent: c.name }));
        btn.onclick = () => send(`/layer/${L.n}/clip/${c.m}/trigger`, 1);
        grid.append(btn);
      }
      card.append(grid);
    }

    // Layer opacity fader.
    const ctrl = el('div', { className: 'ctrl' });
    const valEl = el('span', { className: 'val', textContent: Math.round((L.opacity ?? 1) * 100) + '%' });
    ctrl.append(el('div', { className: 'ctrl-row' }, [el('span', { className: 'lab', textContent: 'Opacity' }), valEl]));
    ctrl.append(fader(L.opacity ?? 1, (v) => { valEl.textContent = Math.round(v * 100) + '%'; send(`/layer/${L.n}/opacity`, v); }));
    card.append(ctrl);
    app.append(card);
  }

  // CUSTOM: the params ticked in the editor's cog menu.
  if (controls.length) {
    app.append(el('div', { className: 'section-label', textContent: 'Parameters' }));
    const card = el('div', { className: 'layer' });
    for (const c of controls) {
      const span = (c.max - c.min) || 1;
      const norm = Math.max(0, Math.min(1, ((c.value ?? c.min) - c.min) / span));
      const ctrl = el('div', { className: 'ctrl' });
      const valEl = el('span', { className: 'val', textContent: fmt(c.value ?? c.min) });
      ctrl.append(el('div', { className: 'ctrl-row' }, [el('span', { className: 'lab', textContent: c.label }), valEl]));
      ctrl.append(fader(norm, (v) => { valEl.textContent = fmt(c.min + span * v); send(c.address, v); }));
      card.append(ctrl);
    }
    app.append(card);
  }
}

const fmt = (v) => { const n = Number(v); return Number.isInteger(n) ? String(n) : n.toFixed(2); };

connect();

// PWA: register the remote's own service worker (scope /remote/) so it installs
// as a home-screen app and opens offline. Secure-context only; best-effort.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => { /* non-fatal */ });
}
