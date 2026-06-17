import dgram from 'node:dgram';
import { buildPackets } from './ddp.js';
import { buildArtnetPackets, buildArtnetSync, nextSequence, ARTNET_PORT } from './artnet.js';
import { buildLut, isIdentity } from './calibrate.js';
const sock = dgram.createSocket('udp4');
sock.on('error', (err) => console.error('[output] socket error', err.message));
let seq = 0;
// Per-send errors (a single dead/unreachable device) were silently swallowed —
// surface them, but rate-limited so one bad controller on a 120-fixture rig
// can't flood the log every frame.
let lastSendErrAt = 0;
function udpSend(pkt, port, ip) {
  sock.send(pkt, port, ip, (err) => {
    if (!err) return;
    const t = Date.now();
    if (t - lastSendErrAt > 2000) { lastSendErrAt = t; console.error(`[output] send to ${ip}:${port} failed: ${err.message}`); }
  });
}
const artSeq = new Map();   // `${ip}:${port}` → last ArtDmx sequence (rolls 1..255, never 0)

// Cache calibration LUTs by (gamma|brightness) so we don't rebuild per frame.
const lutCache = new Map();
function deviceLut(d) {
  if (isIdentity(d.gamma, d.brightness)) return null;
  const key = `${d.gamma ?? 1}|${d.brightness ?? 1}`;
  let lut = lutCache.get(key);
  if (!lut) { lut = buildLut(d.gamma ?? 1, d.brightness ?? 1); lutCache.set(key, lut); }
  return lut;
}

// Channels-per-pixel implied by a colour FORMAT string (the stride): "GRB" = 3,
// "RGBW" = 4. The format is the device/segment colour order, optionally with a W
// (white) channel for RGBW strips. W is DERIVED from the RGB composite (there is
// no white in the source) as min(R,G,B) — the neutral component a dedicated white
// LED can render — leaving R/G/B as-is (the common "additive white" behaviour).
export const formatStride = (fmt) => (fmt || 'RGB').length;

// Build a device's output bytes in ONE pass: per-segment colour-format remap (incl.
// RGBW expansion) AND the gamma/brightness LUT folded together into a single fresh
// buffer. Allocated fresh per frame so in-flight UDP sends that reference it stay
// valid. Output length is per-format (RGB→3B/px, RGBW→4B/px), not the 3B/px input.
export function buildDeviceBytes(slice, d, lut) {
  const segs = d.segments?.length ? d.segments : [{ start: 0, count: slice.length / 3, colorOrder: d.colorOrder }];
  let total = 0;
  for (const s of segs) total += s.count * formatStride(s.colorOrder || d.colorOrder || 'RGB');
  // Zero-filled (not allocUnsafe): if segments don't fully tile the slice (stale/
  // partial route), uncovered channels stay dark, not random memory.
  const out = Buffer.alloc(total);
  let o = 0;
  for (const s of segs) {
    const fmt = s.colorOrder || d.colorOrder || 'RGB';
    const stride = fmt.length;
    const a = s.start * 3;
    for (let p = 0; p < s.count; p++) {
      const r = slice[a + p * 3], g = slice[a + p * 3 + 1], b = slice[a + p * 3 + 2];
      const w = r < g ? (r < b ? r : b) : (g < b ? g : b);   // min(R,G,B) — only used if fmt has W
      for (let c = 0; c < stride; c++) {
        const ch = fmt[c];
        const v = ch === 'R' ? r : ch === 'G' ? g : ch === 'B' ? b : ch === 'W' ? w : 0;
        out[o++] = lut ? lut[v] : v;
      }
    }
  }
  return out;
}

// Temporarily stop streaming DDP to a controller so its (realtime-starved) HTTP
// server can answer config/identify requests. Keyed by ip → unix-ms expiry.
const suppressUntil = new Map();
export function suppressOutput(ip, ms = 6000) { suppressUntil.set(ip, Date.now() + ms); }

// devices: [{ ip, port=4048, colorOrder, byteStart, byteEnd, segments?, protocol?, universe?, delayMs? }]
// protocol 'artnet' streams ArtDmx (universes from `universe`); anything else = DDP.
// delayMs (optional) holds a device's packets back by N ms to time-align it with
// the rest of the rig (e.g. against video/projection); bytes are built NOW so the
// delayed send still ships THIS frame.
export function sendFrame(rgb, devices) {
  seq = (seq + 1) & 0x0f;
  const now = Date.now();
  for (const d of devices) {
    const until = suppressUntil.get(d.ip);
    if (until && until > now) continue;   // paused for a control op
    const slice = rgb.subarray(d.byteStart, d.byteEnd);
    if (!slice.length) continue;
    const bytes = buildDeviceBytes(slice, d, deviceLut(d));   // reorder + gamma/brightness, one pass
    let emit;
    if (d.protocol === 'artnet') {
      const port = d.port ?? ARTNET_PORT;
      const key = `${d.ip}:${port}`;
      const s = nextSequence(artSeq.get(key) ?? 0);   // per-device rolling 1..255
      artSeq.set(key, s);
      // Stride from the device's colour format (RGBW→4) so universes break on whole
      // pixels. (Per-segment format overrides aren't reflected here — a controller's
      // strips share a format in practice.)
      const stride = formatStride(d.colorOrder || 'RGB');
      const pkts = buildArtnetPackets(bytes, { startUniverse: d.universe ?? 0, sequence: s, stride });
      // ArtSync: after this device's ArtDmx, latch all its universes at once (no
      // multi-universe tearing). Unicast to the node (widely honored; avoids needing
      // broadcast perms / disturbing unrelated nodes).
      const sync = d.artnetSync ? buildArtnetSync() : null;
      emit = () => { for (const pkt of pkts) udpSend(pkt, port, d.ip); if (sync) udpSend(sync, port, d.ip); };   // pkt = [header, chunk] gather list
    } else {
      const port = d.port ?? 4048;
      const pkts = buildPackets(bytes, { sequence: seq });
      emit = () => { for (const pkt of pkts) udpSend(pkt, port, d.ip); };
    }
    const delay = Number(d.delayMs) || 0;
    if (delay > 0) setTimeout(emit, delay); else emit();
  }
}
