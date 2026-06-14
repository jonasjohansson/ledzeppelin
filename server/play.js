// Headless show player CLI — replays a baked recording to the LEDs with no
// browser, no GPU, no editor. The "leave it running" / MiniMad-style runtime.
//
//   node server/play.js <name> [--once]
//   npm run play -- <name>
//
// <name> is a recording in recordings/ (without extension). Loops by default.

import { startPlayback, isPlaying } from './player.js';
import { listRecordings } from './recorder.js';

const args = process.argv.slice(2);
const once = args.includes('--once');
const name = args.find((a) => !a.startsWith('--'));

if (!name) {
  const recs = listRecordings();
  console.log('usage: node server/play.js <name> [--once]');
  console.log(recs.length ? 'recordings:\n  ' + recs.map((r) => `${r.name}  (${(r.durationMs / 1000).toFixed(1)}s @ ${r.fps}fps)`).join('\n  ') : 'no recordings yet');
  process.exit(1);
}

const meta = startPlayback(name, { loop: !once });
if (!meta) { console.error(`recording "${name}" not found or empty`); process.exit(1); }
console.log(`playing "${name}" — Ctrl-C to stop`);

// Keep the process alive; exit cleanly when a one-shot finishes.
if (once) {
  const t = setInterval(() => { if (!isPlaying()) { clearInterval(t); process.exit(0); } }, 200);
}
process.on('SIGINT', () => { process.exit(0); });
