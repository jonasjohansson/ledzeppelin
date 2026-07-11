// Audio → modulation bands. TWO independent sources can run at once (Resolume's
// "Audio" vs "Audio Composition"): each feeds its own AnalyserNode and is reduced
// per frame to four 0..1 values (level/bass/mid/high):
//   - 'external'    — a hardware input device (getUserMedia), and
//   - 'composition' — the audio of the video clips playing in the comp.
//
// A param's audio anim carries which source it follows (anim.source); the bands
// are exposed namespaced ("external:bass", "composition:level") plus plain band
// names (back-compat → external). Starting audio needs a user gesture, so the
// enable* calls are driven from a click (the Audio menu / a modulator pick).

export const AUDIO_BANDS = ['level', 'bass', 'mid', 'high'];
export const AUDIO_SOURCES = ['external', 'composition'];

// The bin-fraction ranges for each band — the ONE source of truth shared by computeBands
// (modulation) and the FFT visualiser (src/ui/spectrum.js). `level` is the full range.
export const AUDIO_BAND_SPLIT = { bass: [0, 0.10], mid: [0.10, 0.40], high: [0.40, 1] };

let ctx = null;
let globalGain = 1;                   // master multiplier on every source
const registered = new Set();         // comp <video> els known to the app
const mediaNodes = new Map();         // <video> el → MediaElementAudioSourceNode (one each, ever)

// Per-source graph state.
const SRC = {
  external:    { analyser: null, data: null, stream: null, node: null, enabled: false, deviceId: 'default', bands: { level: 0, bass: 0, mid: 0, high: 0 } },
  composition: { analyser: null, data: null, enabled: false, bands: { level: 0, bass: 0, mid: 0, high: 0 } },
};

export function audioGain() { return globalGain; }
export function setAudioGain(g) { const v = Number(g); globalGain = Number.isFinite(v) && v >= 0 ? v : 1; }
export function audioEnabled(src) { return src ? !!SRC[src]?.enabled : (SRC.external.enabled || SRC.composition.enabled); }

// Current external (mic) band value 0..1 (0 when the mic isn't running). Per-clip triggers
// (src/model/clip-triggers.js) sample this in the render loop.
export function externalBand(name) {
  const s = SRC.external;
  return s.enabled ? (s.bands[name] || 0) : 0;
}

// Live mic spectrum into a caller-owned Uint8Array (length >= binCount). Returns the bin
// count, or 0 when the mic isn't running. Self-refreshing → the visualiser reads it on its
// own rAF without depending on the main render loop.
export function externalFFT(out) {
  const s = SRC.external;
  if (!s.enabled || !s.analyser) return 0;
  s.analyser.getByteFrequencyData(out);
  return s.analyser.frequencyBinCount;
}
export function externalBinCount() { return SRC.external.analyser?.frequencyBinCount || 512; }

function ensureCtx() { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; }
function ensureAnalyser(s) {
  ensureCtx();
  if (!s.analyser) { s.analyser = ctx.createAnalyser(); s.analyser.fftSize = 1024; s.analyser.smoothingTimeConstant = 0.8; s.data = new Uint8Array(s.analyser.frequencyBinCount); }
  return s.analyser;
}

// List the system's audio INPUT devices. Labels only populate once mic permission
// has been granted; before that they're blank (named generically in the UI).
export async function listInputs() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch { return []; }
}

// --- composition source: tap comp video elements -------------------------------
function attachMedia(el) {
  const s = SRC.composition; ensureAnalyser(s);
  let n = mediaNodes.get(el);
  if (!n) { try { n = ctx.createMediaElementSource(el); mediaNodes.set(el, n); } catch { return; } }  // once per element, ever
  try { el.muted = false; } catch { /* ignore */ }                 // a muted element feeds the graph silence
  try { n.connect(s.analyser); n.connect(ctx.destination); } catch { /* already connected */ }   // keep it audible
}
function detachAllMedia() {
  for (const [el, n] of mediaNodes) { try { n.disconnect(); } catch { /* ignore */ } try { el.muted = true; } catch { /* ignore */ } }
}
export function registerMediaElement(el) { if (!el || registered.has(el)) return; registered.add(el); if (SRC.composition.enabled) attachMedia(el); }
export function unregisterMediaElement(el) { if (!el) return; registered.delete(el); const n = mediaNodes.get(el); if (n) { try { n.disconnect(); } catch { /* ignore */ } mediaNodes.delete(el); } }

// --- start / switch sources (call from a user gesture) -------------------------
export async function enableExternal(deviceId) {
  ensureCtx(); if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
  const s = SRC.external;
  if (s.node) { try { s.node.disconnect(); } catch { /* ignore */ } s.node = null; }
  if (s.stream) { s.stream.getTracks().forEach((t) => t.stop()); s.stream = null; }
  try {
    const audio = deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true;
    s.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    ensureAnalyser(s);
    s.node = ctx.createMediaStreamSource(s.stream); s.node.connect(s.analyser);
    s.deviceId = deviceId || 'default'; s.enabled = true; return true;
  } catch (e) { console.warn('Audio (external) unavailable:', e?.message || e); s.enabled = false; return false; }
}
// Close the mic input — stop the stream + free the graph node (keeps the analyser for
// reuse). `enabled` goes false so externalBand/externalFFT report silence.
export function disableExternal() {
  const s = SRC.external;
  if (s.node) { try { s.node.disconnect(); } catch { /* ignore */ } s.node = null; }
  if (s.stream) { s.stream.getTracks().forEach((t) => t.stop()); s.stream = null; }
  s.enabled = false;
}
export async function enableComposition() {
  ensureCtx(); if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
  ensureAnalyser(SRC.composition);
  for (const el of registered) attachMedia(el);
  SRC.composition.enabled = true; return true;
}
// Convenience wrapper used by the modulator menu.
export function enableAudio(source, deviceId) { return source === 'composition' ? enableComposition() : enableExternal(deviceId); }

// --- per-frame band extraction -------------------------------------------------
function computeBands(s) {
  if (!s.enabled || !s.analyser) return s.bands;
  s.analyser.getByteFrequencyData(s.data);
  const d = s.data, n = d.length;
  const avg = (a, b) => { let x = 0; for (let i = a; i < b; i++) x += d[i]; return b > a ? x / ((b - a) * 255) : 0; };
  const g = globalGain, clamp = (x) => (x > 1 ? 1 : x < 0 ? 0 : x);
  const rng = (band) => { const [lo, hi] = AUDIO_BAND_SPLIT[band]; return avg(Math.floor(n * lo), Math.floor(n * hi)); };
  s.bands.bass = clamp(rng('bass') * g);
  s.bands.mid = clamp(rng('mid') * g);
  s.bands.high = clamp(rng('high') * g);
  s.bands.level = clamp(avg(0, n) * g);
  return s.bands;
}

// Signals map for anim.js: namespaced per source ("external:bass") + plain band
// names (back-compat for old source-less audio anims → external). Call once/frame.
// The output object + its key strings are reused across frames (it's consumed
// immediately by the render loop), so this allocates nothing per frame.
const _audioOut = {};
const _audioKeys = AUDIO_BANDS.map((b) => ['external:' + b, 'composition:' + b, b]);
export function updateAudio() {
  const ext = computeBands(SRC.external), comp = computeBands(SRC.composition);
  for (let i = 0; i < AUDIO_BANDS.length; i++) {
    const b = AUDIO_BANDS[i], k = _audioKeys[i];
    _audioOut[k[0]] = ext[b]; _audioOut[k[1]] = comp[b]; _audioOut[k[2]] = ext[b];
  }
  return _audioOut;
}
