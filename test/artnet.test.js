import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtnetPackets, buildArtnetSync, nextSequence, ARTNET_PORT } from '../server/artnet.js';
// buildArtnetPackets returns GATHER LISTS [header(18B), chunk] like ddp.js —
// each test reads the header from pkt[0] and the DMX payload from pkt[1].
test('ArtDmx header bytes are exact (universe 0)', () => {
  const bytes = Buffer.from([1, 2, 3, 4, 5, 6]);
  const pkts = buildArtnetPackets(bytes, { startUniverse: 0, sequence: 7 });
  assert.equal(pkts.length, 1);
  const [h, data] = pkts[0];
  assert.equal(h.length, 18);
  assert.equal(h.toString('ascii', 0, 8), 'Art-Net\0');
  assert.equal(h[8], 0x00); assert.equal(h[9], 0x50);    // OpCode 0x5000 LE
  assert.equal(h[10], 0x00); assert.equal(h[11], 0x0e);  // ProtVer 14 BE
  assert.equal(h[12], 7);                                 // Sequence
  assert.equal(h[13], 0);                                 // Physical
  assert.equal(h[14], 0); assert.equal(h[15], 0);         // SubUni / Net
  assert.equal(h.readUInt16BE(16), 6);                    // Length BE
  assert.deepEqual([...data], [1, 2, 3, 4, 5, 6]);
});
test('SubUni/Net split the 15-bit port-address (universes 255 and 256)', () => {
  const one = Buffer.alloc(3);
  const u255 = buildArtnetPackets(one, { startUniverse: 255 })[0][0];
  assert.equal(u255[14], 0xff);   // SubUni = 255 & 0xff
  assert.equal(u255[15], 0x00);   // Net = 255 >> 8
  const u256 = buildArtnetPackets(one, { startUniverse: 256 })[0][0];
  assert.equal(u256[14], 0x00);   // SubUni = 256 & 0xff
  assert.equal(u256[15], 0x01);   // Net = 256 >> 8
});
test('170-px universes: 768 px device → 5 packets 170/170/170/170/88', () => {
  const bytes = Buffer.alloc(768 * 3);
  const pkts = buildArtnetPackets(bytes, { startUniverse: 4, sequence: 1 });
  assert.equal(pkts.length, 5);
  const lens = pkts.map(([h]) => h.readUInt16BE(16));
  assert.deepEqual(lens, [510, 510, 510, 510, 88 * 3]);
  // consecutive universes from the base
  assert.deepEqual(pkts.map(([h]) => h[14]), [4, 5, 6, 7, 8]);
  assert.deepEqual(pkts.map(([h]) => h[15]), [0, 0, 0, 0, 0]);
});
test('odd final chunk is padded by one zero byte (Length stays even)', () => {
  // 171 px = 513 bytes → 510 + 3; the 3-byte tail pads to 4.
  const bytes = Buffer.alloc(171 * 3, 9);
  const pkts = buildArtnetPackets(bytes, { startUniverse: 0 });
  assert.equal(pkts.length, 2);
  assert.equal(pkts[1][0].readUInt16BE(16), 4);
  assert.deepEqual([...pkts[1][1]], [9, 9, 9, 0]);   // pad byte is zero
});
test('chunks are subarray views of the input (no copy), except a padded tail', () => {
  const bytes = Buffer.alloc(768 * 3);
  const pkts = buildArtnetPackets(bytes, { startUniverse: 0 });
  for (const [, chunk] of pkts) {
    assert.equal(chunk.buffer, bytes.buffer);   // shares backing store
  }
  assert.equal(pkts[1][1].byteOffset, bytes.byteOffset + 510);
});
test('sequence helper rolls 1..255 and skips 0', () => {
  assert.equal(nextSequence(0), 1);     // first frame / "disabled" → 1
  assert.equal(nextSequence(1), 2);
  assert.equal(nextSequence(254), 255);
  assert.equal(nextSequence(255), 1);   // wrap, never 0
});
test('port constant is 6454', () => {
  assert.equal(ARTNET_PORT, 6454);
});
test('buildArtnetSync is a valid 14-byte OpSync packet', () => {
  const s = buildArtnetSync();
  assert.equal(s.length, 14);
  assert.equal(s.subarray(0, 7).toString('ascii'), 'Art-Net');
  assert.equal(s[8], 0x00); assert.equal(s[9], 0x52);   // OpSync 0x5200, little-endian
  assert.equal(s[10], 0x00); assert.equal(s[11], 0x0e); // ProtVer 14, big-endian
  assert.equal(s[12], 0); assert.equal(s[13], 0);        // Aux1 / Aux2
});
