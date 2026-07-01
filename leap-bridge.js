#!/usr/bin/env node
// Leap Motion → LED Zeppelin bridge
//
// Connects to the Leap Motion tracking service (WebSocket on :6437) and relays
// hand-tracking data as external channels to LED Zeppelin's daemon (:7070/frames).
//
// Each hand property becomes an OSC-style address normalised to 0..1:
//   /leap/hand/x        palm position X  (left→right)
//   /leap/hand/y        palm position Y  (down→up, height above sensor)
//   /leap/hand/z        palm position Z  (near→far)
//   /leap/hand/grab     grab strength    (open→fist)
//   /leap/hand/pinch    pinch strength   (open→pinched)
//   /leap/hand/roll     palm roll        (−180°..+180° → 0..1)
//   /leap/hand/pitch    palm pitch
//   /leap/hand/yaw      palm yaw
//   /leap/hand/spread   finger spread    (0..1, derived from inter-finger angles)
//   /leap/hand/vel      hand speed       (0..~1, clamped)
//   /leap/hand/point    index-point      (1 = index out, rest curled; else 0)
//   /leap/hand/ball     fist OR point    (1 = either gesture; else 0)
//   /leap/hands         number of hands  (0 or 0.5 or 1)
//
// In ledzeppelin, set any parameter's modulation to "external" and pick the
// channel from the dropdown — they appear as soon as the first frame arrives.
//
// Usage:
//   node leap-bridge.js                         # defaults
//   node leap-bridge.js --lz ws://10.0.0.5:7070 # custom LED Zeppelin host
//   node leap-bridge.js --leap ws://127.0.0.1:6437  # custom Leap service
//   node leap-bridge.js --rate 30               # send rate in Hz (default 40)
//   node leap-bridge.js --ylo 190 --yhi 380     # calibrate the height range (mm)
//
// Calibration: each palm axis is mapped from a mm range onto 0..1. If a channel
// floors/clips before your hand reaches its limit, narrow that axis's range:
//   --xlo/--xhi   left↔right   (default -200..200)
//   --ylo/--yhi   low↔high     (default  100..350)
//   --zlo/--zhi   near↔far     (default -150..150)
//
// To cut a NOISY edge (e.g. the jitter when a hand is close to the sensor), trim
// in the 0..1 reading itself — readings below the floor pin to a steady 0:
//   --yfloor 0.2   floor the bottom 20% (and rescale 0.2..1 → 0..1)
//   --yceil  0.9   ceil the top 10%      (also --xfloor/--xceil, --zfloor/--zceil)

import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';

// --- CLI args ---------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const LEAP_URL = flag('leap', 'ws://127.0.0.1:6437/v7.json');
const LZ_URL   = flag('lz',   'ws://127.0.0.1:7070/frames');
const RATE     = Math.max(1, Math.min(120, Number(flag('rate', '40'))));

// Palm-position input ranges in mm — the interaction volume the sensor reports,
// mapped onto 0..1 per axis. Defaults suit a desk-mounted Leap; tune to YOUR rig
// and reach. If a channel floors before your hand reaches the physical limit,
// NARROW the range: e.g. the original Leap rarely tracks a hand below ~190mm, so
// `--ylo 190` makes your lowest comfortable hand height map to 0 (and `--yhi` the
// top). Same idea for x (left↔right) and z (near↔far).
const numFlag = (name, fb) => { const v = Number(flag(name, String(fb))); return Number.isFinite(v) ? v : fb; };
const X_LO = numFlag('xlo', -200), X_HI = numFlag('xhi', 200);   // left → right
const Y_LO = numFlag('ylo',  100), Y_HI = numFlag('yhi', 350);   // low → high (height above sensor)
const Z_LO = numFlag('zlo', -150), Z_HI = numFlag('zhi', 150);   // near → far

// Optional post-TRIM per axis, expressed in the 0..1 reading you see on the /leap/
// page: re-stretch [floor..ceil] → [0..1] and CLAMP outside it. Use it to cut a
// noisy edge — the original Leap jitters when a hand is very close, so the reading
// flickers near the bottom; `--yfloor 0.2` pins everything ≤0.2 to a steady 0 and
// rescales the rest. `--yceil 0.9` does the same at the top. Defaults = no trim.
const trimFlag = (name, fb) => { const v = Number(flag(name, String(fb))); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fb; };
const X_FLOOR = trimFlag('xfloor', 0), X_CEIL = trimFlag('xceil', 1);
const Y_FLOOR = trimFlag('yfloor', 0), Y_CEIL = trimFlag('yceil', 1);
const Z_FLOOR = trimFlag('zfloor', 0), Z_CEIL = trimFlag('zceil', 1);

// Minimum hand-tracking confidence (0..1) for the GESTURE channels (grab/point/
// ball) to count. At the edge of the sensor's view the Leap loses the fingers and
// falsely reports a fist (grab→1); below this, those gestures read 0 so they don't
// glitch. Position channels (x/y/z) are unaffected. Raise it if edge-flicker
// persists; lower it if real gestures get ignored. Default 0.2.
const CONF_MIN = numFlag('conf', 0.2);

// --- Helpers ----------------------------------------------------------------
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const remap = (v, lo, hi) => clamp01((v - lo) / (hi - lo));
// Re-stretch an already-normalised 0..1 value so [floor..ceil] fills 0..1,
// clamping anything outside (a no-op when floor=0, ceil=1).
const trim = (v, floor, ceil) => (ceil > floor ? clamp01((v - floor) / (ceil - floor)) : v);

// The v6/v7 Leap frame keeps fingers in a top-level `pointables` array linked to
// each hand by `handId` (NOT nested as hand.fingers). Attach them so the finger
// helpers (spread/point) and per-finger logic work.
function attachFingers(frame) {
  const ps = frame.pointables;
  if (!Array.isArray(ps)) return;
  for (const h of frame.hands || []) if (!h.fingers) h.fingers = ps.filter((p) => p.handId === h.id);
}

// Convert Leap Motion's palm normal + direction into roll/pitch/yaw in degrees,
// then normalise −180..+180 → 0..1 (0.5 = neutral).
function palmAngles(hand) {
  const n = hand.palmNormal || [0, -1, 0];
  const d = hand.direction  || [0, 0, -1];
  const roll  = Math.atan2(n[0], -n[1]) * (180 / Math.PI);
  const pitch = Math.atan2(d[1], -d[2]) * (180 / Math.PI);
  const yaw   = Math.atan2(d[0], -d[2]) * (180 / Math.PI);
  return {
    roll:  (roll  + 180) / 360,
    pitch: (pitch + 180) / 360,
    yaw:   (yaw   + 180) / 360,
  };
}

// Finger spread: average angle between adjacent extended finger directions.
function fingerSpread(hand) {
  const fingers = hand.fingers;
  if (!fingers || fingers.length < 2) return 0;
  const dirs = fingers.filter(f => f.extended).map(f => f.direction);
  if (dirs.length < 2) return 0;
  let sum = 0, n = 0;
  for (let i = 1; i < dirs.length; i++) {
    const a = dirs[i - 1], b = dirs[i];
    const dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    sum += Math.acos(clamp01(Math.abs(dot)));  // 0 = parallel, π/2 = perpendicular
    n++;
  }
  return n ? clamp01((sum / n) / (Math.PI / 4)) : 0;  // π/4 ≈ max comfortable spread
}

// Per-finger extended state by type (0=thumb…4=pinky); falls back to array order
// when a finger carries no `type`.
function fingerExt(hand) {
  const ext = [false, false, false, false, false];   // [thumb, index, middle, ring, pinky]
  (hand.fingers || []).forEach((f, i) => { const t = typeof f.type === 'number' ? f.type : i; if (t >= 0 && t < 5) ext[t] = !!f.extended; });
  return ext;
}
// Index-point gesture: index extended, and AT MOST ONE of middle/ring/pinky still
// extended (thumb ignored). The tolerance keeps a partly-curled / edge-of-tracking
// finger from cancelling the point, which caused flicker at the sides.
function pointStrength(hand) {
  const e = fingerExt(hand);
  if (!e[1]) return 0;
  const othersOut = (e[2] ? 1 : 0) + (e[3] ? 1 : 0) + (e[4] ? 1 : 0);
  return othersOut <= 1 ? 1 : 0;
}

// --- State ------------------------------------------------------------------
let leapWs = null, lzWs = null;
let latestFrame = null;
let sendTimer = null;

// Channels to send — updated from the latest Leap frame at the configured rate.
function extractChannels(frame) {
  const out = {};
  const hands = frame.hands || [];
  out['/leap/hands'] = clamp01(hands.length / 2);

  // Use the first (most confident) hand; if two hands are present, map both
  // with /leap/left/* and /leap/right/* prefixes as well.
  for (const hand of hands) {
    const prefix = hands.length > 1
      ? `/leap/${hand.type || 'hand'}`   // 'left' or 'right'
      : '/leap/hand';

    // Palm position — Leap reports in mm, interaction box ~−150..+150 for X/Z,
    // 50..350 for Y (height above sensor).
    const p = hand.palmPosition || hand.stabilizedPalmPosition || [0, 200, 0];
    out[`${prefix}/x`]   = trim(remap(p[0], X_LO, X_HI), X_FLOOR, X_CEIL);
    out[`${prefix}/y`]   = trim(remap(p[1], Y_LO, Y_HI), Y_FLOOR, Y_CEIL);
    out[`${prefix}/z`]   = trim(remap(p[2], Z_LO, Z_HI), Z_FLOOR, Z_CEIL);

    // Grab & pinch (already 0..1 from Leap).
    out[`${prefix}/grab`]  = clamp01(hand.grabStrength  ?? 0);
    out[`${prefix}/pinch`] = clamp01(hand.pinchStrength ?? 0);

    // Palm orientation.
    const angles = palmAngles(hand);
    out[`${prefix}/roll`]  = angles.roll;
    out[`${prefix}/pitch`] = angles.pitch;
    out[`${prefix}/yaw`]   = angles.yaw;

    // Finger spread.
    out[`${prefix}/spread`] = fingerSpread(hand);

    // Index-point gesture, and a combined "ball" trigger = fist OR point, so a
    // single binding (e.g. Layer Bypass ← /leap/hand/ball, momentary) switches to
    // the spot on EITHER gesture.
    // Only trust the gesture channels when the hand is confidently tracked —
    // at the FOV edge the Leap drops the fingers and reports a phantom fist.
    const tracked = Number(hand.confidence ?? 1) >= CONF_MIN;
    const point = tracked ? pointStrength(hand) : 0;
    const fist  = tracked && clamp01(hand.grabStrength ?? 0) >= 0.5;
    out[`${prefix}/point`] = point;
    out[`${prefix}/ball`]  = (fist || point) ? 1 : 0;

    // Hand velocity (mm/s → normalise; ~1500 mm/s is a fast swipe).
    const v = hand.palmVelocity || [0, 0, 0];
    const speed = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    out[`${prefix}/vel`] = remap(speed, 0, 1500);
  }

  // When no hand is visible, zero out the generic channels so params relax.
  if (!hands.length) {
    for (const k of ['/x', '/y', '/z', '/grab', '/pinch', '/roll', '/pitch', '/yaw', '/spread', '/vel', '/point', '/ball']) {
      out[`/leap/hand${k}`] = (k === '/y' || k === '/roll' || k === '/pitch' || k === '/yaw') ? 0.5 : 0;
    }
  }

  return out;
}

function sendChannels() {
  if (!latestFrame || !lzWs || lzWs.readyState !== WebSocket.OPEN) return;
  const channels = extractChannels(latestFrame);
  for (const [channel, value] of Object.entries(channels)) {
    lzWs.send(JSON.stringify({ type: 'ext', channel, value }));
  }
}

// --- Leap Motion connection -------------------------------------------------
let leapBackoff = 500;
function connectLeap() {
  console.log(`[leap] connecting to ${LEAP_URL} …`);
  leapWs = new WebSocket(LEAP_URL);

  leapWs.on('open', () => {
    console.log('[leap] connected');
    leapBackoff = 500;
    // Enable gestures and optimise for low latency (v6 API).
    leapWs.send(JSON.stringify({ enableGestures: false, optimizeHMD: false }));
    // Request focused state so we get frames even when not in focus.
    leapWs.send(JSON.stringify({ focused: true }));
  });

  leapWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.hands !== undefined) { attachFingers(msg); latestFrame = msg; }   // it's a tracking frame
    } catch { /* not JSON or malformed — ignore */ }
  });

  leapWs.on('close', () => {
    console.log('[leap] disconnected — retrying …');
    setTimeout(connectLeap, leapBackoff);
    leapBackoff = Math.min(leapBackoff * 2, 5000);
  });

  leapWs.on('error', (e) => {
    console.error(`[leap] error: ${e.message}`);
    try { leapWs.close(); } catch { /* already closing */ }
  });
}

// --- LED Zeppelin connection ------------------------------------------------
let lzBackoff = 500;
function connectLZ() {
  console.log(`[lz] connecting to ${LZ_URL} …`);
  lzWs = new WebSocket(LZ_URL);

  lzWs.on('open', () => {
    console.log('[lz] connected — streaming channels');
    lzBackoff = 500;
  });

  lzWs.on('close', () => {
    console.log('[lz] disconnected — retrying …');
    setTimeout(connectLZ, lzBackoff);
    lzBackoff = Math.min(lzBackoff * 2, 5000);
  });

  lzWs.on('error', (e) => {
    console.error(`[lz] error: ${e.message}`);
    try { lzWs.close(); } catch { /* already closing */ }
  });
}

// --- Exports (for tests) ----------------------------------------------------
// The pure channel logic is exported so it can be unit-tested; the runtime below
// only starts when this file is executed directly (not when imported).
export { extractChannels, pointStrength, fingerExt, attachFingers };

// --- Main -------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  console.log(`\n  Leap Motion → LED Zeppelin bridge`);
  console.log(`  Leap:  ${LEAP_URL}`);
  console.log(`  LZ:    ${LZ_URL}`);
  console.log(`  Rate:  ${RATE} Hz\n`);

  connectLeap();
  connectLZ();
  sendTimer = setInterval(sendChannels, 1000 / RATE);

  // Graceful shutdown.
  process.on('SIGINT', () => {
    console.log('\n[bridge] shutting down');
    clearInterval(sendTimer);
    try { leapWs?.close(); } catch { /* */ }
    try { lzWs?.close(); }   catch { /* */ }
    process.exit(0);
  });
}
