import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveParams, resetTakeover, makeExternalAnim } from '../src/model/anim.js';

// External soft-takeover: a channel only drives the param WHILE MOVING; a held
// channel yields to a direct write (the phone/slider). This is the phone↔MIDI
// anti-flicker fix.
const ext = { x: makeExternalAnim(0, 1, 'cc1', 1) };   // value = signals.cc1
const frame = (params, signals) => resolveParams(params, ext, 0, signals, 'L1').x;

test('a STATIC external channel does not override a direct write (no flicker)', () => {
  resetTakeover();
  // Phone holds x=0.3; MIDI cc1 sits at 0.8 but isn't moving.
  assert.equal(frame({ x: 0.3 }, { cc1: 0.8 }), 0.3);   // pickup: must move to grab
  assert.equal(frame({ x: 0.3 }, { cc1: 0.8 }), 0.3);   // still held → base wins (no fight)
});

test('a MOVING external channel takes over, then HOLDS its value', () => {
  resetTakeover();
  frame({ x: 0.3 }, { cc1: 0.8 });                       // seed
  assert.equal(frame({ x: 0.3 }, { cc1: 0.9 }), 0.9);    // moved → ext owns
  assert.equal(frame({ x: 0.3 }, { cc1: 0.9 }), 0.9);    // idle → holds (no revert to base)
});

test('a direct write reclaims ownership from a held channel', () => {
  resetTakeover();
  frame({ x: 0.3 }, { cc1: 0.8 });
  frame({ x: 0.3 }, { cc1: 0.9 });                       // ext owns (0.9)
  assert.equal(frame({ x: 0.2 }, { cc1: 0.9 }), 0.2);    // phone wrote 0.2, MIDI idle → phone wins
  assert.equal(frame({ x: 0.5 }, { cc1: 0.9 }), 0.5);    // phone keeps moving → phone
  assert.equal(frame({ x: 0.5 }, { cc1: 0.4 }), 0.4);    // MIDI moves again → MIDI reclaims
});

test('without an instanceKey, behaviour is the simple legacy rule', () => {
  resetTakeover();
  // No instanceKey → live channel wins; absent channel rests at base.
  assert.equal(resolveParams({ x: 0.3 }, ext, 0, { cc1: 0.8 }).x, 0.8);
  assert.equal(resolveParams({ x: 0.3 }, ext, 0, {}).x, 0.3);
});
