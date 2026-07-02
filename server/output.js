import dgram from 'node:dgram';
import { buildPackets } from './ddp.js';
import { buildArtnetPackets, buildArtnetSync, nextSequence, ARTNET_PORT } from './artnet.js';
import { packDmxUniverses } from './dmx-pack.js';
import { buildLut, isIdentity } from './calibrate.js';
const sock = dgram.createSocket('udp4');
sock.on('error', (err) => console.error('[output] socket error', err.message));
let seq = 0;
// ArtSync is sent as a DIRECTED BROADCAST (the spec forbids unicast sync); enable
// broadcast on the socket lazily on first use.
let broadcastReady = false;
function broadcast(pkt, port) {
  if (!broadcastReady) { try { sock.setBroadcast(true); broadcastReady = true; } catch { /* not permitted yet */ } }
  udpSend(pkt, port, '255.255.255.255');
}
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

// --- Control-API overrides (daemon-native, default OFF — docs/api.md) --------
// Blackout: while set, sendFrame ships zeros instead of the incoming frame
// (packets keep flowing so WLED stays in realtime mode — a deliberate dark
// state, not a dead stream). Survives editor reconnects; cleared only via the
// API. Edges fade over BLACKOUT_FADE_MS instead of hard-cutting.
export const BLACKOUT_FADE_MS = 300;
let blackout = false, blackoutAt = 0;
export function setBlackout(on) {
  on = !!on;
  if (on !== blackout) { blackout = on; blackoutAt = Date.now(); }
  return blackout;
}
export function getBlackout() { return blackout; }
// Output gain 0..1 implied by the blackout state at `now` (1 = normal, 0 =
// dark; ramps across the fade window). Exported for tests.
export function blackoutGain(now = Date.now()) {
  const t = Math.min(1, (now - blackoutAt) / BLACKOUT_FADE_MS);
  return blackout ? 1 - t : t;
}

// Per-device brightness OVERRIDE multiplier (ip → 0..1), applied on top of the
// route's own brightness in the calibration LUT. An override, not an edit —
// the editor's route resends can't clobber it, and it doesn't persist.
const brightnessOverride = new Map();
export function setBrightnessOverride(ip, v) {
  if (v == null) { brightnessOverride.delete(ip); return null; }
  const x = Math.max(0, Math.min(1, Number(v)));
  brightnessOverride.set(ip, x);
  return x;
}
export function getBrightnessOverrides() { return Object.fromEntries(brightnessOverride); }

// Cache calibration LUTs by (gamma|brightness) so we don't rebuild per frame.
// The API's brightness override multiplies the route's brightness and is folded
// into the same cache key.
const lutCache = new Map();
function deviceLut(d) {
  const bri = (d.brightness ?? 1) * (brightnessOverride.get(d.ip) ?? 1);
  if (isIdentity(d.gamma, bri)) return null;
  const key = `${d.gamma ?? 1}|${bri}`;
  let lut = lutCache.get(key);
  if (!lut) { lut = buildLut(d.gamma ?? 1, bri); lutCache.set(key, lut); }
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
let blackBuf = null;   // reused buffer for the blackout-faded frame
export function sendFrame(rgb, devices) {
  seq = (seq + 1) & 0x0f;
  const now = Date.now();
  // API blackout: substitute a scaled/zero copy of THIS frame (fresh buffer per
  // frame semantics preserved for in-flight sends via buildDeviceBytes below).
  const gain = blackoutGain(now);
  if (gain < 1) {
    if (!blackBuf || blackBuf.length !== rgb.length) blackBuf = Buffer.alloc(rgb.length);
    if (gain <= 0) blackBuf.fill(0);
    else for (let i = 0; i < rgb.length; i++) blackBuf[i] = Math.round(rgb[i] * gain);
    rgb = blackBuf;
  }
  let syncPort = 0, syncAfter = -1;   // ArtSync wanted? track the latest send delay
  for (const d of devices) {
    const until = suppressUntil.get(d.ip);
    if (until && until > now) continue;   // paused for a control op
    const sends = [];   // a device can emit pixel strips AND/OR DMX fixtures
    const slice = rgb.subarray(d.byteStart, d.byteEnd);
    if (slice.length) {
      const bytes = buildDeviceBytes(slice, d, deviceLut(d));   // reorder + gamma/brightness, one pass
      if (d.protocol === 'artnet') {
        const port = d.port ?? ARTNET_PORT;
        const key = `${d.ip}:${port}`;
        const s = nextSequence(artSeq.get(key) ?? 0);   // per-device rolling 1..255
        artSeq.set(key, s);
        // Stride for universe chunking: if every segment shares a format, break on
        // whole pixels (RGBW→512B/univ, RGB→510B). With MIXED formats on one
        // controller, fall back to byte-packed 512-channel universes (a pixel may
        // straddle a boundary — patch the controller's per-universe channel counts).
        const segs = d.segments?.length ? d.segments : [{ colorOrder: d.colorOrder }];
        const strides = segs.map((sg) => formatStride(sg.colorOrder || d.colorOrder || 'RGB'));
        const stride = strides.every((x) => x === strides[0]) ? strides[0] : 1;
        const pkts = buildArtnetPackets(bytes, { startUniverse: d.universe ?? 0, sequence: s, stride });
        sends.push(() => { for (const pkt of pkts) udpSend(pkt, port, d.ip); });   // pkt = [header, chunk] gather list
        if (d.artnetSync) { syncPort = port; syncAfter = Math.max(syncAfter, Number(d.delayMs) || 0); }
      } else {
        const port = d.port ?? 4048;
        const pkts = buildPackets(bytes, { sequence: seq });
        sends.push(() => { for (const pkt of pkts) udpSend(pkt, port, d.ip); });
      }
    }
    // DMX fixtures (Art-Net only): one ArtDmx per touched universe, each fixture's
    // resolved channels written at its start address.
    if (d.protocol === 'artnet' && d.dmx?.length) {
      const port = d.port ?? ARTNET_PORT;
      const key = `${d.ip}:${port}`;
      const dpkts = [];
      for (const [u, buf] of packDmxUniverses(rgb, d.dmx)) {
        const s = nextSequence(artSeq.get(key) ?? 0); artSeq.set(key, s);
        for (const pkt of buildArtnetPackets(buf, { startUniverse: u, sequence: s, stride: 4 })) dpkts.push(pkt);
      }
      sends.push(() => { for (const pkt of dpkts) udpSend(pkt, port, d.ip); });
      if (d.artnetSync) { syncPort = port; syncAfter = Math.max(syncAfter, Number(d.delayMs) || 0); }
    }
    if (!sends.length) continue;
    const delay = Number(d.delayMs) || 0;
    const fire = () => { for (const s of sends) s(); };
    if (delay > 0) setTimeout(fire, delay); else fire();
  }
  // One broadcast ArtSync after every controller's ArtDmx → the whole rig latches
  // together (tear-free). Nodes match it to their last ArtDmx by source IP.
  if (syncAfter >= 0) {
    const fire = () => broadcast(buildArtnetSync(), syncPort || ARTNET_PORT);
    if (syncAfter > 0) setTimeout(fire, syncAfter); else fire();
  }
}
