// Synthesized hard-rock startup riff — a procedural HOMAGE to the heavy blues-rock
// the app is named after. Nothing here is a sample or a copy of any real song:
// every note is generated live with oscillators, and the motif is original
// (evoking a *style*, not reproducing a *composition*).
//
// One bar of a galloping riff, then a soaring war-cry wail lands as the payoff
// (~3.7s; full band — distorted guitar + locked bass/kick, snare backbeats, a
// crash on the turn, and a formant-synth wail).
//
// Plays only on the FIRST visit (a localStorage flag silences it afterwards); the
// System › Settings toggle ('lz.riff.always') plays it on every reload. Browser
// autoplay policy blocks sound until a user gesture, so we TRY to play on load and
// fall back to the first pointer/key interaction.
//   localStorage 'lz.riff' = '0' → off (any other value, or unset → on)
// For live testing, call window.lzRiff() from the console anytime.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);   // MIDI note → Hz

// Soft-clip curve → overdriven-guitar grit.
function distortionCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

// CRY — one bar of the catchy gallop riff, then the soaring war-cry wail lands
// as the payoff. ~3.7s.
function cry(ac) {
  const BEAT = 0.341;              // 176 BPM
  const t0 = ac.currentTime + 0.06;
  const at = (b) => t0 + b * BEAT;
  const G = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const bq = (type, freq, Q = 0.7, gain = 0) => { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; f.gain.value = gain; return f; };

  const master = G(0.46); const mlp = bq('lowpass', 12000); master.connect(mlp).connect(ac.destination);
  const conv = ac.createConvolver();
  { const rate = ac.sampleRate, len = Math.floor(rate * 2.8), ir = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    conv.buffer = ir; }
  const revRet = G(0.26); conv.connect(revRet).connect(master);
  const send = (node, amt) => { const g = G(amt); node.connect(g).connect(conv); };

  // guitar amp cabinet (shared) + per-note voice
  const pre = G(1.6); const sh = ac.createWaveShaper(); sh.curve = distortionCurve(40); sh.oversample = '4x';
  const hp = bq('highpass', 90), mid = bq('peaking', 800, 1.2, 6), dip = bq('peaking', 3000, 2, -8), camp = bq('lowpass', 5000);
  const gtrBus = G(0.9); pre.connect(sh).connect(hp).connect(mid).connect(dip).connect(camp).connect(gtrBus).connect(master); send(gtrBus, 0.12);
  const noteG = (freq, t, durSec, { power = false, palmMute = false, accent = false } = {}) => {
    const amp = G(0), tone = bq('lowpass', palmMute ? 1800 : 7000); tone.connect(amp).connect(pre);
    const level = accent ? 1.0 : 0.62;
    if (palmMute) { amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(level, t + 0.003); amp.gain.exponentialRampToValueAtTime(level * 0.25, t + 0.06); amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(durSec, 0.1) + 0.05); }
    else { amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(level, t + 0.008); amp.gain.exponentialRampToValueAtTime(level * 0.7, t + 0.4); amp.gain.exponentialRampToValueAtTime(0.0001, t + durSec + 0.7); }
    const voices = [{ f: freq, det: -7, g: 0.5 }, { f: freq, det: 0, g: 0.5 }, { f: freq, det: 7, g: 0.5 }, { f: freq / 2, det: 0, g: 0.45, sq: true }];
    if (power) { voices.push({ f: freq * 1.4983, det: 0, g: 0.42 }); voices.push({ f: freq * 2, det: 0, g: 0.38 }); }
    const end = t + durSec + 0.8;
    for (const v of voices) { const o = ac.createOscillator(); o.type = v.sq ? 'square' : 'sawtooth'; o.frequency.setValueAtTime(v.f, t); o.detune.setValueAtTime(v.det, t); const g = G(v.g); o.connect(g).connect(tone); o.start(t); o.stop(end); }
  };

  // drums + bass
  const drumBus = G(0.95); drumBus.connect(master); send(drumBus, 0.06);
  const noise = (() => { const len = Math.floor(ac.sampleRate * 2), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; return b; })();
  const noiseSrc = () => { const s = ac.createBufferSource(); s.buffer = noise; return s; };
  const kick = (t) => { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.06); const g = G(0.9); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42); o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.45); };
  const snare = (t) => { const n = noiseSrc(), hpf = bq('highpass', 1500), bpf = bq('bandpass', 2200, 0.7), g = G(0.8); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); n.connect(hpf).connect(bpf).connect(g).connect(drumBus); n.start(t); n.stop(t + 0.2); for (const f of [185, 330]) { const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const bg = G(0.4); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.12); o.connect(bg).connect(drumBus); o.start(t); o.stop(t + 0.14); } };
  const crash = (t, level, dec) => { const n = noiseSrc(), hpf = bq('highpass', 4000), bpf = bq('bandpass', 8000, 0.5), g = G(level); g.gain.exponentialRampToValueAtTime(0.001, t + dec); n.connect(hpf).connect(bpf).connect(g).connect(drumBus); n.start(t); n.stop(t + dec + 0.05); };
  const bass = (t, durSec, midi) => { const f = mtof(midi), lp = bq('lowpass', 600, 4); lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.12); const amp = G(0); amp.gain.linearRampToValueAtTime(0.7, t + 0.004); amp.gain.setValueAtTime(0.7, t + Math.max(durSec - 0.05, 0.02)); amp.gain.exponentialRampToValueAtTime(0.001, t + durSec + 0.05); lp.connect(amp).connect(drumBus); const saw = ac.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f; const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2; const sg = G(0.5); saw.connect(lp); sub.connect(sg).connect(lp); const end = t + durSec + 0.1; saw.start(t); saw.stop(end); sub.start(t); sub.stop(end); };

  const wail = (t, durSec, startMidi, peakMidi) => {
    const target = mtof(peakMidi);
    const src = ac.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(mtof(startMidi - 2), t);
    src.frequency.exponentialRampToValueAtTime(target, t + 0.3);
    const vowel = G(0);
    vowel.gain.linearRampToValueAtTime(0.6, t + 0.1);
    vowel.gain.setValueAtTime(0.6, t + durSec * 0.72);
    vowel.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
    for (const fm of [{ f: 700, Q: 6, g: 1.0 }, { f: 1220, Q: 8, g: 0.7 }, { f: 2600, Q: 9, g: 0.4 }]) {
      const bp = bq('bandpass', fm.f, fm.Q), g = G(fm.g); src.connect(bp).connect(g).connect(vowel);
    }
    const grit = ac.createWaveShaper(); grit.curve = distortionCurve(12); grit.oversample = '2x';
    const pres = bq('peaking', 3500, 1.5, 5), vhp = bq('highpass', 200);
    vowel.connect(grit).connect(pres).connect(vhp).connect(master); send(vhp, 0.34);
    const lfo = ac.createOscillator(); lfo.frequency.value = 5.5; const lg = G(0);
    lg.gain.setValueAtTime(0, t + 0.2); lg.gain.linearRampToValueAtTime(42, t + 0.55);
    lfo.connect(lg).connect(src.detune);
    const end = t + durSec + 0.05; src.start(t); src.stop(end); lfo.start(t); lfo.stop(end);
  };

  // one bar of the climbing gallop riff
  const GTR = [
    [42, 0.0, 0.25, 1, 1], [42, 0.25, 0.25, 0, 1], [45, 0.5, 0.5, 1, 0],
    [42, 1.0, 0.25, 1, 1], [42, 1.25, 0.25, 0, 1], [47, 1.5, 0.5, 1, 0],
    [42, 2.0, 0.25, 1, 1], [42, 2.25, 0.25, 0, 1], [49, 2.5, 0.5, 1, 0],
    [47, 3.0, 0.25, 1, 1], [45, 3.25, 0.25, 0, 1], [42, 3.5, 0.5, 1, 0],
  ];
  for (const [m, b, d, acc, pm] of GTR) noteG(mtof(m), at(b), d * BEAT, { power: !pm, palmMute: !!pm, accent: !!acc });
  const bassSeen = new Set();
  for (const [m, b] of GTR) { if (Math.abs((b * 2) % 1) < 1e-6 && !bassSeen.has(b)) { bassSeen.add(b); bass(at(b), 0.22, m - 12); } }
  for (const b of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) kick(at(b));
  for (const b of [1, 3]) snare(at(b));

  // …then the cry soars up over a crash, ringing out in the reverb
  crash(at(4), 0.8, 1.9);
  wail(at(4) + 0.02, 2.0, 64, 81);
  return 4 * BEAT + 2.4;
}

// 'lz.riff' = '0' disables the startup sound; anything else plays the riff.
function enabled() { try { return localStorage.getItem('lz.riff') !== '0'; } catch { return true; } }

// One shared AudioContext (browsers cap how many you can create).
let sharedAc = null;
function audioCtx() {
  if (sharedAc) return sharedAc;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { sharedAc = new AC(); } catch { sharedAc = null; }
  return sharedAc;
}

function playRiff() {
  try {
    const ac = audioCtx(); if (!ac) return;
    const go = () => { try { cry(ac); } catch { /* synthesis failed — silent */ } };
    if (ac.state === 'suspended') ac.resume().then(go).catch(() => {}); else go();
  } catch { /* no audio — silent */ }
}

const PLAYED_KEY = 'lz.riff.played';   // set once it has played, so it's a FIRST-VISIT-only greeting

// Public: on the FIRST visit only, try to play on load; if autoplay is blocked,
// fire on the first gesture. Subsequent visits stay silent. (window.lzRiff()
// always plays, for testing — and doesn't set the played flag.)
export function armStartupRiff() {
  try { window.lzRiff = () => playRiff(); } catch { /* ignore */ }
  if (!enabled()) return;   // 'lz.riff' = '0' → off
  // 'lz.riff.always' (Settings toggle) → play on every reload; otherwise first visit only.
  let always = false; try { always = localStorage.getItem('lz.riff.always') === '1'; } catch { /* private */ }
  if (!always) { try { if (localStorage.getItem(PLAYED_KEY)) return; } catch { /* private → greet anyway */ } }

  let done = false;
  const playOnce = () => {
    if (done) return; done = true; cleanup();
    if (!always) { try { localStorage.setItem(PLAYED_KEY, '1'); } catch { /* private mode */ } }
    playRiff();
  };
  const onGesture = () => playOnce();
  const cleanup = () => { document.removeEventListener('pointerdown', onGesture, true); document.removeEventListener('keydown', onGesture, true); };
  // arm the gesture fallback first (capture-phase, never preventDefault)
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);

  // …then TRY to play immediately. If the context resumes (allowed), play now;
  // otherwise the gesture fallback above covers it.
  const ac = audioCtx();
  if (!ac) return;
  if (ac.state === 'running') { playOnce(); return; }
  ac.resume().then(() => { if (ac.state === 'running') playOnce(); }).catch(() => { /* blocked — wait for gesture */ });
}
