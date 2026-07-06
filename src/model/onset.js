// Pure, browser-free onset detector: fires when a 0..1 signal spikes above its own
// running average (EMA), gated by a noise floor and a refractory period. No Web Audio,
// no DOM — so it unit-tests under `node --test` and is reused by src/model/audio.js.
//
// createOnsetDetector(opts) → { push(value, nowMs) → boolean, reset() }
//   sensitivity  how far above the EMA the value must jump to count as an onset,
//                as a fraction of the EMA (0.5 = 50% louder than recent average). 0..3.
//   refractoryMs minimum gap between fires (debounce); one clap = one pulse.
//   floor        absolute minimum value to consider (ignores room hum / silence).
//   attack       EMA smoothing per frame (higher = average adapts faster). 0..1.
//
// push(value, nowMs) expects a non-decreasing nowMs. If the caller's clock jumps
// backward (e.g. a transport reset without calling reset()), fires are suppressed
// until time catches back up — call reset() on such resets.

export function createOnsetDetector(opts = {}) {
  const sensitivity = clampNum(opts.sensitivity, 0.5, 0, 3);
  const refractoryMs = clampNum(opts.refractoryMs, 120, 0, 5000);
  const floor = clampNum(opts.floor, 0.05, 0, 1);
  const attack = clampNum(opts.attack, 0.15, 0.01, 1);

  let ema = 0;
  let primed = false;      // seen at least one sample (so the first frame just seeds the EMA)
  let lastFireMs = -Infinity;

  return {
    push(value, nowMs) {
      const v = Number.isFinite(value) ? value : 0;
      if (!primed) { ema = v; primed = true; return false; }

      const threshold = Math.max(floor, ema * (1 + sensitivity));
      const fired =
        v >= threshold &&      // threshold is >= floor, so this already implies v >= floor
        nowMs - lastFireMs >= refractoryMs;

      if (fired) lastFireMs = nowMs;
      ema += (v - ema) * attack;   // update AFTER the test so the spike doesn't mask itself
      return fired;
    },
    reset() { ema = 0; primed = false; lastFireMs = -Infinity; },
  };
}

function clampNum(x, dflt, lo, hi) {
  const n = Number(x);
  if (!Number.isFinite(n)) return dflt;
  return n < lo ? lo : n > hi ? hi : n;
}
