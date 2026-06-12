// External modulation channels — live values fed by the daemon over the bridge
// socket (OSC/UDP messages and { type:'ext' } socket JSON both land here, see
// server/index.js). A channel is just a name → latest raw number; mapping onto
// a param's range happens per-binding (anim.js 'external' mode: from/to/gain).
//
// NOTE: the four audio band names (level/bass/mid/high) are reserved by the
// audio input — an external channel with one of those names would shadow the
// band in the merged signals map. Use distinct names (e.g. OSC-style '/fader1').

const values = Object.create(null);   // channel → latest value (the live signals map)
const lastSeen = new Map();           // channel → ms timestamp of the last update

// Record a channel value (called by the bridge on every ext message).
export function extSet(channel, value) {
  const v = Number(value);
  if (typeof channel !== 'string' || !channel || !Number.isFinite(v)) return;
  values[channel] = v;
  lastSeen.set(channel, Date.now());
}

// The live channel→value map. The SAME object every call (updated in place)
// so the per-frame signals merge stays allocation-free on this side.
export function extChannels() { return values; }

// Channels for the UI: [{ channel, value, age }] (age in ms since last update),
// sorted by name so the picker is stable across re-renders.
export function extList() {
  const now = Date.now();
  return Object.keys(values).sort().map((channel) => ({
    channel, value: values[channel], age: now - (lastSeen.get(channel) ?? now),
  }));
}
