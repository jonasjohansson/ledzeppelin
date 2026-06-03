// Audio input → modulation bands. A mic stream feeds an AnalyserNode; each frame
// we reduce the spectrum to four 0..1 values (level/bass/mid/high) that params
// can bind to (see anim.js 'audio' mode). getUserMedia needs a user gesture, so
// enableAudio() is called from a click (toggling a param to Audio mode).

export const AUDIO_BANDS = ['level', 'bass', 'mid', 'high'];

let ctx = null, analyser = null, data = null, stream = null;
let enabled = false;
let globalGain = 1;                 // master multiplier on the input (general config)
const bands = { level: 0, bass: 0, mid: 0, high: 0 };

export function audioEnabled() { return enabled; }
export function audioBands() { return bands; }
export function audioGain() { return globalGain; }
export function setAudioGain(g) {
  const v = Number(g);
  globalGain = Number.isFinite(v) && v >= 0 ? v : 1;
}

export async function enableAudio() {
  if (enabled) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    src.connect(analyser);
    data = new Uint8Array(analyser.frequencyBinCount);
    enabled = true;
    return true;
  } catch (e) {
    console.warn('Audio input unavailable:', e?.message || e);
    return false;
  }
}

// Pull the latest spectrum and update the bands. Call once per frame.
export function updateAudio() {
  if (!enabled || !analyser) return bands;
  analyser.getByteFrequencyData(data);
  const n = data.length;
  const avg = (a, b) => {
    let s = 0; for (let i = a; i < b; i++) s += data[i];
    return b > a ? s / ((b - a) * 255) : 0;
  };
  const g = globalGain;
  const clamp = (x) => (x > 1 ? 1 : x < 0 ? 0 : x);
  bands.bass = clamp(avg(0, Math.floor(n * 0.10)) * g);
  bands.mid = clamp(avg(Math.floor(n * 0.10), Math.floor(n * 0.40)) * g);
  bands.high = clamp(avg(Math.floor(n * 0.40), n) * g);
  bands.level = clamp(avg(0, n) * g);
  return bands;
}
