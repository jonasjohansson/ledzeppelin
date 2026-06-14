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

// A param spec is BASIC (no entry), TIMELINE (mode 'timeline', default),
// AUDIO (mode 'audio', driven by an audio band 0..1 scaled by gain), or
// EXTERNAL (mode 'external', driven by a live OSC / socket-JSON channel).
export function makeAnim(from, to, durationMs = 10000, direction = 'forward') {
  return { mode: 'timeline', from: Number(from) || 0, to: Number(to) || 0, durationMs: Math.max(0, Math.round(durationMs)), direction };
}

// `source`: 'external' (a hardware input) or 'composition' (the comp's clip
// audio). Both feed independent analysers — see model/audio.js.
export function makeAudioAnim(from, to, band = 'level', gain = 1, source = 'external') {
  return { mode: 'audio', from: Number(from) || 0, to: Number(to) || 0, band, gain: Number(gain) || 1, source: source === 'composition' ? 'composition' : 'external' };
}

export function makeExternalAnim(from, to, channel = '', gain = 1) {
  return { mode: 'external', from: Number(from) || 0, to: Number(to) || 0, channel, gain: Number(gain) || 1 };
}

// Normalized 0..1 phase for the given clock time, duration and direction.
// `phase` is an offset in CYCLES (0..1) — retimeAnim() writes it so edits to
// direction/duration stay continuous on the free-running clock.
export function animPhase(timeSec, durationMs, direction = 'forward', phase = 0) {
  const dur = (Number(durationMs) || 0) / 1000;
  if (dur <= 0) return 0;
  let ph = (Number(timeSec) || 0) / dur + (Number(phase) || 0);
  ph -= Math.floor(ph);          // wrap to 0..1 (handles negative too)
  if (direction === 'backward') return 1 - ph;
  if (direction === 'mirror') return 1 - Math.abs(2 * ph - 1); // 0→1→0
  return ph;                      // forward
}

// Retime a timeline spec edit so the sweep CONTINUES from where it is now
// instead of jumping: given the current spec, the edited spec and the clock,
// compute the `phase` offset that makes the new (direction, duration) pass
// through the value the old spec is at right now — pressing ← reverses from
// the current position, bounce folds from it, a duration change rescales
// around it. Non-timeline specs pass through untouched.
export function retimeAnim(spec, next, timeSec) {
  if (!next || next.mode !== 'timeline' || !spec || spec.mode !== 'timeline') return next;
  const dur = (Number(next.durationMs) || 0) / 1000;
  if (dur <= 0) return next;
  // Where the OLD spec is right now: clock position x (0..1) and value position p.
  const p = animPhase(timeSec, spec.durationMs, spec.direction, spec.phase);
  const oldDur = (Number(spec.durationMs) || 0) / 1000;
  let x = oldDur > 0 ? (Number(timeSec) || 0) / oldDur + (Number(spec.phase) || 0) : 0;
  x -= Math.floor(x);
  // Is the value currently travelling UP? (forward rises; mirror rises in its
  // first half; backward falls.)
  const rising = spec.direction === 'forward' || (spec.direction === 'mirror' && x < 0.5);
  // The clock position the NEW direction needs to output p (mirror picks the
  // branch that keeps the current travel direction).
  let nx;
  if (next.direction === 'backward') nx = 1 - p;
  else if (next.direction === 'mirror') nx = rising ? p / 2 : 1 - p / 2;
  else nx = p;
  let phase = nx - (Number(timeSec) || 0) / dur;
  phase -= Math.floor(phase);
  return { ...next, phase };
}

// The value of one spec at `timeSec`, given the current `signals` map — the
// audio bands MERGED with the external channels ({ level, bass, mid, high,
// ...extChannels }; the four band names are reserved by audio). Timeline specs
// use the clock; audio/external specs read their bound signal (×gain, clamped).
export function animatedValue(spec, timeSec, signals) {
  if (!spec) return undefined;
  let p;
  if (spec.mode === 'audio' || spec.mode === 'external') {
    // Audio reads a per-source band ("external:bass" / "composition:level"),
    // falling back to the plain band name when the namespaced key isn't present
    // (legacy/source-less anims, or signal maps that only expose plain bands).
    let key = spec.channel;
    if (spec.mode === 'audio') {
      key = spec.source ? `${spec.source}:${spec.band}` : spec.band;
      if (signals && !(key in signals) && spec.band in signals) key = spec.band;
    }
    const v = (signals && signals[key]) || 0;
    p = Math.max(0, Math.min(1, v * (spec.gain ?? 1)));
  } else {
    p = animPhase(timeSec, spec.durationMs, spec.direction, spec.phase);
  }
  return spec.from + (spec.to - spec.from) * p;
}

// Resolve a params map against an anim map at `timeSec` (+ signals): animated
// keys are overridden by their computed value; everything else passes through.
// Returns the SAME params reference when there are no animations (fast-path).
export function resolveParams(params, anim, timeSec, signals) {
  if (!anim) return params;
  const keys = Object.keys(anim);
  if (!keys.length) return params;
  const out = { ...(params || {}) };
  for (const k of keys) out[k] = animatedValue(anim[k], timeSec, signals);
  return out;
}
