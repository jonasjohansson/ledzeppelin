// Throwaway connectivity test: fires DDP frames straight at the QuinLED (WLED).
// Run on a machine that's on the same LAN:  node server/test-quinled.js
// Optional args:  node server/test-quinled.js <ip> <pixels>
import dgram from 'node:dgram';
import { buildPackets } from './ddp.js';

const IP = process.argv[2] || '192.168.0.111';
const N = Number(process.argv[3] || 96);     // pixel count
const PORT = 4048;

const sock = dgram.createSocket('udp4');
let seq = 0;
let t = 0;

function fill(r, g, b) {
  const buf = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) { buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b; }
  return buf;
}

// Step 1: solid colors so you can eyeball that the strip lights AND that the
// channel order is right (you should see RED, then GREEN, then BLUE in order).
const steps = [
  ['RED  ', fill(255, 0, 0)],
  ['GREEN', fill(0, 255, 0)],
  ['BLUE ', fill(0, 0, 255)],
  ['WHITE', fill(60, 60, 60)],
];

console.log(`→ ${IP}:${PORT}  ${N} px`);
let i = 0;
const solidTimer = setInterval(() => {
  if (i >= steps.length) { clearInterval(solidTimer); chase(); return; }
  const [name, bytes] = steps[i++];
  seq = (seq + 1) & 0x0f;
  for (const pkt of buildPackets(bytes, { sequence: seq })) sock.send(pkt, PORT, IP);
  console.log(`  ${name}`);
}, 800);

// Step 2: a moving dot so you can confirm pixel direction + count.
function chase() {
  console.log('  chase (Ctrl-C to stop)…');
  setInterval(() => {
    const buf = Buffer.alloc(N * 3);
    const head = t % N;
    for (let k = 0; k < 4; k++) { const p = (head - k + N) % N; buf[p * 3] = 255 - k * 60; buf[p * 3 + 1] = 80; buf[p * 3 + 2] = 0; }
    seq = (seq + 1) & 0x0f;
    for (const pkt of buildPackets(buf, { sequence: seq })) sock.send(pkt, PORT, IP);
    t++;
  }, 33);
}

sock.on('error', (e) => { console.error('socket error:', e.message); process.exit(1); });
