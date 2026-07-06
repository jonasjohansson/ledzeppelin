// Project file I/O — New / Save / Load / composition load / ISF import (file picker,
// drag-drop, bundled examples) + the ⌘S/⌘O shortcuts. Extracted verbatim from app.js
// (no behavior change) behind explicit hooks. The two whole-show appliers stay in
// app.js — applyFullShow/applyComposition resize the stage and RECREATE the
// compositor (a live `let` the render loop owns) — and arrive here as hooks.
//
//   createProjectIO(hooks) → { newProject, saveShowToFile, openShowPicker,
//                              importISFExample }
//
//   getShow()          — the live show
//   applyFullShow(next)— open/import a whole project (stage resize + rebuild + persist)
//   applyComposition(c)— replace just the composition (visuals), keep the rig
//   rebuild(next)      — rebuild pipeline/panels from an edited show (ISF adds)
//   layerPanel         — getSelectedClipId/getSelectedLayerId/refresh (ISF drop target)
//   setSection(which)  — focus the Design section after an ISF lands
//   typingIn(t)        — "is the user typing in a field" guard for the shortcuts
//   oel                — app.js's element helper
//   defaultShow()      — the starter project New resets to

import { normalizeComposition, addISFClip, addISFEffect } from '../model/layers.js';
import { parseISF, isfParams, wrapISF } from '../engine/shaders/isf.js';
import { parseObj, objToKagora } from '../model/obj-import.js';
import { importKagora } from '../model/kagora-import.js';

export function createProjectIO(hooks) {
  const { getShow, applyFullShow, applyComposition, rebuild, layerPanel, setSection, typingIn, oel, defaultShow } = hooks;

  // New project: confirm, then reset to a sensible STARTER — one controller with a
  // single fixture wired to it, lit by a Lines clip. (Not blank, so there's
  // something on screen and a patch to build from.)
  // A fresh project gets a random LED Zeppelin track as its title (beats "untitled").
  const LZ_TRACKS = [
    'Stairway to Heaven', 'Kashmir', 'Whole Lotta Love', 'Black Dog', 'Immigrant Song',
    'Rock and Roll', 'Ramble On', 'Going to California', 'Dazed and Confused', 'Heartbreaker',
    "Since I've Been Loving You", 'When the Levee Breaks', 'The Rain Song', 'Over the Hills and Far Away',
    'No Quarter', 'Trampled Under Foot', 'Achilles Last Stand', 'In My Time of Dying', 'Ten Years Gone',
    'The Ocean', 'Fool in the Rain', 'Gallows Pole', 'Tangerine', 'Thank You', 'Misty Mountain Hop',
    'The Battle of Evermore', 'Good Times Bad Times', 'Communication Breakdown', 'In the Light',
    "Nobody's Fault but Mine", 'All My Love', 'Houses of the Holy', 'The Song Remains the Same',
  ];
  const randomTrackTitle = () => LZ_TRACKS[Math.floor(Math.random() * LZ_TRACKS.length)];

  function newProject() {
    if (!window.confirm('Start a new project? This clears the current one (save first if you want to keep it).')) return;
    // Reset to the standard default (Lines + Checkered, Generic Controller, 1280²) —
    // the same show a fresh install loads — with a random LED Zeppelin track as its title.
    const next = normalizeComposition(defaultShow());
    if (next.composition) next.composition.title = randomTrackTitle();
    applyFullShow(next);
  }

  function saveShowToFile() {
    const blob = new Blob([JSON.stringify(getShow(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'project.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  const openShowInput = document.getElementById('open-show-file');
  openShowInput?.addEventListener('change', async () => {
    const file = openShowInput.files[0]; if (!file) return;
    try {
      const loaded = JSON.parse(await file.text());
      if (!loaded || !Array.isArray(loaded.fixtures) || !loaded.composition) {
        window.alert(loaded?.instances ? 'That looks like a LEDger file — use “import from LEDger…” in the File menu.' : 'Not a LED Zeppelin project file.');
      } else {
        applyFullShow(normalizeComposition(loaded));
      }
    } catch (e) { window.alert('Load failed: ' + e.message); }
    openShowInput.value = '';
  });

  // (Composition EXPORT — "Save composition…" — lives in the Settings panel, see
  // src/ui/settings.js; it builds the file straight from getShow().composition.)
  const openCompInput = oel('input', { type: 'file', accept: '.json,application/json' });
  openCompInput.style.display = 'none'; document.body.append(openCompInput);
  openCompInput.addEventListener('change', async () => {
    const file = openCompInput.files[0]; if (!file) return;
    try { const c = JSON.parse(await file.text()); if (c && (c.layers || c.canvas)) applyComposition(c); else window.alert('Not a composition file.'); }
    catch (e) { window.alert('Load failed: ' + e.message); }
    openCompInput.value = '';
  });

  // Import an ISF shader (.fs/.isf) as a new generator clip on the active layer.
  // Its INPUTS become animatable, OSC/MIDI-mappable clip params automatically.
  // Content-stable id (a hash of the GLSL) so the same shader dedupes and a saved
  // clip's id never collides with a fresh import across sessions.
  const isfId = (g) => { let h = 5381; for (let i = 0; i < (g || '').length; i++) h = ((h << 5) + h + g.charCodeAt(i)) | 0; return 'isf' + (h >>> 0).toString(36); };
  const openISFInput = oel('input', { type: 'file', accept: '.fs,.isf,.frag,.glsl,.txt' });
  openISFInput.style.display = 'none'; document.body.append(openISFInput);
  // Import an ISF shader. `target` (from a drop) hints WHERE to land it:
  // {layerId, clipId} from the deck cell under the cursor — so dropping next to a
  // clip lands on THAT layer / applies the filter to THAT clip (not a new layer).
  function importISFText(text, filename, target) {
    const r = parseISF(text);
    if (!r.ok) { window.alert(`Not a valid ISF shader: ${r.error}`); return; }
    const show = getShow();
    const layers = show.composition?.layers || [];
    if (!layers.length) { window.alert('Add a layer first.'); return; }
    const isf = {
      id: isfId(r.glsl),
      name: (filename || '').replace(/\.[^.]+$/, '') || r.name,
      glsl: r.glsl, inputs: r.inputs, params: isfParams(r.inputs),
      src: wrapISF(r.glsl, r.inputs),
    };
    const findClip = (cid) => { for (const L of layers) for (const c of (L.clips || [])) if (c && c.id === cid) return { layerId: L.id, clipId: c.id }; return null; };
    if (r.type === 'effect') {
      // A filter (samples inputImage) → the clip under the drop, else the selected/
      // active clip (optionally on the dropped-on layer).
      const hit = (target?.clipId && findClip(target.clipId)) || findClip(layerPanel?.getSelectedClipId?.());
      let layerId = hit?.layerId, clipId = hit?.clipId;
      if (!clipId && target?.layerId) { const L = layers.find((x) => x.id === target.layerId); if (L) { layerId = L.id; clipId = L.activeClipId || L.clips?.[0]?.id; } }
      if (!clipId) { const L = layers.find((x) => x.activeClipId) || layers[0]; layerId = L.id; clipId = L.activeClipId || L.clips?.[0]?.id; }
      if (!clipId) { window.alert('Add/select a clip to apply the ISF effect to.'); return; }
      rebuild(addISFEffect(show, layerId, clipId, isf));
    } else {
      // A generator → the dropped-on layer, else the selected/first layer.
      const layerId = (target?.layerId && layers.some((L) => L.id === target.layerId)) ? target.layerId
        : (layers.find((L) => L.id === layerPanel?.getSelectedLayerId?.()) || layers[0]).id;
      rebuild(addISFClip(show, layerId, isf));
    }
    setSection('design'); layerPanel?.refresh?.();
  }
  openISFInput.addEventListener('change', async () => {
    const file = openISFInput.files[0]; openISFInput.value = '';
    if (file) importISFText(await file.text(), file.name);
  });
  // Import a 3D model (.obj): each named run (Base__leds=N__out=dev.port) becomes a
  // fixture. OBJ → LEDger preset → whole show (rig + a starter composition), applied
  // like opening a project. Naming metadata rides on the object names (see obj-import).
  async function applyObjFile(file) {
    try {
      const { preset, warnings } = objToKagora(parseObj(await file.text()));
      // importKagora returns a COMPLETE, normalized show (deviceTypes + devices +
      // fixtures + fixtureTypes + composition, already synced + canvas-fitted) — apply
      // it WHOLE, exactly as the LEDger import panel does. Cherry-picking fields dropped
      // deviceTypes, which the device manager + output need.
      const { warnings: impWarnings, ...show } = importKagora(preset);
      if (!show.fixtures.length) { window.alert('No fixtures in that OBJ. Name each run like  Tail__leds=204__out=dev.0'); return; }
      applyFullShow(show);
      const allWarn = [...warnings, ...(impWarnings || [])];
      if (allWarn.length) window.alert('Imported with notes:\n• ' + allWarn.join('\n• '));
    } catch (e) { window.alert('OBJ import failed: ' + e.message); }
  }

  // Drag-and-drop an ISF shader (.fs/.isf/.frag/.glsl) onto the window; the deck cell
  // under the cursor sets where it lands.
  const isISFName = (n) => /\.(fs|isf|frag|glsl)$/i.test(n || '');
  window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    const all = [...(e.dataTransfer?.files || [])];
    const isf = all.filter((f) => isISFName(f.name));
    const json = all.filter((f) => /\.json$/i.test(f.name));
    const objs = all.filter((f) => /\.obj$/i.test(f.name));
    if (!isf.length && !json.length && !objs.length) return;
    e.preventDefault();
    // ISF shaders → a new generator clip under the drop target (layer/clip cell).
    const node = document.elementFromPoint(e.clientX, e.clientY);
    const target = { layerId: node?.closest?.('.deck-layer')?.dataset.layer, clipId: node?.closest?.('.clip-cell')?.dataset.clip };
    for (const f of isf) importISFText(await f.text(), f.name, target);
    // .json → load a LED Zeppelin project (rig + visuals) or a composition (visuals only).
    for (const f of json) {
      try {
        const data = JSON.parse(await f.text());
        if (data && Array.isArray(data.fixtures) && data.composition) applyFullShow(normalizeComposition(data));
        else if (data && (data.layers || data.canvas)) applyComposition(data);
        else if (data && Array.isArray(data.instances)) window.alert('That looks like a LEDger preset — import it from the Library window.');
        else window.alert('Unrecognised .json — expected a LED Zeppelin project or composition.');
      } catch (err) { window.alert('Load failed: ' + err.message); }
    }
    // .obj → import a 3D model as a whole rig + starter show.
    for (const f of objs) await applyObjFile(f);
  });
  // Bundled ISF examples (source picker's "ISF" group): fetch one + import it.
  function importISFExample(file) {
    fetch('./examples/isf/' + encodeURIComponent(file))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('not found'))))
      .then((t) => importISFText(t, file))
      .catch(() => window.alert('Could not load ' + file));
  }

  // ⌘S save / ⌘O open — kept as shortcuts.
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || typingIn(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveShowToFile(); }
    else if (k === 'o') { e.preventDefault(); openShowInput?.click(); }
  });

  return { newProject, saveShowToFile, openShowPicker: () => openShowInput?.click(), importISFExample };
}
