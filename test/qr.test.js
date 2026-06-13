import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rsEncode, qrMatrix } from '../src/ui/qr.js';

// The canonical worked example ("HELLO WORLD", version 1, ECC level M): the 16
// data codewords below produce these 10 error-correction codewords. Matching it
// proves the GF(256) + Reed–Solomon core (the part most likely to be wrong).
test('Reed–Solomon matches the published 1-M reference vector', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('qrMatrix is a square of the right size with finder patterns + timing', () => {
  const m = qrMatrix('http://10.0.0.5:7070/remote/');
  const n = m.length;
  assert.equal((n - 17) % 4, 0);              // n = 17 + 4·version
  assert.ok(n >= 21 && n <= 57);              // versions 1–10
  for (const row of m) assert.equal(row.length, n);
  // Finder pattern: dark ring + dark 3×3 centre at the top-left corner.
  for (let i = 0; i <= 6; i++) { assert.equal(m[0][i], true); assert.equal(m[6][i], true); assert.equal(m[i][0], true); }
  assert.equal(m[1][1], false); assert.equal(m[2][2], true);   // inner ring gap, then centre
  // Separators: the row/col just outside the finder are light.
  assert.equal(m[7][0], false); assert.equal(m[0][7], false);
  // Timing pattern alternates on row/col 6.
  assert.equal(m[6][8], true); assert.equal(m[6][9], false);
});

test('qrMatrix grows the version with the data length', () => {
  const small = qrMatrix('hi').length;
  const big = qrMatrix('x'.repeat(120)).length;
  assert.ok(big > small);
});
