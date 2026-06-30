// Kagora (LEDger) import + assign-IP UI (Task 4.2).
//
// Flow: user picks a LEDger preset JSON → JSON.parse → importKagora(preset)
// yields a show with BLANK device IPs → a preview + assign-IPs panel lets the user
// review the rig and fill each controller's IP (with a sequential auto-fill that
// also runs once on open) → Apply confirms the rig replace, writes the IPs back,
// runs validate(), and only if valid + all IPs valid does it commit the new show
// through the SAME geometry path as fixture edits (saveShow + rebuild) and refresh
// the sibling panels, then shows a persistent success banner.
//
// createImportPanel({ getShow, applyShow, onApplied }) → { el }
//   getShow():       the LIVE show (used to pre-fill IPs/colour order across re-import)
//   applyShow(show): persist + rebuild the whole pipeline (caller wires app.rebuild)
//   onApplied():     called after a successful apply (refresh fixtures/layers panels)

import { importKagora } from '../model/kagora-import.js';
import { validate } from '../model/show.js';
import { isValidIPv4, fillIPs } from '../model/ip.js';
import { saveShow } from './fixtures.js';
import { el } from './dom.js';

const COLOR_ORDERS = ['RGB', 'GRB', 'BGR', 'RBG', 'GBR', 'BRG'];

export function createImportPanel({ getShow, applyShow, onApplied }) {
  const root = el('div', { className: 'fx-panel imp-panel' });

  // pending: the imported show awaiting IP assignment, or null when idle.
  let pending = null;
  let openPicker = null;   // set by render() to click the latest file input (for the top menu)
  let didAutofill = false; // I7 — only auto-fill once per import (on first render)
  let successMsg = null;   // C3 — persistent success banner text, shown when idle.

  // N3 — true while an import is in progress AND at least one device has a
  // non-blank IP, so we can confirm before throwing that work away.
  const hasTypedIPs = () => !!pending && pending.devices.some((d) => (d.ip ?? '').trim() !== '');
  const confirmDiscard = () =>
    !hasTypedIPs() || window.confirm('Discard this import? You have typed controller IPs that will be lost.');

  // N3 — warn on window close while typed IPs are pending.
  const onBeforeUnload = (e) => {
    if (!hasTypedIPs()) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  };
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload);

  function importFromPreset(preset, showError) {
    let imported;
    try {
      imported = importKagora(preset);
    } catch (e) {
      showError(`import failed: ${e.message}`);
      return false;
    }
    // I5 — carry IPs + colour order forward from the LIVE show's device with the
    // same id, so re-importing a rig you've already addressed doesn't blank it.
    const live = getShow?.();
    const liveById = new Map((live?.devices ?? []).map((d) => [d.id, d]));
    for (const d of imported.devices) {
      const prev = liveById.get(d.id);
      if (prev) {
        if (prev.ip) d.ip = prev.ip;
        if (prev.colorOrder) d.colorOrder = prev.colorOrder;
      }
    }
    pending = imported;
    successMsg = null;
    didAutofill = false;
    return true;
  }

  function render() {
    root.textContent = '';

    const banner = el('div', { className: 'fx-err imp-banner' });
    banner.style.display = 'none';
    const showError = (msg) => { banner.style.display = ''; banner.className = 'fx-err imp-banner'; banner.textContent = msg; };
    const clearError = () => { banner.style.display = 'none'; banner.textContent = ''; };

    const fileIn = el('input', { type: 'file', accept: '.json,application/json' });
    fileIn.style.display = 'none';
    // N3 — re-triggering the picker mid-import discards typed IPs; confirm first.
    openPicker = () => { if (confirmDiscard()) fileIn.click(); };
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files[0];
      if (!file) return;
      clearError();
      let preset;
      try {
        preset = JSON.parse(await file.text());
      } catch (e) {
        showError(`parse failed: ${e.message}`);
        fileIn.value = '';
        return;
      }
      const ok = importFromPreset(preset, showError);
      fileIn.value = '';
      if (!ok) return;
      render();
    });

    root.append(fileIn, banner);

    // C3 — persistent success banner shown when idle after a successful apply.
    if (!pending && successMsg) {
      root.append(el('div', { className: 'imp-success', textContent: successMsg }));
    }

    if (!pending) return;

    const impDevices = pending.devices.length;
    const impFixtures = pending.fixtures.length;

    // C2 — a structurally-valid preset that yields no rig is a no-op. Show a clear
    // message and DO NOT render the assign/apply UI (apply can't run).
    if (impDevices === 0 && impFixtures === 0) {
      root.append(el('div', { className: 'fx-section', textContent: 'import' }));
      root.append(el('div', { className: 'imp-empty', textContent: 'Nothing to import — this file has no controllers or strips.' }));
      const actions = el('div', { className: 'fx-io' });
      actions.append(el('button', {
        className: 'imp-cancel', textContent: 'dismiss',
        onclick: () => { pending = null; clearError(); render(); },
      }));
      root.append(actions);
      return;
    }

    // --- Preview summary (I7) -------------------------------------------------
    const totalPx = pending.fixtures.reduce((sum, f) => sum + (f.pixelCount || 0), 0);
    const canvas = pending.composition?.canvas ?? { w: 0, h: 0 };
    root.append(el('div', { className: 'fx-section', textContent: 'import preview' }));

    const preview = el('div', { className: 'imp-preview' });
    preview.append(el('div', { className: 'imp-prev-line',
      textContent: `${impDevices} controller(s) · ${impFixtures} fixture(s) · ${totalPx} px · canvas ${canvas.w}×${canvas.h}` }));

    // Per-controller breakdown: name — outputs — Σpx — fixture count.
    for (const d of pending.devices) {
      const fixturesOnDev = pending.fixtures.filter((f) => f.output?.deviceId === d.id);
      const ports = new Set(fixturesOnDev.map((f) => f.output?.port));
      const px = fixturesOnDev.reduce((s, f) => s + (f.pixelCount || 0), 0);
      preview.append(el('div', { className: 'imp-prev-dev',
        textContent: `${d.name} — ${ports.size} output(s) — ${px} px — ${fixturesOnDev.length} fixture(s)` }));
    }
    // Unassigned (orphan) fixtures, if any, so the count reconciles.
    const orphans = pending.fixtures.filter((f) => !f.output?.deviceId);
    if (orphans.length) {
      const px = orphans.reduce((s, f) => s + (f.pixelCount || 0), 0);
      preview.append(el('div', { className: 'imp-prev-dev',
        textContent: `unassigned — ${px} px — ${orphans.length} fixture(s)` }));
    }
    root.append(preview);

    // --- Warnings (I4) --------------------------------------------------------
    const warnings = Array.isArray(pending.warnings) ? pending.warnings : [];
    if (warnings.length) {
      const warn = el('div', { className: 'imp-warn' });
      for (const w of warnings) warn.append(el('div', { className: 'imp-warn-line', textContent: w }));
      root.append(warn);
    }

    // --- Assign-IPs panel -----------------------------------------------------
    root.append(el('div', { className: 'fx-section', textContent: 'assign controller ips' }));

    // Live "N of M need a valid IP" count + apply enable/disable.
    const statusLine = el('div', { className: 'fx-pts imp-ipstatus' });
    let applyBtn;       // forward-declared; updateStatus() reads it
    const ipInputs = []; // device → its input, for re-marking after auto-fill
    function updateStatus() {
      const bad = pending.devices.filter((d) => !isValidIPv4(d.ip));
      const m = pending.devices.length;
      statusLine.textContent = bad.length
        ? `${bad.length} of ${m} controller(s) need a valid IP`
        : `all ${m} controller(s) have a valid IP`;
      statusLine.classList.toggle('imp-ipstatus-ok', bad.length === 0);
      if (applyBtn) applyBtn.disabled = bad.length > 0;
    }

    // Sequential auto-fill: type a base IP and fill all device rows from it.
    // Seed the base from the first device that already carries an IP (I5 carried
    // one over, or the user typed one) so the common case is a single edit — but
    // keep it a real placeholder (no fake default) when nothing is known yet.
    const seedBase = pending.devices.find((d) => isValidIPv4(d.ip))?.ip ?? '';
    const baseInput = el('input', { type: 'text', value: seedBase, placeholder: 'base IP (e.g. 192.168.1.50)' });
    baseInput.className = 'imp-base';
    const runFill = () => {
      const base = baseInput.value.trim();
      const res = fillIPs(base, pending.devices.length);
      if (!res) { showError(`auto-fill: invalid base IP ("${baseInput.value}")`); return; }
      clearError();
      pending.devices.forEach((d, i) => { if (i < res.filled) d.ip = res.ips[i]; });
      ipInputs.forEach((inp, i) => { inp.value = pending.devices[i].ip ?? ''; markValidity(inp, pending.devices[i].ip); });
      if (res.filled < pending.devices.length) {
        const stopDev = pending.devices[res.filled];
        showError(`auto-fill: filled ${res.filled} of ${pending.devices.length} (ran out of addresses at "${stopDev?.name ?? stopDev?.id}")`);
      }
      updateStatus();
    };
    const fillBtn = el('button', { className: 'imp-fill', textContent: 'auto-fill sequential', onclick: runFill });
    root.append(el('div', { className: 'imp-autofill' }, [baseInput, fillBtn]));
    root.append(statusLine);

    // One row per device: name + IP input + colorOrder.
    for (let i = 0; i < pending.devices.length; i++) {
      const d = pending.devices[i];
      const ipIn = el('input', { type: 'text', value: d.ip ?? '', placeholder: 'e.g. 192.168.1.50' });
      ipIn.addEventListener('input', () => { d.ip = ipIn.value; markValidity(ipIn, d.ip); updateStatus(); });
      markValidity(ipIn, d.ip);
      ipInputs.push(ipIn);

      const coSel = el('select');
      for (const co of COLOR_ORDERS) {
        const opt = el('option', { value: co, textContent: co });
        if (co === (d.colorOrder ?? 'GRB')) opt.selected = true;
        coSel.append(opt);
      }
      coSel.addEventListener('change', () => { d.colorOrder = coSel.value; });

      root.append(el('div', { className: 'fx-card imp-row' }, [
        el('label', { className: 'fx-field' }, [el('span', { textContent: `${d.name} (${d.id})` }), ipIn]),
        el('label', { className: 'fx-field' }, [el('span', { textContent: 'colour order' }), coSel]),
      ]));
    }

    // --- Apply / Cancel -------------------------------------------------------
    const actions = el('div', { className: 'fx-io' });
    applyBtn = el('button', {
      className: 'imp-apply', textContent: 'apply import',
      onclick: () => {
        // 1) Block blank/invalid IPs before touching validate/rebuild.
        const badIps = pending.devices.filter((d) => !isValidIPv4(d.ip));
        if (badIps.length) {
          showError(`fix IPs for: ${badIps.map((d) => `${d.name} (${d.id})`).join(', ')}`);
          return;
        }
        // 2) Imported show must pass structural validate() before apply/rebuild.
        const v = validate(pending);
        if (!v.ok) { showError(`validation failed: ${v.errors.join(' · ')}`); return; }

        // 3) C3 — confirm the destructive rig replace (layers/clips are kept).
        const cur = getShow?.();
        const liveControllers = cur?.devices?.length ?? 0;
        const liveFixtures = cur?.fixtures?.length ?? 0;
        const w = pending.composition?.canvas?.w ?? 0;
        const h = pending.composition?.canvas?.h ?? 0;
        const ok = window.confirm(
          `Replace your current rig (${liveControllers} controllers, ${liveFixtures} fixtures) with the imported one (${impDevices} controllers, ${impFixtures} fixtures)?\n\n` +
          `Your layers & clips are kept; the canvas becomes ${w}×${h}. You can undo this (⌘Z).`);
        if (!ok) return;

        // 4) Commit through the geometry path: persist + rebuild + refresh panels.
        //    KEEP the current composition's layers/clips, but ADOPT the imported
        //    CANVAS (it matches the rig's aspect so the layout isn't stretched).
        const composition = cur?.composition
          ? { ...cur.composition, canvas: pending.composition?.canvas ?? cur.composition.canvas }
          : pending.composition;
        const next = { ...pending, composition };
        pending = null;
        successMsg = `Imported ${impDevices} controllers, ${impFixtures} fixtures (${totalPx} px). Rig replaced — ⌘Z to undo.`;
        saveShow(next);
        applyShow(next);   // app.rebuild — recreates sampler/route/bridge
        onApplied?.();     // refresh fixtures + layers panels
        render();
      },
    });
    actions.append(applyBtn);
    actions.append(el('button', {
      className: 'imp-cancel', textContent: 'cancel',
      // N3 — discarding typed IPs needs a confirm.
      onclick: () => { if (!confirmDiscard()) return; pending = null; clearError(); render(); },
    }));
    root.append(actions);

    // Initial status + one-shot auto-fill on open (I7): if a base is typed-or-blank
    // we leave rows blank until the user supplies a base, but we still set the
    // disabled state immediately. We only auto-run the fill once per import, and
    // only if the user hasn't already got valid IPs (e.g. carried over via I5).
    updateStatus();
    if (!didAutofill) {
      didAutofill = true;
      // Auto-fill once on open ONLY for a fresh rig where NO device has an IP yet,
      // and only if we have a base to fill from. If I5 carried real IPs over we
      // must NOT clobber them with a sequential run (those may be deliberate).
      const noneAssigned = pending.devices.every((d) => !isValidIPv4(d.ip));
      if (noneAssigned && isValidIPv4(baseInput.value.trim())) runFill();
    }
  }

  // Visual cue for invalid IP fields (red border via inline style; no CSS dep).
  function markValidity(input, ip) {
    input.style.borderColor = isValidIPv4(ip) ? '' : '#a33';
  }

  render();
  // trigger(): open the LEDger file picker from elsewhere (e.g. the top menu).
  return { el: root, refresh: render, trigger: () => openPicker?.() };
}
