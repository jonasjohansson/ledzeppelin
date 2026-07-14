import { makeFixtureType, typeInstanceCount, makeDeviceType, deviceTypeInstanceCount, pushTypeToFixtures, deviceOutputConfig } from '../model/show.js';
import { fixtureLabel, fixtureRange, pointsFromTransform } from '../model/fixture-transform.js';
import { Section } from './section.js';
import { controllerColorMap } from '../model/chains.js';
import { getDeviceState, setDeviceState, identify, scanDevices, pushDeviceConfig, getDeviceOutputs } from '../wled.js';
import { el, field, selectInput, shiftDown, coarseSnap } from './dom.js';
import { Slider } from './controls.js';
import { NumInput, TextInput } from './kit/field.js';
import { ListRow } from './kit/listrow.js';
import { fixtureTypeChannels, paramSpan, paramsToChannels, channelsToParams, isDmxType } from '../model/dmx.js';
import { confirmDelete } from './confirm.js';
import { DISTRIBUTIONS, gridCellOrder } from '../model/grid.js';
import { isValidIPv4 } from '../model/ip.js';

const STORAGE_KEY = 'ledzeppelin.show';
// Controller colour ORDER: the channel wiring order. The RGB reorderings plus the
// 4-channel RGBW variants (White = min(R,G,B) at output) so a GRBW/SK6812 controller
// can send its white byte directly; the per-fixture Color Format below still overrides.
export const COLOR_ORDERS = ['RGB', 'GRB', 'BGR', 'RBG', 'GBR', 'BRG',
  'RGBW', 'GRBW', 'BGRW', 'RBGW', 'WRGB', 'WGRB'];
// Per-FIXTURE colour FORMAT options: '' inherits the controller's order; the rest
// pin this fixture's format. Every controller order plus the amber (A) variants, so
// RGB, RGBW and RGBWA strips can share one controller.
export const COLOR_FORMATS = [{ value: '', label: 'From controller' }, ...COLOR_ORDERS,
  'RGBA', 'RGBWA', 'RGBAW',
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
export function createFixturePanel({ getShow, setShow, onSelect, onPick, onInstantiateFixture, onInstantiateController, onDeviceAdded, onPushType, getConnected = () => true }) {
  // This panel renders the catalog LIST only (the library of controller + fixture
  // models); the selected item's editor goes into the host's sidebar (app wires that
  // via deviceDetailEl / libraryDetailEl and re-renders it on onSelect). The live
  // device list lives in the app's Output list (renderOutput), not here.
  const libraryBox = el('div', { className: 'fx-panel' });   // Library — controller + fixture models
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
  // onUpdate (optional): called when any ping resolves so a list mounted OUTSIDE this
  // panel (the app's Output device list, which paints the status dot) can re-render.
  // When omitted, falls back to the panel's own coalesced render.
  const autoPing = (devices, onUpdate) => {
    for (const d of devices) {
      // Art-Net nodes have no WLED JSON API — never poll them (avoids a false "offline").
      if (!d.ip || d.protocol === 'artnet' || deviceStatus.has(d.id) || pinging.has(d.id)) continue;
      pinging.add(d.id);
      getDeviceState(d.ip).then((st) => { pinging.delete(d.id); deviceStatus.set(d.id, st); onUpdate ? onUpdate() : scheduleRender(); });
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
    // CHECK + REBOOT are WLED-only and only meaningful once a real WLED is actually
    // detected at this controller's IP (auto-pinged on render). Art-Net nodes and
    // undetected / offline controllers show nothing here.
    if (d.protocol === 'artnet') return el('div');
    const st = deviceStatus.get(d.id);
    if (!st?.ok) return el('div');
    const refresh = async () => { deviceStatus.set(d.id, await getDeviceState(d.ip)); render(); };
    return el('div', { className: 'ctrl-block' }, [
      el('div', { className: 'ctrl-row' }, [
        el('button', { className: 'ctrl-btn', textContent: 'check', title: 'read status from the controller', onclick: refresh }),
        // Flash the physical controller red so you can locate it on the rig (works best
        // with output paused/blackout — live DDP overrides WLED's own segments).
        el('button', { className: 'ctrl-btn', textContent: 'identify', title: 'flash this controller red to locate it (pause output / blackout to see it)', onclick: () => identify(d.ip) }),
        el('button', {
          className: 'ctrl-btn', textContent: 'reboot', title: 'reboot the controller (output to it drops for ~10s)',
          onclick: async () => {
            if (!window.confirm(`Reboot “${d.name || d.id}”?\n\nIt drops off the network for ~10s while it restarts.`)) return;
            deviceStatus.delete(d.id); render();                 // status goes unknown while it cycles
            const r = await setDeviceState(d.ip, { rb: true });   // WLED JSON API: reboot
            if (!r.ok) window.alert(`Reboot failed: ${r.error}`);
          },
        }),
      ]),
    ]);
  }

  // "Save to device": write each output's LED length + colour order to WLED's
  // config, then set the controller's DEFAULT colour so it shows the brand colour.
  function saveToDeviceRow(d, online = true, offTitle = '') {
    const show = getShow();
    const nOut = (show.deviceTypes || []).find((m) => m.id === d.typeId)?.outputs ?? d.outputs ?? 1;
    // Dense per-output array indexed by the fixture's 0-based port (= WLED bus
    // index): pushConfig writes outs[i] → bus i, so a port-0 fixture is counted and
    // every port maps to its own bus (no off-by-one). See deviceOutputConfig.
    const outs = deviceOutputConfig(show.fixtures, d.id, nOut, d.colorOrder || 'GRB');
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
  // The scan action (WLED subnet sweep + Art-Net ArtPoll, in parallel, rendered
  // independently). Triggered by the scan icon in the Devices tab header.
  function runScan(rerender = render) {
    if (scanState.running || !getConnected()) return;
    scanState = { running: true, result: null, artnet: null, error: null }; rerender();
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
  }
  // The scan RESULTS (error / found controllers), rendered separately below the row.
  // While running, shows a live PROGRESS block (the two probes, each marked done as
  // it resolves). Null only when idle with nothing to show yet.
  function scanResults(show) {
    const art = scanState.artnet;   // null = not scanned yet, [] = scanned, none found
    // === IN PROGRESS ====================================================
    // Don't go blank during the scan: name both probes and reflect each leg's
    // independent completion (the two legs resolve + rerender on their own).
    if (scanState.running) {
      const wrap = el('div', { className: 'scan-block scan-progress' });
      wrap.append(el('div', { className: 'scan-status' }, [
        el('span', { className: 'scan-spinner', role: 'status', 'aria-label': 'scanning' }),
        el('span', { textContent: 'Scanning…' }),
      ]));
      const probe = (label, done, detail) => el('div', { className: 'scan-probe' + (done ? ' is-done' : '') }, [
        el('span', { className: 'scan-mark', textContent: done ? '✓' : '·' }),
        el('span', { textContent: label }),
        el('span', { className: 'fx-badge', textContent: detail }),
      ]);
      // WLED leg is done once result OR error is set; Art-Net leg once artnet !== null.
      const wledDone = scanState.result != null || scanState.error != null;
      wrap.append(probe('WLED subnet sweep', wledDone,
        scanState.error ? 'failed' : wledDone ? `${scanState.result?.devices.length ?? 0} found` : 'scanning…'));
      const artDone = art != null;
      wrap.append(probe('Art-Net ArtPoll', artDone, artDone ? `${art.length} found` : 'scanning…'));
      return wrap;
    }
    if (!scanState.result && !scanState.error && !art) return null;
    const wrap = el('div', { className: 'scan-block' });
    if (scanState.error) wrap.append(el('div', { className: 'fx-err', textContent: `scan failed: ${scanState.error}` }));
    const known = new Set((show.devices || []).map((d) => d.ip));
    // A found controller → one click to add it (with the right protocol/port).
    const uniqueDeviceId = (next) => { let n = (next.devices.length || 0) + 1, id; do { id = `c${n}`; n++; } while (next.devices.some((x) => x.id === id)); return id; };
    const foundRow = (label, ip, badges, makeDevice, wledIp) => {
      const added = known.has(ip);
      const add = el('button', { className: 'ctrl-btn' + (added ? ' is-added' : ''), textContent: added ? '✓' : 'add', title: added ? 'already added' : 'add this device', disabled: added });
      add.onclick = () => {
        const next = structuredClone(show);
        // Unique id: increment until unused (a mid-list delete can make
        // `length + 1` collide with an existing id — and this id drives selection).
        const id = uniqueDeviceId(next);
        next.devices.push(makeDevice(next, id));
        selDeviceId = id; lastSel = 'device';
        commit(next);
        // commit() only refreshes the panel's own render; tell the app so the LIVE
        // #output-list re-renders + selects the new device immediately (issue #4).
        onDeviceAdded?.(id);
      };
      const buttons = [add];
      // WLED only: "+ outputs" also imports a fixture per configured LED output
      // (skipping empty ones) — reads the controller's bus config over the daemon
      // proxy, then lays each output out as a horizontal bar sized to its pixels.
      if (wledIp && !added) {
        const addOut = el('button', { className: 'ctrl-btn', textContent: '+ outputs', title: 'add this controller AND a fixture per configured LED output' });
        addOut.onclick = async () => {
          addOut.disabled = true; const orig = addOut.textContent; addOut.textContent = '…';
          const res = await getDeviceOutputs(wledIp);
          if (!res.ok || !Array.isArray(res.data)) {   // daemon down / not WLED / no buses → plain Add still works
            addOut.textContent = orig; addOut.disabled = false;
            addOut.title = `couldn't read outputs: ${res.error || 'no data'}`;
            return;
          }
          const outs = res.data.filter((o) => (o.len || 0) > 0);   // skip length-0 (unused) outputs
          const next = structuredClone(getShow());
          const id = uniqueDeviceId(next);
          const dev = makeDevice(next, id);
          dev.outputs = res.data.length;                           // instance owns its output count (8-bus ⇒ reads as DigOcta)
          if (outs[0]?.order) dev.colorOrder = outs[0].order;
          const byOut = (next.deviceTypes || []).find((t) => Number(t.outputs) === res.data.length);
          if (byOut) dev.typeId = byOut.id;                        // pick the matching QuinLED model by bus count
          next.devices.push(dev);
          const cv = next.composition?.canvas || { w: 1280, h: 720 };
          const PXPM = 100, LPM = 60;                              // drawn scale: canvas-px per metre; strips are 60 led/m
          let fn = 1;
          outs.forEach((o, k) => {
            while (next.fixtures.some((x) => x.id === `f${fn}`)) fn++;
            const meters = o.len / LPM;
            const tf = { x: cv.w / 2, y: 60 + k * 40, w: meters * PXPM, h: 10, rotation: 0 };
            next.fixtures.push({
              id: `f${fn++}`, name: `Out ${o.index + 1}`,
              pixelCount: o.len, ledsPerMeter: LPM, meters,
              colorFormat: o.rgbw ? o.order + 'W' : '',           // 4-ch (e.g. GRBW) for a white-channel strip, else inherit
              input: { transform: tf, points: pointsFromTransform(tf, cv) },
              output: { deviceId: id, port: o.index, pixelOffset: 0 },   // port = WLED bus index (DDP buffer order)
            });
          });
          selDeviceId = id; lastSel = 'device';
          commit(next);
          onDeviceAdded?.(id);
        };
        buttons.push(addOut);
      }
      // Name (truncates) · IP chip (fixed slot so rows column-align) · detail chips · add(+outputs).
      return el('div', { className: 'output-row scan-row' }, [
        el('span', { textContent: label || ip, title: label || ip }),
        el('span', { className: 'fx-badge scan-ip', textContent: ip }),
        ...badges.map((b) => el('span', { className: 'fx-badge', textContent: b, title: b })), ...buttons,
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
        }, d.ip));
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
    if (!total) return el('div');   // nothing patched yet → show nothing
    const wrap = el('div', {}, [el('div', { className: 'fx-pts', textContent: `patch · ${total} px` })]);
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
    if (!px) return el('div');   // nothing patched yet → show nothing
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
        // (Art-Net SYNC is a model-level setting now — see the Inventory controller editor.
        // Discovery lives in the Devices SCAN, which already ArtPolls — no per-device scan.)
        field('Universe', numInputCommit(d.universe ?? 0, (x) => upd({ universe: Math.max(0, Math.round(x)) }))),
        artnetSpanHint(show, d),
      ] : []),
      // Colour order = the colour byte order (physical wiring spec — the only one most
      // rigs need). A fixture on this device can PIN its own format (RGBW on an RGB
      // controller, etc.); when any does, this order is only a fallback for the rest —
      // so surface that override inline instead of leaving it silent.
      (() => {
        const orderField = field('Order', selectInput(COLOR_ORDERS, d.colorOrder ?? 'GRB', (x) => upd({ colorOrder: x })));
        const overridden = (show.fixtures || []).some((f) => f.output?.deviceId === d.id && f.colorFormat && f.colorFormat !== 'NONE');
        if (overridden) orderField.querySelector('span').append(el('span', { className: 'seg-hint', textContent: ' · order set per-fixture' }));
        return orderField;
      })(),
      // Identity colour — the swatch/bars in the Output list + the canvas Tint mode.
      // Auto-assigned from the palette on creation; override it here.
      (() => {
        const ci = el('input', { type: 'color', value: d.color || '#888888', title: 'controller identity colour (Output list + Tint mode)' });
        ci.addEventListener('change', () => upd({ color: ci.value }));
        return field('Color', ci);
      })(),
      // Output gamma calibration (daemon-side LUT) — straightens LED fades. 1 = linear.
      // Advanced-only: a technical calibration most shows never touch.
      (() => { const g = sliderRow('Gamma', d.gamma ?? 1, (x) => upd({ gamma: Math.round(x * 10) / 10 }), 0.5, 3, 0.1); g.classList.add('adv-only'); return g; })(),
      // Patch ruler (PATCH · N px + the fixture segments) — technical; advanced-only.
      (() => { const r = patchRuler(show, d); r.classList.add('adv-only'); return r; })(),
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
      // Art-Net sync (ArtSync): latch all of a device's universes together each frame
      // so a multi-universe rig doesn't tear. A model-level capability (applies to every
      // device of this model that outputs Art-Net). Off by default; some nodes ignore it.
      field('Art-Net sync', (() => {
        const c = el('input', { type: 'checkbox' }); c.checked = !!t.artnetSync;
        c.addEventListener('change', () => upd((nt) => { nt.artnetSync = c.checked; }));
        return c;
      })()),
      ...(t.id !== 'generic' ? [deleteEntryBtn('Delete controller model…')] : []),
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
    // Templates stay standalone (placed fixtures never auto-follow edits) — this
    // button is the ONE explicit fan-out: overwrite the spec of every placed
    // fixture of this type from the template (one commit → one undo step in-app).
    // The popout passes onPushType (the main window must apply the push on ITS
    // live fixtures — the type-merge sync would clobber a fixtures-only save).
    const pushRow = () => {
      const n = typeInstanceCount(show, t.id);
      return el('button', {
        className: 'fx-add', disabled: !n,
        textContent: `Push to placed fixtures (${n})`,
        title: n
          ? `overwrite the spec (size, wiring, format, channels) of the ${n} placed fixture${n === 1 ? '' : 's'} of this type with this template`
          : 'no placed fixtures use this type',
        onclick: () => {
          // Destructive: this overwrites every placed instance's pixelCount/format/wiring
          // from the template, flattening any per-fixture customisation (e.g. custom rib
          // pixel counts). Confirm, naming how many fixtures will be overwritten.
          const cnt = typeInstanceCount(show, t.id);
          if (!window.confirm(`Overwrite the spec (size, wiring, format, channels) of ${cnt} placed fixture${cnt === 1 ? '' : 's'} of this type? This replaces any per-fixture customisation.`)) return;
          if (onPushType) onPushType(t.id); else commit(pushTypeToFixtures(show, t.id));
        },
      });
    };
    if (isDmx) { dmxChannelEditor(t, upd, rows); rows.push(pushRow()); return el('div', { className: 'fx-card fx-detail' }, rows); }
    // Width = pixels per row (a 1-row strip's pixel count — "set pixels directly").
    rows.push(field('Width', numInputCommit(t.cols ?? t.pixelCount, (x) => upd((nt) => { nt.cols = x; }))));
    // Height = number of rows; 1 = a plain strip, >1 = a matrix/panel.
    rows.push(field('Height', numInputCommit(t.rows ?? 1, (x) => upd((nt) => { nt.rows = x; }))));
    rows.push(field('Pixels', el('span', { className: 'fx-readonly', textContent: String(t.pixelCount) })));
    // Colour channels: '' inherits the controller's order; pick RGBW here for a
    // white-channel strip (mixes freely with RGB fixtures on the same controller).
    rows.push(field('Colour channels', selectInput(COLOR_FORMATS, t.colorFormat || '', (x) => upd((nt) => { nt.colorFormat = x; }))));
    // Wiring (Distribution) only matters for a matrix — which corner pixel #0 sits
    // in, row/column order, and snake vs. straight. Shown as a visual 4×4 glyph grid.
    if (isGrid) {
      rows.push(el('div', { className: 'fx-pts', textContent: 'wiring' }));
      rows.push(distributionPicker(t.distribution ?? 0, (x) => upd((nt) => { nt.distribution = x; })));
    }
    // A pixel strip/matrix has no extra channels — that's a DMX fixture (switch the
    // Layout to "DMX channels" to define a channel list). So no Parameters here.

    // Physical size — drives true-scale strip THICKNESS on the canvas, and offers
    // density×length as a convenience to set a strip's Width. Plain always-open rows
    // (was a <details> fold, but every edit re-rendered it CLOSED — the fold ate the
    // click you'd just made; the editor keeps everything visible anyway).
    rows.push(el('div', { className: 'fx-pts', textContent: 'physical size' }));
    rows.push(
      sliderRow('LEDs / m', round2(t.ledsPerMeter), (x) => upd((nt) => { nt.ledsPerMeter = Math.max(0, x); if ((Number(nt.rows) || 1) === 1) nt.cols = Math.max(1, Math.round(x * (Number(nt.meters) || 0))); }), 0, 200, 1),
      sliderRow('Length (m)', round2(t.meters), (x) => upd((nt) => { nt.meters = Math.max(0, x); if ((Number(nt.rows) || 1) === 1) nt.cols = Math.max(1, Math.round((Number(nt.ledsPerMeter) || 0) * x)); }), 0, 20, 0.1),
    );
    if (t.id !== 'generic') rows.push(deleteEntryBtn('Delete fixture type…'));
    // Colour order is set per CONTROLLER (Devices tab), not per strip definition.
    rows.push(pushRow());
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
    libraryBox.textContent = '';

    // Compact selectable row (master): name + a couple of badges. Clicking opens
    // its editor below. Reuses the Output tab's list styling.
    const listRow = (label, badges, selected, onClick) => ListRow(label, { badges, selected, onClick });

    // Section header, styled like the Output tab: a label bar with a compact "+ …"
    // action pinned to the right (mirrors the +Controller/+Fixture buttons that sit on
    // the Output header), instead of a separate full-width "+ new …" row below the list.
    const libHead = (label, addLabel, addTitle, onAdd) => {
      const head = el('div', { className: 'fx-pts lib-head' }, [el('span', { textContent: label })]);
      head.append(el('button', { className: 'out-add', textContent: addLabel, title: addTitle, onclick: (e) => { e.stopPropagation(); onAdd(); } }));
      return head;
    };

    // Keep the device-editor selection valid for the app's left-sidebar editor
    // (deviceDetailEl / setDevice read selDeviceId). The device LIST itself is the
    // app's Output list (renderOutput); this panel only builds the catalog now.
    if (!show.devices.some((d) => d.id === selDeviceId)) selDeviceId = show.devices[0]?.id ?? null;

    // === The catalog of MODELS you build with ================================
    // Each item has a "⧉" to duplicate it (author a variant), and clicking the row
    // opens its editor popover. Authoring a brand-new blank model lives at the END of
    // each section ("+ new …"). (In contexts that place onto a canvas, a "+" to
    // instantiate also appears — gated on onInstantiate*; absent in the popout.)

    // --- Controller MODELS (flat — not foldable; just a label + the full list). ---
    const devTypes = show.deviceTypes || [];
    if (!devTypes.some((t) => t.id === selDevTypeId)) selDevTypeId = devTypes[0]?.id ?? null;
    libraryBox.append(libHead('controllers', '+ Controller', 'New controller model', () => { addController(show); onPick?.(); }));
    {
      const list = el('div', { className: 'fx-list' });
      for (const t of devTypes) {
        const count = deviceTypeInstanceCount(show, t.id);
        // The "+" only instantiates onto a canvas — render it ONLY where a handler is
        // wired (the main app). The Inventory popout has no canvas, so it omits the
        // handler and the button doesn't appear (it would be inert).
        const add = onInstantiateController && el('button', { className: 'lib-add', textContent: '+', title: 'add a controller of this model to the scene', onclick: (e) => { e.stopPropagation(); onInstantiateController(t.id); } });
        const dup = el('button', { className: 'lib-dup', textContent: '⧉', title: 'duplicate (⌘D)', onclick: (e) => { e.stopPropagation(); duplicateController(getShow(), t.id); } });
        list.append(listRow(t.name, [`${t.outputs} out`, `×${count}`, add, dup].filter(Boolean),
          libSel === 'controller' && t.id === selDevTypeId,
          () => { selDevTypeId = t.id; lastSel = 'devtype'; libSel = 'controller'; render(); onPick?.(); }));
      }
      if (!devTypes.length) libraryBox.append(el('div', { className: 'seg-hint', textContent: 'no controller models yet' }));
      libraryBox.append(list);
    }

    // --- Fixture DEFINITIONS (flat — define once, place many). ---
    const types = show.fixtureTypes || [];
    if (!types.some((t) => t.id === selTypeId)) selTypeId = types[0]?.id ?? null;
    libraryBox.append(libHead('fixtures', '+ Fixture', 'New fixture type', () => { addType(show); onPick?.(); }));
    {
      const list = el('div', { className: 'fx-list' });
      for (const t of types) {
        const count = typeInstanceCount(show, t.id);
        // "+" only when an instantiate handler is wired (see controllers, above).
        const add = onInstantiateFixture && el('button', { className: 'lib-add', textContent: '+', title: 'place a fixture of this type on the canvas', onclick: (e) => { e.stopPropagation(); onInstantiateFixture(t.id); } });
        const dup = el('button', { className: 'lib-dup', textContent: '⧉', title: 'duplicate (⌘D)', onclick: (e) => { e.stopPropagation(); duplicateType(getShow(), t.id); } });
        // Size shows as a greyed suffix on the name ("(6ch)" / "(60px)"); ×N = instances.
        list.append(ListRow(t.name, { suffix: `(${typeSizeSuffix(t)})`, badges: [`×${count}`, add, dup].filter(Boolean),
          selected: libSel === 'fixture' && t.id === selTypeId,
          onClick: () => { selTypeId = t.id; lastSel = 'type'; libSel = 'fixture'; render(); onPick?.(); } }));
      }
      if (!types.length) libraryBox.append(el('div', { className: 'seg-hint', textContent: 'no fixture definitions yet' }));
      libraryBox.append(list);
    }
    // Project file I/O lives in the Settings tab.
    if (mounted) onSelect?.();   // lists rebuilt → refresh the left sidebar editor too (covers status pings, edits)
  }

  render();
  mounted = true;
  // Delete the last-clicked device / controller model / fixture definition (shared
  // by the panel's ⌫ path AND the visible Delete buttons in the Library detail
  // editors). A controller model still in use is NOT deleted; deleting a fixture
  // definition removes its placed fixtures too (after a confirm).
  function deleteSelectedItem() {
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
  }

  // Danger button for the Library detail editors — the ⌫ shortcut only exists in
  // the main app's keydown, so the Library window needs a visible affordance.
  const deleteEntryBtn = (label) => el('button', {
    className: 'fx-add fx-delete', textContent: label,
    title: 'delete this library entry', onclick: () => deleteSelectedItem(),
  });

  return {
    libraryEl: libraryBox, refresh: render,
    // Device health for the app's Output list (renderOutput paints the status dot):
    // pingDevices kicks one-shot health checks (calling onUpdate when each resolves),
    // deviceState returns the cached { ok, … } for an id. The popout never calls
    // pingDevices (it has no live device list and passes getConnected:()=>false), so
    // it never touches the network.
    pingDevices: (devices, onUpdate) => autoPing(devices, onUpdate),
    deviceState: (id) => deviceStatus.get(id),
    isPinging: (id) => pinging.has(id),
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
    runScan: (rerender) => runScan(rerender),
    scanning: () => scanState.running,
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
    // true if it deleted. (Also reachable via the visible Delete button in the
    // Library detail editors — the Library window has no ⌫ wiring of its own.)
    deleteSelected: deleteSelectedItem,
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
