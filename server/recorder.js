// Show recorder — bakes the live per-frame RGB output stream to disk so it can be
// replayed standalone (no browser/GPU) by server/player.js. A recording is two
// files in recordings/:
//   <name>.lzshow  — raw RGB frames, frameCount × frameBytes bytes, back-to-back
//   <name>.json    — { version, fps, frameBytes, frameCount, route, createdAt }
// The route (device map: ip/port/protocol/universe/colorOrder/gamma/brightness/
// delay/byte-range) is stored so playback drives the exact same controllers via
// the same output path.

import { createWriteStream, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RECORDINGS_DIR = join(ROOT, 'recordings');

let rec = null;   // active recording, or null

export function isRecording() { return !!rec; }
export function recordingName() { return rec?.name || null; }

// Begin capturing. fps + route come from the editor (the output rate + device map).
export function startRecording(name, fps, route) {
  if (rec) stopRecording();
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const safe = String(name || '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) || 'show';
  const framesPath = join(RECORDINGS_DIR, safe + '.lzshow');
  rec = {
    name: safe, fps: Math.max(1, Math.min(60, Math.round(fps) || 42)),
    route, frameBytes: 0, frameCount: 0,
    framesPath, jsonPath: join(RECORDINGS_DIR, safe + '.json'),
    stream: createWriteStream(framesPath),
  };
  return safe;
}

// Append one frame (the full RGB output buffer). Called per output tick.
export function captureFrame(buf) {
  if (!rec || !buf || !buf.length) return;
  if (!rec.frameBytes) rec.frameBytes = buf.length;
  if (buf.length !== rec.frameBytes) return;   // pixel count changed mid-record — skip
  rec.stream.write(Buffer.from(buf));          // copy: the source buffer is reused next frame
  rec.frameCount++;
}

// Finish + write the sidecar meta. Returns the recording summary (or null).
export function stopRecording() {
  if (!rec) return null;
  const r = rec; rec = null;
  try { r.stream.end(); } catch { /* already closed */ }
  const meta = { version: 1, fps: r.fps, frameBytes: r.frameBytes, frameCount: r.frameCount, route: r.route, createdAt: Date.now() };
  try { writeFileSync(r.jsonPath, JSON.stringify(meta)); } catch (e) { console.error('[rec] meta write failed', e.message); }
  console.log(`[rec] saved "${r.name}" — ${r.frameCount} frames @ ${r.fps}fps`);
  return { name: r.name, ...meta };
}

// List saved recordings (newest first) for the UI — meta only, no frame data.
export function listRecordings() {
  if (!existsSync(RECORDINGS_DIR)) return [];
  const out = [];
  for (const f of readdirSync(RECORDINGS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const m = JSON.parse(readFileSync(join(RECORDINGS_DIR, f), 'utf8'));
      const name = f.slice(0, -5);
      const framesPath = join(RECORDINGS_DIR, name + '.lzshow');
      if (!existsSync(framesPath)) continue;
      out.push({ name, fps: m.fps, frameCount: m.frameCount, frameBytes: m.frameBytes,
        durationMs: Math.round((m.frameCount / m.fps) * 1000), createdAt: m.createdAt,
        sizeBytes: statSync(framesPath).size });
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// Load a recording's meta + frame buffer for the player.
export function loadRecording(name) {
  const safe = String(name || '').replace(/[^a-z0-9_-]/gi, '_');
  const jsonPath = join(RECORDINGS_DIR, safe + '.json');
  const framesPath = join(RECORDINGS_DIR, safe + '.lzshow');
  if (!existsSync(jsonPath) || !existsSync(framesPath)) return null;
  const meta = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const frames = readFileSync(framesPath);
  return { meta, frames };
}
