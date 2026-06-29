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
import { emptyShow, syncDeviceTypes, syncFixtureTypes } from '../src/model/show.js';

const $ = (id) => document.getElementById(id);
const listEl = $('inv-list');
const detailEl = $('inv-detail');
const detailTitleEl = $('inv-detail-title');
const statusEl = $('inv-status');

// This window loads ui.css (which only carries the DEFAULT accent). Mirror the
// editor's chosen accent (persisted in lz.accent) here — on load and live via the
// storage event — so Inventory matches the theme. (Identical to mappings.js.)
(function syncAccent() {
  const h2 = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(x || ''); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, w) => { const A = h2(a), B = h2(b); return toHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };
  const apply = () => {
    let hex; try { hex = localStorage.getItem('lz.accent'); } catch { hex = null; }
    if (!h2(hex)) return;
    const s = document.documentElement.style;
    s.setProperty('--accent', hex);
    s.setProperty('--accent-soft', mix(hex, '#0a0a0a', 0.16));
    s.setProperty('--accent-line', mix(hex, '#0a0a0a', 0.40));
    s.setProperty('--accent-text', mix(hex, '#ffffff', 0.62));
  };
  apply();
  addEventListener('storage', (e) => { if (e.key === 'lz.accent') apply(); });
})();

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

// Receive: another window changed the show → reload + re-render so we stay in sync.
bus.onmessage = (e) => {
  if (e.data?.type !== 'inventory-changed') return;
  show = readShow();
  panel.refresh();   // → onSelect → mountDetail()
};

statusEl.textContent = 'editing the template library — changes save instantly';
