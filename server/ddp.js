const MAX_DATA = 1440;
const FLAG_VER1 = 0x40, FLAG_PUSH = 0x01;
export function buildPackets(bytes, { sequence = 0, maxData = MAX_DATA } = {}) {
  const packets = [];
  for (let off = 0; off < bytes.length || off === 0; off += maxData) {
    const chunk = bytes.subarray(off, off + maxData);
    const isLast = off + maxData >= bytes.length;
    const h = Buffer.alloc(10);
    h[0] = FLAG_VER1 | (isLast ? FLAG_PUSH : 0);
    h[1] = sequence & 0x0f;
    h[2] = 0;
    h[3] = 1;
    h.writeUInt32BE(off, 4);
    h.writeUInt16BE(chunk.length, 8);
    packets.push(Buffer.concat([h, chunk]));
    if (chunk.length < maxData) break;
  }
  return packets;
}
