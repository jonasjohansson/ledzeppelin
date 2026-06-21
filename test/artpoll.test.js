import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directedBroadcast } from '../server/artpoll.js';

test('directedBroadcast: host bits from the real netmask', () => {
  assert.equal(directedBroadcast('192.168.1.50', '255.255.255.0'), '192.168.1.255');   // /24
  assert.equal(directedBroadcast('10.5.6.7', '255.0.0.0'), '10.255.255.255');          // /8 (issue #1 network)
  assert.equal(directedBroadcast('172.16.4.9', '255.255.0.0'), '172.16.255.255');      // /16
  assert.equal(directedBroadcast('10.0.0.1', '255.255.255.128'), '10.0.0.127');        // /25
});

test('directedBroadcast: bad input → null', () => {
  assert.equal(directedBroadcast('nope', '255.0.0.0'), null);
  assert.equal(directedBroadcast('10.0.0.1', '255.255.0'), null);
  assert.equal(directedBroadcast('10.0.0.999', '255.0.0.0'), null);
});
