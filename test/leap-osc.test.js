import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseOsc } from '../server/osc.js';

// This Mac has a C compiler; on a host without one both tests skip cleanly.
const hasCC = (() => { try { execFileSync('cc', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// The pure-C unit tests (channels + osc) must pass on their own terms first.
test('leap-osc C unit tests pass', { skip: !hasCC && 'no C compiler' }, () => {
  execFileSync('sh', ['leap/osc/run-tests.sh'], { stdio: 'pipe' });   // non-zero exit = throw
});

// The strongest correctness check: the exact bytes our C encoder emits must
// parse cleanly through the daemon's OWN parser (server/osc.js parseOsc) — the
// same code that receives them in production. parseOsc(buf) → [{ address, value }],
// recursing '#bundle' into a flat array of messages in wire order.
test('leap-osc bundle round-trips through the daemon OSC parser', { skip: !hasCC && 'no C compiler' }, () => {
  // Own binary path (NOT run-tests.sh's /tmp/lo_test_osc) so the two tests can't
  // race on the same file if the suite is run concurrently or shares /tmp.
  execFileSync('cc', ['-std=c99', '-o', '/tmp/lo_emit_osc', 'leap/osc/test_osc.c', 'leap/osc/osc.c', 'leap/osc/channels.c', '-lm']);
  const bundle = execFileSync('/tmp/lo_emit_osc', ['--emit']);   // raw datagram bytes (a Buffer)
  const parsed = parseOsc(bundle);
  assert.deepEqual(parsed.map(m => m.address), ['/leap/hand/x', '/leap/hands']);
  assert.ok(Math.abs(parsed[0].value - 0.25) < 1e-6);
  assert.ok(Math.abs(parsed[1].value - 0.5) < 1e-6);
});
