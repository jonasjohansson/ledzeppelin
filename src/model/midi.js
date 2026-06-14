// Web MIDI input → external channels + tempo clock.
//
// - Control Change → external channel `cc<n>` (0..1), Note → `note<n>` (vel 0..1).
//   These flow through the same external-channel store as OSC/socket, so you bind
//   them with the External modulator (no separate MIDI-learn UI needed).
// - MIDI clock (0xF8, 24 pulses/quarter) drives the global BPM via a callback.
//
// requestMIDIAccess needs a user gesture the first time; once the browser has
// granted it, later calls resolve without a prompt (so we can auto-enable).

import { extSet } from './external.js';

let access = null;
let enabled = false;
let onBpm = null;                       // callback(bpm) from MIDI clock

// Clock state: average the last few quarter-note intervals for a stable BPM.
let clkAnchor = null, clkCount = 0, clkIntervals = [];

export function midiEnabled() { return enabled; }
export function setBpmCallback(fn) { onBpm = fn; }

function resetClock() { clkAnchor = null; clkCount = 0; clkIntervals = []; }

function onClock(ts) {
  if (clkAnchor == null) { clkAnchor = ts; clkCount = 0; return; }   // anchor on first pulse
  clkCount++;
  if (clkCount < 24) return;                                          // 24 pulses = one quarter note
  const dt = ts - clkAnchor; clkAnchor = ts; clkCount = 0;
  if (dt <= 0) return;
  clkIntervals.push(dt); if (clkIntervals.length > 4) clkIntervals.shift();
  const avg = clkIntervals.reduce((a, b) => a + b, 0) / clkIntervals.length;
  const bpm = Math.round(60000 / avg);
  if (bpm >= 20 && bpm <= 300 && onBpm) onBpm(bpm);
}

function handleMessage(e) {
  const d = e.data; if (!d || !d.length) return;
  const status = d[0];
  if (status === 0xF8) { onClock(e.timeStamp); return; }              // timing clock
  if (status === 0xFA || status === 0xFB || status === 0xFC) { resetClock(); return; } // start/continue/stop
  const type = status & 0xF0;
  if (type === 0xB0) { extSet(`cc${d[1]}`, d[2] / 127); return; }     // control change → 0..1
  if (type === 0x90) { extSet(`note${d[1]}`, d[2] ? d[2] / 127 : 0); return; } // note on (vel 0 = off)
  if (type === 0x80) { extSet(`note${d[1]}`, 0); }                    // note off
}

export async function enableMidi() {
  if (enabled) return true;
  if (!navigator.requestMIDIAccess) { console.warn('Web MIDI not available in this browser'); return false; }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
    const bind = () => { for (const inp of access.inputs.values()) inp.onmidimessage = handleMessage; };
    bind();
    access.onstatechange = bind;        // pick up hot-plugged controllers
    enabled = true;
    return true;
  } catch (e) { console.warn('MIDI access denied:', e?.message || e); return false; }
}

export function midiInputs() {
  if (!access) return [];
  return [...access.inputs.values()].map((i) => ({ id: i.id, name: i.name || 'MIDI input' }));
}
