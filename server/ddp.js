const MAX_DATA = 1440;   // ≤ MTU (header+data+UDP/IP stays under 1500, no fragmentation)
const FLAG_VER1 = 0x40, FLAG_PUSH = 0x01;
// Returns an array of GATHER LISTS [header, chunk] — dgram.send accepts an array of
// Buffers, so we avoid a Buffer.concat copy per packet. `chunk` is a subarray view
// of `bytes` (no copy); the caller must keep `bytes` alive until the sends flush.
export function buildPackets(bytes, { sequence = 0, maxData = MAX_DATA } = {}) {
  const packets = [];
  for (let off = 0; off < bytes.length || off === 0; off += maxData) {
    const chunk = bytes.subarray(off, off + maxData);
    const isLast = off + maxData >= bytes.length;
    const h = Buffer.allocUnsafe(10);
    h[0] = FLAG_VER1 | (isLast ? FLAG_PUSH : 0);
    h[1] = sequence & 0x0f;
    h[2] = 0;
    h[3] = 1;
    h.writeUInt32BE(off, 4);
    h.writeUInt16BE(chunk.length, 8);
    packets.push([h, chunk]);   // gather list, no concat
    if (chunk.length < maxData) break;
  }
  return packets;
}
