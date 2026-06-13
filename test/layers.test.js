import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prefixedDefaults, normalizeComposition,
  makeClip, addClip, removeClip, moveClip, moveClipToLayer, setActiveClip,
  changeClipGenerator, setClipParam,
  setClipTransform, setClipOpacity, setClipDuration, playheadClip,
  addClipEffect, removeClipEffect, moveClipEffect,
  makeLayer, addLayer, removeLayer, moveLayer, patchLayer,
  setLayerParam, addLayerEffect, removeLayerEffect, moveLayerEffect,
  clampCanvasSize, setCanvasSize, CANVAS_MIN, CANVAS_MAX, CANVAS_PRESETS,
} from '../src/model/layers.js';

// --- prefixedDefaults (unchanged) ---
test('prefixedDefaults namespaces keys with the entry name', () => {
  assert.deepEqual(prefixedDefaults('line'),
    { 'line.pos': 0.5, 'line.width': 0.08, 'line.angle': 90, 'line.speed': 1, 'line.amp': 0.5 });
});

// --- migration: normalizeComposition ---
function oldShow() {
  return {
    version: 1, devices: [], fixtures: [],
    composition: {
      canvas: { w: 1280, h: 720 },
      layers: [
        { id: 'l1', generator: 'line', effects: ['displace'], blend: 'add', opacity: 1,
          params: { 'line.pos': 0.9, 'displace.amt': 0.3 } },
      ],
    },
  };
}

test('normalizeComposition upgrades an OLD-shape layer to a one-clip layer', () => {
  const out = normalizeComposition(oldShow());
  const layer = out.composition.layers[0];
  // layer-level shape
  assert.equal(layer.id, 'l1');
  assert.equal(layer.blend, 'alpha');
  assert.equal(layer.opacity, 1);
  assert.deepEqual(layer.effects, []);          // layer effects empty
  assert.deepEqual(layer.params, {});           // layer params empty
  assert.equal(layer.transitionMs, 500);        // default crossfade
  assert.equal(typeof layer.name, 'string');
  assert.ok(!('generator' in layer));           // old keys removed from layer
  // clip carries the old generator/params/effects
  assert.equal(layer.clips.length, 1);
  const clip = layer.clips[0];
  assert.equal(clip.generator, 'line');
  assert.deepEqual(clip.effects, ['displace']);
  assert.equal(clip.params['line.pos'], 0.9);
  assert.equal(clip.params['displace.amt'], 0.3);
  assert.equal(layer.activeClipId, clip.id);
});

test('normalizeComposition migrates legacy add→alpha once, then respects explicit add', () => {
  // First load (no blendV2): the legacy default 'add' flips to 'alpha'.
  const once = normalizeComposition(oldShow());
  assert.equal(once.composition.layers[0].blend, 'alpha');
  assert.equal(once.composition.blendV2, true);
  // After migration, a deliberate 'add' is preserved (not re-flipped).
  const setAdd = { ...once, composition: { ...once.composition,
    layers: once.composition.layers.map((l) => ({ ...l, blend: 'add' })) } };
  const again = normalizeComposition(setAdd);
  assert.equal(again.composition.layers[0].blend, 'add');
  // Other explicit modes are never touched, migrated or not.
  const screen = normalizeComposition({ composition: { layers: [
    { id: 'l1', blend: 'screen', clips: [{ id: 'c1', generator: 'line' }] }] } });
  assert.equal(screen.composition.layers[0].blend, 'screen');
});

test('normalizeComposition is idempotent (twice == once)', () => {
  const once = normalizeComposition(oldShow());
  const twice = normalizeComposition(once);
  assert.deepEqual(twice, once);
});

test('normalizeComposition preserves clip + layer per-param animations (no data loss on reload)', () => {
  const clipAnim = { 'line.pos': { mode: 'timeline', from: 0, to: 1, durationMs: 10000, direction: 'forward' } };
  const layerAnim = { 'hue.shift': { mode: 'audio', from: 0, to: 1, band: 'bass', gain: 2 } };
  const show = {
    version: 1, devices: [], fixtures: [],
    composition: { canvas: { w: 1280, h: 720 }, layers: [{
      id: 'l1', activeClipId: 'c1', effects: ['hue'], anim: layerAnim,
      clips: [{ id: 'c1', generator: 'line', anim: clipAnim }],
    }] },
  };
  const out = normalizeComposition(show);
  assert.deepEqual(out.composition.layers[0].clips[0].anim, clipAnim);
  assert.deepEqual(out.composition.layers[0].anim, layerAnim);
});

test('normalizeComposition ensures canvas + fills clip-layer defaults', () => {
  const show = {
    version: 1, devices: [], fixtures: [],
    composition: { layers: [{ id: 'l1', clips: [{ id: 'c1', generator: 'line' }] }] },
  };
  const out = normalizeComposition(show);
  assert.deepEqual(out.composition.canvas, { w: 1280, h: 720 });
  const layer = out.composition.layers[0];
  assert.equal(layer.activeClipId, 'c1');       // first clip
  assert.deepEqual(layer.effects, []);
  assert.deepEqual(layer.params, {});
  assert.equal(layer.transitionMs, 500);
  assert.equal(typeof layer.name, 'string');
  // clip gets default params/effects/name filled
  assert.deepEqual(out.composition.layers[0].clips[0].effects, []);
  assert.deepEqual(out.composition.layers[0].clips[0].params, {});
});

test('normalizeComposition is safe on an empty composition', () => {
  const out = normalizeComposition({ composition: { layers: [] } });
  assert.deepEqual(out.composition.layers, []);
  assert.deepEqual(out.composition.canvas, { w: 1280, h: 720 });
});

test('normalizeComposition repairs a dangling activeClipId', () => {
  const out = normalizeComposition({ composition: { layers: [
    { id: 'l1', clips: [{ id: 'k1', generator: 'line' }], activeClipId: 'gone' },
  ] } });
  assert.equal(out.composition.layers[0].activeClipId, 'k1');
});

test('normalizeComposition does not mutate the input', () => {
  const inp = oldShow();
  const snapshot = structuredClone(inp);
  normalizeComposition(inp);
  assert.deepEqual(inp, snapshot);
});

// --- helper to get a fresh normalized show with one layer ---
function freshShow() {
  return normalizeComposition({ composition: { canvas: { w: 1280, h: 720 }, layers: [] } });
}

// --- makeClip ---
test('makeClip seeds prefixed generator params, empty effects', () => {
  const c = makeClip('line');
  assert.equal(c.generator, 'line');
  assert.deepEqual(c.effects, []);
  assert.equal(c.params['line.pos'], 0.5);
  assert.equal(typeof c.id, 'string');
  assert.equal(typeof c.name, 'string');
});

// --- addLayer creates an EMPTY new-shape layer, inserted at the bottom ---
test('addLayer creates an empty new-shape layer (bottom of stack)', () => {
  const show = freshShow();
  const next = addLayer(show);
  assert.equal(show.composition.layers.length, 0);   // immutable
  assert.equal(next.composition.layers.length, 1);
  const layer = next.composition.layers[0];
  assert.equal(layer.blend, 'alpha');
  assert.equal(layer.opacity, 1);
  assert.equal(layer.transitionMs, 500);
  assert.deepEqual(layer.effects, []);
  assert.deepEqual(layer.params, {});
  assert.deepEqual(layer.clips, []);          // EMPTY — no clips
  assert.equal(layer.activeClipId, null);     // nothing active
});

// adding a second layer prepends it (new layer goes UNDERNEATH = array index 0)
test('addLayer prepends (new layer at the bottom)', () => {
  let show = freshShow();
  show = addLayer(show);
  const firstId = show.composition.layers[0].id;
  show = addLayer(show);
  assert.equal(show.composition.layers.length, 2);
  assert.equal(show.composition.layers[1].id, firstId);   // original pushed up
});

// Helper: a layer holding one active clip (clip ops fixtures use this, since
// addLayer now makes an EMPTY layer).
function deckShow(gen = 'line') {
  const base = freshShow();
  const withLayer = addLayer(base);
  const lid = withLayer.composition.layers[0].id;
  return addClip(withLayer, lid, gen);
}

// --- addClip / removeClip / setActiveClip ---
test('addClip appends; becomes active if none was active', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  show = addClip(show, lid, 'gradient');
  const layer = show.composition.layers[0];
  assert.equal(layer.clips.length, 2);
  assert.equal(layer.clips[1].generator, 'gradient');
  // first clip stays active (there was an active clip already)
  assert.equal(layer.activeClipId, layer.clips[0].id);
});

test('addClip becomes active when layer had no active clip', () => {
  let show = deckShow();
  let lid = show.composition.layers[0].id;
  // force no active clip
  show = setActiveClip(show, lid, null);
  show = addClip(show, lid, 'gradient');
  const layer = show.composition.layers[0];
  assert.equal(layer.activeClipId, layer.clips[layer.clips.length - 1].id);
});

test('removeClip reassigns activeClipId when removing the active clip', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  show = addClip(show, lid, 'gradient');
  const activeId = show.composition.layers[0].activeClipId;
  show = removeClip(show, lid, activeId);
  const layer = show.composition.layers[0];
  assert.equal(layer.clips.length, 1);
  assert.equal(layer.activeClipId, layer.clips[0].id);  // reassigned to survivor
  assert.notEqual(layer.activeClipId, activeId);
});

test('removeClip on last clip → activeClipId null, no crash', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  const onlyId = show.composition.layers[0].clips[0].id;
  show = removeClip(show, lid, onlyId);
  const layer = show.composition.layers[0];
  assert.deepEqual(layer.clips, []);
  assert.equal(layer.activeClipId, null);
});

test('setActiveClip sets the target', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  show = addClip(show, lid, 'gradient');
  const target = show.composition.layers[0].clips[1].id;
  show = setActiveClip(show, lid, target);
  assert.equal(show.composition.layers[0].activeClipId, target);
});

test('moveClip reorders within the deck, bounds-safe', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  show = addClip(show, lid, 'gradient');
  show = addClip(show, lid, 'solid');
  const ids = show.composition.layers[0].clips.map((c) => c.id);
  const moved = moveClip(show, lid, ids[0], +1);
  assert.deepEqual(moved.composition.layers[0].clips.map((c) => c.id),
    [ids[1], ids[0], ids[2]]);
  // out-of-range → unchanged reference
  assert.equal(moveClip(show, lid, ids[0], -1), show);
});

// --- moveClipToLayer (cross-layer drag) ---
function twoLayerShow() {
  let show = deckShow('line');                 // layer A with 1 clip
  show = addLayer(show);                        // a second layer prepended/appended
  return show;
}

// A = the layer that owns the original clip; B = the other (empty) layer.
// addLayer prepends, so don't assume array order — pick by content.
const splitAB = (show) => {
  const A = show.composition.layers.find((l) => (l.clips || []).length);
  const B = show.composition.layers.find((l) => l.id !== A.id);
  return [A, B];
};

test('moveClipToLayer moves a clip across layers, inserting at the target slot', () => {
  let show = twoLayerShow();
  let [A, B] = splitAB(show);
  show = addClip(show, B.id, 'gradient');       // B now has 1 clip
  const movingId = A.clips[0].id;
  const bClips0 = show.composition.layers.find((l) => l.id === B.id).clips.map((c) => c.id);
  const next = moveClipToLayer(show, A.id, movingId, B.id, 0);  // insert at index 0 of B
  const a = next.composition.layers.find((l) => l.id === A.id);
  const b = next.composition.layers.find((l) => l.id === B.id);
  assert.equal(a.clips.find((c) => c.id === movingId), undefined);   // gone from A
  assert.deepEqual(b.clips.map((c) => c.id), [movingId, bClips0[0]]);  // landed at slot 0
});

test('moveClipToLayer reassigns the source active clip and activates in the destination', () => {
  let show = twoLayerShow();
  let [A, B] = splitAB(show);
  show = addClip(show, A.id, 'gradient');       // A has 2 clips; first is active
  const movingId = show.composition.layers.find((l) => l.id === A.id).activeClipId;
  const next = moveClipToLayer(show, A.id, movingId, B.id, -1);  // append to B
  const a = next.composition.layers.find((l) => l.id === A.id);
  const b = next.composition.layers.find((l) => l.id === B.id);
  assert.notEqual(a.activeClipId, movingId);    // A's active fell back to a survivor
  assert.equal(b.activeClipId, movingId);       // it was active in A → active in B
  assert.equal(b.clips[b.clips.length - 1].id, movingId);  // appended
});

test('moveClipToLayer with same source and target is a plain reorder', () => {
  let show = deckShow('line');
  const lid = show.composition.layers[0].id;
  show = addClip(show, lid, 'gradient');
  show = addClip(show, lid, 'solid');
  const ids = show.composition.layers[0].clips.map((c) => c.id);
  const next = moveClipToLayer(show, lid, ids[2], lid, 0);   // move last to front
  assert.deepEqual(next.composition.layers[0].clips.map((c) => c.id), [ids[2], ids[0], ids[1]]);
});

test('moveClipToLayer on an unknown clip returns the same show', () => {
  const show = twoLayerShow();
  const [A, B] = show.composition.layers;
  assert.equal(moveClipToLayer(show, A.id, 'nope', B.id, 0), show);
});

// --- changeClipGenerator ---
test('changeClipGenerator resets generator params, keeps clip effect params', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  const cid = show.composition.layers[0].clips[0].id;
  show = addClipEffect(show, lid, cid, 'displace');
  show = setClipParam(show, lid, cid, 'displace.amt', 0.7);
  show = changeClipGenerator(show, lid, cid, 'gradient');
  const clip = show.composition.layers[0].clips[0];
  assert.equal(clip.generator, 'gradient');
  assert.equal(clip.params['gradient.angle'], 0);     // new gen default seeded
  assert.equal(clip.params['line.pos'], undefined);   // old gen params dropped
  assert.equal(clip.params['displace.amt'], 0.7);     // clip effect params kept
});

// --- clip effect chain ---
test('addClipEffect seeds defaults; removeClipEffect drops orphan params', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  const cid = show.composition.layers[0].clips[0].id;
  show = addClipEffect(show, lid, cid, 'displace');
  assert.deepEqual(show.composition.layers[0].clips[0].effects, ['displace']);
  assert.equal(show.composition.layers[0].clips[0].params['displace.amt'], 0.2);
  show = removeClipEffect(show, lid, cid, 0);
  assert.deepEqual(show.composition.layers[0].clips[0].effects, []);
  assert.equal(show.composition.layers[0].clips[0].params['displace.amt'], undefined);
});

test('removeClipEffect keeps params when a duplicate effect remains', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  const cid = show.composition.layers[0].clips[0].id;
  show = addClipEffect(show, lid, cid, 'displace');
  show = addClipEffect(show, lid, cid, 'displace');
  show = removeClipEffect(show, lid, cid, 0);
  assert.deepEqual(show.composition.layers[0].clips[0].effects, ['displace']);
  assert.equal(show.composition.layers[0].clips[0].params['displace.amt'], 0.2);
});

test('moveClipEffect reorders the clip chain, bounds-safe', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  const cid = show.composition.layers[0].clips[0].id;
  show = addClipEffect(show, lid, cid, 'displace');
  show = addClipEffect(show, lid, cid, 'repeat');
  const moved = moveClipEffect(show, lid, cid, 0, +1);
  assert.deepEqual(moved.composition.layers[0].clips[0].effects, ['repeat', 'displace']);
  assert.equal(moveClipEffect(show, lid, cid, 0, -1), show);  // clamp → unchanged
});

// --- layer-level effects, independent of clip params ---
test('layer effect helpers operate on layer.effects/layer.params', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  show = addLayerEffect(show, lid, 'displace');
  assert.deepEqual(show.composition.layers[0].effects, ['displace']);
  assert.equal(show.composition.layers[0].params['displace.amt'], 0.2);
  show = setLayerParam(show, lid, 'displace.amt', 0.4);
  assert.equal(show.composition.layers[0].params['displace.amt'], 0.4);
  show = removeLayerEffect(show, lid, 0);
  assert.deepEqual(show.composition.layers[0].effects, []);
  assert.equal(show.composition.layers[0].params['displace.amt'], undefined);
});

test('layer displace and clip displace keep separate values (no collision)', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  const cid = show.composition.layers[0].clips[0].id;
  show = addClipEffect(show, lid, cid, 'displace');
  show = setClipParam(show, lid, cid, 'displace.amt', 0.9);
  show = addLayerEffect(show, lid, 'displace');
  show = setLayerParam(show, lid, 'displace.amt', 0.1);
  assert.equal(show.composition.layers[0].clips[0].params['displace.amt'], 0.9);
  assert.equal(show.composition.layers[0].params['displace.amt'], 0.1);
});

test('moveLayerEffect reorders the layer chain, bounds-safe', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  show = addLayerEffect(show, lid, 'displace');
  show = addLayerEffect(show, lid, 'repeat');
  const moved = moveLayerEffect(show, lid, 0, +1);
  assert.deepEqual(moved.composition.layers[0].effects, ['repeat', 'displace']);
  assert.equal(moveLayerEffect(show, lid, 0, -1), show);
});

// --- layer lifecycle: remove / move / patch ---
test('removeLayer / moveLayer are immutable and clamp', () => {
  let show = addLayer(addLayer(deckShow()));
  const ids = show.composition.layers.map((l) => l.id);
  const rm = removeLayer(show, ids[1]);
  assert.deepEqual(rm.composition.layers.map((l) => l.id), [ids[0], ids[2]]);
  assert.equal(removeLayer(show, 'nope'), show);             // unknown → unchanged
  const mv = moveLayer(show, ids[0], +1);
  assert.deepEqual(mv.composition.layers.map((l) => l.id), [ids[1], ids[0], ids[2]]);
  assert.equal(moveLayer(show, ids[0], -1), show);           // clamp → unchanged
  assert.equal(show.composition.layers.length, 3);           // original untouched
});

test('patchLayer patches blend/opacity/name/transitionMs immutably', () => {
  let show = deckShow();
  const lid = show.composition.layers[0].id;
  const p = patchLayer(show, lid, { opacity: 0.5, transitionMs: 250, name: 'foo' });
  assert.equal(p.composition.layers[0].opacity, 0.5);
  assert.equal(p.composition.layers[0].transitionMs, 250);
  assert.equal(p.composition.layers[0].name, 'foo');
  assert.equal(show.composition.layers[0].opacity, 1);       // original untouched
});

test('makeLayer builds a one-clip active new-shape layer', () => {
  const l = makeLayer('l1');
  assert.equal(l.id, 'l1');
  assert.equal(l.blend, 'alpha');
  assert.equal(l.opacity, 1);
  assert.equal(l.transitionMs, 500);
  assert.deepEqual(l.effects, []);
  assert.deepEqual(l.params, {});
  assert.equal(l.clips.length, 1);
  assert.equal(l.activeClipId, l.clips[0].id);
  assert.equal(l.clips[0].generator, 'line');
});

// --- canvas resolution (Task 2) ---
test('clampCanvasSize rounds to integers and clamps to bounds', () => {
  assert.deepEqual(clampCanvasSize(1920.4, 1080.6), { w: 1920, h: 1081 });
  assert.deepEqual(clampCanvasSize(0, 0), { w: CANVAS_MIN, h: CANVAS_MIN });
  assert.deepEqual(clampCanvasSize(99999, 99999), { w: CANVAS_MAX, h: CANVAS_MAX });
  assert.deepEqual(clampCanvasSize(-5, 8), { w: CANVAS_MIN, h: CANVAS_MIN });
});

test('clampCanvasSize falls back to min on non-numeric input', () => {
  assert.deepEqual(clampCanvasSize('abc', NaN), { w: CANVAS_MIN, h: CANVAS_MIN });
  // Non-finite (Infinity/undefined) → fall back to the bound minimum.
  assert.deepEqual(clampCanvasSize(undefined, Infinity), { w: CANVAS_MIN, h: CANVAS_MIN });
});

test('setCanvasSize immutably updates composition.canvas (clamped)', () => {
  const show = normalizeComposition({});
  const next = setCanvasSize(show, 1024, 768);
  assert.deepEqual(next.composition.canvas, { w: 1024, h: 768 });
  assert.deepEqual(show.composition.canvas, { w: 1280, h: 720 }); // original untouched
  // Clamps out-of-range values.
  assert.deepEqual(setCanvasSize(show, 5, 99999).composition.canvas,
    { w: CANVAS_MIN, h: CANVAS_MAX });
});

test('CANVAS_PRESETS are all within bounds and integers', () => {
  for (const p of CANVAS_PRESETS) {
    assert.deepEqual(clampCanvasSize(p.w, p.h), { w: p.w, h: p.h });
  }
});

// --- per-clip transform / opacity / duration (timeline slot fields) ---
test('makeClip seeds transform, opacity, and durationMs defaults', () => {
  const c = makeClip('line', 'clip 1', 'c1');
  assert.deepEqual(c.transform, { x: 0, y: 0, scale: 1, rotation: 0 });
  assert.equal(c.opacity, 1);
  assert.equal(c.durationMs, 4000);
});

test('normalizeComposition fills transform/opacity/duration on new-shape clips', () => {
  const show = {
    version: 1, devices: [], fixtures: [],
    composition: { canvas: { w: 1280, h: 720 }, layers: [
      { id: 'l1', clips: [{ id: 'c1', generator: 'line', params: {}, effects: [] }],
        activeClipId: 'c1' },
    ] },
  };
  const clip = normalizeComposition(show).composition.layers[0].clips[0];
  assert.deepEqual(clip.transform, { x: 0, y: 0, scale: 1, rotation: 0 });
  assert.equal(clip.opacity, 1);
  assert.equal(clip.durationMs, 4000);
});

test('setClipTransform merges fields; setClipOpacity clamps; setClipDuration floors', () => {
  let show = { composition: { layers: [{ id: 'l1', clips: [makeClip('line', 'c', 'c1')], activeClipId: 'c1' }] } };
  show = setClipTransform(show, 'l1', 'c1', { x: 0.25, rotation: 90 });
  assert.deepEqual(show.composition.layers[0].clips[0].transform, { x: 0.25, y: 0, scale: 1, rotation: 90 });
  show = setClipOpacity(show, 'l1', 'c1', 1.7);
  assert.equal(show.composition.layers[0].clips[0].opacity, 1);
  show = setClipOpacity(show, 'l1', 'c1', -0.3);
  assert.equal(show.composition.layers[0].clips[0].opacity, 0);
  show = setClipDuration(show, 'l1', 'c1', 2500.6);
  assert.equal(show.composition.layers[0].clips[0].durationMs, 2501);
});

test('playheadClip walks clips by duration, wrapping when looped', () => {
  const clips = [
    { id: 'a', durationMs: 1000 },
    { id: 'b', durationMs: 2000 },
    { id: 'c', durationMs: 1000 },
  ];
  assert.equal(playheadClip(clips, 0).index, 0);
  assert.equal(playheadClip(clips, 999).index, 0);
  assert.equal(playheadClip(clips, 1000).index, 1);
  assert.equal(playheadClip(clips, 2999).index, 1);
  assert.equal(playheadClip(clips, 3000).index, 2);
  // total = 4000 → wraps
  assert.equal(playheadClip(clips, 4000).index, 0);
  assert.equal(playheadClip(clips, 5000).index, 1);
  assert.equal(playheadClip(clips, 4000).intoMs, 0);
});

test('playheadClip clamps to last clip when not looping', () => {
  const clips = [{ id: 'a', durationMs: 1000 }, { id: 'b', durationMs: 1000 }];
  assert.equal(playheadClip(clips, 5000, false).index, 1);
  assert.equal(playheadClip(clips, 500, false).index, 0);
});

test('playheadClip returns null for an empty deck', () => {
  assert.equal(playheadClip([], 100), null);
});
