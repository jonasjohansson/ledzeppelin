const MAX_DATA = 1440;   // ≤ MTU (header+data+UDP/IP stays under 1500, no fragmentation)
const FLAG_VER1 = 0x40, FLAG_PUSH = 0x01;

// DDP header byte 2 = DATA TYPE (3waylabs spec): (type << 3) | size, where
// size = 3 means 8 bits per channel. type: 1 = RGB, 3 = RGBW. So RGB = 0x0B,
// RGBW = 0x1B. This MUST be set correctly: WLED reads it to decide 3-byte vs
// 4-byte pixels. Sending 0 (undefined) makes WLED assume RGB and read 3 bytes
// out of a 4-byte RGBW stream → the pixel data walks one byte per pixel →
// polka-dot corruption on the strip. Stride 4 → RGBW, 3 → RGB, else undefined.
export const ddpDataType = (stride) => (stride === 4 ? 0x1b : stride === 3 ? 0x0b : 0);

// Returns an array of GATHER LISTS [header, chunk] — dgram.send accepts an array of
// Buffers, so we avoid a Buffer.concat copy per packet. `chunk` is a subarray view
// of `bytes` (no copy); the caller must keep `bytes` alive until the sends flush.
// `dataType` = the DDP header byte-2 pixel format (see ddpDataType above).
export function buildPackets(bytes, { sequence = 0, maxData = MAX_DATA, dataType = 0 } = {}) {
  const packets = [];
  for (let off = 0; off < bytes.length || off === 0; off += maxData) {
    const chunk = bytes.subarray(off, off + maxData);
    const isLast = off + maxData >= bytes.length;
    const h = Buffer.allocUnsafe(10);
    h[0] = FLAG_VER1 | (isLast ? FLAG_PUSH : 0);
    h[1] = sequence & 0x0f;
    h[2] = dataType;
    h[3] = 1;
    h.writeUInt32BE(off, 4);
    h.writeUInt16BE(chunk.length, 8);
    packets.push([h, chunk]);   // gather list, no concat
    if (chunk.length < maxData) break;
  }
  return packets;
}
