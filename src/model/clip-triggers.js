// Per-clip triggers: each triggerable clip owns an onset DETECTOR + a BUS of recent trigger
// timestamps (seconds), keyed by clip id. Pure (no DOM / Web Audio) → node-testable. The ⚡
// button calls fire(); the render loop calls poll() with a band sampler; both push to the SAME
// per-clip bus, read back by the compositor/sampler via trigsFor(clipId).
import { createOnsetDetector } from './onset.js';

const CAP = 8;
const EMPTY = [];

export function createClipTriggers() {
  const buses = new Map();       // clipId → number[] (seconds, newest last, cap 8)
  const detectors = new Map();   // clipId → { det, sig }
  const sigOf = (a) => `${a.sensitivity}|${a.refractoryMs}|${a.floor}`;
  const push = (id, sec) => { let b = buses.get(id); if (!b) { b = []; buses.set(id, b); } b.push(sec); if (b.length > CAP) b.splice(0, b.length - CAP); };

  return {
    fire(clipId, sec) { if (clipId != null) push(clipId, sec); },

    // clips: active triggerable clips (each {id, audioTrigger?}). bandOf(name)→0..1.
    // nowMs: monotonic ms (detector clock). nowSec: elapsed seconds (bus stamp).
    poll(clips, bandOf, nowMs, nowSec) {
      const fired = [];
      for (const c of clips || []) {
        const at = c && c.audioTrigger;
        if (!at || !at.enabled) continue;
        const sig = sigOf(at);
        let d = detectors.get(c.id);
        if (!d || d.sig !== sig) { d = { det: createOnsetDetector(at), sig }; detectors.set(c.id, d); }
        if (d.det.push(bandOf(at.band || 'bass'), nowMs)) { push(c.id, nowSec); fired.push(c.id); }
      }
      return fired;
    },

    trigsFor(clipId) { return buses.get(clipId) || EMPTY; },

    prune(liveIds) {
      const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
      for (const k of [...buses.keys()]) if (!live.has(k)) buses.delete(k);
      for (const k of [...detectors.keys()]) if (!live.has(k)) detectors.delete(k);
    },

    reset() { buses.clear(); detectors.clear(); },
  };
}
