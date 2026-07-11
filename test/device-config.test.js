import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deviceOutputConfig } from '../src/model/show.js';

// "Save to device" builds a DENSE per-output array indexed by the fixture's
// 0-based output port (port = WLED bus index). pushConfig writes outs[i] → bus i,
// so the port-0 fixture MUST be counted and port N MUST land in outs[N] — no
// off-by-one, no dropped port-0 (the bug this fixes).

const fx = (id, port, pixelCount, deviceId = 'd1') => ({ id, pixelCount, output: { deviceId, port } });

test('deviceOutputConfig sums a port-0 fixture and maps each port to its own bus', () => {
  // Balena-style 0-based layout: two fixtures share port 0 (the bug dropped these).
  const fixtures = [
    fx('tail', 0, 204),
    fx('rib1', 1, 42),
    fx('rib4', 0, 60),   // second fixture ALSO on bus 0 → must add to outs[0]
    fx('rib5', 3, 72),
  ];
  const outs = deviceOutputConfig(fixtures, 'd1', 4, 'GRB');
  assert.equal(outs.length, 4);                         // one slot per WLED bus
  assert.equal(outs[0].len, 264);                       // 204 + 60 — port-0 IS counted
  assert.equal(outs[1].len, 42);
  assert.equal(outs[2].len, 0);                         // unused bus → length 0
  assert.equal(outs[3].len, 72);                        // port 3 → outs[3], not outs[2]
  assert.equal(outs[0].order, 'GRB');
});

test('deviceOutputConfig only counts the given device and ignores out-of-range ports', () => {
  const fixtures = [
    fx('a', 0, 100, 'd1'),
    fx('b', 0, 999, 'd2'),   // other device — excluded
    fx('c', 9, 50, 'd1'),    // port beyond nOut → ignored (not clamped into a bus)
  ];
  const outs = deviceOutputConfig(fixtures, 'd1', 4);
  assert.equal(outs[0].len, 100);
  assert.deepEqual(outs.map((o) => o.len), [100, 0, 0, 0]);
});

test('deviceOutputConfig matches the real balena preset per DigOcta (8 buses, 0-based)', () => {
  const path = fileURLToPath(new URL('../examples/projects/balena-voladora.json', import.meta.url));
  const show = JSON.parse(readFileSync(path, 'utf8'));
  const oct = show.devices.find((d) => d.id === 'oct110');
  const nOut = (show.deviceTypes.find((m) => m.id === oct.typeId)?.outputs) ?? oct.outputs;
  assert.equal(nOut, 8);
  const outs = deviceOutputConfig(show.fixtures, 'oct110', nOut, oct.colorOrder || 'GRB');
  // Independent recompute of the expected per-bus sums straight from the preset.
  const expect = Array.from({ length: nOut }, () => 0);
  for (const f of show.fixtures) {
    if ((f.output?.deviceId || '') !== 'oct110') continue;
    expect[f.output.port] += f.pixelCount || 0;
  }
  assert.deepEqual(outs.map((o) => o.len), expect);
  // The Tail (port 0) must contribute — the exact bug: port-0 pixels were dropped.
  assert.ok(outs[0].len > 0, 'bus 0 must carry the port-0 fixtures');
});
