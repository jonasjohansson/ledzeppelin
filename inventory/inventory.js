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
import { emptyShow, syncDeviceTypes, syncFixtureTypes, pushTypeToFixtures } from '../src/model/show.js';

const $ = (id) => document.getElementById(id);
const listEl = $('inv-list');
const detailEl = $('inv-detail');
const detailTitleEl = $('inv-detail-title');
const importEl = $('inv-import');

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
// Embedded (right-sidebar iframe) vs standalone popout window. When embedded, the
// selected item's editor floats in the MAIN window's #device-pop (like the Output
// controller/fixture editor) instead of stacking inline here — we post the pick and
// the main window opens the pop. The standalone popout keeps its two-column inline
// detail (it has no main-window pop to defer to).
const embedded = window.parent !== window;
if (embedded) document.querySelector('.inv-detail')?.setAttribute('style', 'display:none');

// Post the current Library selection so the main window opens its floating editor.
function postPick() {
  const s = panel.librarySelection?.();
  if (s) bus.postMessage({ type: 'library-select', kind: s.kind.toLowerCase(), id: s.id });
}

const panel = createFixturePanel({
  getShow: () => show,
  setShow: (next) => persistAndBroadcast(next),
  onSelect: () => mountDetail(),
  onPick: () => { if (embedded) postPick(); mountDetail(); },
  // "Push to placed fixtures": apply locally (covers the standalone case), then
  // tell the MAIN window to apply the push on its LIVE fixtures — the ordinary
  // 'inventory-changed' sync merges TYPE arrays only and would clobber a
  // fixtures-only save from this window.
  onPushType: (typeId) => {
    show = pushTypeToFixtures(show, typeId);
    saveShow(show);
    bus.postMessage({ type: 'inventory-push-type', typeId });
    panel.refresh();   // → onSelect → mountDetail() (button count/label stays fresh)
  },
  getConnected: () => false,
});

// Mount the library LIST once (createFixturePanel re-renders into it in place).
listEl.append(panel.libraryEl);

// Mount the selected item's DETAIL editor. Called on every list re-render
// (onSelect) and selection change (onPick) so the editor follows the selection,
// just like the main app's updateInspector().
function mountDetail() {
  if (embedded) return;   // embedded: the editor floats in the main window's #device-pop
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

// ⌫ deletes the selected library entry — same rule as the main app's keydown
// (which this window doesn't share; this was the bug: the Library window had no
// delete path at all). The detail editors also carry a visible Delete button.
// Skipped while typing in a field.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
  if (/^(input|textarea|select)$/i.test(e.target?.tagName || '')) return;
  if (panel.deleteSelected?.()) { e.preventDefault(); mountDetail(); }
});

// ⌘D duplicates the selected model/type — the rows advertise "duplicate (⌘D)", so the
// chord must work HERE too (the main window's handler can't see keys inside this window).
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'd' || e.altKey || e.shiftKey) return;
  if (/^(input|textarea|select)$/i.test(e.target?.tagName || '')) return;
  e.preventDefault();   // never the browser bookmark dialog
  if (panel.duplicateSelected?.()) mountDetail();
});

// Receive: another window changed the show → reload + re-render so we stay in sync.
// A main-window "Import from LEDger…" click also reaches us as 'open-import' →
// open the file picker so the import flow starts here.
bus.onmessage = (e) => {
  if (e.data?.type === 'open-import') { importPanel.trigger?.(); return; }
  if (e.data?.type !== 'inventory-changed') return;
  show = readShow();
  panel.refresh();   // → onSelect → mountDetail()
};
