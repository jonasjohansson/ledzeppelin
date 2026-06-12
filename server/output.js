import dgram from 'node:dgram';
import { buildPackets } from './ddp.js';
import { buildArtnetPackets, nextSequence, ARTNET_PORT } from './artnet.js';
import { buildLut, isIdentity } from './calibrate.js';
const sock = dgram.createSocket('udp4');
sock.on('error', (err) => console.error('[output] socket error', err.message));
let seq = 0;
const artSeq = new Map();   // `${ip}:${port}` → last ArtDmx sequence (rolls 1..255, never 0)
const IDX = { R: 0, G: 1, B: 2 };

// Cache calibration LUTs by (gamma|brightness) so we don't rebuild per frame.
const lutCache = new Map();
function deviceLut(d) {
  if (isIdentity(d.gamma, d.brightness)) return null;
  const key = `${d.gamma ?? 1}|${d.brightness ?? 1}`;
  let lut = lutCache.get(key);
  if (!lut) { lut = buildLut(d.gamma ?? 1, d.brightness ?? 1); lutCache.set(key, lut); }
  return lut;
}

// Build a device's output bytes in ONE pass: per-segment colour-order remap AND
// the gamma/brightness LUT folded together into a single fresh buffer (was three
// buffers: reorder-temp + per-segment copy + LUT copy). Allocated fresh per frame
// so the in-flight UDP sends that reference it stay valid.
function buildDeviceBytes(slice, d, lut) {
  const out = Buffer.allocUnsafe(slice.length);
  const segs = d.segments?.length ? d.segments : [{ start: 0, count: slice.length / 3, colorOrder: d.colorOrder }];
  for (const s of segs) {
    const order = s.colorOrder || d.colorOrder || 'RGB';
    const o0 = IDX[order[0]] ?? 0, o1 = IDX[order[1]] ?? 1, o2 = IDX[order[2]] ?? 2;
    const a = s.start * 3, b = (s.start + s.count) * 3;
    if (lut) {
      for (let i = a; i < b; i += 3) { out[i] = lut[slice[i + o0]]; out[i + 1] = lut[slice[i + o1]]; out[i + 2] = lut[slice[i + o2]]; }
    } else {
      for (let i = a; i < b; i += 3) { out[i] = slice[i + o0]; out[i + 1] = slice[i + o1]; out[i + 2] = slice[i + o2]; }
    }
  }
  return out;
}

// Temporarily stop streaming DDP to a controller so its (realtime-starved) HTTP
// server can answer config/identify requests. Keyed by ip → unix-ms expiry.
const suppressUntil = new Map();
export function suppressOutput(ip, ms = 6000) { suppressUntil.set(ip, Date.now() + ms); }

// devices: [{ ip, port=4048, colorOrder, byteStart, byteEnd, segments?, protocol?, universe? }]
// protocol 'artnet' streams ArtDmx (universes from `universe`); anything else = DDP.
export function sendFrame(rgb, devices) {
  seq = (seq + 1) & 0x0f;
  const now = Date.now();
  for (const d of devices) {
    const until = suppressUntil.get(d.ip);
    if (until && until > now) continue;   // paused for a control op
    const slice = rgb.subarray(d.byteStart, d.byteEnd);
    if (!slice.length) continue;
    const bytes = buildDeviceBytes(slice, d, deviceLut(d));   // reorder + gamma/brightness, one pass
    if (d.protocol === 'artnet') {
      const port = d.port ?? ARTNET_PORT;
      const key = `${d.ip}:${port}`;
      const s = nextSequence(artSeq.get(key) ?? 0);   // per-device rolling 1..255
      artSeq.set(key, s);
      for (const pkt of buildArtnetPackets(bytes, { startUniverse: d.universe ?? 0, sequence: s }))
        sock.send(pkt, port, d.ip);   // pkt = [header, chunk] gather list
    } else {
      for (const pkt of buildPackets(bytes, { sequence: seq }))
        sock.send(pkt, d.port ?? 4048, d.ip);   // pkt = [header, chunk] gather list
    }
  }
}
