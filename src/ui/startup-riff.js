// Synthesized hard-rock startup intros — procedural HOMAGES to the heavy
// blues-rock the app is named after. Nothing here is a sample or a copy of any
// real song: every note is generated live with oscillators, and the motifs are
// original (evoking a *style*, not reproducing a *composition*).
//
// Styles you can A/B:
//   • 'cry'        — DEFAULT. Just the soaring war-cry wail on its own (~2.6s).
//   • 'immigrant'  — a ~6s full-band intro: galloping distorted guitar + locked
//                    bass/kick, snare backbeats, a tom fill into a crash stab,
//                    and two scooping banshee wails.
//   • 'kashmir'    — slow, majestic modal swell over a drone (Eastern colour)
//   • 'wholelotta' — a bluesy pentatonic riff that ends on a big chord stab
//
// Browser autoplay policy blocks sound until a user gesture. We TRY to play on
// load; if the browser blocks it, we fall back to firing on the first
// pointer/key interaction (once per launch).
// Control via localStorage 'lz.riff':
//   unset                                   → 'cry'
//   'immigrant' | 'cry' | 'kashmir' | 'wholelotta'  → always that one
//   'random'                                → a random style each launch
//   '0'                                     → off
// For live testing, call window.lzRiff('immigrant') from the console anytime.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);   // MIDI note → Hz

// Soft-clip curve → overdriven-guitar grit.
function distortionCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

// ---------------------------------------------------------------------------
// Shared simple chain + helpers used by the two lighter styles (kashmir/wholelotta)
// ---------------------------------------------------------------------------
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
  if (power) voices.push({ f: freq * 1.4983, det: 0, type: 'sawtooth', g: 0.5 });
  for (const v of voices) {
    const o = ac.createOscillator(); o.type = v.type;
    o.frequency.setValueAtTime(v.f, t); o.detune.setValueAtTime(v.det, t);
    const g = ac.createGain(); g.gain.value = v.g;
    o.connect(g).connect(amp); o.start(t); o.stop(t + dur + 0.1);
  }
}

function pad(ac, dest, freq, t, dur, level = 0.5) {
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + dur * 0.4);
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

function simpleWail(ac, dest, t, dur, fStart, fEnd) {
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.5, t + 0.08);
  amp.gain.setValueAtTime(0.5, t + dur * 0.7);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2;
  bp.connect(amp).connect(dest);
  const o = ac.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(fStart, t);
  o.frequency.exponentialRampToValueAtTime(fEnd, t + 0.18);
  const lfo = ac.createOscillator(); lfo.frequency.value = 5.5;
  const lfoG = ac.createGain(); lfoG.gain.value = 14;
  lfo.connect(lfoG).connect(o.detune);
  o.connect(bp); o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
}

// ---------------------------------------------------------------------------
// IMMIGRANT — the full-band flagship intro (its own self-contained engine).
// ---------------------------------------------------------------------------
function immigrant(ac) {
  const BEAT = 0.341;              // 176 BPM — swift
  const t0 = ac.currentTime + 0.06;
  const at = (beat) => t0 + beat * BEAT;
  const bq = (type, freq, Q = 0.7, gain = 0) => { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; f.gain.value = gain; return f; };
  const G = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };

  // --- master bus + a synthesized "stadium" reverb on a send ---
  const master = G(0.42);
  const mlp = bq('lowpass', 12000); master.connect(mlp).connect(ac.destination);
  const conv = ac.createConvolver();
  { const rate = ac.sampleRate, len = Math.floor(rate * 2.4), ir = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.0); }
    conv.buffer = ir; }
  const revRet = G(0.18); conv.connect(revRet).connect(master);
  const send = (node, amt) => { const g = G(amt); node.connect(g).connect(conv); };

  // --- shared guitar "amp cabinet" (one stack, like a real amp) ---
  const pre = G(1.6);
  const sh = ac.createWaveShaper(); sh.curve = distortionCurve(40); sh.oversample = '4x';
  const hp = bq('highpass', 90), mid = bq('peaking', 800, 1.2, 6), dip = bq('peaking', 3000, 2, -8), camp = bq('lowpass', 5000);
  const gtrBus = G(0.9);
  pre.connect(sh).connect(hp).connect(mid).connect(dip).connect(camp).connect(gtrBus).connect(master);
  send(gtrBus, 0.12);

  // a guitar note → per-note tone (palm-mute = darker) → enveloped amp → cabinet
  const noteG = (freq, t, durSec, { power = false, palmMute = false, accent = false } = {}) => {
    const amp = G(0); const tone = bq('lowpass', palmMute ? 1800 : 7000);
    tone.connect(amp).connect(pre);
    const level = accent ? 1.0 : 0.62;
    if (palmMute) {
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.003);
      amp.gain.exponentialRampToValueAtTime(level * 0.25, t + 0.06);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(durSec, 0.1) + 0.05);
    } else {
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.008);
      amp.gain.exponentialRampToValueAtTime(level * 0.7, t + 0.4);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + durSec + 0.7);
    }
    const voices = [{ f: freq, det: -7, g: 0.5 }, { f: freq, det: 0, g: 0.5 }, { f: freq, det: 7, g: 0.5 }, { f: freq / 2, det: 0, g: 0.45, sq: true }];
    if (power) { voices.push({ f: freq * 1.4983, det: 0, g: 0.42 }); voices.push({ f: freq * 2, det: 0, g: 0.38 }); }
    const end = t + durSec + 0.8;
    for (const v of voices) {
      const o = ac.createOscillator(); o.type = v.sq ? 'square' : 'sawtooth';
      o.frequency.setValueAtTime(v.f, t); o.detune.setValueAtTime(v.det, t);
      const g = G(v.g); o.connect(g).connect(tone); o.start(t); o.stop(end);
    }
  };

  // --- drums + bass bus ---
  const drumBus = G(0.95); drumBus.connect(master); send(drumBus, 0.06);
  const noise = (() => { const len = Math.floor(ac.sampleRate * 2), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; return b; })();
  const noiseSrc = () => { const s = ac.createBufferSource(); s.buffer = noise; return s; };

  const kick = (t) => {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.06);
    const g = G(0.9); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.45);
    const c = ac.createOscillator(); c.type = 'sine'; c.frequency.value = 1200;
    const cg = G(0.5); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    c.connect(cg).connect(drumBus); c.start(t); c.stop(t + 0.02);
  };
  const snare = (t) => {
    const n = noiseSrc(), hpf = bq('highpass', 1500), bpf = bq('bandpass', 2200, 0.7), g = G(0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(hpf).connect(bpf).connect(g).connect(drumBus); n.start(t); n.stop(t + 0.2);
    for (const f of [185, 330]) { const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const bg = G(0.4); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.12); o.connect(bg).connect(drumBus); o.start(t); o.stop(t + 0.14); }
  };
  const tom = (t, f0, f1, dec) => {
    const o = ac.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.1);
    const g = G(0.8); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    o.connect(g).connect(drumBus); o.start(t); o.stop(t + dec + 0.05);
    const n = noiseSrc(), ng = G(0.15); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(ng).connect(drumBus); n.start(t); n.stop(t + 0.04);
  };
  const crash = (t, level, dec) => {
    const n = noiseSrc(), hpf = bq('highpass', 4000), bpf = bq('bandpass', 8000, 0.5), g = G(level);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    n.connect(hpf).connect(bpf).connect(g).connect(drumBus); n.start(t); n.stop(t + dec + 0.05);
  };
  const bass = (t, durSec, midi) => {
    const f = mtof(midi), lp = bq('lowpass', 600, 4);
    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.12);
    const amp = G(0);
    amp.gain.linearRampToValueAtTime(0.7, t + 0.004);
    amp.gain.setValueAtTime(0.7, t + Math.max(durSec - 0.05, 0.02));
    amp.gain.exponentialRampToValueAtTime(0.001, t + durSec + 0.05);
    lp.connect(amp).connect(drumBus);
    const saw = ac.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f;
    const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2; const sg = G(0.5);
    saw.connect(lp); sub.connect(sg).connect(lp);
    const end = t + durSec + 0.1; saw.start(t); saw.stop(end); sub.start(t); sub.stop(end);
  };

  // the wailing "war cry": glottal saw → parallel vowel formants → grit → master
  const wail = (t, durSec, startMidi, peakMidi) => {
    const target = mtof(peakMidi);
    const src = ac.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(mtof(startMidi - 2), t);
    src.frequency.exponentialRampToValueAtTime(target, t + 0.2);
    const vowel = G(0);
    vowel.gain.linearRampToValueAtTime(0.5, t + 0.08);
    vowel.gain.setValueAtTime(0.5, t + durSec * 0.7);
    vowel.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
    for (const fm of [{ f: 700, Q: 6, g: 1.0 }, { f: 1220, Q: 8, g: 0.7 }, { f: 2600, Q: 9, g: 0.4 }]) {
      const bp = bq('bandpass', fm.f, fm.Q), g = G(fm.g);
      src.connect(bp).connect(g).connect(vowel);
    }
    const grit = ac.createWaveShaper(); grit.curve = distortionCurve(12); grit.oversample = '2x';
    const pres = bq('peaking', 3500, 1.5, 5), vhp = bq('highpass', 200);
    vowel.connect(grit).connect(pres).connect(vhp).connect(master); send(vhp, 0.3);
    const lfo = ac.createOscillator(); lfo.frequency.value = 5.5; const lfoG = G(0);
    lfoG.gain.setValueAtTime(0, t + 0.18); lfoG.gain.linearRampToValueAtTime(35, t + 0.5);
    lfo.connect(lfoG).connect(src.detune);
    const end = t + durSec + 0.05; src.start(t); src.stop(end); lfo.start(t); lfo.stop(end);
  };

  // a singing lead-hook voice (brighter, bypasses the heavy cab so it cuts over
  // the wall of guitars, with a little vibrato).
  const lead = (freq, t, durSec) => {
    const amp = G(0);
    amp.gain.linearRampToValueAtTime(0.5, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.34, t + 0.3);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + durSec + 0.5);
    const drv = ac.createWaveShaper(); drv.curve = distortionCurve(18); drv.oversample = '2x';
    const pres = bq('peaking', 3200, 1.5, 6), lp = bq('lowpass', 6800);
    amp.connect(drv).connect(pres).connect(lp).connect(master); send(lp, 0.2);
    const lfo = ac.createOscillator(); lfo.frequency.value = 5.5; const lg = G(0);
    lg.gain.setValueAtTime(0, t + 0.15); lg.gain.linearRampToValueAtTime(20, t + 0.4); lfo.connect(lg);
    const end = t + durSec + 0.6;
    for (const det of [-5, 5]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det; lg.connect(o.detune); const g = G(0.5); o.connect(g).connect(amp); o.start(t); o.stop(end); }
    lfo.start(t); lfo.stop(end);
  };

  // --- the score (beats @ 176 BPM) — straight into the catchy gallop, NO
  // opening chord. F# minor pentatonic; the riff climbs A→B→C# then resolves
  // B-A-F#. guitar/bass gallop: [midi, startBeat, durBeats, accent, palmMute] ---
  const GTR = [
    // riff cell (climbing hook)
    [42, 0.0, 0.25, 1, 1], [42, 0.25, 0.25, 0, 1], [45, 0.5, 0.5, 1, 0],
    [42, 1.0, 0.25, 1, 1], [42, 1.25, 0.25, 0, 1], [47, 1.5, 0.5, 1, 0],
    [42, 2.0, 0.25, 1, 1], [42, 2.25, 0.25, 0, 1], [49, 2.5, 0.5, 1, 0],
    [47, 3.0, 0.25, 1, 1], [45, 3.25, 0.25, 0, 1], [42, 3.5, 0.5, 1, 0],
    // repeat (lead hook sings over this)
    [42, 4.0, 0.25, 1, 1], [42, 4.25, 0.25, 0, 1], [45, 4.5, 0.5, 1, 0],
    [42, 5.0, 0.25, 1, 1], [42, 5.25, 0.25, 0, 1], [47, 5.5, 0.5, 1, 0],
    [42, 6.0, 0.25, 1, 1], [42, 6.25, 0.25, 0, 1], [49, 6.5, 0.5, 1, 0],
    [47, 7.0, 0.25, 1, 1], [45, 7.25, 0.25, 0, 1], [42, 7.5, 0.5, 1, 0],
    // build (straight climbing 16ths)
    [42, 8.0, 0.25, 1, 1], [45, 8.25, 0.25, 1, 1], [47, 8.5, 0.25, 1, 1], [49, 8.75, 0.25, 1, 1],
    [47, 9.0, 0.25, 1, 1], [49, 9.25, 0.25, 1, 1], [52, 9.5, 0.25, 1, 1], [54, 9.75, 0.25, 1, 1],
    // final stab
    [42, 10.0, 1.0, 1, 0], [49, 10.0, 1.0, 1, 0], [54, 10.0, 1.0, 1, 0],
  ];
  for (const [m, b, d, acc, pm] of GTR) noteG(mtof(m), at(b), d * BEAT, { power: !pm, palmMute: !!pm, accent: !!acc });

  // the singing lead hook (octave up) over the riff's repeat
  for (const [m, b, d] of [[57, 4.5, 1.0], [59, 5.5, 1.0], [61, 6.5, 1.2], [57, 7.5, 1.4]]) lead(mtof(m), at(b), d * BEAT);

  // bass: root-following, on the eighth positions so it locks with the kick
  const bassSeen = new Set();
  for (const [m, b] of GTR) { if (Math.abs((b * 2) % 1) < 1e-6 && !bassSeen.has(b)) { bassSeen.add(b); bass(at(b), 0.22, m - 12); } }

  // drums
  const kicks = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  for (const b of kicks) kick(at(b));
  for (const b of [1, 3, 5, 7, 9, 10]) snare(at(b));
  for (const [b, k] of [[8, 't1'], [8.5, 't1'], [9, 't2'], [9.25, 't2'], [9.5, 't3'], [9.75, 't3']]) {
    if (k === 't1') tom(at(b), 220, 130, 0.3); else if (k === 't2') tom(at(b), 165, 98, 0.34); else tom(at(b), 110, 62, 0.4);
  }
  crash(at(10), 0.9, 1.9);

  // the two war cries
  wail(at(2.5), 0.7, 66, 73);
  wail(at(8.0), 1.1, 73, 81);

  return 11 * BEAT + 1.0;   // total incl. ring-out
}

// ---------------------------------------------------------------------------
// The two lighter styles
// ---------------------------------------------------------------------------
function kashmir(ac) {
  const dest = makeChain(ac, { drive: 6, tone: 2800, vol: 0.2, delay: 0.28, fb: 0.3, wet: 0.22 });
  const t0 = ac.currentTime + 0.05;
  pad(ac, dest, mtof(38), t0, 3.3, 0.45);
  const seq = [[50, 0.7], [53, 0.7], [55, 0.7], [58, 0.55], [57, 0.9]];
  let t = t0 + 0.15;
  for (const [m, d] of seq) { guitar(ac, dest, mtof(m), t, d * 0.95, { power: true, level: 1, sustain: 0.5 }); t += d; }
  return (t - t0) + 0.3;
}

function wholelotta(ac) {
  const dest = makeChain(ac, { drive: 9, tone: 3200, vol: 0.22, delay: 0.16, fb: 0.25, wet: 0.18 });
  const t0 = ac.currentTime + 0.05;
  const B = 0.2;
  const seq = [[40, 2], [43, 1], [40, 1], [38, 1], [40, 2], [43, 1], [40, 1]];
  let t = t0;
  for (const [m, b] of seq) { guitar(ac, dest, mtof(m), t, b * B * 0.92, { power: false, level: 1, sustain: 0.3 }); t += b * B; }
  guitar(ac, dest, mtof(47), t, 0.5, { level: 1, sustain: 0.4 });
  t += 0.55;
  guitar(ac, dest, mtof(40), t, 0.9, { power: true, level: 1.1, sustain: 0.5 });
  return (t - t0) + 1.0;
}

// CRY — just the soaring war-cry wail on its own. ~2.6s. A scooping, vibrato'd
// "aaah" (formant-synth) that rises into pitch and rings out in big reverb.
function cry(ac) {
  const t0 = ac.currentTime + 0.06;
  const G = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const bq = (type, freq, Q = 0.7, gain = 0) => { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; f.gain.value = gain; return f; };

  const master = G(0.5); const mlp = bq('lowpass', 12000); master.connect(mlp).connect(ac.destination);
  const conv = ac.createConvolver();
  { const rate = ac.sampleRate, len = Math.floor(rate * 2.8), ir = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    conv.buffer = ir; }
  const revRet = G(0.28); conv.connect(revRet).connect(master);
  const send = (node, amt) => { const g = G(amt); node.connect(g).connect(conv); };

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

  wail(t0, 2.2, 64, 81);   // the cry, alone — scoops up to a high held A
  return 2.6;
}

const STYLES = { immigrant, cry, kashmir, wholelotta };
const NAMES = Object.keys(STYLES);

function pickStyle() {
  let sel; try { sel = localStorage.getItem('lz.riff'); } catch { sel = null; }
  if (sel === '0') return null;
  if (sel && STYLES[sel]) return sel;
  if (sel === 'random') return NAMES[Math.floor((performance.now() / 7) % NAMES.length)];
  return 'cry';   // default
}

// One shared AudioContext (browsers cap how many you can create).
let sharedAc = null;
function audioCtx() {
  if (sharedAc) return sharedAc;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { sharedAc = new AC(); } catch { sharedAc = null; }
  return sharedAc;
}

function playStyle(name) {
  try {
    const ac = audioCtx(); if (!ac) return;
    const go = () => { try { (STYLES[name] || immigrant)(ac); } catch { /* synthesis failed — silent */ } };
    if (ac.state === 'suspended') ac.resume().then(go).catch(() => {}); else go();
  } catch { /* no audio — silent */ }
}

// Public: try to play on load; if autoplay is blocked, fire on first gesture.
export function armStartupRiff() {
  try { window.lzRiff = (name) => playStyle(name || pickStyle() || 'immigrant'); } catch { /* ignore */ }
  const style = pickStyle();
  if (!style) return;   // disabled

  let done = false;
  const playOnce = () => { if (done) return; done = true; cleanup(); playStyle(style); };
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
