import { validate, makeFixtureType, typeInstanceCount, makeDeviceType, deviceTypeInstanceCount } from '../model/show.js';
import { fixtureLabel, fixtureRange } from '../model/fixture-transform.js';
import { Section } from './section.js';
import { controllerColorMap } from '../model/chains.js';
import { getDeviceState, setDeviceState, identify, scanDevices, pushDeviceConfig } from '../wled.js';
import { el, field, selectInput, shiftDown, coarseSnap } from './dom.js';
import { Slider } from './controls.js';
import { NumInput, TextInput } from './kit/field.js';
import { ListRow } from './kit/listrow.js';
import { DMX_CHANNEL_KINDS, colorFormatChannels, fixtureTypeChannels } from '../model/dmx.js';
import { confirmDelete } from './confirm.js';
import { DISTRIBUTIONS, gridCellOrder } from '../model/grid.js';

const STORAGE_KEY = 'ledzeppelin.show';
// Controller colour ORDER: the RGB wiring order (the per-fixture Color Format below
// can override this and add a White channel).
const COLOR_ORDERS = ['RGB', 'GRB', 'BGR', 'RBG', 'GBR', 'BRG'];
// Per-FIXTURE colour FORMAT options: '' inherits the controller's order; the rest
// pin this fixture's format, including RGBW variants (White = min(R,G,B) at output)
// so RGB and RGBW strips can share one controller.
const COLOR_FORMATS = [{ value: '', label: 'From controller' }, ...COLOR_ORDERS,
  'RGBW', 'GRBW', 'BGRW', 'RBGW', 'WRGB', 'WGRB', 'RGBA', 'RGBWA', 'RGBAW',
  { value: 'NONE', label: 'None (channels only)' }];
const hexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [255, 255, 255]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

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

// Input helpers now route through the kit (kit/field.js) so every input behaves
// identically; these keep the local names/signatures the call sites already use.
const numInput = (value, onInput, step = 'any') => NumInput(value, { onInput, step });
const numInputCommit = (value, onCommit, step = 1) => NumInput(value, { onInput: onCommit, commit: 'release', step, min: 0 });
const textInput = (value, onInput) => TextInput(value, { onInput });
const textInputCommit = (value, onCommit) => TextInput(value, { onInput: onCommit, commit: 'release' });

// Library / device spec slider. Same control as Design's, but commits on RELEASE
// (not every drag tick) so the panel isn't rebuilt mid-drag. Thin wrapper over Slider.
const sliderRow = (label, value, onCommit, min, max, step) =>
  Slider(label, value, { min, max, onInput: onCommit, step: step ?? ((max - min) <= 2 ? 0.01 : (max - min) <= 60 ? 0.1 : 1), commit: 'release' });


// Round to 2 decimals for editor display (density/length can be fractional).
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// A small SVG glyph of one wiring (Distribution): the snake path through a 3×3
// grid in that pattern's order, with a dot on the START pixel — so you can SEE
// the corner + direction + serpentine instead of reading "TL · rows · snake".
function distIcon(dist) {
  const n = 3, pad = 4, size = 28, step = (size - 2 * pad) / (n - 1);
  const pts = gridCellOrder(n, n, dist).map(([c, r]) => [pad + c * step, pad + r * step]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">`
    + `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}" r="2.4" fill="currentColor"/></svg>`;
}

// A 4×4 grid of those glyphs — click one to pick the wiring. The selected cell is
// accent-filled. Replaces the opaque text dropdown (MadMapper/Resolume-style).
function distributionPicker(value, onPick) {
  const grid = el('div', { className: 'dist-grid' });
  for (const d of DISTRIBUTIONS) {
    const cell = el('button', { className: 'dist-cell' + (d.index === value ? ' on' : ''), title: d.label, innerHTML: distIcon(d) });
    cell.addEventListener('click', () => onPick(d.index));
    grid.append(cell);
  }
  return grid;
}

// DMX-profile editor: an explicit ordered channel list on the type. Each channel has
// a function (kind), a name, and — for manual kinds (fixed/uv/strobe) — a default
// value. Reorder with ↑/↓; channel number = DMX slot offset from the start address.
const CH_MANUAL_VAL = new Set(['fixed', 'uv', 'strobe']);
function dmxChannelEditor(t, upd, rows) {
  const channels = t.channels || [];
  const cUpd = (i, patch) => upd((nt) => { nt.channels = (nt.channels || []).slice(); nt.channels[i] = { ...nt.channels[i], ...patch }; });
  const moveCh = (i, dir) => upd((nt) => { const cs = (nt.channels || []).slice(); const j = i + dir; if (j < 0 || j >= cs.length) return; [cs[i], cs[j]] = [cs[j], cs[i]]; nt.channels = cs; });
  rows.push(el('div', { className: 'fx-pts', textContent: `Channels · ${channels.length}` }));
  channels.forEach((c, i) => {
    const name = textInputCommit(c.name ?? `Ch ${i + 1}`, (x) => cUpd(i, { name: x }));
    const kind = selectInput(DMX_CHANNEL_KINDS, c.kind, (x) => cUpd(i, { kind: x }));
    const up = el('button', { className: 'fx-act', textContent: '↑', title: 'move up', onclick: () => moveCh(i, -1) });
    const down = el('button', { className: 'fx-act', textContent: '↓', title: 'move down', onclick: () => moveCh(i, +1) });
    if (i === 0) up.disabled = true;
    if (i === channels.length - 1) down.disabled = true;
    const rm = el('button', { className: 'fx-act', textContent: '⌫', title: 'remove channel',
      onclick: () => upd((nt) => { const cs = (nt.channels || []).slice(); cs.splice(i, 1); nt.channels = cs.length ? cs : [{ kind: 'red', name: 'Ch 1', value: 0 }]; }) });
    const cells = [el('span', { className: 'fx-ch-n', textContent: String(i + 1) }), name, kind];
    if (CH_MANUAL_VAL.has(c.kind)) cells.push(numInputCommit(c.value ?? 0, (x) => cUpd(i, { value: Math.max(0, Math.min(255, Math.round(x))) }), 1));
    cells.push(up, down, rm);
    rows.push(el('div', { className: 'fx-field fx-param-row' }, cells));
  });
  rows.push(el('button', { className: 'fx-add', textContent: '+ channel',
    onclick: () => upd((nt) => { nt.channels = [...(nt.channels || []), { kind: 'red', name: `Ch ${(nt.channels?.length || 0) + 1}`, value: 0 }]; }) }));
}

// createFixturePanel({ getShow, setShow, onChange })
// - getShow(): current show
// - setShow(show): persist + rebuild (caller wires this to app.rebuild)
// - returns { el, refresh() }
export function createFixturePanel({ getShow, setShow, onSelect, getConnected = () => true }) {
  // The Devices + Library tabs render LISTS only; the selected item's editor goes
  // into the left sidebar (app wires that via deviceDetailEl / libraryDetailEl and
  // re-renders it on onSelect).
  const devicesBox = el('div', { className: 'fx-panel' });   // Devices tab — instances
  const libraryBox = el('div', { className: 'fx-panel' });   // Library tab — controller + fixture models
  let selDeviceId = null;   // master-detail: which device INSTANCE's editor is open
  let selTypeId = null;     // which fixture DEFINITION's editor is open
  let selDevTypeId = null;  // which controller MODEL's editor is open
  let libSel = 'controller';// which Library list the inspector shows: 'controller' | 'fixture'
  let lastSel = null;       // 'device' | 'type' | 'devtype' — what ⌫ deletes (last row clicked)
  let mounted = false;      // suppress onSelect during the initial construction render (app's panel ref isn't ready yet)
  let scanState = { running: false, result: null, error: null };   // network device scan
  const deviceStatus = new Map();   // id → last { ok, data|error } from the controller
  const pushStatus = new Map();     // id → last config-push result text
  const pinging = new Set();        // ids with an in-flight auto health-check
  let renderTimer = null;           // coalesce the re-renders that ping results trigger
  const scheduleRender = () => { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = null; render(); }, 80); };
  // Auto-check every device with an IP whose status we don't know yet, so the
  // Devices list can show online/offline without opening each one. One-shot per
  // (id) — the per-device "check" button refreshes a single controller on demand.
  const autoPing = (devices) => {
    for (const d of devices) {
      if (!d.ip || deviceStatus.has(d.id) || pinging.has(d.id)) continue;
      pinging.add(d.id);
      getDeviceState(d.ip).then((st) => { pinging.delete(d.id); deviceStatus.set(d.id, st); scheduleRender(); });
    }
  };

  function commit(next) {
    saveShow(next);
    setShow(next);
    render();   // render() calls onSelect → the sidebar editor refreshes too
  }

  // Live status + minimal config pushed to the actual WLED controller (via the
  // daemon proxy). Read-only monitoring + identify/on/off/brightness — enough to
  // verify and locate a controller without leaving the app.
  // Compact "2h 13m" style uptime from WLED's seconds counter.
  function fmtUptime(sec) {
    if (!(sec > 0)) return '—';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function controllerBlock(d) {
    const st = deviceStatus.get(d.id);
    // Live controls (brightness / save / reboot) only make sense when the device is
    // actually reachable — gate them on a confirmed-online status. CHECK stays
    // enabled (it's how you bring the status online in the first place).
    const online = !!st?.ok;
    const offTitle = d.ip ? 'controller offline — press CHECK first' : 'set the controller IP first';
    const refresh = async () => { deviceStatus.set(d.id, await getDeviceState(d.ip)); render(); };
    // Status — multi-line key/value so it reads clearly (we have the vertical room).
    const statBox = el('div', { className: 'ctrl-stat' });
    if (!st) statBox.append(el('div', { className: 'fx-devstatus', textContent: '— not checked' }));
    else if (!st.ok) statBox.append(el('div', { className: 'fx-devstatus is-off', textContent: `⚠ offline · ${st.error}` }));
    else {
      const info = st.data.info || {}, s = st.data.state || {}, leds = info.leds || {}, wifi = info.wifi || {};
      // "stream" confirms our DDP is actually landing: WLED reports realtime mode +
      // the live source IP while it's receiving frames.
      const stream = info.live ? `live · ${info.lm || info.lip || 'realtime'}` : 'idle';
      const pwr = leds.pwr != null ? `${leds.pwr}${leds.maxpwr ? '/' + leds.maxpwr : ''} mA` : '—';
      const rows = [
        ['model', `${info.name || 'wled'} · v${info.ver || '?'}`],
        ['pixels', `${leds.count ?? '?'} px${leds.fps != null ? ' · ' + leds.fps + ' fps' : ''}`],
        ['stream', stream],
        ['power', s.on ? `on · master ${s.bri ?? '?'}` : 'off'],
        ['draw', pwr],
        ['signal', `${wifi.rssi ?? '?'} dBm`],
        ['uptime', fmtUptime(info.uptime)],
      ];
      for (const [k, v] of rows) statBox.append(el('div', { className: 'ctrl-stat-row' }, [
        el('span', { className: 'ctrl-stat-k', textContent: k }), el('span', { className: 'ctrl-stat-v', textContent: v }),
      ]));
    }
    // Brightness — scales the DDP output we send to THIS controller (d.brightness,
    // a 0–1 cap applied per-frame on the daemon). This works during a live show;
    // WLED's own master-brightness write is ignored while it's in realtime mode.
    const pct = Math.round((d.brightness ?? 1) * 100);
    const slider = el('input', { type: 'range', min: '0', max: '100', value: String(pct), className: 'ctrl-range', disabled: !online });
    if (!online) slider.title = offTitle;
    const briVal = el('span', { className: 'ctrl-val', textContent: `${pct}%` });
    slider.addEventListener('input', () => {
      if (shiftDown) slider.value = String(coarseSnap(Number(slider.value), 0, 100));   // Shift → 10% steps
      briVal.textContent = `${slider.value}%`;
    });
    slider.addEventListener('change', () => {
      const show = getShow(); const di = show.devices.indexOf(d);
      if (di < 0) return;
      const next = structuredClone(show); next.devices[di].brightness = Number(slider.value) / 100; commit(next);
    });
    return el('div', { className: 'ctrl-block' }, [
      el('div', { className: 'fx-pts', textContent: 'controller' }),
      el('label', { className: 'ctrl-bri' }, [el('span', { textContent: 'Bright' }), slider, briVal]),
      saveToDeviceRow(d, online, offTitle),
      // Check + its status readout sit at the bottom (the diagnostics, after the
      // everyday controls).
      el('div', { className: 'ctrl-row' }, [
        el('button', { className: 'ctrl-btn', textContent: 'check', title: 'read status from the controller', onclick: refresh }),
        el('button', {
          className: 'ctrl-btn', textContent: 'reboot', disabled: !online, title: online ? 'reboot the controller (output to it drops for ~10s)' : offTitle,
          onclick: async () => {
            if (!d.ip) { window.alert('Set the controller IP first.'); return; }
            if (!window.confirm(`Reboot “${d.name || d.id}”?\n\nIt drops off the network for ~10s while it restarts.`)) return;
            deviceStatus.delete(d.id); render();                 // status goes unknown while it cycles
            const r = await setDeviceState(d.ip, { rb: true });   // WLED JSON API: reboot
            if (!r.ok) window.alert(`Reboot failed: ${r.error}`);
          },
        }),
      ]),
      statBox,
    ]);
  }

  // "Save to device": write each output's LED length + colour order to WLED's
  // config, then set the controller's DEFAULT colour so it shows the brand colour.
  function saveToDeviceRow(d, online = true, offTitle = '') {
    const show = getShow();
    const nOut = (show.deviceTypes || []).find((m) => m.id === d.typeId)?.outputs ?? d.outputs ?? 1;
    const outs = [];
    for (let p = 1; p <= nOut; p++) {
      const len = (show.fixtures || [])
        .filter((f) => (f.output?.deviceId || '') === d.id && (f.output?.port ?? 1) === p)
        .reduce((m, f) => m + (f.pixelCount || 0), 0);
      outs.push({ len, order: d.colorOrder || 'GRB' });
    }
    const note = pushStatus.get(d.id);
    const btn = el('button', {
      className: 'ctrl-btn', textContent: 'save to device', disabled: !online,
      title: online ? `write LED count + colour order to ${d.name || d.id}'s WLED config` : offTitle,
      onclick: async () => {
        pushStatus.set(d.id, 'saving…'); render();
        const r = await pushDeviceConfig(d.ip, outs);
        if (r.ok && d.defaultColor) await setDeviceState(d.ip, { on: true, seg: [{ fx: 0, col: [hexToRgb(d.defaultColor)] }] });
        pushStatus.set(d.id, r.ok
          ? `✓ saved ${r.data.applied}/${r.data.outputs} outputs · ${r.data.total} px · ${d.colorOrder || 'GRB'}`
          : `⚠ save failed · ${r.error}`);
        render();
      },
    });
    return el('div', { className: 'ctrl-push' }, [
      btn,
      ...(note ? [el('div', { className: 'fx-devstatus' + (note.startsWith('⚠') ? ' is-off' : note.startsWith('✓') ? ' is-on' : ''), textContent: note })] : []),
    ]);
  }

  // Network scan: find WLED controllers on the LAN (via the daemon) and add them
  // with one click. Results persist across renders so adding one re-renders the
  // list with it marked "added".
  // Just the scan toggle button (so it can sit beside + fixture / + device).
  function scanButton(rerender = render) {
    const online = getConnected();   // false on the hosted demo (no local daemon)
    return el('button', {
      className: 'fx-add', textContent: scanState.running ? 'scanning…' : '⌖ scan',
      title: online ? 'find WLED controllers on your network (needs the daemon running)'
        : 'scanning needs the local app (the daemon) — not available on the web demo',
      disabled: scanState.running || !online,
      onclick: async () => {
        if (scanState.running || !getConnected()) return;
        scanState = { running: true, result: null, error: null }; rerender();
        const r = await scanDevices();
        scanState = { running: false, result: r.ok ? r.data : null, error: r.ok ? null : r.error };
        rerender();
      },
    });
  }
  // The scan RESULTS (error / found controllers), rendered separately below the row.
  // Null when there's nothing to show yet.
  function scanResults(show) {
    if (!scanState.result && !scanState.error) return null;
    const wrap = el('div', { className: 'scan-block' });
    if (scanState.error) wrap.append(el('div', { className: 'fx-err', textContent: `scan failed: ${scanState.error}` }));
    const res = scanState.result;
    if (res) {
      const known = new Set((show.devices || []).map((d) => d.ip));
      wrap.append(el('div', { className: 'fx-pts', textContent: `found ${res.devices.length} on ${res.subnets.join(', ') || '—'}` }));
      if (!res.devices.length) wrap.append(el('div', { className: 'seg-hint', textContent: 'no WLED controllers responded' }));
      for (const d of res.devices) {
        const added = known.has(d.ip);
        const add = el('button', { className: 'ctrl-btn' + (added ? ' is-added' : ''), textContent: added ? '✓' : 'add', title: added ? 'already added' : 'add this device', disabled: added });
        add.onclick = () => {
          const next = structuredClone(show);
          const id = `c${next.devices.length + 1}`;
          const dts = next.deviceTypes || [];
          const typeId = (dts.find((t) => t.id === 'digquad') || dts[0])?.id;
          next.devices.push({ id, name: d.name || id, ip: d.ip, colorOrder: 'GRB', port: 4048, typeId });
          selDeviceId = id; lastSel = 'device';
          commit(next);
        };
        wrap.append(el('div', { className: 'output-row scan-row' }, [
          el('span', { textContent: d.name }),
          el('span', { className: 'fx-badge', textContent: d.ip }),
          ...(d.leds != null ? [el('span', { className: 'fx-badge', textContent: `${d.leds} px` })] : []),
          add,
        ]));
      }
    }
    return wrap;
  }

  // Per-device patch ruler: the controller's pixel address space as proportional
  // segments, one per fixture, in offset order. Makes the DDP budget + each
  // fixture's slice visible at a glance (offsets are auto-packed, so contiguous).
  function patchRuler(show, d) {
    const fxs = (show.fixtures || [])
      .filter((f) => (f.output?.deviceId || '') === d.id)
      .sort((a, b) => (a.output?.pixelOffset || 0) - (b.output?.pixelOffset || 0));
    const total = fxs.reduce((m, f) => m + (f.pixelCount || 0), 0);
    const wrap = el('div', {}, [el('div', { className: 'fx-pts', textContent: `patch · ${total} px` })]);
    if (!total) { wrap.append(el('div', { className: 'seg-hint', textContent: 'no fixtures on this device' })); return wrap; }
    const bar = el('div', { className: 'patch-bar' });
    for (const f of fxs) {
      const seg = el('div', { className: 'patch-seg' });
      seg.style.flexGrow = String(f.pixelCount || 0);
      seg.title = `${fixtureLabel(f, show.fixtures.indexOf(f))} · ${fixtureRange(f)}`;
      seg.append(el('span', { textContent: fixtureLabel(f, show.fixtures.indexOf(f)) }));
      bar.append(seg);
    }
    wrap.append(bar);
    return wrap;
  }

  // Art-Net span readout: how many universes this device's patched pixels occupy
  // from its base universe (170 RGB px per universe — 510 of 512 DMX slots).
  function artnetSpanHint(show, d) {
    const px = (show.fixtures || [])
      .filter((f) => (f.output?.deviceId || '') === d.id)
      .reduce((m, f) => m + (f.pixelCount || 0), 0);
    const base = d.universe ?? 0;
    if (!px) return el('div', { className: 'seg-hint', textContent: 'no fixtures patched — spans 0 universes' });
    const last = base + Math.ceil(px / 170) - 1;
    const span = last === base ? `universe ${base}` : `universes ${base}–${last}`;
    return el('div', { className: 'seg-hint', textContent: `spans ${span} (170 px each)` });
  }

  // Inline editor for the selected DEVICE INSTANCE (rendered under its list row).
  // Output count + per-output budget come from its controller MODEL (Library) —
  // here you only set the per-unit facts: name, IP, model, colour order, bright.
  function deviceDetail(show, d) {
    const di = show.devices.indexOf(d);
    const upd = (patch) => { const next = structuredClone(show); Object.assign(next.devices[di], patch); commit(next); };
    const models = show.deviceTypes || [];
    const model = models.find((m) => m.id === d.typeId);
    // IP row with a link out to the controller's own WLED web UI.
    const ipLink = el('a', { className: 'ip-open', textContent: '↗',
      href: d.ip ? `http://${d.ip}` : '#', target: '_blank', rel: 'noopener',
      title: d.ip ? `open the WLED UI at http://${d.ip}` : 'set an IP first' });
    if (!d.ip) { ipLink.style.pointerEvents = 'none'; ipLink.style.opacity = '.35'; }
    return el('div', { className: 'fx-card fx-detail' }, [
      field('Name', textInputCommit(d.name, (x) => upd({ name: x }))),
      el('label', { className: 'fx-field' }, [el('span', { textContent: 'IP' }), textInputCommit(d.ip, (x) => upd({ ip: x })), ipLink]),
      // Controller MODEL — drives the output count (a live template from Library).
      field('Model', selectInput(models.map((m) => ({ value: m.id, label: m.name })), d.typeId ?? models[0]?.id, (x) => upd({ typeId: x }))),
      field('Outputs', el('span', { className: 'fx-readonly', textContent: `${model?.outputs ?? d.outputs ?? '?'} (from model)` })),
      // Output protocol — DDP (WLED's realtime stream) or Art-Net for generic
      // gear (nodes, consoles, MadMapper/Resolume). Switching also resets the
      // port to the protocol's default (4048 / 6454).
      field('Protocol', selectInput(
        [{ value: 'ddp', label: 'DDP (WLED)' }, { value: 'artnet', label: 'Art-Net' }],
        d.protocol ?? 'ddp',
        (x) => upd({ protocol: x, port: x === 'artnet' ? 6454 : 4048 }))),
      ...(d.protocol === 'artnet' ? [
        // Base universe — the device's pixels occupy consecutive universes from it.
        field('Universe', numInputCommit(d.universe ?? 0, (x) => upd({ universe: Math.max(0, Math.round(x)) }))),
        artnetSpanHint(show, d),
        // ArtSync: latch all of this device's universes together each frame, so a
        // multi-universe rig doesn't tear. Off by default (some nodes ignore it).
        field('Art-Net sync', (() => {
          const c = el('input', { type: 'checkbox' }); c.checked = !!d.artnetSync;
          c.addEventListener('change', () => upd({ artnetSync: c.checked }));
          return c;
        })()),
        // Discover Art-Net nodes on the network (ArtPoll) → click one to bind this
        // device's IP to it without re-mapping pixels.
        (() => {
          const btn = el('button', { className: 'fx-add', textContent: 'scan Art-Net' });
          const list = el('div', { className: 'scan-block' });
          btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = 'scanning…'; list.textContent = '';
            let nodes = [];
            try { nodes = await fetch('/api/artnet/scan').then((r) => r.json()); } catch { /* daemon offline */ }
            btn.disabled = false; btn.textContent = 'scan Art-Net';
            if (!Array.isArray(nodes) || !nodes.length) { list.append(el('span', { className: 'seg-hint', textContent: 'no Art-Net nodes found' })); return; }
            for (const n of nodes) {
              const row = el('button', { className: 'fx-add', textContent: `${n.ip}${n.shortName ? ' · ' + n.shortName : ''}`, title: n.longName || n.ip });
              row.addEventListener('click', () => upd({ ip: n.ip }));   // bind → re-renders the editor
              list.append(row);
            }
          });
          return el('div', { className: 'scan-block' }, [btn, list]);
        })(),
      ] : []),
      // Output delay (ms) — hold this controller's packets back to time-align it
      // with the rest of the rig (e.g. against projection). 0 = immediate. Niche, so
      // it lives under an Advanced disclosure (collapsed unless already non-zero)
      // to keep the common per-device editor short.
      (() => {
        const det = el('details', { className: 'fx-advanced' });
        if ((d.syncDelayMs ?? 0) > 0) det.open = true;
        det.append(el('summary', { textContent: 'Advanced' }));
        // Physical wiring spec — set once at setup, NOT a live-performance control,
        // so it lives here (collapsed) rather than up top.
        det.append(field('Color Order', selectInput(COLOR_ORDERS, d.colorOrder ?? 'GRB', (x) => upd({ colorOrder: x }))));
        det.append(field('Sync delay (ms)', numInputCommit(d.syncDelayMs ?? 0, (x) => upd({ syncDelayMs: Math.max(0, Math.min(1000, Math.round(x))) }))));
        return det;
      })(),
      patchRuler(show, d),
      controllerBlock(d),
    ]);
  }

  // Library editor for a controller MODEL (device type): name + physical output
  // count + per-output pixel budget. Editing it propagates to every device that
  // uses the model (via syncDeviceTypes on rebuild) — the device-side twin of a
  // fixture definition.
  function controllerTypeDetail(show, t) {
    const ti = show.deviceTypes.indexOf(t);
    const upd = (mutate) => { const next = structuredClone(show); mutate(next.deviceTypes[ti]); commit(next); };
    return el('div', { className: 'fx-card fx-detail' }, [
      field('Name', textInputCommit(t.name, (x) => upd((nt) => { nt.name = x; }))),
      // Physical OUTPUTS on this controller (e.g. a QuinLED DigQuad = 4). Fixtures
      // patch to one of these; each output is its own daisy-chain.
      sliderRow('Outputs', t.outputs ?? 4, (x) => upd((nt) => { nt.outputs = Math.max(1, Math.round(x)); }), 1, 16, 1),
      // Max pixels a single output can drive (0 = unlimited). A full output greys
      // out extending its chain.
      sliderRow('Max px/output', t.maxPerOutput ?? 0, (x) => upd((nt) => { nt.maxPerOutput = Math.max(0, Math.round(x)); }), 0, 2048, 1),
    ]);
  }

  // Add a generic controller model and select it.
  function addController(show) {
    const next = structuredClone(show);
    const id = `dt${(next.deviceTypes?.length || 0) + 1}`;
    (next.deviceTypes ||= []).push(makeDeviceType('Controller', 4, 830, id));
    selDevTypeId = id; lastSel = 'devtype'; libSel = 'controller';
    commit(next);
  }

  // Library editor for a fixture DEFINITION (type): name + physical strip only —
  // density, length, pixel count, colour order. Editing it propagates to every
  // placed instance (via syncFixtureTypes on rebuild). Placement + patch live in
  // the Fixtures tab.
  // The auto-name for a definition: a matrix reads "W×H · Npx"; a strip reads
  // "Lm · Npx" (or just "Npx" with no physical length).
  function autoTypeName(nt) {
    const cols = Math.max(1, Math.round(Number(nt.cols) || 1));
    const rows = Math.max(1, Math.round(Number(nt.rows) || 1));
    if (rows > 1) return `${cols}×${rows} · ${cols * rows}px`;
    return Number(nt.meters) > 0 ? `${round2(nt.meters)}m · ${cols}px` : `${cols}px`;
  }

  function typeDetail(show, t) {
    const ti = show.fixtureTypes.indexOf(t);
    // Every edit recomputes cols/rows/pixelCount coherently and keeps an
    // auto-generated name in sync (a hand-typed name is left alone).
    const upd = (mutate) => {
      const next = structuredClone(show);
      const nt = next.fixtureTypes[ti];
      const wasAuto = nt.name === autoTypeName(nt);
      mutate(nt);
      nt.cols = Math.max(1, Math.round(Number(nt.cols) || 1));
      nt.rows = Math.max(1, Math.round(Number(nt.rows) || 1));
      nt.distribution = Math.max(0, Math.round(Number(nt.distribution) || 0));
      nt.pixelCount = nt.cols * nt.rows;
      if (wasAuto) nt.name = uniqueTypeName(next.fixtureTypes, autoTypeName(nt), nt.id);
      commit(next);
    };
    const isGrid = (Number(t.rows) || 1) > 1;
    const isDmx = !!(t.channels && t.channels.length);   // DMX-profile mode (flat channel list)
    const rows = [
      field('Name', textInputCommit(t.name, (x) => upd((nt) => { nt.name = uniqueTypeName(show.fixtureTypes, x, nt.id); }))),
      // Layout: a pixel strip/matrix (W×H + Color Format) OR a DMX fixture defined by
      // an explicit channel list. Switching to DMX seeds the list from the current
      // colour format + parameters; switching back drops it.
      field('Layout', selectInput([{ value: 'pixels', label: 'Pixels (strip / matrix)' }, { value: 'dmx', label: 'DMX channels' }], isDmx ? 'dmx' : 'pixels',
        (mode) => upd((nt) => {
          if (mode === 'dmx') { if (!(nt.channels && nt.channels.length)) nt.channels = fixtureTypeChannels(nt); nt.cols = 1; nt.rows = 1; }
          else delete nt.channels;
        }))),
    ];
    if (isDmx) { dmxChannelEditor(t, upd, rows); return el('div', { className: 'fx-card fx-detail' }, rows); }
    // Width = pixels per row (a 1-row strip's pixel count — "set pixels directly").
    rows.push(field('Width', numInputCommit(t.cols ?? t.pixelCount, (x) => upd((nt) => { nt.cols = x; }))));
    // Height = number of rows; 1 = a plain strip, >1 = a matrix/panel.
    rows.push(field('Height', numInputCommit(t.rows ?? 1, (x) => upd((nt) => { nt.rows = x; }))));
    rows.push(field('Pixels', el('span', { className: 'fx-readonly', textContent: String(t.pixelCount) })));
    // Colour format: '' inherits the controller's order; pick RGBW here for a
    // white-channel strip (mixes freely with RGB fixtures on the same controller).
    rows.push(field('Color Format', selectInput(COLOR_FORMATS, t.colorFormat || '', (x) => upd((nt) => { nt.colorFormat = x; }))));
    // For a 1×1 par, show the running DMX channel total (colour + parameters) so it's
    // clear that each parameter you add is another channel. (A strip's count is pixels.)
    if (!isGrid && (Number(t.cols) || 1) === 1) rows.push(field('Channels', el('span', { className: 'fx-readonly', textContent: String(fixtureTypeChannels(t).length) })));
    // Wiring (Distribution) only matters for a matrix — which corner pixel #0 sits
    // in, row/column order, and snake vs. straight. Shown as a visual 4×4 glyph grid.
    if (isGrid) {
      rows.push(el('div', { className: 'fx-pts', textContent: 'Wiring' }));
      rows.push(distributionPicker(t.distribution ?? 0, (x) => upd((nt) => { nt.distribution = x; })));
    }
    // Parameters — extra DMX channels around the pixel/colour block (Resolume model):
    // dimmer/strobe/UV/etc. Colour kinds are driven by the canvas; `fixed` carries a
    // default value. A param sits BEFORE or AFTER the pixels (↑/↓ moves it across the
    // block); DMX channel ORDER follows this list top-to-bottom exactly.
    rows.push(el('div', { className: 'fx-pts', textContent: 'Parameters' }));
    const params = t.params || [];
    const pUpd = (i, patch) => upd((nt) => { nt.params = (nt.params || []).slice(); nt.params[i] = { ...nt.params[i], ...patch }; });
    // Display order = before-params, then the PIXELS divider, then after-params.
    const beforeIdx = [], afterIdx = [];
    params.forEach((p, i) => (p.before ? beforeIdx : afterIdx).push(i));
    const tokens = [...beforeIdx, 'PX', ...afterIdx];   // 'PX' = the pixel block slot
    const lastPos = tokens.length - 1;
    // Move a param up/down across the display sequence; crossing 'PX' flips before/after.
    const moveParam = (idx, dir) => upd((nt) => {
      const ps = (nt.params || []).slice();
      const bi = [], ai = [];
      ps.forEach((p, i) => (p.before ? bi : ai).push(i));
      const tk = [...bi, 'PX', ...ai];
      const pos = tk.indexOf(idx), tgt = pos + dir;
      if (pos < 0 || tgt < 0 || tgt >= tk.length) return;
      [tk[pos], tk[tgt]] = [tk[tgt], tk[pos]];
      const out = []; let before = true;
      for (const t2 of tk) { if (t2 === 'PX') { before = false; continue; } out.push({ ...ps[t2], before }); }
      nt.params = out;
    });
    const colourKinds = colorFormatChannels(t.colorFormat);
    tokens.forEach((tok, pos) => {
      if (tok === 'PX') {
        const lbl = colourKinds.length
          ? `Pixels · ${t.colorFormat || 'RGB'} (${t.cols}×${t.rows}, ${colourKinds.length} ch)`
          : 'Pixels · none';
        rows.push(el('div', { className: 'fx-param-pixels', textContent: lbl }));
        return;
      }
      const i = tok, p = params[i];
      const name = textInputCommit(p.name, (x) => pUpd(i, { name: x }));
      const kind = selectInput(DMX_CHANNEL_KINDS, p.kind, (x) => pUpd(i, { kind: x }));
      const up = el('button', { className: 'fx-act', textContent: '↑', title: 'move up', onclick: () => moveParam(i, -1) });
      const down = el('button', { className: 'fx-act', textContent: '↓', title: 'move down', onclick: () => moveParam(i, +1) });
      if (pos === 0) up.disabled = true;
      if (pos === lastPos) down.disabled = true;
      const rm = el('button', { className: 'fx-act', textContent: '⌫', title: 'remove parameter',
        onclick: () => upd((nt) => { nt.params = (nt.params || []).slice(); nt.params.splice(i, 1); }) });
      const cells = [name, kind];
      // A `fixed` channel has a settable default; colour kinds come from the canvas.
      if (p.kind === 'fixed') cells.push(numInputCommit(p.value ?? 0, (x) => pUpd(i, { value: Math.max(0, Math.min(255, Math.round(x))) }), 1));
      cells.push(up, down, rm);
      rows.push(el('div', { className: 'fx-field fx-param-row' }, cells));
    });
    rows.push(el('button', { className: 'fx-add', textContent: '+ parameter',
      onclick: () => upd((nt) => { nt.params = [...(nt.params || []), { name: `Param ${(nt.params?.length || 0) + 1}`, kind: 'fixed', value: 0 }]; }) }));

    // Physical size (optional) — only drives true-scale strip THICKNESS on the
    // canvas, and offers density×length as a convenience to set a strip's Width.
    const phys = el('details', { className: 'fx-advanced' });
    phys.append(el('summary', { textContent: 'Physical size' }));
    phys.append(
      sliderRow('LEDs / m', round2(t.ledsPerMeter), (x) => upd((nt) => { nt.ledsPerMeter = Math.max(0, x); if ((Number(nt.rows) || 1) === 1) nt.cols = Math.max(1, Math.round(x * (Number(nt.meters) || 0))); }), 0, 200, 1),
      sliderRow('Length (m)', round2(t.meters), (x) => upd((nt) => { nt.meters = Math.max(0, x); if ((Number(nt.rows) || 1) === 1) nt.cols = Math.max(1, Math.round((Number(nt.ledsPerMeter) || 0) * x)); }), 0, 20, 0.1),
    );
    rows.push(phys);
    // Colour order is set per CONTROLLER (Devices tab), not per strip definition.
    return el('div', { className: 'fx-card fx-detail' }, rows);
  }

  // A name not already taken by another fixture definition — duplicate names are
  // confusing in the placement dropdown. Appends " 2", " 3"… on collision.
  function uniqueTypeName(types, base, exceptId) {
    const taken = new Set((types || []).filter((t) => t.id !== exceptId).map((t) => String(t.name || '').trim().toLowerCase()));
    const b = String(base || 'Fixture').trim() || 'Fixture';
    if (!taken.has(b.toLowerCase())) return b;
    let n = 2; while (taken.has(`${b} ${n}`.toLowerCase())) n++;
    return `${b} ${n}`;
  }

  // Add a fresh definition (60/m × 2.5m = 150px) and select it.
  function addType(show) {
    const next = structuredClone(show);
    const id = `t${(next.fixtureTypes?.length || 0) + 1}`;
    const t = makeFixtureType(60, 2.5, 'GRB', id);
    t.name = uniqueTypeName(next.fixtureTypes, t.name, id);   // never collide with an existing definition
    (next.fixtureTypes ||= []).push(t);
    selTypeId = id; lastSel = 'type'; libSel = 'fixture';
    commit(next);
  }

  function render() {
    const show = getShow();
    devicesBox.textContent = '';
    libraryBox.textContent = '';

    const v = validate(show);
    // --- Validation banner (whole show) — only surfaces when something's wrong;
    //     a clean show shows nothing (no "valid" noise). ---
    if (!v.ok) devicesBox.append(el('div', { className: 'fx-err', textContent: v.errors.join(' · ') }));

    // No daemon banner here: the bottom-left HUD already surfaces output/connection
    // state ("◐ output offline — start the daemon"), and only when a device is
    // actually configured to need it — so this tab stays clean.

    // Compact selectable row (master): name + a couple of badges. Clicking opens
    // its editor below. Reuses the Output tab's list styling.
    const listRow = (label, badges, selected, onClick) => ListRow(label, { badges, selected, onClick });

    // Pixels routed to one device (hidden fixtures still occupy DDP address space).
    const devicePixels = (devId) => show.fixtures
      .filter((f) => (f.output?.deviceId || '') === devId)
      .reduce((m, f) => m + (f.pixelCount || 0), 0);

    // --- Devices: a selectable list; the editor opens in the LEFT sidebar. ---
    if (!show.devices.some((d) => d.id === selDeviceId)) selDeviceId = show.devices[0]?.id ?? null;
    const modelName = (d) => (show.deviceTypes || []).find((m) => m.id === d.typeId)?.name || 'no model';
    // The Devices tab is already labelled — render the list directly (no
    // redundant "DEVICES" section header).
    {
      const b = devicesBox;
      const devList = el('div', { className: 'fx-list' });
      for (const d of show.devices) {
        const st = deviceStatus.get(d.id);
        const state = !d.ip ? 'noip' : pinging.has(d.id) || !st ? 'check' : st.ok ? 'online' : 'offline';
        const title = { online: 'online', offline: 'offline', check: 'checking…', noip: 'no IP set' }[state];
        const row = listRow(d.name || d.id, [d.ip || 'no ip', modelName(d), `${devicePixels(d.id)} px`],
          d.id === selDeviceId, () => { selDeviceId = d.id; lastSel = 'device'; render(); });
        row.prepend(el('i', { className: `dev-dot dev-${state}`, title }));
        devList.append(row);
      }
      autoPing(show.devices);
      if (!show.devices.length) b.append(el('div', { className: 'seg-hint', textContent: 'no devices yet — add one, or define models in Inventory' }));
      b.append(devList);
      b.append(el('button', {
        className: 'fx-add', textContent: '+ device',
        onclick: () => {
          const next = structuredClone(show);
          const id = `c${next.devices.length + 1}`;
          const dts = next.deviceTypes || [];
          const typeId = (dts.find((t) => t.id === 'digquad') || dts[0])?.id;
          next.devices.push({ id, name: id, ip: '', colorOrder: 'GRB', port: 4048, typeId });   // blank IP — set it or scan to bind a real controller
          selDeviceId = id; lastSel = 'device';
          commit(next);
        },
      }));
      b.append(scanButton());
      const sr = scanResults(show); if (sr) b.append(sr);
    }

    // === LIBRARY tab = the catalog of MODELS you build with ===================

    // Add controls at the TOP, inline (matches the Fixtures tab) — one row, two
    // buttons: a new fixture definition and a new controller model.
    libraryBox.append(el('div', { className: 'output-addrow' }, [
      el('button', { className: 'fx-add', textContent: '+ fixture', onclick: () => addType(show) }),
      el('button', { className: 'fx-add', textContent: '+ controller', onclick: () => addController(show) }),
    ]));

    // --- Controller MODELS (device types) — DigUno/Quad/Octa + generic. Editing
    //     a model fans out to every device that uses it. ---
    const devTypes = show.deviceTypes || [];
    if (!devTypes.some((t) => t.id === selDevTypeId)) selDevTypeId = devTypes[0]?.id ?? null;
    libraryBox.append(Section('Controllers', 'controllers', (b) => {
      const list = el('div', { className: 'fx-list' });
      for (const t of devTypes) {
        const count = deviceTypeInstanceCount(show, t.id);
        list.append(listRow(t.name, [`${t.outputs} out`, `×${count}`],
          libSel === 'controller' && t.id === selDevTypeId,
          () => { selDevTypeId = t.id; lastSel = 'devtype'; libSel = 'controller'; render(); }));
      }
      if (!devTypes.length) b.append(el('div', { className: 'seg-hint', textContent: 'no controller models yet' }));
      b.append(list);
    }));

    // --- Fixture DEFINITIONS (types) — define once, place many in the Fixtures
    //     tab. Editing a definition updates all its placed instances. ---
    const types = show.fixtureTypes || [];
    if (!types.some((t) => t.id === selTypeId)) selTypeId = types[0]?.id ?? null;
    libraryBox.append(Section('Fixtures', 'fixtures', (b) => {
      const list = el('div', { className: 'fx-list' });
      for (const t of types) {
        const count = typeInstanceCount(show, t.id);
        list.append(listRow(t.name, [`${t.pixelCount} px`, `×${count}`],
          libSel === 'fixture' && t.id === selTypeId,
          () => { selTypeId = t.id; lastSel = 'type'; libSel = 'fixture'; render(); }));
      }
      if (!types.length) b.append(el('div', { className: 'seg-hint', textContent: 'no fixture definitions yet' }));
      b.append(list);
    }));
    // Project file I/O lives in the Settings tab.
    if (mounted) onSelect?.();   // lists rebuilt → refresh the left sidebar editor too (covers status pings, edits)
  }

  render();
  mounted = true;
  return {
    devicesEl: devicesBox, libraryEl: libraryBox, refresh: render,
    // The selected item's EDITOR — app mounts these into the left sidebar.
    deviceDetailEl: () => {
      const show = getShow();
      const d = (show.devices || []).find((x) => x.id === selDeviceId);
      return d ? deviceDetail(show, d) : null;
    },
    // App drives device selection in the merged Fixtures tab (clicking a controller
    // header) → point the left-sidebar editor at it.
    setDevice: (id) => { selDeviceId = id; lastSel = 'device'; },
    // The WLED network-discovery block, for the app to mount in the merged tab.
    // Pass a rerender callback so its results refresh wherever it's mounted.
    scanButtonEl: (rerender) => scanButton(rerender),
    scanResultsEl: () => scanResults(getShow()),
    libraryDetailEl: () => {
      const show = getShow();
      if (libSel === 'controller') {
        const t = (show.deviceTypes || []).find((x) => x.id === selDevTypeId);
        return t ? controllerTypeDetail(show, t) : null;
      }
      const t = (show.fixtureTypes || []).find((x) => x.id === selTypeId);
      return t ? typeDetail(show, t) : null;
    },
    // The inspector title: "Fixture: <name>" or "Controller: <name>" for the
    // currently-selected Inventory item (null when nothing's selected).
    librarySelection: () => {
      const show = getShow();
      if (libSel === 'controller') {
        const t = (show.deviceTypes || []).find((x) => x.id === selDevTypeId);
        return t ? { kind: 'Controller', name: t.name } : null;
      }
      const t = (show.fixtureTypes || []).find((x) => x.id === selTypeId);
      return t ? { kind: 'Fixture', name: t.name } : null;
    },
    // ⌫ deletes the last-clicked device (Devices tab) or model/definition
    // (Library tab). A model/definition still IN USE is NOT deleted. Returns
    // true if it deleted.
    deleteSelected: () => {
      const show = getShow();
      if (lastSel === 'device' && selDeviceId && (show.devices || []).some((d) => d.id === selDeviceId)) {
        const dev = show.devices.find((d) => d.id === selDeviceId);
        const used = (show.fixtures || []).filter((f) => (f.output?.deviceId || '') === selDeviceId).length;
        const msg = `Delete device “${dev?.name || selDeviceId}”?`
          + (used ? `\n\n${used} fixture${used === 1 ? '' : 's'} routed to it will be unrouted.` : '');
        if (!confirmDelete(msg)) return false;
        const next = structuredClone(show);
        next.devices = next.devices.filter((d) => d.id !== selDeviceId);
        selDeviceId = null; commit(next); return true;
      }
      if (lastSel === 'devtype' && selDevTypeId && selDevTypeId !== 'generic' && deviceTypeInstanceCount(show, selDevTypeId) === 0) {
        const next = structuredClone(show);
        next.deviceTypes = (next.deviceTypes || []).filter((t) => t.id !== selDevTypeId);
        selDevTypeId = null; commit(next); return true;
      }
      if (lastSel === 'type' && selTypeId && selTypeId !== 'generic') {
        const used = typeInstanceCount(show, selTypeId);
        const t = (show.fixtureTypes || []).find((x) => x.id === selTypeId);
        // In use → confirm, then delete the definition AND its placed fixtures.
        if (used && !confirmDelete(`Delete “${t?.name || selTypeId}”?\n\n${used} placed fixture${used === 1 ? '' : 's'} will also be removed.`)) return false;
        const next = structuredClone(show);
        next.fixtureTypes = (next.fixtureTypes || []).filter((x) => x.id !== selTypeId);
        next.fixtures = (next.fixtures || []).filter((f) => f.typeId !== selTypeId);
        selTypeId = null; commit(next); return true;
      }
      return false;
    },
    // Selecting a placed fixture pre-selects its DEFINITION (shown if you open
    // Library); the per-fixture position editor itself is the app's sidebar.
    selectFixture: (id) => {
      const typeId = getShow().fixtures.find((f) => f.id === id)?.typeId;
      if (typeId) { selTypeId = typeId; render(); }
    },
  };
}
