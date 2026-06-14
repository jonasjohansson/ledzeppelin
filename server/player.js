// Standalone show player — replays a baked recording (server/recorder.js) over
// DDP/Art-Net with NO browser/GPU, using the same output path as the live editor.
// Used two ways:
//   - on the running daemon (start/stopPlayback) so a recording can drive the rig
//     while the editor is closed; the live frame timer yields while it's active.
//   - headless from the CLI:  node server/play.js <name> [--once]
//     (a Raspberry-Pi-class "MiniMad" — just UDP out).

import { sendFrame } from './output.js';
import { loadRecording } from './recorder.js';

let active = null;   // { name, timer, frame, total, loop }

export function isPlaying() { return !!active; }
export function playingName() { return active?.name || null; }

// Start playing `name` (loops unless once=true). Returns the meta summary or null.
export function startPlayback(name, { loop = true } = {}) {
  stopPlayback();
  const rec = loadRecording(name);
  if (!rec) return null;
  const { meta, frames } = rec;
  const { fps, frameBytes, frameCount, route } = meta;
  if (!frameBytes || !frameCount || !route) return null;
  const st = { name, frame: 0, total: frameCount, loop, timer: null };
  st.timer = setInterval(() => {
    if (st.frame >= st.total) {
      if (!loop) { stopPlayback(); return; }
      st.frame = 0;
    }
    const off = st.frame * frameBytes;
    const buf = frames.subarray(off, off + frameBytes);
    try { sendFrame(buf, route); } catch (e) { console.error('[play] sendFrame failed', e.message); }
    st.frame++;
  }, 1000 / Math.max(1, Math.min(60, fps)));
  active = st;
  console.log(`[play] "${name}" — ${frameCount} frames @ ${fps}fps${loop ? ' (loop)' : ''}`);
  return { name, ...meta };
}

export function stopPlayback() {
  if (!active) return;
  clearInterval(active.timer);
  console.log(`[play] stopped "${active.name}"`);
  active = null;
}
