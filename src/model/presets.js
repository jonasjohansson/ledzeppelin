// Named parameter presets for sources + effects, persisted in localStorage.
//
// A preset is a saved param subset for a given source/effect TYPE (e.g. all
// 'line' sources share 'line' presets). Keyed by `${kind}:${name}` → presetName
// → params object (the prefixed keys for that type, e.g. { 'line.pos': 0.2 }).

const KEY = 'ledzeppelin.presets';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function writeAll(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch { /* storage full / blocked */ }
}
const bucket = (kind, name) => `${kind}:${name}`;

// Sorted preset names for a source/effect type.
export function listPresets(kind, name) {
  return Object.keys(readAll()[bucket(kind, name)] || {}).sort((a, b) => a.localeCompare(b));
}

export function savePreset(kind, name, presetName, params) {
  const all = readAll();
  const b = bucket(kind, name);
  all[b] = all[b] || {};
  all[b][presetName] = { ...params };
  writeAll(all);
}

export function loadPreset(kind, name, presetName) {
  return readAll()[bucket(kind, name)]?.[presetName] || null;
}

export function deletePreset(kind, name, presetName) {
  const all = readAll();
  const b = bucket(kind, name);
  if (all[b]) { delete all[b][presetName]; writeAll(all); }
}
