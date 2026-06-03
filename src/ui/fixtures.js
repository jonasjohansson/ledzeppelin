import { validate } from '../model/show.js';
import { setFixtureTransform, transformFromPoints } from '../model/fixture-transform.js';
import { pruneChains } from '../model/chains.js';

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

// Commits on `change` (blur / Enter) — for detail-editor fields whose commit
// re-renders the panel, so the input keeps focus while typing.
const textInputCommit = (value, onCommit) => {
  const i = el('input', { type: 'text', value: value ?? '' });
  i.addEventListener('change', () => onCommit(i.value));
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
  let selDeviceId = null;   // master-detail: which device/fixture's editor is open
  let selFixtureId = null;

  function commit(next) {
    saveShow(next);
    setShow(next);
    render();
  }

  function render() {
    const show = getShow();
    root.textContent = '';

    const v = validate(show);
    root.append(el('div', { className: 'fx-title', textContent: 'show editor' }));

    // --- Validation banner ---
    const banner = el('div', { className: v.ok ? 'fx-ok' : 'fx-err' });
    banner.textContent = v.ok ? 'valid' : v.errors.join(' · ');
    root.append(banner);

    // Compact selectable row (master): name + a couple of badges. Clicking opens
    // its editor below. Reuses the Output tab's list styling.
    const listRow = (label, badges, selected, onClick) => {
      const row = el('div', { className: 'output-row' + (selected ? ' selected' : '') });
      row.append(el('span', { textContent: label }));
      for (const bdg of badges) row.append(el('span', { className: 'fx-badge', textContent: bdg }));
      row.onclick = onClick;
      return row;
    };

    // --- Devices (list → edit the selected one) ---
    root.append(el('div', { className: 'fx-section', textContent: 'Devices' }));
    if (!show.devices.some((d) => d.id === selDeviceId)) selDeviceId = show.devices[0]?.id ?? null;
    const devList = el('div', { className: 'fx-list' });
    for (const d of show.devices) {
      devList.append(listRow(d.name || d.id, [d.ip || 'no ip', d.colorOrder || 'GRB'],
        d.id === selDeviceId, () => { selDeviceId = d.id; render(); }));
    }
    root.append(devList);
    root.append(el('button', {
      className: 'fx-add', textContent: '+ device',
      onclick: () => {
        const next = structuredClone(show);
        const id = `c${next.devices.length + 1}`;
        next.devices.push({ id, name: id, ip: '127.0.0.1', colorOrder: 'GRB', port: 4048 });
        selDeviceId = id;
        commit(next);
      },
    }));
    const selDev = show.devices.find((d) => d.id === selDeviceId);
    if (selDev) {
      const di = show.devices.indexOf(selDev);
      const upd = (patch) => { const next = structuredClone(show); Object.assign(next.devices[di], patch); commit(next); };
      root.append(el('div', { className: 'fx-card fx-detail' }, [
        field('id', textInputCommit(selDev.id, (x) => upd({ id: x }))),
        field('name', textInputCommit(selDev.name, (x) => upd({ name: x }))),
        field('ip', textInputCommit(selDev.ip, (x) => upd({ ip: x }))),
        field('color order', selectInput(COLOR_ORDERS, selDev.colorOrder ?? 'GRB', (x) => upd({ colorOrder: x }))),
        field('port', numInputCommit(selDev.port ?? 4048, (x) => upd({ port: x }))),
        // Output calibration (LEDs, not preview): perceptual gamma (~2.2 smooths
        // low-end fades) + a max-brightness cap 0..1.
        field('gamma', numInputCommit(selDev.gamma ?? 1, (x) => upd({ gamma: x }), '0.05')),
        field('max bright', numInputCommit(selDev.brightness ?? 1, (x) => upd({ brightness: x }), '0.01')),
        el('button', {
          className: 'fx-del-link', textContent: 'delete device',
          onclick: () => { const next = structuredClone(show); next.devices.splice(di, 1); selDeviceId = null; commit(next); },
        }),
      ]));
    }

    // --- Fixtures (list → edit the selected one) ---
    root.append(el('div', { className: 'fx-section', textContent: 'Fixtures' }));
    const deviceOpts = show.devices.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }));
    if (!show.fixtures.some((f) => f.id === selFixtureId)) selFixtureId = show.fixtures[0]?.id ?? null;
    const fxList = el('div', { className: 'fx-list' });
    for (const f of show.fixtures) {
      const o = f.output || {};
      const range = `${o.pixelOffset ?? 0}–${(o.pixelOffset ?? 0) + (o.pixelCount ?? 0)}`;
      fxList.append(listRow(f.name || f.id, [o.deviceId || '—', `${range} px`],
        f.id === selFixtureId, () => { selFixtureId = f.id; render(); }));
    }
    root.append(fxList);
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
        selFixtureId = id;
        commit(next);
      },
    }));
    const selFx = show.fixtures.find((f) => f.id === selFixtureId);
    if (selFx) {
      const fi = show.fixtures.indexOf(selFx);
      const tf = selFx.input.transform || transformFromPoints(selFx.input.points, show.composition?.canvas);
      const upd = (mutate) => { const next = structuredClone(show); mutate(next.fixtures[fi]); commit(next); };
      // The Fixtures tab is DESIGN + routing + SIZE; canvas PLACEMENT lives in Output.
      root.append(el('div', { className: 'fx-card fx-detail' }, [
        field('id', textInputCommit(selFx.id, (x) => upd((nf) => { nf.id = x; }))),
        field('name', textInputCommit(selFx.name, (x) => upd((nf) => { nf.name = x; }))),
        field('pixel count', numInputCommit(selFx.pixelCount, (x) => upd((nf) => {
          nf.pixelCount = x; nf.output.pixelCount = x;       // keep in sync (validate requires match)
          if (nf.input) nf.input.samples = nf.input.samples || x;
        }))),
        field('color order', selectInput(COLOR_ORDERS, selFx.colorOrder ?? 'GRB', (x) => upd((nf) => { nf.colorOrder = x; }))),
        field('device', selectInput(deviceOpts.length ? deviceOpts : [{ value: '', label: '(none)' }],
          selFx.output.deviceId, (x) => upd((nf) => { nf.output.deviceId = x; }))),
        field('pixel offset', numInputCommit(selFx.output.pixelOffset, (x) => upd((nf) => { nf.output.pixelOffset = x; }))),
        field('samples', numInputCommit(selFx.input.samples, (x) => upd((nf) => { nf.input.samples = x; }))),
        el('div', { className: 'fx-pts', textContent: 'size (px)' }),
        field('width', numInputCommit(Math.round(tf.w), (v) => commit(setFixtureTransform(show, selFx.id, { w: v })))),
        field('height', numInputCommit(Math.round(tf.h), (v) => commit(setFixtureTransform(show, selFx.id, { h: v })))),
        el('button', {
          className: 'fx-del-link', textContent: 'delete fixture',
          onclick: () => {
            let next = structuredClone(show);
            next.fixtures.splice(fi, 1);
            next = pruneChains(next);          // keep chain stagger indices valid
            selFixtureId = null;
            commit(next);
          },
        }),
      ]));
    }

    // --- Persistence (File API) ---
    const io = el('div', { className: 'fx-io' });
    io.append(el('button', {
      textContent: 'save (download)',
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
    io.append(el('button', { textContent: 'load (file)', onclick: () => fileIn.click() }), fileIn);
    root.append(io);
  }

  render();
  return { el: root, refresh: render };
}
