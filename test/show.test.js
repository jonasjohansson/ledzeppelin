import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyShow, addDevice, addFixture, validate, deviceByteRange } from '../src/model/show.js';

test('valid minimal show passes validation', () => {
  let s = emptyShow();
  s = addDevice(s, { id: 'c1', name: 'DQ1', ip: '10.0.0.11' });
  s = addFixture(s, { id: 't1', name: 'T1', pixelCount: 300, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 0, pixelCount: 300 },
    input: { points: [[0.1,0.2],[0.1,0.8]], samples: 300 } });
  assert.equal(validate(s).ok, true);
});

test('fixture referencing unknown device fails', () => {
  let s = addFixture(emptyShow(), { id: 't1', name: 'T1', pixelCount: 10, colorOrder: 'GRB',
    output: { deviceId: 'nope', pixelOffset: 0, pixelCount: 10 }, input: { points: [[0,0],[1,1]], samples: 10 } });
  const r = validate(s);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /unknown device/);
});

test('non-zero starting pixel offset fails contiguity validation', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: 'x' });
  s = addFixture(s, { id: 't1', name: 'T1', pixelCount: 150, colorOrder: 'GRB',
    output: { deviceId: 'c1', pixelOffset: 150, pixelCount: 150 },
    input: { points: [[0,0],[1,1]], samples: 150 } });
  const r = validate(s);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /must start at 0 and be contiguous/);
});

test('deviceByteRange spans all fixtures on a device', () => {
  let s = addDevice(emptyShow(), { id: 'c1', name: 'DQ1', ip: 'x' });
  s = addFixture(s, { id: 'a', name:'a', pixelCount:300, colorOrder:'GRB',
    output:{deviceId:'c1',pixelOffset:0,pixelCount:300}, input:{points:[[0,0],[0,1]],samples:300} });
  s = addFixture(s, { id: 'b', name:'b', pixelCount:240, colorOrder:'GRB',
    output:{deviceId:'c1',pixelOffset:300,pixelCount:240}, input:{points:[[0,0],[0,1]],samples:240} });
  assert.deepEqual(deviceByteRange(s, 'c1'), { byteStart: 0, byteEnd: 540*3 });
});
