// The Output panel — the controller-grouped placement list (renderOutput) plus its
// row/section builders, drag-to-assign machinery and the chain-selected action.
// Extracted verbatim from app.js (no behavior change) behind the same explicit-hooks
// pattern as createSettingsPanel/initPrefs: everything that lives in app.js state
// (live show, selection, panel, bridge) arrives as a hook; pure helpers are imported
// straight from their model modules.
//
//   createOutputList(hooks) → { render }
//
//   getShow()                        — the live show
//   getSelected() / setSelected(set) — the selected-fixture id Set (render prunes
//                                      stale ids in place; assign REPLACES the Set —
//                                      app.js owns the binding)
//   getSelectedDeviceId() / setSelectedDeviceId(id)
//   expandedDevices                  — the "controllers the user opened" Set (shared)
//   panel                            — the devices panel (deviceState/isPinging/
//                                      pingDevices/runScan/scanResultsEl/scanning/refresh)
//   bridgeConnected()                — is the daemon bridge up (bridge is reassigned
//                                      on route changes, so an accessor, not the object)
//   outputListEl                     — the #output-list mount
//   oel                              — app.js's element helper (kept identical)
//   typeSizeSuffix(t)                — the shared "6ch"/"C×R"/"Npx" tag (also used by
//                                      app.js's inspector + template menus, so it stays
//                                      there and arrives as a hook)
//   saveShow / rebuild / redrawOverlay / updateInspector / closeTemplateMenu
//   selectFixture / selectDevice     — selection entry points (app.js owns selection)
//   applyShow(next)                  — save+rebuild+refresh-everything (chain action)

import { fixtureLabel, fixtureRange, fixtureNumbers } from '../model/fixture-transform.js';
import { isDmxFixture } from '../model/dmx.js';
import { freePort } from '../model/chains.js';

export function createOutputList(hooks) {
  const {
    getShow, getSelected, setSelected, getSelectedDeviceId, setSelectedDeviceId,
    expandedDevices, panel, bridgeConnected, outputListEl, oel, typeSizeSuffix,
    saveShow, rebuild, redrawOverlay, updateInspector, closeTemplateMenu,
    selectFixture, selectDevice, applyShow,
  } = hooks;

  let dragFxIds = [];                   // fixture id(s) being dragged onto a device/output (drag-to-assign)
  // Assign the given fixtures to a device (+ optional output port) and re-pack — the
  // drag-to-assign / drag-to-unassign action (deviceId '' = back to the Unassigned pool).
  function assignFixturesTo(fxIds, deviceId, port) {
    if (!fxIds || !fxIds.length) return;
    const n = structuredClone(getShow());
    for (const f of n.fixtures) if (fxIds.includes(f.id)) { f.output.deviceId = deviceId; if (port != null) f.output.port = port; }
    setSelected(new Set(fxIds)); expandedDevices.add(deviceId);
    saveShow(n); rebuild(n); panel.refresh(); render(); redrawOverlay();   // rebuild repacks pixel offsets
  }

  // Multi-select action: put the selected fixtures on ONE shared output (a fresh
  // port on the first one's device) so they become a chain.
  function chainSelectedAction() {
    return oel('div', { className: 'output-edit' }, [
      oel('button', {
        className: 'fx-add', textContent: '⛓ chain (same output)',
        onclick: () => {
          const show = getShow();
          const selectedFixtureIds = getSelected();
          const ids = [...selectedFixtureIds];
          const first = show.fixtures.find((f) => f.id === ids[0]); if (!first) return;
          const devId = first.output?.deviceId || '';
          const port = freePort(show, devId);
          const next = structuredClone(show);
          for (const f of next.fixtures) if (selectedFixtureIds.has(f.id)) { f.output.deviceId = devId; f.output.port = port; }
          applyShow(next);
        },
      }),
    ]);
  }

  function render() {
    updateInspector();
    if (!outputListEl) return;
    outputListEl.textContent = '';
    closeTemplateMenu();   // a re-render detaches the old anchor; drop any open menu
    // Add fixture / add device / inventory are header icons by the "Devices" title now
    // (wired once at boot) — no in-list toolbar.
    const show = getShow();
    const selectedFixtureIds = getSelected();
    const fixtures = show.fixtures || [];
    for (const id of [...selectedFixtureIds]) if (!fixtures.some((f) => f.id === id)) selectedFixtureIds.delete(id);
    if (getSelectedDeviceId() && !(show.devices || []).some((d) => d.id === getSelectedDeviceId())) setSelectedDeviceId(null);   // drop a stale device selection (e.g. after undo/delete)

    // The Fixtures group always shows the placement list (the Inventory model editor
    // is a separate group), so there's no longer a library-tab early-out.

    // selectable rows + inline position editor under the row.
    // (No early-out for an empty rig — the device containers still render below so
    // they're visible + droppable even before any fixture is placed.)
    // A header/row becomes a drop target: dropping the dragged fixture(s) assigns
    // them to `deviceId` (+ `port` when given; deviceId '' = unassign).
    const dropZone = (el, deviceId, port) => {
      el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-hover'); });
      // dragleave fires when entering a CHILD too — only clear when truly leaving,
      // so the hover doesn't flicker while dragging across the section's rows.
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover'); });
      el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop-hover'); assignFixturesTo(dragFxIds, deviceId, port); dragFxIds = []; });
      return el;
    };
    // A fixture row — same chrome as the Inventory list rows (.output-row + boxed
    // .fx-badge chips) so the two tabs read alike.
    const fixtureRow = (f, i, outLabel, devColor, outOverTitle) => {
      const row = oel('div', { className: 'output-row' + (selectedFixtureIds.has(f.id) ? ' selected' : '') });
      row.dataset.fxid = f.id;
      // Controller identity colour: a subtle 3px left bar (CSS var; the selection
      // accent bar overrides it — see .output-row.selected).
      if (devColor) row.style.setProperty('--dev-color', devColor);
      // Drag a fixture row onto a device header to assign it (the whole selection drags
      // when this row is part of a multi-select).
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        dragFxIds = (selectedFixtureIds.has(f.id) && selectedFixtureIds.size > 1) ? [...selectedFixtureIds] : [f.id];
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragFxIds.join(',')); } catch { /* some browsers */ }
      });
      const ftype = (show.fixtureTypes || []).find((t) => t.id === f.typeId);
      const dn = num.get(f.id); const nIdx = dn != null ? dn - 1 : i;   // display number (falls back to array index)
      const label = ftype?.name ? `${fixtureLabel(f, nIdx)} ${ftype.name}` : fixtureLabel(f, nIdx);
      const nameEl = oel('span', { className: 'lr-name', textContent: label });     // flex-grow name
      if (ftype) nameEl.append(oel('span', { className: 'lr-suffix', textContent: ` (${typeSizeSuffix(ftype)})` }));   // greyed size, appended to the name
      row.append(nameEl);
      if (outLabel) {
        const ob = oel('span', { className: 'fx-badge' + (outOverTitle ? ' out-over' : ''), textContent: outLabel });
        if (outOverTitle) ob.title = outOverTitle;
        row.append(ob);
      }
      // DMX fixtures badge their Art-Net patch (U{universe}.{address}); pixel strips
      // badge their pixel range.
      row.append(oel('span', { className: 'fx-badge', textContent: isDmxFixture(f) ? `U${f.input.dmx.universe ?? 0}.${f.input.dmx.address ?? 1}` : fixtureRange(f) }));
      row.onclick = (e) => selectFixture(f.id, e, { isolate: true });   // list click → just this fixture (⌫ deletes it)
      return row;
    };
    // A collapsible controller group, styled exactly like the Inventory sections
    // (▾ accent header + body). The triangle toggles; clicking the header selects the
    // controller (or unassign group). Returns its parts so callers can wire drop-zones.
    const devSection = (deviceId, title, badges, headClick) => {
      // Controllers are ALWAYS expanded — no fold/collapse. Clicking the header still
      // selects the controller for editing.
      const sec = oel('div', { className: 'insp-sec out-sec is-open' });
      const head = oel('div', { className: 'insp-sec-head' }, [oel('span', { className: 'insp-sec-title', textContent: (title || '').toUpperCase() })]);
      for (const b of (badges || [])) head.append(oel('span', { className: 'fx-badge', textContent: b }));
      if (headClick) head.onclick = headClick;
      const body = oel('div', { className: 'insp-sec-body' });
      sec.append(head, body);
      return { sec, head, body };
    };
    // GROUP the placement list by CONTROLLER → output, rendered as Inventory-style
    // collapsible sections (one per controller) with the fixtures as rows beneath.
    const devOrder = []; const devMap = new Map();
    fixtures.forEach((f, i) => {
      const did = f.output?.deviceId || '';
      let dg = devMap.get(did);
      if (!dg) { dg = { deviceId: did, groups: [], gmap: new Map() }; devMap.set(did, dg); devOrder.push(dg); }
      const port = f.output?.port ?? 1, key = `${did}:${port}`;
      let g = dg.gmap.get(key);
      if (!g) { g = { key, deviceId: did, port, items: [] }; dg.gmap.set(key, g); dg.groups.push(g); }
      g.items.push({ f, i });
    });
    // Show EVERY device as a container (even with no fixtures) so it's a drop target
    // for drag-to-assign — you can drop a fixture onto an empty controller.
    for (const d of show.devices) {
      if (!devMap.has(d.id)) { const dg = { deviceId: d.id, groups: [], gmap: new Map() }; devMap.set(d.id, dg); devOrder.push(dg); }
    }
    // Always show an "Unassigned" container, even when empty — it's a persistent drop
    // target: drag a fixture onto it to UNASSIGN it (deviceId '').
    if (!devMap.has('')) { const dg = { deviceId: '', groups: [], gmap: new Map() }; devMap.set('', dg); devOrder.push(dg); }
    // Controllers in SETUP order (their position in show.devices), the Unassigned
    // holding group LAST; each controller's outputs sorted ascending, and the strips
    // on an output in pixel-offset (chain) order — so the list reads the way the rig
    // is wired, not the order fixtures happened to be added.
    const devIdxOf = new Map(show.devices.map((d, i) => [d.id, i]));
    devOrder.sort((a, b) =>
      (a.deviceId ? (devIdxOf.get(a.deviceId) ?? 1e6) : 1e9) - (b.deviceId ? (devIdxOf.get(b.deviceId) ?? 1e6) : 1e9));
    for (const dg of devOrder) {
      dg.groups.sort((a, b) => a.port - b.port);
      for (const g of dg.groups) g.items.sort((a, b) => (a.f.output?.pixelOffset ?? 0) - (b.f.output?.pixelOffset ?? 0));
    }
    const num = fixtureNumbers(show);   // id → display number (#1,#2,… in this same order)

    for (const dg of devOrder) {
      // UNASSIGNED — a plain heading (not a foldable group), still a drop target: drop
      // a fixture here to unassign it. Its rows sit directly below the heading.
      if (!dg.deviceId) {
        const items = dg.groups.flatMap((g) => g.items);
        const head = oel('div', { className: 'insp-sec-head out-unassigned' }, [
          oel('span', { className: 'insp-sec-title', textContent: 'Unassigned' }),
          oel('span', { className: 'fx-badge', textContent: `${items.length} fx` }),
        ]);
        dropZone(head, '', null);   // drop a fixture here → unassign it
        outputListEl.append(head);
        for (const { f, i } of items) outputListEl.append(fixtureRow(f, i));
        continue;
      }
      const gdev = show.devices.find((d) => d.id === dg.deviceId);
      const devName = gdev?.name || dg.deviceId;
      // Per-OUTPUT loads: the ⚠ is a per-data-line framerate budget (maxPerOutput ≈
      // 40 fps for WS281x), never a total-device cap — name the offending line(s) in
      // the tooltip so a big total doesn't read as the problem.
      const loads = dg.groups.map((g) => ({ port: g.port, px: g.items.reduce((s, it) => s + (it.f.pixelCount || 0), 0) }));
      const devPx = loads.reduce((m, l) => m + l.px, 0);
      const gcap = Number(gdev?.maxPerOutput) || 0;
      const overPorts = new Set(loads.filter((l) => gcap > 0 && l.px > gcap).map((l) => l.port));
      const devOver = overPorts.size > 0;
      const { sec, head, body } = devSection(dg.deviceId, devName, [`${devPx}px${devOver ? ' ⚠' : ''}`],
        (e) => selectDevice(dg.deviceId, e));   // click the header → edit the controller (popover)
      const pxBadge = head.querySelector('.fx-badge');
      if (pxBadge && loads.length) {
        pxBadge.title = loads.map((l) => `out ${l.port}: ${l.px}${gcap ? `/${gcap}` : ''}px${overPorts.has(l.port) ? ' ⚠' : ''}`).join('  ·  ')
          + (devOver ? `\n⚠ over the ~40 fps budget on that line — still works, just fewer fps` : '');
      }
      // Online/offline/checking dot (same machinery as the old Devices list): the panel
      // caches each controller's last health check; renderOutput just paints it. Art-Net
      // nodes have no WLED API (no dot state to poll); a device with no IP reads "no IP".
      if (gdev) {
        const st = panel.deviceState?.(gdev.id);
        const dotState = gdev.protocol === 'artnet' ? 'artnet'
          : !gdev.ip ? 'noip'
          : (panel.isPinging?.(gdev.id) || !st) ? 'check'
          : st.ok ? 'online' : 'offline';
        const dotTitle = { online: 'online', offline: 'offline', check: 'checking…', noip: 'no IP set', artnet: 'Art-Net node' }[dotState];
        // Dot sits before the title (the old .insp-tri anchor is gone — headers no
        // longer fold, so anchoring after the triangle silently dropped the dot).
        head.prepend(oel('i', { className: `dev-dot dev-${dotState}`, title: dotTitle }));
      }
      // Controller identity colour swatch, just before the title (assigned in
      // syncDeviceTypes / editable in the device editor; Tint mode uses the same colour).
      if (gdev?.color) {
        const sw = oel('i', { className: 'dev-swatch', title: 'controller colour' });
        sw.style.background = gdev.color;
        head.insertBefore(sw, head.querySelector('.insp-sec-title'));
      }
      if (devOver) head.querySelector('.fx-badge')?.classList.add('out-over');
      if (getSelectedDeviceId() === dg.deviceId && !selectedFixtureIds.size) head.classList.add('is-sel');
      // The WHOLE section (header + its fixture rows) is the drop target — dropping
      // anywhere on a controller group assigns there; the 24px header alone was too
      // small a target to hit while dragging.
      dropZone(sec, dg.deviceId, null);
      // Fixtures as flat rows; a multi-output controller tags each row with its output.
      const multiOut = dg.groups.length > 1;
      for (const g of dg.groups) {
        const load = loads.find((l) => l.port === g.port);
        const overTitle = overPorts.has(g.port) ? `output ${g.port} carries ${load.px}/${gcap}px — over the ~40 fps budget` : null;
        for (const { f, i } of g.items) body.append(fixtureRow(f, i, multiOut ? `out ${g.port}` : null, gdev?.color, overTitle));
      }
      outputListEl.append(sec);
    }

    if (selectedFixtureIds.size > 1) outputListEl.append(chainSelectedAction());
    // SCAN button sits UNDER the list (with Unassigned), connected to its results below.
    // Shows "Scanning…" + disabled while running so you can't double-scan; disabled when
    // the daemon isn't up. The list re-renders during a scan, so this reflects live state.
    const scanning = !!panel.scanning?.();
    const daemonUp = bridgeConnected();
    // Probe each WLED controller's status ONCE (one-shot per id) so the dots above
    // reflect real online/offline — only when a daemon is up (no daemon → no network).
    // Each resolved ping re-renders this list to repaint its dot. The Inventory popout
    // never reaches here, so it never pings.
    if (daemonUp) panel.pingDevices?.(show.devices, render);
    outputListEl.append(oel('button', {
      className: 'fx-add', textContent: scanning ? 'Scanning…' : '⌖ scan',
      title: daemonUp ? 'scan the network for WLED + Art-Net controllers' : 'start the daemon (npm start) to scan',
      disabled: scanning || !daemonUp,
      onclick: () => panel.runScan?.(render),
    }));
    const scanRes = panel.scanResultsEl?.(); if (scanRes) outputListEl.append(scanRes);
  }

  return { render };
}
