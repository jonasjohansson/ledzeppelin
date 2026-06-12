// Minimal OSC 1.0 parser for the daemon's UDP listener — pure (no I/O) so it
// unit-tests against hand-built Buffers. parseOsc(buf) → [{ address, value }]:
// one entry per message carrying the FIRST numeric argument ('f' float32,
// 'i' int32, 'd' double — others are skipped). '#bundle' recurses (TouchOSC /
// TouchDesigner wrap messages in bundles). Junk in → [] out, never a throw.

// OSC strings are null-terminated and padded to a 4-byte boundary.
function readString(buf, off) {
  const end = buf.indexOf(0, off);
  if (end < 0) return null;
  const str = buf.toString('ascii', off, end);
  const next = off + (Math.floor((end - off) / 4) + 1) * 4;   // include pad
  return { str, next };
}

// One OSC message (address + typetags + args) → { address, value } | null.
function parseMessage(buf) {
  const addr = readString(buf, 0);
  if (!addr || !addr.str.startsWith('/')) return null;
  const tags = readString(buf, addr.next);
  if (!tags || !tags.str.startsWith(',')) return null;
  let off = tags.next;
  for (const t of tags.str.slice(1)) {
    switch (t) {
      case 'f': return { address: addr.str, value: buf.readFloatBE(off) };
      case 'i': return { address: addr.str, value: buf.readInt32BE(off) };
      case 'd': return { address: addr.str, value: buf.readDoubleBE(off) };
      // Non-numeric args: skip their bytes and keep looking for a number.
      case 's': case 'S': { const s = readString(buf, off); if (!s) return null; off = s.next; break; }
      case 'b': { const n = buf.readInt32BE(off); off += 4 + Math.ceil(n / 4) * 4; break; }
      case 'h': case 't': off += 8; break;
      case 'T': case 'F': case 'N': case 'I': break;          // no payload
      default: return null;                                   // unknown tag — bail
    }
  }
  return null;   // no numeric argument found
}

// A packet is either a message or a '#bundle' (timetag + size-prefixed elements,
// each itself a packet). The timetag is ignored — values apply immediately.
export function parseOsc(buf) {
  try {
    if (!buf || buf.length < 4) return [];
    if (buf.toString('ascii', 0, Math.min(8, buf.length)) === '#bundle\0') {
      const out = [];
      let off = 16;   // '#bundle\0' (8) + timetag (8)
      while (off + 4 <= buf.length) {
        const size = buf.readInt32BE(off);
        off += 4;
        if (size <= 0 || off + size > buf.length) break;
        out.push(...parseOsc(buf.subarray(off, off + size)));
        off += size;
      }
      return out;
    }
    const m = parseMessage(buf);
    return m ? [m] : [];
  } catch {
    return [];   // truncated / malformed packet
  }
}
