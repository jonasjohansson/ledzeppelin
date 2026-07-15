// Multi-channel audio capture — the DAEMON side of per-channel triggers.
//
// Browsers hard-cap getUserMedia at 2 channels (verified: a 10-in Flow 8 delivers
// stereo only; channelCount {exact:>2} throws OverconstrainedError). The daemon has
// no such cap: it spawns ffmpeg on the native input (avfoundation on macOS, alsa on
// Linux), reads raw interleaved float PCM, and reduces every channel to the SAME four
// bands the browser analyser produces (level/bass/mid/high, 0..1) at ~45Hz windows.
// The editor subscribes over SSE (/api/audio/stream) and feeds the values into the
// existing per-clip trigger system — so "mic 3 fires the Shockwave" works even though
// the browser never sees channel 3.
//
// The DSP core (createChannelBands) is pure and node-tested; only start() does IO.

import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

// Resolve ffmpeg robustly: a PACKAGED app launches with the minimal GUI PATH
// (/usr/bin:/bin:…), which does NOT include Homebrew — so a bare 'ffmpeg' spawn
// ENOENTs in the installed app even when ffmpeg is on the machine.
function ffmpegPath() {
  if (process.env.LZ_FFMPEG) return process.env.LZ_FFMPEG;
  for (const c of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) if (existsSync(c)) return c;
  return 'ffmpeg';
}

// --- pure DSP: interleaved f32 chunks → per-channel {level,bass,mid,high} ---------
// One-pole splits (≈ the analyser's band ranges): bass < ~200Hz < mid < ~2kHz < high.
// Window RMS (~21ms at 48k) then a light EMA so held sounds read steady like the
// browser analyser's smoothed FFT. Values are pre-gain — the editor applies its
// audio Gain on top, exactly as it does for the browser bands.
export function createChannelBands(channels, sampleRate = 48000, windowSamples = 1024) {
  const kB = 1 - Math.exp(-2 * Math.PI * 200 / sampleRate);    // low-pass 200Hz
  const kM = 1 - Math.exp(-2 * Math.PI * 2000 / sampleRate);   // low-pass 2kHz
  const SMOOTH = 0.55;                                          // window-to-window EMA
  const SCALE = 2.2;                                            // RMS → ~0..1 for real-world program
  const st = Array.from({ length: channels }, () => ({ lpB: 0, lpM: 0, sB: 0, sM: 0, sH: 0, sL: 0 }));
  const bands = Array.from({ length: channels }, () => ({ level: 0, bass: 0, mid: 0, high: 0 }));
  let n = 0;              // samples accumulated into the current window (per channel)
  let pending = Buffer.alloc(0);
  const clamp = (x) => (x > 1 ? 1 : x < 0 ? 0 : x);

  return {
    bands,   // live view — mutated in place
    // Push a raw chunk (interleaved f32le). Returns true when ≥1 window completed.
    push(buf) {
      pending = pending.length ? Buffer.concat([pending, buf]) : buf;
      const frame = channels * 4;
      const frames = Math.floor(pending.length / frame);
      let completed = false;
      for (let f = 0; f < frames; f++) {
        const base = f * frame;
        for (let c = 0; c < channels; c++) {
          const x = pending.readFloatLE(base + c * 4);
          const s = st[c];
          s.lpB += (x - s.lpB) * kB;
          s.lpM += (x - s.lpM) * kM;
          const mid = s.lpM - s.lpB, high = x - s.lpM;
          s.sB += s.lpB * s.lpB; s.sM += mid * mid; s.sH += high * high; s.sL += x * x;
        }
        if (++n >= windowSamples) {
          for (let c = 0; c < channels; c++) {
            const s = st[c], b = bands[c];
            const rms = (v) => clamp(Math.sqrt(v / n) * SCALE);
            b.bass += (rms(s.sB) - b.bass) * SMOOTH;
            b.mid += (rms(s.sM) - b.mid) * SMOOTH;
            b.high += (rms(s.sH) - b.high) * SMOOTH;
            b.level += (rms(s.sL) - b.level) * SMOOTH;
            s.sB = s.sM = s.sH = s.sL = 0;
          }
          n = 0; completed = true;
        }
      }
      pending = pending.subarray(frames * frame);
      return completed;
    },
  };
}

// --- device discovery --------------------------------------------------------------
// macOS: input devices + channel counts from Core Audio (system_profiler), which is
// also how we know how many channels to ask ffmpeg for. Linux: best-effort via env.
export function listDevices(cb) {
  if (process.platform !== 'darwin') return cb(null, []);   // linux: LZ_ALSA_DEV env (no listing)
  execFile('system_profiler', ['-json', 'SPAudioDataType'], { timeout: 8000 }, (err, out) => {
    if (err) return cb(err, []);
    try {
      const items = JSON.parse(out)?.SPAudioDataType?.[0]?._items || [];
      cb(null, items
        .filter((d) => Number(d.coreaudio_device_input) >= 1)
        .map((d) => ({ name: d._name, channels: Number(d.coreaudio_device_input) })));
    } catch (e) { cb(e, []); }
  });
}

// avfoundation addresses audio devices by INDEX — parse `-list_devices` for the index
// whose name matches (the editor sends the browser label, which carries a "(vid:pid)"
// suffix Core Audio doesn't — match on prefix/substring, case-insensitive).
function avfIndexFor(ffmpeg, name, cb) {
  execFile(ffmpeg, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { timeout: 8000 }, (_e, _out, stderr) => {
    const lines = String(stderr || '').split('\n');
    const start = lines.findIndex((l) => /audio devices/i.test(l));
    const want = String(name || '').toLowerCase();
    let idx = -1, first = -1;
    for (let i = Math.max(0, start + 1); i < lines.length; i++) {
      const m = /\[(\d+)\]\s+(.+?)\s*$/.exec(lines[i]);
      if (!m) continue;
      if (first < 0) first = Number(m[1]);
      const label = m[2].toLowerCase();
      if (want && (want.startsWith(label) || label.startsWith(want) || want.includes(label) || label.includes(want))) { idx = Number(m[1]); break; }
    }
    cb(idx >= 0 ? idx : first);
  });
}

// --- capture lifecycle ---------------------------------------------------------------
// ONE capture at a time. Subscribers are SSE responses; every completed window
// broadcasts the full per-channel band set (~45Hz — the editor polls per frame anyway).
const state = { proc: null, dsp: null, device: null, channels: 0, subs: new Set(), err: null };

export function audioStatus() {
  return { running: !!state.proc, device: state.device, channels: state.channels, error: state.err };
}

export function stopCapture() {
  if (state.proc) { try { state.proc.kill('SIGKILL'); } catch { /* gone */ } }
  state.proc = null; state.dsp = null; state.device = null; state.channels = 0; state.err = null;
  broadcast();   // tell subscribers the stream went quiet
}

export function startCapture(deviceName, cb) {
  const ffmpeg = ffmpegPath();
  stopCapture();
  const launch = (args, channels) => {
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const dsp = createChannelBands(channels);
    state.proc = proc; state.dsp = dsp; state.channels = channels; state.err = null;
    proc.stdout.on('data', (buf) => { if (dsp.push(buf)) broadcast(); });
    let errTail = '';
    proc.stderr.on('data', (d) => { errTail = (errTail + d).slice(-400); });
    proc.on('error', (e) => { state.err = `ffmpeg: ${e.message}`; stopCapture(); });
    proc.on('exit', (code) => {
      if (state.proc === proc && code !== 0 && code !== null) { state.err = errTail.trim().split('\n').pop() || `ffmpeg exited ${code}`; }
      if (state.proc === proc) { state.proc = null; state.dsp = null; state.channels = 0; broadcast(); }
    });
    cb(null, { channels });
  };
  if (process.platform === 'darwin') {
    listDevices((_e, devs) => {
      const want = String(deviceName || '').toLowerCase();
      const byWidth = [...devs].sort((a, b) => b.channels - a.channels);
      const dev = (want && devs.find((d) => want.includes(d.name.toLowerCase()) || d.name.toLowerCase().includes(want))) || byWidth[0];   // no label → the widest input (a multi-channel interface beats the built-in mic)
      if (!dev) return cb(new Error('no input devices'));
      state.device = dev.name;
      avfIndexFor(ffmpeg, dev.name, (idx) => {
        launch(['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', `:${idx}`,
                '-ar', '48000', '-ac', String(dev.channels), '-f', 'f32le', 'pipe:1'], dev.channels);
      });
    });
  } else {
    // Linux (the Pi): alsa; device + channel count come from env (no reliable listing).
    const dev = process.env.LZ_ALSA_DEV || 'default';
    const ch = Math.max(1, Number(process.env.LZ_ALSA_CHANNELS) || 2);
    state.device = dev;
    launch(['-hide_banner', '-loglevel', 'error', '-f', 'alsa', '-i', dev,
            '-ar', '48000', '-ac', String(ch), '-f', 'f32le', 'pipe:1'], ch);
  }
}

// --- SSE fan-out -----------------------------------------------------------------
export function subscribe(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  state.subs.add(res);
  res.on('close', () => state.subs.delete(res));
}
function snapshot() {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    running: !!state.proc, channels: state.channels,
    bands: state.dsp ? state.dsp.bands.map((b) => ({ level: r3(b.level), bass: r3(b.bass), mid: r3(b.mid), high: r3(b.high) })) : [],
  };
}
function broadcast() {
  if (!state.subs.size) return;
  const line = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of state.subs) { try { res.write(line); } catch { state.subs.delete(res); } }
}
