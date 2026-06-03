// Output calibration for real LEDs (applied daemon-side, before DDP — NOT to the
// on-screen preview). WS2815/SK6812 etc. are perceptually non-linear, so a linear
// 8-bit ramp crushes the low-end fades a lighting tool lives on; a gamma curve
// fixes that. A max-brightness cap keeps strips from running hotter/brighter than
// intended. Both are per-device and default to no-ops.
//
//   out = round(255 · brightness · (v/255) ^ gamma)

// A 256-entry byte→byte lookup table for (gamma, brightness).
export function buildLut(gamma = 1, brightness = 1) {
  const g = gamma > 0 ? gamma : 1;
  const bri = Math.max(0, Math.min(1, Number(brightness)));
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * bri * Math.pow(v / 255, g));
  return lut;
}

// gamma 1 + brightness 1 is the identity → no LUT needed.
export function isIdentity(gamma = 1, brightness = 1) {
  return (Number(gamma) === 1 || gamma == null) && (Number(brightness) === 1 || brightness == null);
}

// Apply a LUT to a byte buffer, returning a new Buffer.
export function applyLut(bytes, lut) {
  const out = Buffer.allocUnsafe(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = lut[bytes[i]];
  return out;
}
