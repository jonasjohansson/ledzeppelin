import { validate } from '../model/show.js';
import { setFixtureTransform, transformFromPoints } from '../model/fixture-transform.js';

const STORAGE_KEY = 'ledzeppelin.show';
const COLOR_ORDERS = ['RGB', 'GRB', 'BGR', 'RBG', 'GBR', 'BRG'];

export function loadShow() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt storage */ }
  return null;
}

export function saveShow(show) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(show)); } catch { /* quota */ }
}

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};

const numInput = (value, onInput, step = 'any') => {
  const i = el('input', { type: 'number', value: String(value ?? 0), step });
  i.addEventListener('input', () => onInput(i.value === '' ? 0 : Number(i.value)));
  return i;
};

// Commits on `change` (blur / Enter) rather than every keystroke — used for the
// transform fields whose onInput re-renders the panel (so typing isn't cut off).
const numInputCommit = (value, onCommit, step = '1') => {
  const i = el('input', { type: 'number', value: String(value ?? 0), step });
  i.addEventListener('change', () => onCommit(i.value === '' ? 0 : Number(i.value)));
  return i;
};

const textInput = (value, onInput) => {
  const i = el('input', { type: 'text', value: value ?? '' });
  i.addEventListener('input', () => onInput(i.value));
  return i;
};

const selectInput = (options, value, onInput) => {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', { value: o.value ?? o, textContent: o.label ?? o });
    if ((o.value ?? o) === value) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => onInput(s.value));
  return s;
};

const field = (label, control) =>
  el('label', { className: 'fx-field' }, [el('span', { textContent: label }), control]);

// createFixturePanel({ getShow, setShow, onChange })
// - getShow(): current show
// - setShow(show): persist + rebuild (caller wires this to app.rebuild)
// - returns { el, refresh() }
export function createFixturePanel({ getShow, setShow }) {
  const root = el('div', { className: 'fx-panel' });

  function commit(next) {
    saveShow(next);
    setShow(next);
    render();
  }

  function render() {
    const show = getShow();
    root.textContent = '';

    const v = validate(show);
    root.append(el('div', { className: 'fx-title', textContent: 'Show editor' }));

    // --- Validation banner ---
    const banner = el('div', { className: v.ok ? 'fx-ok' : 'fx-err' });
    banner.textContent = v.ok ? 'valid' : v.errors.join(' · ');
    root.append(banner);

    // --- Devices ---
    root.append(el('div', { className: 'fx-section', textContent: 'Devices' }));
    for (let i = 0; i < show.devices.length; i++) {
      const d = show.devices[i];
      const upd = (patch) => {
        const next = structuredClone(show);
        Object.assign(next.devices[i], patch);
        commit(next);
      };
      const card = el('div', { className: 'fx-card' }, [
        field('id', textInput(d.id, (x) => upd({ id: x }))),
        field('name', textInput(d.name, (x) => upd({ name: x }))),
        field('ip', textInput(d.ip, (x) => upd({ ip: x }))),
        field('colorOrder', selectInput(COLOR_ORDERS, d.colorOrder ?? 'GRB', (x) => upd({ colorOrder: x }))),
        field('port', numInput(d.port ?? 4048, (x) => upd({ port: x }), '1')),
      ]);
      card.append(el('button', {
        className: 'fx-del', textContent: 'delete device',
        onclick: () => {
          const next = structuredClone(show);
          next.devices.splice(i, 1);
          commit(next);
        },
      }));
      root.append(card);
    }
    root.append(el('button', {
      className: 'fx-add', textContent: '+ device',
      onclick: () => {
        const next = structuredClone(show);
        const id = `c${next.devices.length + 1}`;
        next.devices.push({ id, name: id, ip: '127.0.0.1', colorOrder: 'GRB', port: 4048 });
        commit(next);
      },
    }));

    // --- Fixtures ---
    root.append(el('div', { className: 'fx-section', textContent: 'Fixtures' }));
    const deviceOpts = show.devices.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }));
    for (let i = 0; i < show.fixtures.length; i++) {
      const f = show.fixtures[i];
      const tf = f.input.transform || transformFromPoints(f.input.points, show.composition?.canvas);
      const upd = (mutate) => {
        const next = structuredClone(show);
        mutate(next.fixtures[i]);
        commit(next);
      };
      const card = el('div', { className: 'fx-card' }, [
        field('id', textInput(f.id, (x) => upd((nf) => { nf.id = x; }))),
        field('name', textInput(f.name, (x) => upd((nf) => { nf.name = x; }))),
        field('pixelCount', numInput(f.pixelCount, (x) => upd((nf) => {
          nf.pixelCount = x;
          nf.output.pixelCount = x;            // keep output count in sync (validate requires match)
          if (nf.input) nf.input.samples = nf.input.samples || x;
        }), '1')),
        field('colorOrder', selectInput(COLOR_ORDERS, f.colorOrder ?? 'GRB', (x) => upd((nf) => { nf.colorOrder = x; }))),
        field('device', selectInput(deviceOpts.length ? deviceOpts : [{ value: '', label: '(none)' }],
          f.output.deviceId, (x) => upd((nf) => { nf.output.deviceId = x; }))),
        field('pixelOffset', numInput(f.output.pixelOffset, (x) => upd((nf) => { nf.output.pixelOffset = x; }), '1')),
        field('samples', numInput(f.input.samples, (x) => upd((nf) => { nf.input.samples = x; }), '1')),
        el('div', { className: 'fx-pts', textContent: 'transform (px) — drag on the canvas to move' }),
        field('x', numInputCommit(Math.round(tf.x), (v) => commit(setFixtureTransform(show, f.id, { x: v })))),
        field('y', numInputCommit(Math.round(tf.y), (v) => commit(setFixtureTransform(show, f.id, { y: v })))),
        field('width', numInputCommit(Math.round(tf.w), (v) => commit(setFixtureTransform(show, f.id, { w: v })))),
        field('height', numInputCommit(Math.round(tf.h), (v) => commit(setFixtureTransform(show, f.id, { h: v })))),
        field('rotation°', numInputCommit(Math.round(tf.rotation), (v) => commit(setFixtureTransform(show, f.id, { rotation: v })))),
      ]);
      card.append(el('button', {
        className: 'fx-del', textContent: 'delete fixture',
        onclick: () => {
          const next = structuredClone(show);
          next.fixtures.splice(i, 1);
          commit(next);
        },
      }));
      root.append(card);
    }
    root.append(el('button', {
      className: 'fx-add', textContent: '+ fixture',
      onclick: () => {
        const next = structuredClone(show);
        const id = `f${next.fixtures.length + 1}`;
        const off = next.fixtures.reduce((m, x) => Math.max(m, x.output.pixelOffset + x.output.pixelCount), 0);
        const px = 150;
        next.fixtures.push({
          id, name: id, pixelCount: px, colorOrder: 'GRB',
          output: { deviceId: next.devices[0]?.id ?? '', pixelOffset: off, pixelCount: px },
          input: { points: [[0.05, 0.5], [0.95, 0.5]], samples: px },
        });
        commit(next);
      },
    }));

    // --- Persistence (File API) ---
    const io = el('div', { className: 'fx-io' });
    io.append(el('button', {
      textContent: 'Save (download)',
      onclick: () => {
        const blob = new Blob([JSON.stringify(getShow(), null, 2)], { type: 'application/json' });
        const a = el('a', { href: URL.createObjectURL(blob), download: 'show.json' });
        a.click();
        URL.revokeObjectURL(a.href);
      },
    }));
    const fileIn = el('input', { type: 'file', accept: '.json,application/json' });
    fileIn.style.display = 'none';
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files[0];
      if (!file) return;
      try {
        const loaded = JSON.parse(await file.text());
        commit(loaded);
      } catch (e) { banner.className = 'fx-err'; banner.textContent = `load failed: ${e.message}`; }
      fileIn.value = '';
    });
    io.append(el('button', { textContent: 'Load (file)', onclick: () => fileIn.click() }), fileIn);
    root.append(io);
  }

  render();
  return { el: root, refresh: render };
}
