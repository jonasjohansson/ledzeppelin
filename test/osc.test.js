import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOsc } from '../server/osc.js';

// --- hand-built OSC packets (the parser's wire format, byte by byte) --------

// An OSC string: ascii + NUL, padded to a 4-byte boundary.
function oscStr(s) {
  const len = Math.floor(s.length / 4 + 1) * 4;
  const b = Buffer.alloc(len);
  b.write(s, 'ascii');
  return b;
}
function f32(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); return b; }
function i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; }
function msg(address, tags, ...args) {
  return Buffer.concat([oscStr(address), oscStr(tags), ...args]);
}
function bundle(...elements) {
  const parts = [oscStr('#bundle'), Buffer.alloc(8)];   // immediate timetag
  for (const e of elements) parts.push(i32(e.length), e);
  return Buffer.concat(parts);
}

test('parses a message with a float argument', () => {
  const out = parseOsc(msg('/speed', ',f', f32(0.7)));
  assert.equal(out.length, 1);
  assert.equal(out[0].address, '/speed');
  assert.ok(Math.abs(out[0].value - 0.7) < 1e-6);
});

test('parses a message with an int argument', () => {
  assert.deepEqual(parseOsc(msg('/fader/3', ',i', i32(42))), [{ address: '/fader/3', value: 42 }]);
});

test('parses a double argument', () => {
  const d = Buffer.alloc(8); d.writeDoubleBE(0.25);
  assert.deepEqual(parseOsc(msg('/x', ',d', d)), [{ address: '/x', value: 0.25 }]);
});

test('skips non-numeric arguments to reach the first numeric one', () => {
  const out = parseOsc(msg('/mix', ',sf', oscStr('label'), f32(0.5)));
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].value - 0.5) < 1e-6);
});

test('a message with no numeric argument yields nothing', () => {
  assert.deepEqual(parseOsc(msg('/name', ',s', oscStr('hello'))), []);
});

test('parses a #bundle of two messages', () => {
  const out = parseOsc(bundle(msg('/a', ',f', f32(0.1)), msg('/b', ',i', i32(2))));
  assert.equal(out.length, 2);
  assert.equal(out[0].address, '/a');
  assert.ok(Math.abs(out[0].value - 0.1) < 1e-6);
  assert.deepEqual(out[1], { address: '/b', value: 2 });
});

test('handles nested bundles (bundle in a bundle)', () => {
  const inner = bundle(msg('/deep', ',f', f32(1)));
  const out = parseOsc(bundle(inner, msg('/flat', ',i', i32(3))));
  assert.deepEqual(out.map((m) => m.address), ['/deep', '/flat']);
});

test('junk and truncated packets parse to []', () => {
  assert.deepEqual(parseOsc(Buffer.from('not osc at all')), []);
  assert.deepEqual(parseOsc(Buffer.alloc(0)), []);
  assert.deepEqual(parseOsc(null), []);
  assert.deepEqual(parseOsc(msg('/cut', ',f')), []);                    // missing arg bytes
  assert.deepEqual(parseOsc(oscStr('/no-typetags')), []);               // no ',' tag string
  assert.deepEqual(parseOsc(Buffer.concat([oscStr('#bundle'), Buffer.alloc(2)])), []);  // truncated bundle
});
