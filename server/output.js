import dgram from 'node:dgram';
import { buildPackets } from './ddp.js';
import { toDeviceOrder } from './colororder.js';
import { buildLut, isIdentity, applyLut } from './calibrate.js';
const sock = dgram.createSocket('udp4');
sock.on('error', (err) => console.error('[ddp] socket error', err.message));
let seq = 0;

// Cache calibration LUTs by (gamma|brightness) so we don't rebuild per frame.
const lutCache = new Map();
function deviceLut(d) {
  if (isIdentity(d.gamma, d.brightness)) return null;
  const key = `${d.gamma ?? 1}|${d.brightness ?? 1}`;
  let lut = lutCache.get(key);
  if (!lut) { lut = buildLut(d.gamma ?? 1, d.brightness ?? 1); lutCache.set(key, lut); }
  return lut;
}

// Re-order a device's bytes, applying each fixture SEGMENT's own colorOrder
// (device-local pixel ranges). Lets mixed strip types on one controller each get
// the right channel order. Falls back to a single device-order pass.
function orderDeviceBytes(slice, d) {
  if (!d.segments?.length) return toDeviceOrder(slice, d.colorOrder);
  const out = Buffer.allocUnsafe(slice.length);
  for (const s of d.segments) {
    const a = s.start * 3, b = (s.start + s.count) * 3;
    toDeviceOrder(slice.subarray(a, b), s.colorOrder || d.colorOrder).copy(out, a);
  }
  return out;
}

// Temporarily stop streaming DDP to a controller so its (realtime-starved) HTTP
// server can answer config/identify requests. Keyed by ip → unix-ms expiry.
const suppressUntil = new Map();
export function suppressOutput(ip, ms = 6000) { suppressUntil.set(ip, Date.now() + ms); }

// devices: [{ ip, port=4048, colorOrder, byteStart, byteEnd, segments? }]
export function sendFrame(rgb, devices) {
  seq = (seq + 1) & 0x0f;
  for (const d of devices) {
    const until = suppressUntil.get(d.ip);
    if (until && until > Date.now()) continue;   // paused for a control op
    const slice = rgb.subarray(d.byteStart, d.byteEnd);
    const ordered = orderDeviceBytes(slice, d);
    const lut = deviceLut(d);
    const bytes = lut ? applyLut(ordered, lut) : ordered;   // gamma + brightness cap
    for (const pkt of buildPackets(bytes, { sequence: seq }))
      sock.send(pkt, d.port ?? 4048, d.ip);
  }
}
