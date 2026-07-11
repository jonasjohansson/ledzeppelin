import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackets, ddpDataType } from '../server/ddp.js';

test('ddpDataType: RGB=0x0B, RGBW=0x1B, other=0', () => {
  assert.equal(ddpDataType(3), 0x0b);   // RGB, 8-bit
  assert.equal(ddpDataType(4), 0x1b);   // RGBW, 8-bit (the value WLED needs for 4-ch)
  assert.equal(ddpDataType(5), 0);      // no standard DDP type → undefined
});

test('header byte 2 carries the data type (0 by default, 0x1B for RGBW)', () => {
  assert.equal(buildPackets(Buffer.from([1, 2, 3]), {})[0][0][2], 0);
  const rgbw = buildPackets(Buffer.from([1, 2, 3, 4]), { dataType: ddpDataType(4) });
  assert.equal(rgbw[0][0][2], 0x1b);
});
// buildPackets now returns GATHER LISTS [header(10B), chunk] (sent via dgram's
// array form — no concat copy). Each test reads the header from pkt[0] and the
// payload from pkt[1].
test('single small frame → one PUSH packet', () => {
  const bytes = Buffer.from([1,2,3, 4,5,6]);
  const pkts = buildPackets(bytes, { sequence: 5 });
  assert.equal(pkts.length, 1);
  const [h, data] = pkts[0];
  assert.equal(h[0], 0x41);
  assert.equal(h[1], 5);
  assert.equal(h.readUInt32BE(4), 0);
  assert.equal(h.readUInt16BE(8), 6);
  assert.deepEqual([...data], [1,2,3,4,5,6]);
});
test('fragments at 480 pixels (1440 bytes); PUSH only on last', () => {
  const bytes = Buffer.alloc(481 * 3);
  const pkts = buildPackets(bytes, { sequence: 1 });
  assert.equal(pkts.length, 2);
  assert.equal(pkts[0][0][0], 0x40);
  assert.equal(pkts[0][0].readUInt16BE(8), 1440);
  assert.equal(pkts[0][0].readUInt32BE(4), 0);
  assert.equal(pkts[1][0][0], 0x41);
  assert.equal(pkts[1][0].readUInt16BE(8), 3);
  assert.equal(pkts[1][0].readUInt32BE(4), 1440);
});
// Edge cases documenting buildPackets behaviour (not in the required spec):
test('empty buffer → one empty PUSH packet', () => {
  const pkts = buildPackets(Buffer.alloc(0), { sequence: 2 });
  assert.equal(pkts.length, 1);
  assert.equal(pkts[0][0][0], 0x41);          // PUSH set
  assert.equal(pkts[0][0].readUInt16BE(8), 0); // zero-length payload
  assert.equal(pkts[0][0].readUInt32BE(4), 0);
  assert.equal(pkts[0][0].length, 10);        // header only
  assert.equal(pkts[0][1].length, 0);
});
test('exact 1440-byte multiple → no trailing empty packet, PUSH on last', () => {
  const pkts = buildPackets(Buffer.alloc(1440), { sequence: 3 });
  assert.equal(pkts.length, 1);
  assert.equal(pkts[0][0][0], 0x41);          // PUSH on the only/last packet
  assert.equal(pkts[0][0].readUInt16BE(8), 1440);
  const pkts2 = buildPackets(Buffer.alloc(2880), { sequence: 4 });
  assert.equal(pkts2.length, 2);
  assert.equal(pkts2[0][0][0], 0x40);         // first not PUSH
  assert.equal(pkts2[1][0][0], 0x41);         // last PUSH
  assert.equal(pkts2[1][0].readUInt32BE(4), 1440);
  assert.equal(pkts2[1][0].readUInt16BE(8), 1440);
});
