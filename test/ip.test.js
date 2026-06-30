import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIPv4, nextIPs, fillIPs } from '../src/model/ip.js';

test('isValidIPv4 accepts well-formed addresses', () => {
  assert.equal(isValidIPv4('10.0.0.11'), true);
  assert.equal(isValidIPv4('0.0.0.0'), true);
  assert.equal(isValidIPv4('255.255.255.255'), true);
  assert.equal(isValidIPv4(' 192.168.1.1 '), true); // trims surrounding space
});

test('isValidIPv4 rejects blanks and garbage', () => {
  assert.equal(isValidIPv4(''), false);
  assert.equal(isValidIPv4('   '), false);
  assert.equal(isValidIPv4('10.0.0'), false);       // too few octets
  assert.equal(isValidIPv4('10.0.0.1.2'), false);   // too many octets
  assert.equal(isValidIPv4('10.0.0.256'), false);   // octet out of range
  assert.equal(isValidIPv4('10.0.0.01'), false);    // leading zero
  assert.equal(isValidIPv4('10.0.0.a'), false);     // non-numeric
  assert.equal(isValidIPv4(null), false);
  assert.equal(isValidIPv4(42), false);
});

test('nextIPs fills sequential final octets', () => {
  assert.deepEqual(nextIPs('10.0.0.11', 3), ['10.0.0.11', '10.0.0.12', '10.0.0.13']);
  assert.deepEqual(nextIPs('192.168.1.1', 1), ['192.168.1.1']);
  assert.deepEqual(nextIPs('10.0.0.11', 0), []);
});

test('nextIPs returns null on invalid base or octet overflow', () => {
  assert.equal(nextIPs('nope', 2), null);
  assert.equal(nextIPs('10.0.0.254', 3), null); // 254,255,256 → overflow
  assert.equal(nextIPs('10.0.0.11', -1), null);
});

test('fillIPs fills what fits and reports the count', () => {
  assert.deepEqual(fillIPs('10.0.0.11', 3), { ips: ['10.0.0.11', '10.0.0.12', '10.0.0.13'], filled: 3 });
  // ran out of final-octet room: only 254 and 255 fit
  assert.deepEqual(fillIPs('10.0.0.254', 4), { ips: ['10.0.0.254', '10.0.0.255'], filled: 2 });
  assert.deepEqual(fillIPs('10.0.0.255', 3), { ips: ['10.0.0.255'], filled: 1 });
  assert.deepEqual(fillIPs('10.0.0.11', 0), { ips: [], filled: 0 });
});

test('fillIPs returns null only on invalid base', () => {
  assert.equal(fillIPs('nope', 2), null);
  assert.equal(fillIPs('10.0.0.11', -1), null);
});
