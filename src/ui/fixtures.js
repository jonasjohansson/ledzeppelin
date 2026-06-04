import { validate } from '../model/show.js';
import { setFixtureTransform, transformFromPoints } from '../model/fixture-transform.js';
import { pruneChains } from '../model/chains.js';
import { Section } from './section.js';

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

  // Running end of a device's DDP address space (offset must stay contiguous
  // per device — see validate()). Used to append new/duplicated fixtures.
  const deviceEnd = (show, devId) => show.fixtures
    .filter((x) => (x.output?.deviceId || '') === devId)
    .reduce((m, x) => Math.max(m, (x.output?.pixelOffset || 0) + (x.output?.pixelCount || 0)), 0);

  // Inline editor for the selected DEVICE (rendered under its list row).
  function deviceDetail(show, d) {
    const di = show.devices.indexOf(d);
    const upd = (patch) => { const next = structuredClone(show); Object.assign(next.devices[di], patch); commit(next); };
    return el('div', { className: 'fx-card fx-detail' }, [
      field('ID', textInputCommit(d.id, (x) => upd({ id: x }))),
      field('Name', textInputCommit(d.name, (x) => upd({ name: x }))),
      field('IP', textInputCommit(d.ip, (x) => upd({ ip: x }))),
      field('Color Order', selectInput(COLOR_ORDERS, d.colorOrder ?? 'GRB', (x) => upd({ colorOrder: x }))),
      field('Port', numInputCommit(d.port ?? 4048, (x) => upd({ port: x }))),
      // Output calibration (LEDs, not preview): perceptual gamma (~2.2 smooths
      // low-end fades) + a max-brightness cap 0..1.
      field('Gamma', numInputCommit(d.gamma ?? 1, (x) => upd({ gamma: x }), '0.05')),
      field('Max Bright', numInputCommit(d.brightness ?? 1, (x) => upd({ brightness: x }), '0.01')),
      el('button', {
        className: 'fx-del-link', textContent: 'delete device',
        onclick: () => { const next = structuredClone(show); next.devices.splice(di, 1); selDeviceId = null; commit(next); },
      }),
    ]);
  }

  // Inline editor for the selected FIXTURE (DESIGN + routing + SIZE; canvas
  // PLACEMENT lives in Output). Rendered under its list row.
  function fixtureDetail(show, f) {
    const fi = show.fixtures.indexOf(f);
    const tf = f.input.transform || transformFromPoints(f.input.points, show.composition?.canvas);
    const deviceOpts = show.devices.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }));
    const upd = (mutate) => { const next = structuredClone(show); mutate(next.fixtures[fi]); commit(next); };
    return el('div', { className: 'fx-card fx-detail' }, [
      field('ID', textInputCommit(f.id, (x) => upd((nf) => { nf.id = x; }))),
      field('Name', textInputCommit(f.name, (x) => upd((nf) => { nf.name = x; }))),
      field('Pixel Count', numInputCommit(f.pixelCount, (x) => upd((nf) => {
        nf.pixelCount = x; nf.output.pixelCount = x;       // keep in sync (validate requires match)
        if (nf.input) nf.input.samples = nf.input.samples || x;
      }))),
      field('Color Order', selectInput(COLOR_ORDERS, f.colorOrder ?? 'GRB', (x) => upd((nf) => { nf.colorOrder = x; }))),
      field('Device', selectInput(deviceOpts.length ? deviceOpts : [{ value: '', label: '(none)' }],
        f.output.deviceId, (x) => upd((nf) => { nf.output.deviceId = x; }))),
      field('Pixel Offset', numInputCommit(f.output.pixelOffset, (x) => upd((nf) => { nf.output.pixelOffset = x; }))),
      field('Samples', numInputCommit(f.input.samples, (x) => upd((nf) => { nf.input.samples = x; }))),
      el('div', { className: 'fx-pts', textContent: 'size (px)' }),
      field('Width', numInputCommit(Math.round(tf.w), (v) => commit(setFixtureTransform(show, f.id, { w: v })))),
      field('Height', numInputCommit(Math.round(tf.h), (v) => commit(setFixtureTransform(show, f.id, { h: v })))),
      el('div', { className: 'fx-detail-actions' }, [
        el('button', { className: 'fx-del-link', textContent: 'duplicate', onclick: () => duplicateFixture(show, f) }),
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
      ]),
    ]);
  }

  // Append a fresh generic strip (150px GRB bar) on the first device,
  // contiguous in that device's address space; select it.
  function newFixture(show) {
    const next = structuredClone(show);
    const id = `f${next.fixtures.length + 1}`;
    const devId = next.devices[0]?.id ?? '';
    const px = 150;
    next.fixtures.push({
      id, name: id, pixelCount: px, colorOrder: 'GRB',
      output: { deviceId: devId, pixelOffset: deviceEnd(next, devId), pixelCount: px },
      input: { points: [[0.05, 0.5], [0.95, 0.5]], samples: px },
    });
    selFixtureId = id;
    commit(next);
    return id;
  }

  // Clone the selected fixture (same device/colorOrder/geometry), appended
  // contiguously in its device's address space.
  function duplicateFixture(show, f) {
    const next = structuredClone(show);
    const src = next.fixtures.find((x) => x.id === f.id);
    let n = 1; let id;
    do { id = `${f.id}-copy${n > 1 ? n : ''}`; n++; } while (next.fixtures.some((x) => x.id === id));
    const devId = src.output?.deviceId || '';
    const copy = structuredClone(src);
    copy.id = id;
    copy.name = `${f.name || f.id} copy`;
    copy.output.pixelOffset = deviceEnd(next, devId);
    next.fixtures.push(copy);
    selFixtureId = id;
    commit(next);
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

    // Pixels routed to one device (hidden fixtures still occupy DDP address space).
    const devicePixels = (devId) => show.fixtures
      .filter((f) => (f.output?.deviceId || '') === devId)
      .reduce((m, f) => m + (f.pixelCount || 0), 0);

    // --- Devices (collapsible: selectable list → inline editor under the row) ---
    if (!show.devices.some((d) => d.id === selDeviceId)) selDeviceId = show.devices[0]?.id ?? null;
    root.append(Section('Devices', 'devices', (b) => {
      const devList = el('div', { className: 'fx-list' });
      for (const d of show.devices) {
        devList.append(listRow(d.name || d.id, [d.ip || 'no ip', d.colorOrder || 'GRB', `${devicePixels(d.id)} px`],
          d.id === selDeviceId, () => { selDeviceId = d.id; render(); }));
        if (d.id === selDeviceId) devList.append(deviceDetail(show, d));
      }
      b.append(devList);
      // Grand total across the whole patch.
      const totalPx = show.fixtures.reduce((m, f) => m + (f.pixelCount || 0), 0);
      b.append(el('div', { className: 'fx-budget',
        textContent: `${totalPx} px · ${show.devices.length} device${show.devices.length === 1 ? '' : 's'}` }));
      b.append(el('button', {
        className: 'fx-add', textContent: '+ device',
        onclick: () => {
          const next = structuredClone(show);
          const id = `c${next.devices.length + 1}`;
          next.devices.push({ id, name: id, ip: '127.0.0.1', colorOrder: 'GRB', port: 4048 });
          selDeviceId = id;
          commit(next);
        },
      }));
    }));

    // --- Fixtures (collapsible: selectable list → inline editor under the row) ---
    if (!show.fixtures.some((f) => f.id === selFixtureId)) selFixtureId = show.fixtures[0]?.id ?? null;
    root.append(Section('Fixtures', 'fixtures', (b) => {
      const fxList = el('div', { className: 'fx-list' });
      for (const f of show.fixtures) {
        const o = f.output || {};
        const range = `${o.pixelOffset ?? 0}–${(o.pixelOffset ?? 0) + (o.pixelCount ?? 0)}`;
        fxList.append(listRow(f.name || f.id, [o.deviceId || '—', `${range} px`],
          f.id === selFixtureId, () => { selFixtureId = f.id; render(); }));
        if (f.id === selFixtureId) fxList.append(fixtureDetail(show, f));
      }
      b.append(fxList);
      b.append(el('button', {
        className: 'fx-add', textContent: '+ fixture',
        onclick: () => { selFixtureId = newFixture(show); },
      }));
    }));

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
