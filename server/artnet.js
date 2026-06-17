export const ARTNET_PORT = 6454;
const ID = Buffer.from('Art-Net\0', 'ascii');
// Whole-pixel bytes per universe for a given channels-per-pixel STRIDE: the most
// whole pixels that fit in 512 DMX slots. RGB(3)→510 (170 px), RGBW(4)→512 (128
// px) — so a pixel never straddles a universe boundary (which controllers expect).
const maxDataFor = (stride) => stride * Math.floor(512 / stride);
// Advance an ArtDmx sequence: rolls 1..255 and never lands on 0 (0 on the wire
// means "sequencing disabled", so a live stream must skip it).
export const nextSequence = (s) => (s % 255) + 1;
// Returns an array of GATHER LISTS [header, chunk] — same shape as ddp.js, so
// dgram.send takes them without a Buffer.concat copy. `bytes` is sliced into
// ≤510-byte chunks (whole RGB pixels), one ArtDmx packet per consecutive
// universe from `startUniverse`. `chunk` is a subarray view of `bytes` (no
// copy); the caller must keep `bytes` alive until the sends flush. DMX data
// length must be EVEN — 510 is, so only an odd final chunk gets a 1-byte zero
// pad (that tail alone is copied).
export function buildArtnetPackets(bytes, { startUniverse = 0, sequence = 0, stride = 3 } = {}) {
  const packets = [];
  const maxData = maxDataFor(stride);
  for (let off = 0, u = startUniverse; off < bytes.length || off === 0; off += maxData, u++) {
    let chunk = bytes.subarray(off, off + maxData);
    const isLast = off + maxData >= bytes.length;
    if (chunk.length & 1) { const p = Buffer.alloc(chunk.length + 1); chunk.copy(p); chunk = p; }
    const h = Buffer.allocUnsafe(18);
    ID.copy(h, 0);                       // "Art-Net\0"
    h[8] = 0x00; h[9] = 0x50;            // OpCode ArtDmx 0x5000, LITTLE-endian
    h[10] = 0x00; h[11] = 0x0e;          // ProtVer 14, BIG-endian
    h[12] = sequence & 0xff;             // 0 = sequencing disabled
    h[13] = 0;                           // Physical (informational only)
    h[14] = u & 0xff;                    // SubUni — low 8 bits of the port-address
    h[15] = (u >> 8) & 0x7f;             // Net — high 7 bits
    h.writeUInt16BE(chunk.length, 16);   // Length, BIG-endian, always even
    packets.push([h, chunk]);            // gather list, no concat
    if (isLast) break;
  }
  return packets;
}

// ArtSync (OpSync 0x5200) — a 14-byte packet sent AFTER all of a frame's ArtDmx so
// the node latches every universe at once (no tearing across a multi-universe rig).
// Build it once and reuse (it never changes). Typically broadcast.
const SYNC_PACKET = (() => {
  const h = Buffer.alloc(14);
  ID.copy(h, 0);              // "Art-Net\0"
  h[8] = 0x00; h[9] = 0x52;   // OpCode ArtSync 0x5200, LITTLE-endian
  h[10] = 0x00; h[11] = 0x0e; // ProtVer 14, BIG-endian
  // Aux1/Aux2 (bytes 12-13) stay 0.
  return h;
})();
export const buildArtnetSync = () => SYNC_PACKET;
