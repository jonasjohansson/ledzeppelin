// Synthesized hard-rock startup intros — procedural HOMAGES to the heavy
// blues-rock the app is named after. Nothing here is a sample or a copy of any
// real song's riff: every note is generated live with oscillators, and the
// motifs are original (evoking a *style*, not reproducing a *composition*).
//
// Three styles you can A/B:
//   • 'kashmir'    — slow, majestic modal swell over a drone (Eastern colour)
//   • 'immigrant'  — fast galloping low riff with a high banshee wail
//   • 'wholelotta' — a bluesy pentatonic riff that ends on a big chord stab
//
// Browser autoplay policy blocks sound until a user gesture, so the riff is ARMED
// on load and fires on the first pointer/key interaction (once per launch).
// Control via localStorage 'lz.riff':
//   unset / 'random'                  → a random style each launch
//   'kashmir' | 'immigrant' | 'wholelotta' → always that one
//   '0'                               → off
// For live testing, call window.lzRiff('kashmir') from the console anytime.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);   // MIDI note → Hz

// Soft-clip curve → overdriven-guitar grit.
function distortionCurve(k) {
  const n = 256, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

// Build the shared amp chain: [input] → distortion → tone → (dry + slap delay) → out.
function makeChain(ac, { drive = 8, tone = 3200, vol = 0.22, delay = 0.16, fb = 0.25, wet = 0.18 } = {}) {
  const input = ac.createGain(); input.gain.value = vol;
  const dist = ac.createWaveShaper(); dist.curve = distortionCurve(drive); dist.oversample = '4x';
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = tone; lp.Q.value = 0.7;
  const dl = ac.createDelay(); dl.delayTime.value = delay;
  const fbg = ac.createGain(); fbg.gain.value = fb;
  const wetg = ac.createGain(); wetg.gain.value = wet;
  input.connect(dist).connect(lp).connect(ac.destination);
  dl.connect(fbg).connect(dl);
  lp.connect(dl).connect(wetg).connect(ac.destination);
  return input;
}

// A fat guitar note: detuned saws + a sub-octave + (optionally) the fifth → power chord.
function guitar(ac, dest, freq, t, dur, { power = false, level = 1, sustain = 0.28 } = {}) {
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + 0.012);
  amp.gain.exponentialRampToValueAtTime(level * sustain, t + dur * 0.6);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
  amp.connect(dest);
  const voices = [
    { f: freq, det: -6, type: 'sawtooth', g: 0.6 },
    { f: freq, det: +6, type: 'sawtooth', g: 0.6 },
    { f: freq / 2, det: 0, type: 'square', g: 0.35 },
  ];
  if (power) voices.push({ f: freq * 1.4983, det: 0, type: 'sawtooth', g: 0.5 });   // perfect fifth
  for (const v of voices) {
    const o = ac.createOscillator(); o.type = v.type;
    o.frequency.setValueAtTime(v.f, t); o.detune.setValueAtTime(v.det, t);
    const g = ac.createGain(); g.gain.value = v.g;
    o.connect(g).connect(amp); o.start(t); o.stop(t + dur + 0.1);
  }
}

// A sustained pad/drone (for the modal swell) — two slow saws through an opening filter.
function pad(ac, dest, freq, t, dur, level = 0.5) {
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + dur * 0.4);   // slow swell
  amp.gain.setValueAtTime(level, t + dur * 0.8);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2400, t + dur * 0.7);
  lp.connect(amp).connect(dest);
  for (const det of [-8, +8]) {
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, t); o.detune.setValueAtTime(det, t);
    o.connect(lp); o.start(t); o.stop(t + dur + 0.3);
  }
}

// A high banshee wail — slides up into pitch, vibrato, long sustain (the "aaah").
function wail(ac, dest, t, dur, fStart, fEnd) {
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.5, t + 0.08);
  amp.gain.setValueAtTime(0.5, t + dur * 0.7);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2;
  bp.connect(amp).connect(dest);
  const o = ac.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(fStart, t);
  o.frequency.exponentialRampToValueAtTime(fEnd, t + 0.18);   // scoop up to pitch
  // vibrato
  const lfo = ac.createOscillator(); lfo.frequency.value = 5.5;
  const lfoG = ac.createGain(); lfoG.gain.value = 14;         // ±14 cents
  lfo.connect(lfoG).connect(o.detune);
  o.connect(bp); o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
}

// --- the three styles -------------------------------------------------------
// Each schedules onto a fresh chain and returns its total length in seconds.

function kashmir(ac) {
  const dest = makeChain(ac, { drive: 6, tone: 2800, vol: 0.2, delay: 0.28, fb: 0.3, wet: 0.22 });
  const t0 = ac.currentTime + 0.05;
  pad(ac, dest, mtof(38), t0, 3.3, 0.45);          // D2 drone underneath
  // Majestic ascending modal power chords (D phrygian-dominant colour: D F G Bb A).
  const seq = [[50, 0.7], [53, 0.7], [55, 0.7], [58, 0.55], [57, 0.9]];  // D3 F3 G3 Bb3 A3
  let t = t0 + 0.15;
  for (const [m, d] of seq) { guitar(ac, dest, mtof(m), t, d * 0.95, { power: true, level: 1, sustain: 0.5 }); t += d; }
  return (t - t0) + 0.3;
}

function immigrant(ac) {
  const dest = makeChain(ac, { drive: 10, tone: 3400, vol: 0.2, delay: 0.12, fb: 0.18, wet: 0.12 });
  const t0 = ac.currentTime + 0.05;
  // Driving gallop on a low root with octave snaps (F#2 ~ midi 42).
  const STEP = 0.13, root = 42;
  const pat = [0, 0, 12, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0];   // offsets from root
  let t = t0;
  for (const off of pat) { guitar(ac, dest, mtof(root + off), t, STEP * 0.9, { power: off === 0, level: 0.9, sustain: 0.2 }); t += STEP; }
  // The banshee wail sailing over the top (F#5 → up), arrives just after the gallop kicks.
  wail(ac, dest, t0 + 0.25, 1.5, mtof(72), mtof(78));
  return Math.max(t - t0, 1.8) + 0.3;
}

function wholelotta(ac) {
  const dest = makeChain(ac, { drive: 9, tone: 3200, vol: 0.22, delay: 0.16, fb: 0.25, wet: 0.18 });
  const t0 = ac.currentTime + 0.05;
  const B = 0.2;   // eighth-note
  // Bluesy E-pentatonic riff: E (G E) D E … then a big stab.
  const seq = [[40, 2], [43, 1], [40, 1], [38, 1], [40, 2], [43, 1], [40, 1]];  // E2 G2 E2 D2 E2 G2 E2
  let t = t0;
  for (const [m, b] of seq) { guitar(ac, dest, mtof(m), t, b * B * 0.92, { power: false, level: 1, sustain: 0.3 }); t += b * B; }
  // a lead note, then the big chord stab
  guitar(ac, dest, mtof(47), t, 0.5, { level: 1, sustain: 0.4 });           // B2 lead
  t += 0.55;
  guitar(ac, dest, mtof(40), t, 0.9, { power: true, level: 1.1, sustain: 0.5 }); // E power-chord stab
  return (t - t0) + 1.0;
}

const STYLES = { kashmir, immigrant, wholelotta };
const NAMES = Object.keys(STYLES);

function pickStyle() {
  let sel; try { sel = localStorage.getItem('lz.riff'); } catch { sel = null; }
  if (sel === '0') return null;
  if (sel && STYLES[sel]) return sel;
  // random each launch (vary by time isn't allowed in headless; use perf counter)
  return NAMES[Math.floor((performance.now() / 7) % NAMES.length)];
}

// One shared AudioContext, lazily created (browsers cap the number of contexts,
// so reuse it across repeated A/B plays via window.lzRiff()).
let sharedAc = null;
function audioCtx() {
  if (sharedAc) return sharedAc;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { sharedAc = new AC(); } catch { sharedAc = null; }
  return sharedAc;
}

// Play a given style now (used by both the armed trigger and window.lzRiff()).
function playStyle(name) {
  try {
    const ac = audioCtx();
    if (!ac) return;
    const go = () => { try { (STYLES[name] || kashmir)(ac); } catch { /* synthesis failed — silent */ } };
    if (ac.state === 'suspended') ac.resume().then(go).catch(() => {}); else go();
  } catch { /* no audio — silent */ }
}

// Public: arm the startup riff to fire on the first user gesture (once).
export function armStartupRiff() {
  // Console helper for A/B testing without reloading.
  try { window.lzRiff = (name) => playStyle(name || pickStyle() || 'kashmir'); } catch { /* ignore */ }
  const style = pickStyle();
  if (!style) return;   // disabled
  let fired = false;
  const fire = () => {
    if (fired) return; fired = true;
    document.removeEventListener('pointerdown', fire, true);
    document.removeEventListener('keydown', fire, true);
    playStyle(style);
  };
  // capture-phase, never preventDefault — the same click still selects/triggers.
  document.addEventListener('pointerdown', fire, true);
  document.addEventListener('keydown', fire, true);
}
