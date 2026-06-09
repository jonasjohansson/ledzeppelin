// Kagora import + assign-IP UI (Task 4.2).
//
// Flow: user picks a Kagora preset JSON → JSON.parse → importKagora(preset)
// yields a show with BLANK device IPs → an assign-IPs panel lets the user fill
// each controller's IP (with an optional sequential auto-fill) → Apply writes the
// IPs back, runs validate(), and only if valid + all IPs valid does it commit the
// new show through the SAME geometry path as fixture edits (saveShow + rebuild)
// and refresh the sibling panels.
//
// createImportPanel({ getShow, applyShow, onApplied }) → { el }
//   applyShow(show): persist + rebuild the whole pipeline (caller wires app.rebuild)
//   onApplied():     called after a successful apply (refresh fixtures/layers panels)

import { importKagora } from '../model/kagora-import.js';
import { validate } from '../model/show.js';
import { isValidIPv4, nextIPs } from '../model/ip.js';
import { saveShow } from './fixtures.js';
import { el } from './dom.js';

const COLOR_ORDERS = ['RGB', 'GRB', 'BGR', 'RBG', 'GBR', 'BRG'];

export function createImportPanel({ getShow, applyShow, onApplied }) {
  const root = el('div', { className: 'fx-panel imp-panel' });

  // pending: the imported show awaiting IP assignment, or null when idle.
  let pending = null;
  let openPicker = null;   // set by render() to click the latest file input (for the top menu)

  function render() {
    root.textContent = '';
    root.append(el('div', { className: 'fx-title', textContent: 'import' }));

    // --- Import button + hidden file input ---
    const banner = el('div', { className: 'fx-err imp-banner' });
    banner.style.display = 'none';
    const showError = (msg) => { banner.style.display = ''; banner.className = 'fx-err imp-banner'; banner.textContent = msg; };
    const clearError = () => { banner.style.display = 'none'; banner.textContent = ''; };

    const fileIn = el('input', { type: 'file', accept: '.json,application/json' });
    fileIn.style.display = 'none';
    openPicker = () => fileIn.click();
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
      try {
        pending = importKagora(preset);
      } catch (e) {
        showError(`import failed: ${e.message}`);
        fileIn.value = '';
        return;
      }
      fileIn.value = '';
      render();
    });

    root.append(el('button', {
      className: 'fx-add imp-btn', textContent: 'import from Kagora…',
      onclick: () => fileIn.click(),
    }), fileIn, banner);

    if (!pending) return;

    // --- Assign-IPs panel ---
    root.append(el('div', { className: 'fx-section', textContent: 'assign controller ips' }));
    root.append(el('div', { className: 'fx-pts',
      textContent: `${pending.devices.length} device(s), ${pending.fixtures.length} fixture(s) imported` }));

    // Sequential auto-fill: type a base IP and fill all device rows from it.
    const baseInput = el('input', { type: 'text', value: '10.0.0.11', placeholder: 'base IP' });
    baseInput.className = 'imp-base';
    const fillBtn = el('button', {
      className: 'imp-fill', textContent: 'auto-fill sequential',
      onclick: () => {
        const ips = nextIPs(baseInput.value.trim(), pending.devices.length);
        if (!ips) { showError(`auto-fill: invalid base IP or range overflow ("${baseInput.value}")`); return; }
        clearError();
        pending.devices.forEach((d, i) => { d.ip = ips[i]; });
        render();
      },
    });
    root.append(el('div', { className: 'imp-autofill' }, [baseInput, fillBtn]));

    // One row per device: name + IP input + colorOrder.
    for (let i = 0; i < pending.devices.length; i++) {
      const d = pending.devices[i];
      const ipIn = el('input', { type: 'text', value: d.ip ?? '', placeholder: 'e.g. 10.0.0.11' });
      ipIn.addEventListener('input', () => { d.ip = ipIn.value; markValidity(ipIn, d.ip); });
      markValidity(ipIn, d.ip);

      const coSel = el('select');
      for (const co of COLOR_ORDERS) {
        const opt = el('option', { value: co, textContent: co });
        if (co === (d.colorOrder ?? 'GRB')) opt.selected = true;
        coSel.append(opt);
      }
      coSel.addEventListener('change', () => { d.colorOrder = coSel.value; });

      root.append(el('div', { className: 'fx-card imp-row' }, [
        el('label', { className: 'fx-field' }, [el('span', { textContent: `${d.name} (${d.id})` }), ipIn]),
        el('label', { className: 'fx-field' }, [el('span', { textContent: 'colorOrder' }), coSel]),
      ]));
    }

    // --- Apply / Cancel ---
    const actions = el('div', { className: 'fx-io' });
    actions.append(el('button', {
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

        // 3) Commit through the geometry path: persist + rebuild + refresh panels.
        //    KEEP the current composition's layers/clips, but ADOPT the imported
        //    CANVAS (it matches the rig's aspect so the layout isn't stretched).
        const cur = getShow?.();
        const composition = cur?.composition
          ? { ...cur.composition, canvas: pending.composition?.canvas ?? cur.composition.canvas }
          : pending.composition;
        const next = { ...pending, composition };
        pending = null;
        saveShow(next);
        applyShow(next);   // app.rebuild — recreates sampler/route/bridge
        onApplied?.();     // refresh fixtures + layers panels
        render();
      },
    }));
    actions.append(el('button', {
      className: 'imp-cancel', textContent: 'cancel',
      onclick: () => { pending = null; clearError(); render(); },
    }));
    root.append(actions);
  }

  // Visual cue for invalid IP fields (red border via inline style; no CSS dep).
  function markValidity(input, ip) {
    input.style.borderColor = isValidIPv4(ip) ? '' : '#a33';
  }

  render();
  // trigger(): open the Kagora file picker from elsewhere (e.g. the top menu).
  return { el: root, refresh: render, trigger: () => openPicker?.() };
}
