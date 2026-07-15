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
  external:    { analyser: null, data: null, stream: null, node: null, enabled: false, deviceId: 'default', bands: { level: 0, bass: 0, mid: 0, high: 0 },
                 splitter: null, channels: [] },   // channels[i] = per-INPUT-CHANNEL analyser/bands (multi-channel interfaces, e.g. a Flow 8)
  composition: { analyser: null, data: null, enabled: false, bands: { level: 0, bass: 0, mid: 0, high: 0 } },
};

// --- daemon multi-channel capture ------------------------------------------------
// Browsers cap getUserMedia at 2 channels, so a 10-in interface (Flow 8) can't feed
// per-channel triggers from the browser. The DAEMON captures natively (ffmpeg) and
// streams per-channel bands over SSE; when running, its channels take precedence in
// externalBand/externalChannelCount, so the trigger system needs no other change.
const DAEMON = { enabled: false, channels: [], es: null, device: null, error: null };

export function daemonAudio() { return { enabled: DAEMON.enabled, channels: DAEMON.channels.length, device: DAEMON.device, error: DAEMON.error }; }

export async function enableDaemonAudio(device) {
  disableDaemonAudio();
  try {
    const r = await fetch('/api/audio/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device }) });
    const info = await r.json();
    if (!r.ok || info.error) { DAEMON.error = info.error || `HTTP ${r.status}`; return false; }
    DAEMON.channels = Array.from({ length: info.channels || 0 }, () => ({ level: 0, bass: 0, mid: 0, high: 0 }));
    DAEMON.device = device || null; DAEMON.error = null;
    DAEMON.es = new EventSource('/api/audio/stream');
    DAEMON.es.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (Array.isArray(m.bands)) for (let i = 0; i < m.bands.length && i < DAEMON.channels.length; i++) {
          const b = m.bands[i], t = DAEMON.channels[i];
          t.level = b.level; t.bass = b.bass; t.mid = b.mid; t.high = b.high;
        }
      } catch { /* malformed frame */ }
    };
    DAEMON.enabled = true;
    return true;
  } catch (e) { DAEMON.error = e?.message || 'daemon unreachable'; return false; }
}

export function disableDaemonAudio() {
  if (DAEMON.es) { try { DAEMON.es.close(); } catch { /* closed */ } DAEMON.es = null; }
  if (DAEMON.enabled) { try { fetch('/api/audio/stop', { method: 'POST' }); } catch { /* daemon gone */ } }
  DAEMON.enabled = false; DAEMON.channels = []; DAEMON.device = null;
}

export function audioGain() { return globalGain; }
export function setAudioGain(g) { const v = Number(g); globalGain = Number.isFinite(v) && v >= 0 ? v : 1; }
export function audioEnabled(src) { return src ? !!SRC[src]?.enabled : (SRC.external.enabled || SRC.composition.enabled); }

// Current external (mic) band value 0..1 (0 when the mic isn't running). Per-clip triggers
// (src/model/clip-triggers.js) sample this in the render loop.
export function externalBand(name, channel = 0) {
  if (channel >= 1 && DAEMON.enabled) {
    const ch = DAEMON.channels[channel - 1];
    if (!ch) return 0;
    const v = (ch[name] || 0) * globalGain;
    return v > 1 ? 1 : v < 0 ? 0 : v;
  }
  const s = SRC.external;
  if (!s.enabled) return channel >= 1 ? 0 : 0;
  if (channel >= 1) { const ch = s.channels[channel - 1]; return ch ? (ch.bands[name] || 0) : 0; }
  return s.bands[name] || 0;
}

// How many separate input channels the open external device exposes (0 = mono/stereo
// treated as one mix — no splitter built). A multi-channel interface (Behringer Flow 8
// etc.) reports its USB channel count here; per-clip triggers can target one channel.
export function externalChannelCount() { return DAEMON.enabled ? DAEMON.channels.length : (SRC.external.enabled ? SRC.external.channels.length : 0); }

// Live mic spectrum into a caller-owned Uint8Array (length >= binCount). Returns the bin
// count, or 0 when the mic isn't running. Self-refreshing → the visualiser reads it on its
// own rAF without depending on the main render loop.
export function externalFFT(out, channel = 0) {
  const s = SRC.external;
  const a = channel >= 1 ? s.channels[channel - 1]?.analyser : s.analyser;
  if (!s.enabled || !a) return 0;
  a.getByteFrequencyData(out);
  return a.frequencyBinCount;
}
export function externalBinCount(channel = 0) {
  const s = SRC.external;
  return (channel >= 1 ? s.channels[channel - 1]?.analyser : s.analyser)?.frequencyBinCount || 512;
}

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
  if (s.splitter) { try { s.splitter.disconnect(); } catch { /* ignore */ } s.splitter = null; }
  s.channels = [];
  try {
    // Ask for EVERY channel the interface has and switch the browser's speech DSP off —
    // echo cancellation / noise suppression / AGC mangle a mixer feed (Flow 8 etc.) and
    // usually force a mono downmix, which would collapse the per-channel triggers.
    const audio = {
      ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
      channelCount: { ideal: 16 },
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    };
    s.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    ensureAnalyser(s);
    s.node = ctx.createMediaStreamSource(s.stream); s.node.connect(s.analyser);
    // Per-channel analysers (only when the device is genuinely multi-channel): a splitter
    // fans the stream out so each USB channel gets its own FFT → its own bands, letting a
    // clip trigger listen to ONE mic on a multi-channel interface instead of the mix.
    const trackCh = s.stream.getAudioTracks()[0]?.getSettings?.().channelCount || 0;
    const chN = Math.min(16, Math.max(s.node.channelCount || 0, trackCh));   // Flow 8 'Recording' = 10 (4 mics · 2×stereo line · main LR)
    s.channels = [];
    if (chN >= 2) {   // build even for stereo — L/R can be two separate mics
      s.splitter = ctx.createChannelSplitter(Math.max(2, chN));
      s.node.connect(s.splitter);
      for (let i = 0; i < Math.max(2, chN); i++) {
        const a = ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0.8;
        s.splitter.connect(a, i);
        s.channels.push({ enabled: true, analyser: a, data: new Uint8Array(a.frequencyBinCount), bands: { level: 0, bass: 0, mid: 0, high: 0 } });
      }
    }
    s.deviceId = deviceId || 'default'; s.enabled = true; return true;
  } catch (e) { console.warn('Audio (external) unavailable:', e?.message || e); s.enabled = false; return false; }
}
// Close the mic input — stop the stream + free the graph node (keeps the analyser for
// reuse). `enabled` goes false so externalBand/externalFFT report silence.
export function disableExternal() {
  const s = SRC.external;
  if (s.node) { try { s.node.disconnect(); } catch { /* ignore */ } s.node = null; }
  if (s.stream) { s.stream.getTracks().forEach((t) => t.stop()); s.stream = null; }
  if (s.splitter) { try { s.splitter.disconnect(); } catch { /* ignore */ } s.splitter = null; }
  s.channels = [];
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
  // Per-channel bands (multi-channel interface) — cheap: one FFT read per channel.
  if (SRC.external.enabled) for (const ch of SRC.external.channels) computeBands(ch);
  for (let i = 0; i < AUDIO_BANDS.length; i++) {
    const b = AUDIO_BANDS[i], k = _audioKeys[i];
    _audioOut[k[0]] = ext[b]; _audioOut[k[1]] = comp[b]; _audioOut[k[2]] = ext[b];
  }
  return _audioOut;
}
