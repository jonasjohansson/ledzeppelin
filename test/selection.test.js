import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldState, applyField } from '../src/model/selection.js';

test('fieldState: shared value', () => {
  assert.deepEqual(fieldState([{ a: 5 }, { a: 5 }], 'a'), { value: 5, mixed: false });
});
test('fieldState: mixed value', () => {
  assert.deepEqual(fieldState([{ a: 5 }, { a: 9 }], 'a'), { value: undefined, mixed: true });
});
test('fieldState: empty selection', () => {
  assert.deepEqual(fieldState([], 'a'), { value: undefined, mixed: false });
});
test('fieldState: single item', () => {
  assert.deepEqual(fieldState([{ a: 'x' }], 'a'), { value: 'x', mixed: false });
});
test('fieldState: dotted key', () => {
  assert.deepEqual(fieldState([{ output: { port: 1 } }, { output: { port: 1 } }], 'output.port'), { value: 1, mixed: false });
});
test('fieldState: dotted key mixed', () => {
  assert.deepEqual(fieldState([{ output: { port: 1 } }, { output: { port: 2 } }], 'output.port'), { value: undefined, mixed: true });
});
test('fieldState: missing key reads undefined (shared)', () => {
  assert.deepEqual(fieldState([{}, {}], 'a'), { value: undefined, mixed: false });
});
test('fieldState: one item lacks the key is mixed', () => {
  assert.deepEqual(fieldState([{ a: 5 }, {}], 'a'), { value: undefined, mixed: true });
});
test('fieldState: dotted path through missing intermediate is undefined', () => {
  assert.deepEqual(fieldState([{ output: { port: 1 } }, {}], 'output.port'), { value: undefined, mixed: true });
});
test('fieldState: false and 0 distinguished (strict)', () => {
  assert.deepEqual(fieldState([{ a: false }, { a: 0 }], 'a'), { value: undefined, mixed: true });
  assert.deepEqual(fieldState([{ a: false }, { a: false }], 'a'), { value: false, mixed: false });
});

test('applyField writes to all', () => {
  assert.deepEqual(applyField([{ a: 1 }, { a: 2 }], 'a', 7), [{ a: 7 }, { a: 7 }]);
});
test('applyField does not mutate inputs (shallow key)', () => {
  const input = [{ a: 1 }];
  const out = applyField(input, 'a', 7);
  assert.equal(input[0].a, 1);
  assert.notEqual(out, input);
  assert.notEqual(out[0], input[0]);
});
test('applyField dotted path is immutable', () => {
  const input = [{ output: { port: 1, deviceId: 'c1' } }];
  const out = applyField(input, 'output.port', 3);
  assert.equal(out[0].output.port, 3);
  assert.equal(out[0].output.deviceId, 'c1');     // sibling preserved
  assert.equal(input[0].output.port, 1);          // original untouched
  assert.notEqual(out[0].output, input[0].output); // fresh nested object
});
test('applyField creates missing intermediate objects', () => {
  const input = [{ name: 'x' }];
  const out = applyField(input, 'output.port', 5);
  assert.deepEqual(out, [{ name: 'x', output: { port: 5 } }]);
  assert.equal(input[0].output, undefined);
});
test('applyField empty selection returns empty array', () => {
  assert.deepEqual(applyField([], 'a', 7), []);
});
