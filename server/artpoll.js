// Art-Net node discovery (ArtPoll → ArtPollReply). Broadcasts an ArtPoll on UDP
// 6454 and collects the replying nodes for ~1.5s, so the UI can list reachable
// Art-Net controllers and bind a device to one without re-mapping pixels.

import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

const ID = Buffer.from('Art-Net\0', 'ascii');
const ARTNET_PORT = 6454;

// The directed broadcast for an interface: host bits all 1s, from its REAL netmask.
// e.g. 10.5.6.7 / 255.0.0.0 → 10.255.255.255 (a /24 guess would wrongly give
// 10.5.6.255 and miss most of a /8 or /16 — the cause of Art-Net nodes not being
// discovered on big flat networks, esp. on Windows where 255.255.255.255 is dropped).
export function directedBroadcast(ip, netmask) {
  const a = String(ip).split('.').map(Number), m = String(netmask).split('.').map(Number);
  if (a.length !== 4 || m.length !== 4 || [...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return a.map((o, i) => ((o & m[i]) | (~m[i] & 255))).join('.');
}

// Broadcast targets: the global broadcast, plus each non-internal IPv4 interface's
// netmask-correct directed broadcast (with a /24 fallback when no netmask is given).
function broadcastTargets() {
  const t = new Set(['255.255.255.255']);
  try {
    for (const ifs of Object.values(networkInterfaces())) {
      for (const i of ifs || []) {
        if (i && i.family === 'IPv4' && !i.internal && i.address) {
          const b = i.netmask && directedBroadcast(i.address, i.netmask);
          if (b) t.add(b);
          const p = i.address.split('.'); t.add(`${p[0]}.${p[1]}.${p[2]}.255`);   // /24 fallback
        }
      }
    }
  } catch { /* ignore */ }
  return [...t];
}

// Returns a promise of [{ ip, shortName, longName }], one per replying node.
export function scanArtnet(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map();   // ip → node
    let done = false;
    const finish = () => { if (done) return; done = true; try { sock.close(); } catch { /* already closed */ } resolve([...found.values()]); };
    const readStr = (buf, o, n) => {
      const s = buf.subarray(o, o + n); const z = s.indexOf(0);
      return s.subarray(0, z < 0 ? n : z).toString('ascii').trim();
    };
    sock.on('error', () => finish());
    sock.on('message', (buf, rinfo) => {
      if (buf.length < 26 || !buf.subarray(0, 8).equals(ID)) return;
      if (buf.readUInt16LE(8) !== 0x2100) return;   // ArtPollReply opcode
      found.set(rinfo.address, {
        ip: rinfo.address,
        shortName: buf.length >= 44 ? readStr(buf, 26, 18) : '',
        longName: buf.length >= 108 ? readStr(buf, 44, 64) : '',
      });
    });
    sock.bind(ARTNET_PORT, () => {
      try { sock.setBroadcast(true); } catch { /* not permitted */ }
      const poll = Buffer.alloc(14);
      ID.copy(poll, 0);
      poll[8] = 0x00; poll[9] = 0x20;   // OpPoll 0x2000, little-endian
      poll[10] = 0; poll[11] = 14;      // ProtVer 14, big-endian
      poll[12] = 0x00; poll[13] = 0x00; // TalkToMe, Priority
      for (const target of broadcastTargets()) { try { sock.send(poll, ARTNET_PORT, target); } catch { /* unreachable iface */ } }
    });
    setTimeout(finish, timeoutMs);
  });
}
