// Whether destructive deletes (fixtures, devices, clips, layers) ask "are you
// sure" before acting. Persisted in localStorage; default ON. The System ›
// Settings toggle flips it. Centralised so every delete path shares one rule.
const KEY = 'lz.confirmdelete';

export function confirmDeletesOn() {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}
export function setConfirmDeletes(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
}
// Returns true to PROCEED: skips the prompt entirely when the setting is off.
export function confirmDelete(msg) {
  return !confirmDeletesOn() || window.confirm(msg);
}
