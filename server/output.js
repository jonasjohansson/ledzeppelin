import dgram from 'node:dgram';
import { buildPackets } from './ddp.js';
import { toDeviceOrder } from './colororder.js';
const sock = dgram.createSocket('udp4');
sock.on('error', (err) => console.error('[ddp] socket error', err.message));
let seq = 0;
// devices: [{ ip, port=4048, colorOrder, byteStart, byteEnd }]
export function sendFrame(rgb, devices) {
  seq = (seq + 1) & 0x0f;
  for (const d of devices) {
    const slice = rgb.subarray(d.byteStart, d.byteEnd);
    const bytes = toDeviceOrder(slice, d.colorOrder);
    for (const pkt of buildPackets(bytes, { sequence: seq }))
      sock.send(pkt, d.port ?? 4048, d.ip);
  }
}
