import { validate, makeFixtureType, typeInstanceCount, makeDeviceType, deviceTypeInstanceCount } from '../model/show.js';
import { fixtureLabel, fixtureRange } from '../model/fixture-transform.js';
import { Section } from './section.js';
import { controllerColorMap } from '../model/chains.js';
import { getDeviceState, setDeviceState, identify, scanDevices, pushDeviceConfig } from '../wled.js';
import { el, field, selectInput, shiftDown, coarseSnap } from './dom.js';
import { Slider } from './controls.js';
import { NumInput, TextInput } from './kit/field.js';
import { ListRow } from './kit/listrow.js';
import { fixtureTypeChannels, paramSpan, paramsToChannels, channelsToParams, isDmxType } from '../model/dmx.js';
import { confirmDelete } from './confirm.js';
import { DISTRIBUTIONS, gridCellOrder } from '../model/grid.js';
import { isValidIPv4 } from '../model/ip.js';

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

// Preset parameter types for the dropdown (the common cases — colour blocks + single
// functions). "Custom…" reveals a free-text name + editable channel count.
const PARAM_PRESETS = [
  { value: 'RGB', count: 3 }, { value: 'RGBW', count: 4 }, { value: 'RGBWA', count: 5 }, { value: 'RGBA', count: 4 },
  { value: 'Dimmer', count: 1 }, { value: 'Strobe', count: 1 }, { value: 'UV', count: 1 },
  { value: 'White', count: 1 }, { value: 'Amber', count: 1 },
];
const presetOf = (name) => PARAM_PRESETS.find((p) => p.value.toLowerCase() === String(name || '').trim().toLowerCase());

// DMX-profile editor: a list of PARAMETERS. The first field is a TYPE dropdown of
// presets (RGB/RGBW/RGBWA/RGBA colour blocks + Dimmer/Strobe/UV/White/Amber/Fixed
// single functions) → the channel count follows the type. Pick "Custom…" to write
// your own name and set the channel count. The flat channels are the expansion.
function dmxChannelEditor(t, upd, rows) {
  const params = t.params || [];
  const setParams = (ps) => upd((nt) => { nt.params = ps; nt.channels = paramsToChannels(ps); });   // keep the expansion in step
  const pUpd = (i, patch) => setParams(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const moveP = (from, to) => { if (to < 0 || to >= params.length || from === to) return; const ps = params.slice(); const [m] = ps.splice(from, 1); ps.splice(to, 0, m); setParams(ps); };
  const total = paramsToChannels(params).length;
  rows.push(el('div', { className: 'fx-pts', textContent: `parameters · ${total} ch` }));
  const presetOpts = PARAM_PRESETS.map((p) => ({ value: p.value, label: p.value }));
  params.forEach((p, i) => {
    const span = paramSpan(p);
    const preset = presetOf(p.name);
    const isCustom = !preset;
    const handle = el('span', { className: 'fx-ch-drag', textContent: '⠿', title: 'drag to reorder', draggable: true });
    handle.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* some browsers */ } });
    // Type dropdown — a preset, or the custom name (shown as the selected option).
    // "Custom…" prompts for a name (and prefills the current one, so it also renames).
    const opts = [...presetOpts, ...(isCustom ? [{ value: p.name, label: p.name }] : []), { value: '__custom__', label: 'Custom…' }];
    const type = selectInput(opts, isCustom ? p.name : preset.value, (v) => {
      if (v === '__custom__') {
        const nm = (typeof window !== 'undefined' && window.prompt ? window.prompt('Channel name', isCustom ? p.name : '') : null)?.trim();
        if (nm) pUpd(i, { name: nm, count: isCustom ? (p.count ?? 1) : 1 });
      } else { const pr = presetOf(v); pUpd(i, { name: pr.value, count: pr.count }); }
    });
    const cells = [handle, type];
    // Channel count: fixed by a preset (read-only), editable for a custom parameter.
    const count = numInputCommit(span, (x) => pUpd(i, { count: Math.max(1, Math.round(x)) }));
    count.classList.add('fx-ch-count');
    count.disabled = !isCustom;
    count.title = isCustom ? 'channels' : `${span} ch (set by type)`;
    cells.push(count);
    cells.push(el('button', { className: 'fx-act', textContent: '⌫', title: 'remove parameter',
      onclick: () => { const ps = params.slice(); ps.splice(i, 1); setParams(ps.length ? ps : [{ name: 'RGB', count: 3 }]); } }));
    const row = el('div', { className: 'fx-field fx-param-row fx-ch-row' }, cells);
    row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drop-hover'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-hover'));
    row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('drop-hover'); const from = Number(e.dataTransfer.getData('text/plain')); if (Number.isInteger(from)) moveP(from, i); });
    rows.push(row);
  });
  rows.push(el('button', { className: 'fx-add', textContent: '+ parameter',
    onclick: () => setParams([...(params || []), { name: 'RGB', count: 3 }]) }));
}

// A DMX type's name carries an auto "(Nch)" suffix reflecting its channel count.
const stripChSuffix = (s) => String(s || '').replace(/\s*\(\d+\s*ch\)\s*$/i, '').trim();

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
  let scanState = { running: false, result: null, artnet: null, error: null };   // network device scan (WLED + Art-Net)
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
      // Art-Net nodes have no WLED JSON API — never poll them (avoids a false "offline").
      if (!d.ip || d.protocol === 'artnet' || deviceStatus.has(d.id) || pinging.has(d.id)) continue;
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

  // Output brightness — a 0–1 cap applied per-frame ON OUR STREAM (daemon-side), so it
  // works for Art-Net too (WLED's own master-brightness write is ignored in realtime).
  function brightnessRow(d, enabled) {
    const pct = Math.round((d.brightness ?? 1) * 100);
    const slider = el('input', { type: 'range', min: '0', max: '100', value: String(pct), className: 'ctrl-range', disabled: !enabled });
    const briVal = el('span', { className: 'ctrl-val', textContent: `${pct}%` });
    slider.addEventListener('input', () => {
      if (shiftDown) slider.value = String(coarseSnap(Number(slider.value), 0, 100));
      briVal.textContent = `${slider.value}%`;
    });
    slider.addEventListener('change', () => {
      const show = getShow(); const di = show.devices.indexOf(d);
      if (di < 0) return;
      const next = structuredClone(show); next.devices[di].brightness = Number(slider.value) / 100; commit(next);
    });
    return el('label', { className: 'ctrl-bri' }, [el('span', { textContent: 'Bright' }), slider, briVal]);
  }

  function controllerBlock(d) {
    // Art-Net nodes (DiGidot, Madrix Nebula, consoles…) have no WLED JSON API — the
    // model/pixels/power/signal status and save/reboot are WLED-only, so skip them.
    // Only the output brightness applies (daemon-side), and it works without a poll.
    if (d.protocol === 'artnet') {
      return el('div', { className: 'ctrl-block' }, [
        el('div', { className: 'fx-pts', textContent: 'controller' }),
        brightnessRow(d, true),
      ]);
    }
    const st = deviceStatus.get(d.id);
    // Live controls (brightness / save / reboot) only make sense when the device is
    // actually reachable — gate them on a confirmed-online status. CHECK stays
    // enabled (it's how you bring the status online in the first place).
    const online = !!st?.ok;
    const offTitle = d.ip ? 'controller offline, press CHECK first' : 'set the controller IP first';
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
    return el('div', { className: 'ctrl-block' }, [
      el('div', { className: 'fx-pts', textContent: 'controller' }),
      brightnessRow(d, online),
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
      title: online ? 'find WLED + Art-Net controllers on your network (needs the daemon running)'
        : 'scanning needs the local app (the daemon) — not available on the web demo',
      disabled: scanState.running || !online,
      onclick: async () => {
        if (scanState.running || !getConnected()) return;
        scanState = { running: true, result: null, artnet: null, error: null }; rerender();
        // WLED subnet scan + Art-Net ArtPoll, in parallel but rendered INDEPENDENTLY —
        // ArtPoll (~1.5s) shows long before the slower WLED subnet sweep (~several s).
        let pending = 2;
        const done = () => { if (--pending === 0) { scanState = { ...scanState, running: false }; rerender(); } };
        scanDevices().then((wled) => {
          scanState = { ...scanState, result: wled.ok ? wled.data : null, error: wled.ok ? null : wled.error };
          rerender(); done();
        });
        fetch('/api/artnet/scan').then((r) => r.json()).catch(() => []).then((art) => {
          scanState = { ...scanState, artnet: Array.isArray(art) ? art : [] };
          rerender(); done();
        });
      },
    });
  }
  // The scan RESULTS (error / found controllers), rendered separately below the row.
  // Null when there's nothing to show yet.
  function scanResults(show) {
    const art = scanState.artnet;   // null = not scanned yet, [] = scanned, none found
    if (!scanState.result && !scanState.error && !art) return null;
    const wrap = el('div', { className: 'scan-block' });
    if (scanState.error) wrap.append(el('div', { className: 'fx-err', textContent: `scan failed: ${scanState.error}` }));
    const known = new Set((show.devices || []).map((d) => d.ip));
    // A found controller → one click to add it (with the right protocol/port).
    const foundRow = (label, ip, badges, makeDevice) => {
      const added = known.has(ip);
      const add = el('button', { className: 'ctrl-btn' + (added ? ' is-added' : ''), textContent: added ? '✓' : 'add', title: added ? 'already added' : 'add this device', disabled: added });
      add.onclick = () => {
        const next = structuredClone(show);
        const id = `c${next.devices.length + 1}`;
        next.devices.push(makeDevice(next, id));
        selDeviceId = id; lastSel = 'device';
        commit(next);
      };
      return el('div', { className: 'output-row scan-row' }, [
        el('span', { textContent: label }), el('span', { className: 'fx-badge', textContent: ip }),
        ...badges.map((b) => el('span', { className: 'fx-badge', textContent: b })), add,
      ]);
    };
    const res = scanState.result;
    if (res) {
      wrap.append(el('div', { className: 'fx-pts', textContent: `WLED · ${res.devices.length} on ${res.subnets.join(', ') || '—'}` }));
      if (!res.devices.length) wrap.append(el('div', { className: 'seg-hint', textContent: 'no WLED controllers responded' }));
      for (const d of res.devices) {
        wrap.append(foundRow(d.name, d.ip, d.leds != null ? [`${d.leds} px`] : [], (next, id) => {
          const dts = next.deviceTypes || [];
          const typeId = (dts.find((t) => t.id === 'digquad') || dts[0])?.id;
          return { id, name: d.name || id, ip: d.ip, colorOrder: 'GRB', port: 4048, typeId };
        }));
      }
    }
    // Art-Net nodes (ArtPoll) — added as Art-Net devices (universe 0, port 6454).
    if (art) {
      wrap.append(el('div', { className: 'fx-pts', textContent: `Art-Net · ${art.length} node${art.length === 1 ? '' : 's'}` }));
      if (!art.length) wrap.append(el('div', { className: 'seg-hint', textContent: 'no Art-Net nodes responded' }));
      for (const n of art) {
        wrap.append(foundRow(n.shortName || n.longName || n.ip, n.ip, n.longName && n.longName !== n.shortName ? [n.longName] : [], (next, id) => {
          const dts = next.deviceTypes || [];
          const typeId = (dts.find((t) => t.id === 'generic') || dts[0])?.id;
          return { id, name: n.shortName || n.longName || id, ip: n.ip, colorOrder: 'GRB', port: 6454, protocol: 'artnet', universe: 0, typeId };
        }));
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
    if (!px) return el('div', { className: 'seg-hint', textContent: 'no fixtures patched, spans 0 universes' });
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
      (() => {
        // IP with live validity (red border when non-empty + malformed) — mirrors the
        // LEDger import flow so the manual editor isn't the lone unvalidated field.
        const ipInput = textInputCommit(d.ip, (x) => upd({ ip: x }));
        const mark = () => { ipInput.style.borderColor = (!ipInput.value || isValidIPv4(ipInput.value)) ? '' : '#a33'; };
        ipInput.addEventListener('input', mark); mark();
        return el('label', { className: 'fx-field' }, [el('span', { textContent: 'IP' }), ipInput, ipLink]);
      })(),
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
      // Colour order (physical wiring spec) + output delay (ms, time-align this
      // controller against the rest of the rig; 0 = immediate). Shown inline.
      field('Colour Order', selectInput(COLOR_ORDERS, d.colorOrder ?? 'GRB', (x) => upd({ colorOrder: x }))),
      field('Sync delay (ms)', numInputCommit(d.syncDelayMs ?? 0, (x) => upd({ syncDelayMs: Math.max(0, Math.min(1000, Math.round(x))) }))),
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
  // Auto-name for a definition: CLEAN (the size shows as a greyed suffix, not in the
  // editable name). A matrix defaults to "Matrix", a strip to "Strip".
  function autoTypeName(nt) {
    return (Math.max(1, Math.round(Number(nt.rows) || 1)) > 1) ? 'Matrix' : 'Strip';
  }
  // The greyed, non-editable size suffix shown after a type's name: "6ch" for a DMX
  // fixture, "C×R" for a matrix, "Npx" for a strip.
  function typeSizeSuffix(t) {
    if (isDmxType(t)) return `${t.channels?.length || paramsToChannels(t.params || []).length}ch`;
    const cols = Math.max(1, Math.round(Number(t.cols) || 1)), rows = Math.max(1, Math.round(Number(t.rows) || 1));
    return rows > 1 ? `${cols}×${rows}` : `${cols * rows}px`;
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
      // Name stays CLEAN (just the user's text) — the channel count shows as a badge
      // in the Inventory list (like "60 px"), not baked into the name. A pixel type
      // keeps its auto W×H·px name while it's still auto.
      const isDmxT = nt.params && nt.params.some((p) => p && p.count != null);
      if (isDmxT) nt.name = uniqueTypeName(next.fixtureTypes, stripChSuffix(nt.name), nt.id);
      else if (wasAuto) nt.name = uniqueTypeName(next.fixtureTypes, autoTypeName(nt), nt.id);
      commit(next);
    };
    const isGrid = (Number(t.rows) || 1) > 1;
    const isDmx = !!(t.params && t.params.some((p) => p && p.count != null));   // DMX-profile mode (name+count params)
    // Name field: an editable clean name + a greyed, non-editable size suffix (e.g.
    // "(6ch)" / "(60px)") shown inside the same box so the size is apparent but fixed.
    const nameInput = textInputCommit(t.name, (x) => upd((nt) => { nt.name = uniqueTypeName(show.fixtureTypes, stripChSuffix(x), nt.id); }));
    const nameCtrl = el('div', { className: 'name-suffixed' }, [nameInput, el('span', { className: 'name-suffix', textContent: `(${typeSizeSuffix(t)})` })]);
    const rows = [
      field('Name', nameCtrl),
      // Layout: a pixel strip/matrix (W×H + Color Format) OR a DMX fixture defined by
      // a list of name+count parameters. Switching to DMX seeds the params from the
      // current colour format; switching back drops them.
      field('Layout', selectInput([{ value: 'pixels', label: 'Pixels (strip / matrix)' }, { value: 'dmx', label: 'DMX channels' }], isDmx ? 'dmx' : 'pixels',
        (mode) => upd((nt) => {
          if (mode === 'dmx') { if (!(nt.params && nt.params.some((p) => p && p.count != null))) nt.params = channelsToParams(fixtureTypeChannels(nt)); nt.cols = 1; nt.rows = 1; }
          else { delete nt.channels; nt.params = []; nt.name = stripChSuffix(nt.name); }   // leaving DMX → drop params + the (Nch) suffix
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
    rows.push(field('Colour Format', selectInput(COLOR_FORMATS, t.colorFormat || '', (x) => upd((nt) => { nt.colorFormat = x; }))));
    // Wiring (Distribution) only matters for a matrix — which corner pixel #0 sits
    // in, row/column order, and snake vs. straight. Shown as a visual 4×4 glyph grid.
    if (isGrid) {
      rows.push(el('div', { className: 'fx-pts', textContent: 'wiring' }));
      rows.push(distributionPicker(t.distribution ?? 0, (x) => upd((nt) => { nt.distribution = x; })));
    }
    // A pixel strip/matrix has no extra channels — that's a DMX fixture (switch the
    // Layout to "DMX channels" to define a channel list). So no Parameters here.

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

  const uniqueId = (list, prefix) => { let n = (list?.length || 0) + 1; while ((list || []).some((x) => x.id === `${prefix}${n}`)) n++; return `${prefix}${n}`; };
  const stripNum = (s) => String(s || '').replace(/\s+\d+$/, '').trim();   // "FOS 2" → "FOS"

  // Duplicate an Inventory item as an independent copy and select it. The copy is
  // numbered ("Name 2", "Name 3", …) rather than "Name copy". No placed instances are
  // created — only the definition/model is copied.
  function duplicateController(show, id) {
    const t = (show.deviceTypes || []).find((x) => x.id === id);
    if (!t) return false;
    const next = structuredClone(show);
    const nid = uniqueId(next.deviceTypes, 'dt');
    const taken = new Set((next.deviceTypes || []).map((x) => String(x.name || '').toLowerCase()));
    const base = stripNum(t.name) || 'Controller';
    let name = base; let n = 2; while (taken.has(name.toLowerCase())) name = `${base} ${n++}`;
    next.deviceTypes.push({ ...structuredClone(t), id: nid, name });
    selDevTypeId = nid; lastSel = 'devtype'; libSel = 'controller'; commit(next); return true;
  }
  function duplicateType(show, id) {
    const t = (show.fixtureTypes || []).find((x) => x.id === id);
    if (!t) return false;
    const next = structuredClone(show);
    const nid = uniqueId(next.fixtureTypes, 't');
    // Clean numbered copy name ("FOS Luminus PRO 2") — the channel count is a badge.
    const core = stripNum(stripChSuffix(t.name));
    const taken = new Set(next.fixtureTypes.map((x) => String(x.name || '').toLowerCase()));
    let n = 2; let name = core; while (taken.has(name.toLowerCase())) name = `${core} ${n++}`;
    next.fixtureTypes.push({ ...structuredClone(t), id: nid, name });
    selTypeId = nid; lastSel = 'type'; libSel = 'fixture'; commit(next); return true;
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
        const state = d.protocol === 'artnet' ? 'artnet' : !d.ip ? 'noip' : pinging.has(d.id) || !st ? 'check' : st.ok ? 'online' : 'offline';
        const title = { online: 'online', offline: 'offline', check: 'checking…', noip: 'no IP set', artnet: 'Art-Net node' }[state];
        const row = listRow(d.name || d.id, [d.ip || 'no ip', modelName(d), `${devicePixels(d.id)} px`],
          d.id === selDeviceId, () => { selDeviceId = d.id; lastSel = 'device'; render(); });
        row.prepend(el('i', { className: `dev-dot dev-${state}`, title }));
        devList.append(row);
      }
      autoPing(show.devices);
      if (!show.devices.length) b.append(el('div', { className: 'seg-hint', textContent: 'no devices yet — add one or scan, or define models in the Inventory tab' }));
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
        const dup = el('button', { className: 'lib-dup', textContent: '⧉', title: 'duplicate (⌘D)', onclick: (e) => { e.stopPropagation(); duplicateController(getShow(), t.id); } });
        list.append(listRow(t.name, [`${t.outputs} out`, `×${count}`, dup],
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
        const dup = el('button', { className: 'lib-dup', textContent: '⧉', title: 'duplicate (⌘D)', onclick: (e) => { e.stopPropagation(); duplicateType(getShow(), t.id); } });
        // Size shows as a greyed suffix on the name ("(6ch)" / "(60px)"); ×N = instances.
        list.append(ListRow(t.name, { suffix: `(${typeSizeSuffix(t)})`, badges: [`×${count}`, dup],
          selected: libSel === 'fixture' && t.id === selTypeId,
          onClick: () => { selTypeId = t.id; lastSel = 'type'; libSel = 'fixture'; render(); } }));
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
    // What was last clicked: 'device' | 'devtype' | 'type' (lets the app point the
    // Fixture editor group at a device vs. an Inventory model without tabs).
    lastSel: () => lastSel,
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
      if (lastSel === 'devtype' && selDevTypeId && selDevTypeId !== 'generic') {
        const t = (show.deviceTypes || []).find((x) => x.id === selDevTypeId);
        const used = deviceTypeInstanceCount(show, selDevTypeId);
        // In use → explain rather than silently doing nothing.
        if (used) { window.alert(`“${t?.name || selDevTypeId}” is in use by ${used} device${used === 1 ? '' : 's'} — remove those first.`); return false; }
        if (!confirmDelete(`Delete controller model “${t?.name || selDevTypeId}”?`)) return false;
        const next = structuredClone(show);
        next.deviceTypes = (next.deviceTypes || []).filter((t) => t.id !== selDevTypeId);
        selDevTypeId = null; commit(next); return true;
      }
      if (lastSel === 'type' && selTypeId && selTypeId !== 'generic') {
        const used = typeInstanceCount(show, selTypeId);
        const t = (show.fixtureTypes || []).find((x) => x.id === selTypeId);
        // Always confirm; if in use, warn that placed fixtures go too.
        const msg = used
          ? `Delete “${t?.name || selTypeId}”?\n\n${used} placed fixture${used === 1 ? '' : 's'} will also be removed.`
          : `Delete fixture type “${t?.name || selTypeId}”?`;
        if (!confirmDelete(msg)) return false;
        const next = structuredClone(show);
        next.fixtureTypes = (next.fixtureTypes || []).filter((x) => x.id !== selTypeId);
        next.fixtures = (next.fixtures || []).filter((f) => f.typeId !== selTypeId);
        selTypeId = null; commit(next); return true;
      }
      return false;
    },
    // ⌘D duplicates the selected Inventory item — a controller MODEL or a fixture
    // DEFINITION — as an independent copy ("… copy"), then selects it. The copy is a
    // new definition only; no placed instances are created. Returns true if it copied.
    duplicateSelected: () => {
      const show = getShow();
      if (libSel === 'controller' && selDevTypeId) return duplicateController(show, selDevTypeId);
      if (libSel === 'fixture' && selTypeId) return duplicateType(show, selTypeId);
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
