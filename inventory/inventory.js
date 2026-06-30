// Inventory window — the standalone TEMPLATE-LIBRARY editor. It mounts the SAME
// library list + detail editor the main app builds (createFixturePanel's
// libraryEl + libraryDetailEl/librarySelection), so this is the exact catalog UI
// that used to live in the removed Inventory tab — not a reimplementation.
//
// The popout is served by the daemon at /inventory/ and owns the model directly:
// it loadShow()s on open, and every edit (add / rename / delete a controller model
// or fixture type) flows through createFixturePanel's commit() → saveShow() +
// our setShow() hook, where we re-persist and broadcast on BroadcastChannel
// ('lz-inventory') so the main app (T11) can refresh. We also LISTEN on that
// channel and re-render if another window changes the show, keeping every window
// consistent — mirroring how mappings/ handles its 'lz-mappings' channel both ways.

import { createFixturePanel, loadShow, saveShow } from '../src/ui/fixtures.js';
import { createImportPanel } from '../src/ui/import.js';
import { syncAccent } from '../src/ui/sync-accent.js';
import { emptyShow, syncDeviceTypes, syncFixtureTypes } from '../src/model/show.js';

const $ = (id) => document.getElementById(id);
const listEl = $('inv-list');
const detailEl = $('inv-detail');
const detailTitleEl = $('inv-detail-title');
const statusEl = $('inv-status');
const importEl = $('inv-import');
const importPickBtn = $('inv-import-pick');

// Mirror the editor's chosen accent (persisted in lz.accent) so Inventory matches the
// theme — shared with the Mappings popout.
syncAccent();

// The show this window edits. Load the persisted show; if there is none yet, seed a
// fresh catalog (QuinLED controller presets + default fixture types) the same way
// the main app does on first run, so the page is useful even standalone.
function readShow() {
  const loaded = loadShow();
  if (loaded) return loaded;
  return syncDeviceTypes(syncFixtureTypes(emptyShow()));
}
let show = readShow();

// BroadcastChannel — both directions. A BroadcastChannel never delivers a message
// back to the context that posted it, so broadcasting our own edits can't loop.
const bus = new BroadcastChannel('lz-inventory');

// Persist + broadcast. createFixturePanel.commit() already saveShow()s before
// calling setShow(); we keep it explicit here (per spec) and post the change so the
// main window can refresh its add menu.
function persistAndBroadcast(next) {
  show = next;
  saveShow(next);
  bus.postMessage({ type: 'inventory-changed' });
}

// Build the catalog panel exactly as the main app does, then mount only the LIBRARY
// pieces (the Devices instance list / WLED scan stay in the main app). The "+"
// instantiate-into-scene handlers are intentionally omitted — there's no canvas
// here; this page authors TEMPLATES (the "+ new …" authoring buttons go through
// commit()/setShow()). getConnected:false keeps any network UI quiet.
const panel = createFixturePanel({
  getShow: () => show,
  setShow: (next) => persistAndBroadcast(next),
  onSelect: () => mountDetail(),
  onPick: () => mountDetail(),
  getConnected: () => false,
});

// Mount the library LIST once (createFixturePanel re-renders into it in place).
listEl.append(panel.libraryEl);

// Mount the selected item's DETAIL editor. Called on every list re-render
// (onSelect) and selection change (onPick) so the editor follows the selection,
// just like the main app's updateInspector().
function mountDetail() {
  const detail = panel.libraryDetailEl?.();
  const sel = panel.librarySelection?.();
  detailTitleEl.textContent = sel ? `${sel.kind}: ${sel.name}` : 'properties';
  detailEl.textContent = '';
  if (detail) detailEl.append(detail);
  else detailEl.append(Object.assign(document.createElement('div'), { className: 'inv-detail-hint', textContent: 'select a controller model or fixture type to edit it' }));
}
mountDetail();

// --- LEDger import (re-homed here from the main window) ----------------------
// The import panel picks a preset → assigns controller IPs → applies. Its
// applyShow persists the WHOLE imported show (createImportPanel saveShow()s the
// next show before calling applyShow), so we just update our local copy and tell
// the main window to adopt it: 'inventory-import' triggers a full rig replace
// there (devices + fixtures + composition), unlike 'inventory-changed' which only
// merges the type arrays. onApplied re-renders our catalog against the new show.
const importPanel = createImportPanel({
  getShow: () => show,
  applyShow: (next) => { show = next; bus.postMessage({ type: 'inventory-import' }); },
  onApplied: () => panel.refresh(),
});
importEl.append(importPanel.el);
importPickBtn.addEventListener('click', () => importPanel.trigger?.());

// Receive: another window changed the show → reload + re-render so we stay in sync.
// A main-window "Import from LEDger…" click also reaches us as 'open-import' →
// open the file picker so the import flow starts here.
bus.onmessage = (e) => {
  if (e.data?.type === 'open-import') { importPanel.trigger?.(); return; }
  if (e.data?.type !== 'inventory-changed') return;
  show = readShow();
  panel.refresh();   // → onSelect → mountDetail()
};

statusEl.textContent = 'editing the template library — changes save instantly';
