// A ~3s synthesized hard-rock riff that greets you when the app starts — a
// procedural homage to the heavy blues-rock the app is named after (NOT a sample
// of any recording: every note is generated live with oscillators, so there's no
// copyrighted audio shipped or played back).
//
// Browser autoplay policy blocks sound until a user gesture, so we ARM the riff
// and fire it on the first pointer/key interaction after load (once per launch).
// Disable with localStorage 'lz.riff' = '0'.

const A4 = 440;
const note = (semisFromA4) => A4 * Math.pow(2, semisFromA4 / 12);
// E minor pentatonic shapes (semitone offsets from A4, negative = lower octaves).
const E2 = note(-29), G2 = note(-26), A2 = note(-24), B2 = note(-22);
const D3 = note(-19), E3 = note(-17), G3 = note(-14), A3 = note(-12);

// Riff: a driving E-pentatonic lick. [freq, beats, isPowerChord]. ~120 BPM feel.
const BEAT = 0.18;   // seconds per eighth — tuned so the whole thing lands near 3s
const RIFF = [
  [E2, 1, true], [E2, 1, true], [G2, 1, false], [A2, 1, false],
  [A2, 1, false], [G2, 1, false], [E2, 2, true],
  [E2, 1, true], [G2, 1, false], [A2, 1, false], [B2, 1, false],
  [D3, 1, false], [B2, 1, false], [A3, 1, false], [G3, 1, false],
  [E3, 3, true],
];

// Soft-clip curve → the gritty overdriven-guitar tone.
function distortionCurve(amount) {
  const n = 256, curve = new Float32Array(n), k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

// Play one fat note (two detuned saws + an octave-down for body) at time t.
function playNote(ac, dest, freq, t, dur, power) {
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(1, t + 0.012);                 // pick attack
  amp.gain.exponentialRampToValueAtTime(0.28, t + dur * 0.6);     // sustain droop
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);  // release
  amp.connect(dest);

  const voices = [
    { f: freq, detune: -6, type: 'sawtooth', g: 0.6 },
    { f: freq, detune: +6, type: 'sawtooth', g: 0.6 },
    { f: freq / 2, detune: 0, type: 'square', g: 0.35 },          // sub-octave thump
  ];
  if (power) voices.push({ f: freq * 1.4983, detune: 0, type: 'sawtooth', g: 0.5 });  // the fifth → power chord
  for (const v of voices) {
    const o = ac.createOscillator();
    o.type = v.type; o.frequency.setValueAtTime(v.f, t); o.detune.setValueAtTime(v.detune, t);
    const g = ac.createGain(); g.gain.value = v.g;
    o.connect(g).connect(amp);
    o.start(t); o.stop(t + dur + 0.1);
  }
}

function playRiff(ac) {
  const out = ac.createGain();
  out.gain.value = 0.0;
  // gentle fade so the very first note doesn't click on cold contexts
  out.gain.setValueAtTime(0.22, ac.currentTime);

  const dist = ac.createWaveShaper();
  dist.curve = distortionCurve(8); dist.oversample = '4x';

  const tone = ac.createBiquadFilter();   // tame the fizz
  tone.type = 'lowpass'; tone.frequency.value = 3200; tone.Q.value = 0.7;

  // A short slap delay for a touch of space (stadium vibe).
  const delay = ac.createDelay(); delay.delayTime.value = 0.16;
  const fb = ac.createGain(); fb.gain.value = 0.25;
  const wet = ac.createGain(); wet.gain.value = 0.18;
  delay.connect(fb).connect(delay);

  out.connect(dist).connect(tone).connect(ac.destination);
  tone.connect(delay).connect(wet).connect(ac.destination);

  let t = ac.currentTime + 0.06;
  for (const [freq, beats, power] of RIFF) {
    const dur = beats * BEAT;
    playNote(ac, out, freq, t, dur * 0.92, power);
    t += dur;
  }
  return t - ac.currentTime;   // total length
}

// Public: arm the riff to play on the first user gesture after load (once).
export function armStartupRiff() {
  try { if (localStorage.getItem('lz.riff') === '0') return; } catch { /* private mode → still play */ }
  let fired = false;
  const fire = () => {
    if (fired) return; fired = true;
    document.removeEventListener('pointerdown', fire, true);
    document.removeEventListener('keydown', fire, true);
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      const go = () => { try { playRiff(ac); } catch { /* synthesis failed — silent */ } };
      if (ac.state === 'suspended') ac.resume().then(go).catch(() => {}); else go();
    } catch { /* no audio — silent */ }
  };
  // capture-phase so it runs before app handlers consume the event; it never
  // preventDefault()s, so the same click still selects/triggers normally.
  document.addEventListener('pointerdown', fire, true);
  document.addEventListener('keydown', fire, true);
}
