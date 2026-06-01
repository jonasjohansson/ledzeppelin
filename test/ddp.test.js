import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackets } from '../server/ddp.js';
test('single small frame → one PUSH packet', () => {
  const bytes = Buffer.from([1,2,3, 4,5,6]);
  const pkts = buildPackets(bytes, { sequence: 5 });
  assert.equal(pkts.length, 1);
  const p = pkts[0];
  assert.equal(p[0], 0x41);
  assert.equal(p[1], 5);
  assert.equal(p.readUInt32BE(4), 0);
  assert.equal(p.readUInt16BE(8), 6);
  assert.deepEqual([...p.subarray(10)], [1,2,3,4,5,6]);
});
test('fragments at 480 pixels (1440 bytes); PUSH only on last', () => {
  const bytes = Buffer.alloc(481 * 3);
  const pkts = buildPackets(bytes, { sequence: 1 });
  assert.equal(pkts.length, 2);
  assert.equal(pkts[0][0], 0x40);
  assert.equal(pkts[0].readUInt16BE(8), 1440);
  assert.equal(pkts[0].readUInt32BE(4), 0);
  assert.equal(pkts[1][0], 0x41);
  assert.equal(pkts[1].readUInt16BE(8), 3);
  assert.equal(pkts[1].readUInt32BE(4), 1440);
});
// Edge cases documenting buildPackets behaviour (not in the required spec):
test('empty buffer → one empty PUSH packet', () => {
  const pkts = buildPackets(Buffer.alloc(0), { sequence: 2 });
  assert.equal(pkts.length, 1);
  assert.equal(pkts[0][0], 0x41);       // PUSH set
  assert.equal(pkts[0].readUInt16BE(8), 0); // zero-length payload
  assert.equal(pkts[0].readUInt32BE(4), 0);
  assert.equal(pkts[0].length, 10);     // header only
});
test('exact 1440-byte multiple → no trailing empty packet, PUSH on last', () => {
  const pkts = buildPackets(Buffer.alloc(1440), { sequence: 3 });
  assert.equal(pkts.length, 1);
  assert.equal(pkts[0][0], 0x41);       // PUSH on the only/last packet
  assert.equal(pkts[0].readUInt16BE(8), 1440);
  const pkts2 = buildPackets(Buffer.alloc(2880), { sequence: 4 });
  assert.equal(pkts2.length, 2);
  assert.equal(pkts2[0][0], 0x40);      // first not PUSH
  assert.equal(pkts2[1][0], 0x41);      // last PUSH
  assert.equal(pkts2[1].readUInt32BE(4), 1440);
  assert.equal(pkts2[1].readUInt16BE(8), 1440);
});
