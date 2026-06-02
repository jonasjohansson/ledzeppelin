// Per-parameter animation (Resolume "Timeline" mode, minimal).
//
// A parameter is in one of two modes:
//   BASIC    — a static value in params[key] (no anim entry).
//   TIMELINE — an anim spec drives it: it sweeps between `from` and `to` over
//              `durationMs`, in a `direction`, on a free-running clock.
//
// An animation spec: { from, to, durationMs, direction }.
//   direction ∈ 'forward' (from→to, repeat), 'backward' (to→from, repeat),
//              'mirror' (from→to→from, ping-pong).
//
// Animations are stored per (namespaced) param key alongside the values, e.g.
//   clip.anim = { 'line.pos': { from: 0, to: 1, durationMs: 4000, direction: 'mirror' } }
// and RESOLVED to plain numbers each frame (see resolveParams) so the compositor
// keeps receiving static params and needs no knowledge of animation.

export const DIRECTIONS = ['forward', 'backward', 'mirror'];

export function makeAnim(from, to, durationMs = 4000, direction = 'forward') {
  return { from: Number(from) || 0, to: Number(to) || 0, durationMs: Math.max(0, Math.round(durationMs)), direction };
}

// Normalized 0..1 phase for the given clock time, duration and direction.
export function animPhase(timeSec, durationMs, direction = 'forward') {
  const dur = (Number(durationMs) || 0) / 1000;
  if (dur <= 0) return 0;
  let ph = (Number(timeSec) || 0) / dur;
  ph -= Math.floor(ph);          // wrap to 0..1 (handles negative too)
  if (direction === 'backward') return 1 - ph;
  if (direction === 'mirror') return 1 - Math.abs(2 * ph - 1); // 0→1→0
  return ph;                      // forward
}

// The animated value of one spec at `timeSec`.
export function animatedValue(spec, timeSec) {
  if (!spec) return undefined;
  const p = animPhase(timeSec, spec.durationMs, spec.direction);
  return spec.from + (spec.to - spec.from) * p;
}

// Resolve a params map against an anim map at `timeSec`: animated keys are
// overridden by their computed value; everything else passes through. Returns
// the SAME params reference when there are no animations (cheap fast-path).
export function resolveParams(params, anim, timeSec) {
  if (!anim) return params;
  const keys = Object.keys(anim);
  if (!keys.length) return params;
  const out = { ...(params || {}) };
  for (const k of keys) out[k] = animatedValue(anim[k], timeSec);
  return out;
}
