import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChannels, pointStrength, fingerExt, attachFingers } from '../leap-bridge.js';

// Build a fingers array from an extended-flags list [thumb, index, middle, ring, pinky].
const fingers = (ext) => ext.map((e, i) => ({ type: i, extended: e }));

test('pointStrength: index out, ≤1 of the other three out (thumb ignored)', () => {
  assert.equal(pointStrength({ fingers: fingers([false, true, false, false, false]) }), 1);   // index only
  assert.equal(pointStrength({ fingers: fingers([true, true, false, false, false]) }), 1);    // thumb ignored
  assert.equal(pointStrength({ fingers: fingers([false, true, true, false, false]) }), 1);    // one other out → tolerated
  assert.equal(pointStrength({ fingers: fingers([false, true, true, true, false]) }), 0);     // two others out → not a point
  assert.equal(pointStrength({ fingers: fingers([false, false, false, false, false]) }), 0);  // no index → 0
  assert.equal(pointStrength({ fingers: [] }), 0);
});

test('fingerExt: by type, falling back to array order', () => {
  assert.deepEqual(fingerExt({ fingers: [{ type: 1, extended: true }, { type: 3, extended: true }] }),
    [false, true, false, true, false]);
  assert.deepEqual(fingerExt({ fingers: [{ extended: true }, { extended: false }, { extended: true }] }),
    [true, false, true, false, false]);
  assert.deepEqual(fingerExt({}), [false, false, false, false, false]);
});

test('attachFingers: links top-level pointables to hands by handId, without clobbering', () => {
  const frame = { hands: [{ id: 0 }, { id: 1 }], pointables: [{ handId: 0, type: 1 }, { handId: 0, type: 2 }, { handId: 1, type: 1 }] };
  attachFingers(frame);
  assert.equal(frame.hands[0].fingers.length, 2);
  assert.equal(frame.hands[1].fingers.length, 1);

  const kept = { hands: [{ id: 0, fingers: [{ type: 1 }] }], pointables: [{ handId: 0, type: 2 }] };
  attachFingers(kept);
  assert.equal(kept.hands[0].fingers.length, 1);   // existing fingers preserved

  const none = { hands: [{ id: 0 }] };
  attachFingers(none);                             // no pointables → no-op (no throw)
  assert.equal(none.hands[0].fingers, undefined);
});

// --- extractChannels (default calibration) ----------------------------------
const centred = (over = {}) => ({ palmPosition: [0, 225, 0], grabStrength: 0, confidence: 1, fingers: [], ...over });

test('extractChannels: a centred open hand maps to the middle of each axis', () => {
  const out = extractChannels({ hands: [centred()] });
  assert.ok(Math.abs(out['/leap/hand/x'] - 0.5) < 1e-9);
  assert.ok(Math.abs(out['/leap/hand/y'] - 0.5) < 1e-9);   // 225mm in 100..350
  assert.ok(Math.abs(out['/leap/hand/z'] - 0.5) < 1e-9);
  assert.equal(out['/leap/hand/grab'], 0);
  assert.equal(out['/leap/hand/ball'], 0);
  assert.equal(out['/leap/hands'], 0.5);                   // one hand
});

test('extractChannels: confidence gate suppresses the phantom edge fist', () => {
  const confident = extractChannels({ hands: [centred({ grabStrength: 1 })] });
  assert.equal(confident['/leap/hand/ball'], 1);           // real fist → ball

  const edge = extractChannels({ hands: [centred({ grabStrength: 1, confidence: 0.1 })] });
  assert.equal(edge['/leap/hand/grab'], 1);                // raw grab still reported
  assert.equal(edge['/leap/hand/ball'], 0);                // but the gesture is gated off
  assert.equal(edge['/leap/hand/point'], 0);
});

test('extractChannels: an index point drives point AND ball', () => {
  const hand = centred({ fingers: [
    { type: 1, extended: true, direction: [0.2, 0.1, -0.97] },
    { type: 2, extended: false }, { type: 3, extended: false }, { type: 4, extended: false },
  ] });
  const out = extractChannels({ hands: [hand] });
  assert.equal(out['/leap/hand/point'], 1);
  assert.equal(out['/leap/hand/ball'], 1);                 // ball = fist OR point
});

test('extractChannels: no hands relax to neutral (y centred, gestures off)', () => {
  const out = extractChannels({ hands: [] });
  assert.equal(out['/leap/hand/y'], 0.5);
  assert.equal(out['/leap/hand/grab'], 0);
  assert.equal(out['/leap/hand/ball'], 0);
  assert.equal(out['/leap/hands'], 0);
});

test('extractChannels: two hands split into /leap/left and /leap/right', () => {
  const out = extractChannels({ hands: [
    { type: 'left', ...centred() },
    { type: 'right', ...centred() },
  ] });
  assert.ok('/leap/left/x' in out);
  assert.ok('/leap/right/x' in out);
  assert.equal(out['/leap/hands'], 1);                     // two hands
});
