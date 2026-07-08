// Fixture INPUT geometry as a pixel-space TRANSFORM.
//
// Instead of two free endpoints, a fixture's footprint on the canvas is defined
// by a transform in CANVAS PIXEL space:
//   { x, y, w, h, rotation }  — centre (x,y) px, size w×h px, rotation degrees.
// A tube samples a 1D centreline along its WIDTH axis; `h` is the visual
// thickness (drawn as a rectangle, reserved for future band sampling).
//
// For the GPU sampler we derive the two endpoints in NORMALIZED 0..1 space and
// store them as `input.points` — so sampling.js / pipeline.js / preview.js are
// unchanged. The TRANSFORM is the editable source of truth; `points` is a
// derived cache that must be recomputed whenever the transform OR the canvas
// resolution changes (pixel positions are fixed; their 0..1 mapping is not).

import { isBezierFixture, bezierToPoints, midOf } from './bezier.js';

const DEG = Math.PI / 180;
const DEFAULT_CANVAS = { w: 1280, h: 720 };
const DEFAULT_THICKNESS = 8;

const canvasOf = (c) => ({ w: (c && c.w) || DEFAULT_CANVAS.w, h: (c && c.h) || DEFAULT_CANVAS.h });

// Transform (px) → the two centreline endpoints in normalized 0..1 space.
// `grid` = a matrix footprint: its rotation is EXPLICIT, so the strip aspect-flip
// (vertical when h > w) must NOT apply — otherwise a near-square matrix jumps ±90°
// as h crosses w while rotating.
export function pointsFromTransform(t, canvas, grid = false) {
  const { w: W, h: H } = canvasOf(canvas);
  const w = Number(t?.w) || 0, h = Number(t?.h);
  // Orientation comes from the BOX ASPECT: the LED centreline runs along the
  // LONGER side, so editing width/height alone flips a strip vertical↔horizontal
  // (no rotation needed). Legacy/auto fixtures (h is the auto-thickness sentinel)
  // keep length = w (horizontal). `rotation` then tilts further on top. A matrix
  // is exempt — its centreline runs along width at the explicit rotation.
  const autoH = isAutoThickness(h);
  const vertical = !grid && !autoH && h > w;
  const len = vertical ? h : w;
  const a = (Number(t?.rotation) || 0) * DEG + (vertical ? Math.PI / 2 : 0);
  const half = len / 2;
  const dx = Math.cos(a) * half, dy = Math.sin(a) * half;
  const cx = Number(t?.x) || 0, cy = Number(t?.y) || 0;
  return [
    [(cx - dx) / W, (cy - dy) / H],
    [(cx + dx) / W, (cy + dy) / H],
  ];
}

// Centre of a fixture in normalized 0..1 UV — a DMX fixture samples this single
// spot (not a strip). Uses the points' midpoint when present, else the transform.
export function fixtureCentreUV(f, canvas) {
  const { w: W, h: H } = canvasOf(canvas);
  const pts = f?.input?.points;
  if (Array.isArray(pts) && pts.length) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += Number(p?.[0]) || 0; sy += Number(p?.[1]) || 0; }
    return [sx / pts.length, sy / pts.length];
  }
  const t = f?.input?.transform;
  return [(Number(t?.x) || 0) / W, (Number(t?.y) || 0) / H];
}

// Normalized endpoints → a pixel-space transform (migration / drag readback).
export function transformFromPoints(points, canvas) {
  const { w: W, h: H } = canvasOf(canvas);
  const p1 = points?.[0] || [0.05, 0.5];
  const p2 = points?.[points.length - 1] || [0.95, 0.5];
  const x1 = p1[0] * W, y1 = p1[1] * H, x2 = p2[0] * W, y2 = p2[1] * H;
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
    w: Math.hypot(x2 - x1, y2 - y1),
    h: DEFAULT_THICKNESS,
    rotation: Math.atan2(y2 - y1, x2 - x1) / DEG,
  };
}

const normTransform = (t) => ({
  x: Number(t?.x) || 0,
  y: Number(t?.y) || 0,
  w: Number(t?.w) || 0,
  h: t?.h == null ? DEFAULT_THICKNESS : Number(t.h),
  rotation: Number(t?.rotation) || 0,
});

// Normalized points are NOT clamped to 0..1: like bar transforms, a polyline can
// extend onto the pasteboard (off-canvas), where the sampler reads black. Keeping
// both fixture kinds unclamped makes off-canvas placement behave the same for all.
const num = (v) => Number(v) || 0;
// A point is 2-tuple [x,y] or 3-tuple [x,y,z] (3D mapping). Once ANY vertex
// carries z, the WHOLE polyline is promoted to 3-tuples (missing z → 0) so a run
// never has per-point dimensionality splits (e.g. an inserted 2D midpoint in a
// 3D run). All-2D input stays exactly [x,y] — the byte-identical 2D guard.
const normPts = (pts) => {
  const arr = Array.isArray(pts) ? pts : [];
  const any3 = arr.some((p) => p != null && p.length > 2);
  return arr.map((p) => (any3
    ? [num(p?.[0]), num(p?.[1]), num(p?.[2])]
    : [num(p?.[0]), num(p?.[1])]));
};

// Carry z (height off the canvas plane) across a 2D points-recompute: bar/grid
// points are DERIVED from the pixel transform (x/y only), so without this a
// resync/resize/move would silently drop a lifted fixture back to the plane.
// Re-attach the previous cache's z per-vertex (first z as the fallback when the
// point count changes). All-2D previous points pass `next` through untouched.
const withZOf = (prev, next) => {
  if (!Array.isArray(prev) || !prev.some((p) => p != null && p.length > 2)) return next;
  const z0 = num(prev.find((p) => p != null && p.length > 2)?.[2]);
  return next.map((p, i) => [p[0], p[1], prev[i]?.length > 2 ? num(prev[i][2]) : z0]);
};

// Set a WHOLE fixture's height off the canvas plane: write z on every vertex of
// its polyline (promoting 2-tuples), x/y and the output patch untouched. z = 0
// strips back to clean 2-tuples — the fixture returns to a plain 2D strip (the
// byte-identical 2D guard). Per-vertex z editing is a later phase; this is the
// whole-fixture lift. Pure — returns a new show.
export function setFixtureZ(show, fxId, z) {
  const cv = show.composition?.canvas;
  const zz = num(z);
  return mapFixture(show, fxId, (f) => {
    const base = normPts(
      f.input?.points?.length ? f.input.points : pointsFromTransform(f.input?.transform, cv),
    );
    const points = base.map((p) => (zz === 0 ? [p[0], p[1]] : [p[0], p[1], zz]));
    // A bezier's CONTROL rides along with the whole-fixture lift, else the arch
    // would deform (ends up, apex left behind).
    const bez = f.input?.bezier?.c
      ? { bezier: { ...f.input.bezier, c: zz === 0 ? [num(f.input.bezier.c[0]), num(f.input.bezier.c[1])] : [num(f.input.bezier.c[0]), num(f.input.bezier.c[1]), zz] } }
      : {};
    return { ...f, input: { ...f.input, points, ...bez } };
  });
}

// A fixture is POLYLINE mode (a bendable, multi-segment run) when it carries an
// explicit mode flag or more than two points; otherwise BAR mode (a single
// straight segment editable as a {x,y,w,h,rotation} transform). Polyline mode
// keeps `input.points` as the canonical geometry (no transform) so an imported
// Kagora strip with bends is NOT collapsed to a straight line.
export function isPolylineFixture(input) {
  const n = Array.isArray(input?.points) ? input.points.length : 0;
  return input?.mode === 'polyline' || (input?.mode !== 'bar' && n > 2);
}

// Physical strip width — a standard LED strip/PCB is ~10 mm across.
export const STRIP_WIDTH_M = 0.010;

// Centreline length of a fixture in composition-canvas px (bar: transform.w;
// polyline: the summed segment lengths of its normalized points × canvas).
export function centrelineLengthPx(f, canvas) {
  const input = f?.input;
  if (input?.transform && !isPolylineFixture(input)) {
    const w = Number(input.transform.w) || 0, h = Number(input.transform.h);
    // Length = the longer box side (the LED axis); auto-h fixtures keep length = w.
    return isAutoThickness(h) ? w : Math.max(w, h);
  }
  const { w: W, h: H } = canvasOf(canvas);
  // A bezier's length is the EVALUATED curve's, not its 2-point chord.
  const pts = isBezierFixture(input) ? bezierToPoints(input)
    : Array.isArray(input?.points) ? input.points : [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(((Number(pts[i]?.[0]) || 0) - (Number(pts[i - 1]?.[0]) || 0)) * W,
      ((Number(pts[i]?.[1]) || 0) - (Number(pts[i - 1]?.[1]) || 0)) * H);
  }
  return L;
}

// AUTO height sentinel: 0/null mean "derive physically". The legacy hardcoded
// creation defaults (8 and 10) were never user choices, so they count as auto
// too — old shows snap to physical scale without migration.
export const isAutoThickness = (h) => {
  const v = Number(h);
  return !Number.isFinite(v) || v <= 0 || v === 8 || v === 10;
};

// EFFECTIVE bar thickness in composition-canvas px. AUTO by default: drawn to
// PHYSICAL scale — strip width (10 mm) × the fixture's own px-per-meter
// (centreline length ÷ meters) — so the bar is as wide as the real strip and
// follows when stretched. Any other stored positive h is a manual override.
// Clamped ≥2 px so a long-thin fixture never vanishes.
export function thicknessOf(f, canvas) {
  const stored = Number(f?.input?.transform?.h);
  // Explicit box height: thickness is the SHORTER of the two box dims (the longer
  // is the LED length — see pointsFromTransform's aspect rule).
  if (!isAutoThickness(stored)) return Math.max(2, Math.min(Number(f?.input?.transform?.w) || stored, stored));
  const meters = Number(f?.meters) || 0;
  const lenPx = centrelineLengthPx(f, canvas);
  if (meters > 0 && lenPx > 0) return Math.max(2, (lenPx / meters) * STRIP_WIDTH_M);
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_THICKNESS;
}

// Auto fixture identity for the lists/canvas: a 1-based number ("#1", "#2", …).
// The internal `id` stays the stable routing handle (chains/selection); users no
// longer type it. Pass the fixture's DISPLAY number (see fixtureNumbers); falls back to id.
export function fixtureLabel(f, index) {
  return index != null ? `#${index + 1}` : (f?.name || f?.id || '');
}

// Display numbering (#1, #2, …) in the ORDER the rig reads top-to-bottom: by
// controller (its position in show.devices; unassigned last), then output port,
// then pixel offset (chain order on that line). Used by BOTH the Output list and
// the canvas labels so the numbers match and run 1,2,3,… — the raw array index
// jumped around once fixtures were grouped by controller. Returns a Map id→number
// (1-based); pass `map.get(f.id) - 1` where a 0-based index is wanted.
export function fixtureNumbers(show) {
  const devIdx = new Map((show?.devices || []).map((d, i) => [d.id, i]));
  const rankDev = (did) => (did ? (devIdx.get(did) ?? 1e6) : 1e9);   // assigned by setup order, unassigned last
  const ordered = (show?.fixtures || []).map((f, i) => ({ f, i }))
    .sort((a, b) =>
      rankDev(a.f.output?.deviceId || '') - rankDev(b.f.output?.deviceId || '')
      || (a.f.output?.port ?? 0) - (b.f.output?.port ?? 0)
      || (a.f.output?.pixelOffset ?? 0) - (b.f.output?.pixelOffset ?? 0)
      || a.i - b.i);
  const map = new Map();
  ordered.forEach(({ f }, n) => map.set(f.id, n + 1));
  return map;
}

// The DDP pixel range a fixture targets on its device, zero-padded ("000–288").
const pad3 = (n) => String(Math.max(0, Math.round(Number(n) || 0))).padStart(3, '0');
export function fixtureRange(f) {
  const o = f?.output || {};
  const off = o.pixelOffset ?? 0;
  return `${pad3(off)}–${pad3(off + (o.pixelCount ?? 0))}`;
}

// Ensure a fixture has valid geometry + a fresh derived `points` cache for the
// given canvas. Bar mode keeps a transform (recomputed on canvas resize);
// polyline mode keeps its normalized points as-is. Pure — returns a new fixture.
export function syncFixtureGeometry(fixture, canvas) {
  const input = fixture.input || {};
  if (isBezierFixture(input)) {
    // Bezier: the TWO ends + the control are canonical (normalized like points;
    // z kept). No transform — the evaluated curve is the geometry.
    const pts = normPts(input.points);
    const ends = [pts[0], pts[pts.length - 1]];
    const c = Array.isArray(input.bezier?.c)
      ? normPts([input.bezier.c])[0]
      : midOf(ends[0], ends[1]);
    const { transform, ...rest } = input;
    return { ...fixture, input: { ...rest, mode: 'bezier', points: ends, bezier: { c } } };
  }
  if (isPolylineFixture(input)) {
    const pts = normPts(input.points);
    const points = pts.length >= 2 ? pts : [[0.05, 0.5], [0.95, 0.5]];
    const { transform, ...rest } = input;          // polyline is canonical; drop any stale transform
    return { ...fixture, input: { ...rest, mode: 'polyline', points } };
  }
  const transform = input.transform
    ? normTransform(input.transform)
    : transformFromPoints(input.points, canvas);
  // A DMX/par fixture keeps its 'dmx' mode (point fixture); a matrix keeps 'grid'
  // (rectangle footprint); everything else is a straight bar. `points` is a 2-pt cache.
  const mode = input.dmx ? 'dmx' : (input.mode === 'grid' ? 'grid' : 'bar');
  const points = withZOf(input.points, pointsFromTransform(transform, canvas, mode === 'grid'));
  return { ...fixture, input: { ...input, mode, transform, points } };
}

const mapFixture = (show, fxId, fn) => ({
  ...show,
  fixtures: (show.fixtures || []).map((f) => (f.id === fxId ? fn(f) : f)),
});

// Replace a points-canonical fixture's full point list (normalized). Used by
// group-move/scale. A bezier keeps its mode (its two ends ARE its point list).
export function setFixturePoints(show, fxId, points) {
  return mapFixture(show, fxId, (f) => ({
    ...f, input: { ...f.input, mode: isBezierFixture(f.input) ? 'bezier' : 'polyline', points: normPts(points) },
  }));
}

// Move a bezier fixture's CONTROL point (normalized). `c` may be [x, y] —
// keeping the control's existing height, like setFixtureVertex — or [x, y, z].
// z = 0 strips back to a 2-tuple (the 2D guard).
export function setBezierControl(show, fxId, c) {
  return mapFixture(show, fxId, (f) => {
    if (!isBezierFixture(f.input)) return f;
    const prev = Array.isArray(f.input.bezier?.c) ? f.input.bezier.c : [];
    const z = c.length > 2 ? num(c[2]) : num(prev[2]);
    const nc = z !== 0 ? [num(c[0]), num(c[1]), z] : [num(c[0]), num(c[1])];
    return { ...f, input: { ...f.input, bezier: { ...f.input.bezier, c: nc } } };
  });
}

// Set a BEZIER fixture's ARC HEIGHT: the control point's z ALONE (c.x/c.y and
// the two ends untouched) — so one shared value stands a whole multi-selection
// up as arches. A missing control seeds at the chord midpoint (the same seed
// setFixtureShape uses); z = 0 strips c back to a 2-tuple (the 2D guard).
// Non-bezier fixtures pass through untouched — safe across a mixed selection.
// Pure — returns a new show.
export function setBezierArcZ(show, fxId, z) {
  const zz = num(z);
  return mapFixture(show, fxId, (f) => {
    if (!isBezierFixture(f.input)) return f;
    const pts = normPts(f.input.points);
    const prev = Array.isArray(f.input.bezier?.c) ? f.input.bezier.c : midOf(pts[0], pts[pts.length - 1]);
    const c = zz !== 0 ? [num(prev[0]), num(prev[1]), zz] : [num(prev[0]), num(prev[1])];
    return { ...f, input: { ...f.input, bezier: { ...f.input.bezier, c } } };
  });
}

// Switch a fixture's SHAPE: 'bar' (straight transform) | 'polyline' (bendable
// run) | 'bezier' (quadratic arch). Ends carry over; entering bezier seeds the
// control at the chord midpoint; leaving bezier drops it. Pure.
export function setFixtureShape(show, fxId, shape, canvas) {
  const cv = canvas ?? show.composition?.canvas;
  return mapFixture(show, fxId, (f) => {
    const input = f.input || {};
    const cur = isBezierFixture(input) ? 'bezier' : isPolylineFixture(input) ? 'polyline' : 'bar';
    if (cur === shape) return f;
    const base = normPts(
      input.points?.length ? input.points : pointsFromTransform(input.transform, cv),
    );
    const ends = base.length >= 2 ? [base[0], base[base.length - 1]] : [[0.05, 0.5], [0.95, 0.5]];
    if (shape === 'bezier') {
      const { transform, ...rest } = input;
      return { ...f, input: { ...rest, mode: 'bezier', points: ends, bezier: { c: midOf(ends[0], ends[1]) } } };
    }
    if (shape === 'polyline') {
      const { transform, bezier, ...rest } = input;
      return { ...f, input: { ...rest, mode: 'polyline', points: base.length >= 2 ? base : ends } };
    }
    // bar: straighten end-to-end; z (if any) survives via the points cache.
    const transform = transformFromPoints(ends, cv);
    const { bezier, ...rest } = input;
    return { ...f, input: { ...rest, mode: 'bar', transform, points: withZOf(ends, pointsFromTransform(transform, cv)) } };
  });
}

// Move ONE vertex of a polyline fixture to an absolute normalized position.
// `nz` is optional: omitted → the vertex KEEPS its current z (a 2D drag on a
// lifted run must not flatten it); given → the vertex moves to that height.
// When the whole run ends up flat (every z = 0) the points strip back to clean
// 2-tuples — the byte-identical 2D guard.
export function setFixtureVertex(show, fxId, index, nx, ny, nz) {
  return mapFixture(show, fxId, (f) => {
    const pts = normPts(f.input?.points);
    if (!(index >= 0 && index < pts.length)) return f;
    const z = nz != null ? num(nz) : num(pts[index][2]);
    pts[index] = [num(nx), num(ny), z];
    const flat = pts.every((p) => !p[2]);
    return { ...f, input: { ...f.input, mode: isBezierFixture(f.input) ? 'bezier' : 'polyline',
      points: flat ? pts.map((p) => [p[0], p[1]]) : normPts(pts) } };
  });
}

// Insert a vertex after `afterIndex` (at `at` [nx,ny], or the segment midpoint),
// turning a bar into a polyline so the run can BEND. Returns the new show.
export function addFixtureVertex(show, fxId, afterIndex, at, canvas) {
  const cv = canvas ?? show.composition?.canvas;
  return mapFixture(show, fxId, (f) => {
    const base = normPts(
      f.input?.points?.length ? f.input.points : pointsFromTransform(f.input?.transform, cv),
    );
    if (base.length < 2) return f;
    const i = Math.max(0, Math.min(afterIndex, base.length - 2));
    // `at` may be [nx, ny] (2D) or [nx, ny, nz] (3D viewport insertion); the
    // default midpoint interpolates EVERY component, so a vertex inserted into a
    // lifted run lands ON the run (z included), not on the floor.
    const is3 = base[i].length > 2;
    const mid = at
      ? (at.length > 2 ? [num(at[0]), num(at[1]), num(at[2])] : [num(at[0]), num(at[1])])
      : [(base[i][0] + base[i + 1][0]) / 2, (base[i][1] + base[i + 1][1]) / 2,
        ...(is3 ? [(base[i][2] + base[i + 1][2]) / 2] : [])];
    const points = normPts([...base.slice(0, i + 1), mid, ...base.slice(i + 1)]);
    const { transform, ...rest } = f.input || {};
    return { ...f, input: { ...rest, mode: 'polyline', points } };
  });
}

// Remove a vertex (keeps a minimum of two points; reverts to a bar at two).
export function removeFixtureVertex(show, fxId, index, canvas) {
  const cv = canvas ?? show.composition?.canvas;
  return mapFixture(show, fxId, (f) => {
    const pts = normPts(f.input?.points);
    if (pts.length <= 2 || !(index >= 0 && index < pts.length)) return f;
    pts.splice(index, 1);
    // A LIFTED run (any z) stays a polyline even at 2 points — collapsing to a
    // bar would derive a 2D transform and silently drop the z placement.
    if (pts.length > 2 || pts.some((p) => p.length > 2 && p[2] !== 0)) {
      return { ...f, input: { ...f.input, mode: 'polyline', points: pts } };
    }
    // Back to a single segment → restore an editable bar transform.
    const transform = transformFromPoints(pts, cv);
    return { ...f, input: { ...f.input, mode: 'bar', transform, points: pointsFromTransform(transform, cv) } };
  });
}

// Sync every fixture's geometry against the show's canvas (idempotent).
export function syncShowFixtures(show) {
  if (!show || !Array.isArray(show.fixtures)) return show;
  const canvas = show.composition?.canvas;
  return { ...show, fixtures: show.fixtures.map((f) => syncFixtureGeometry(f, canvas)) };
}

// FIT the composition canvas to the fixtures' footprint — a "fluid" canvas that
// is decided by the LED strips rather than a fixed aspect. We're mapping lights,
// not framing video, so the canvas just has to CONTAIN every strip.
//
// Footprints come from each fixture's normalized `points` (× the current canvas),
// so the result is independent of how the fixtures were authored. The fitted
// canvas keeps that bounding box's exact aspect, scaled so its long axis ≈
// `target` px (enough render detail), with `pad` px of breathing room on every
// side. Fixtures are remapped so they stay put visually. Pure — returns a new
// show (or the same show unchanged if there are no fixtures with geometry).
export function fitCanvasToFixtures(show, { target = 1280, pad = 24 } = {}) {
  const fixtures = show?.fixtures || [];
  const cv = canvasOf(show?.composition?.canvas);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  for (const f of fixtures) {
    if (isBezierFixture(f.input)) {
      // Bezier: the EVALUATED curve is the footprint (the arch bulges past its ends).
      for (const p of bezierToPoints(f.input)) ext((Number(p[0]) || 0) * cv.w, (Number(p[1]) || 0) * cv.h);
      continue;
    }
    const pts = (Array.isArray(f.input?.points) ? f.input.points : [])
      .map((p) => [(Number(p?.[0]) || 0) * cv.w, (Number(p?.[1]) || 0) * cv.h]);
    if (!pts.length) continue;
    if (!isPolylineFixture(f.input) && pts.length >= 2) {
      // Bar: expand to the rectangle's OUTER corners (centerline ± half-thickness)
      // so the canvas contains the strip's full footprint, not just its spine.
      const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const hx = -dy / len, hy = dx / len, ht = thicknessOf(f, cv) / 2;
      for (const [cx, cy] of [[ax, ay], [bx, by]]) { ext(cx + hx * ht, cy + hy * ht); ext(cx - hx * ht, cy - hy * ht); }
    } else {
      for (const [px, py] of pts) ext(px, py);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return show; // nothing placed
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const scale = target / Math.max(spanX, spanY);
  const newW = Math.round(spanX * scale + pad * 2);
  const newH = Math.round(spanY * scale + pad * 2);
  const newCanvas = { w: newW, h: newH };
  // Map a current-canvas normalized point → fitted normalized point (z, when
  // present, rides along unchanged — the fit is a 2D reframe).
  const remap = (p) => {
    const px = (Number(p?.[0]) || 0) * cv.w, py = (Number(p?.[1]) || 0) * cv.h;
    const q = [((px - minX) * scale + pad) / newW, ((py - minY) * scale + pad) / newH];
    if (p?.length > 2) q.push(Number(p[2]) || 0);
    return q;
  };
  const out = fixtures.map((f) => {
    const pts = (Array.isArray(f.input?.points) ? f.input.points : []).map(remap);
    if (isBezierFixture(f.input)) {
      return { ...f, input: { ...f.input, points: pts, bezier: { ...f.input.bezier, c: remap(f.input.bezier?.c || pts[0]) } } };
    }
    if (isPolylineFixture(f.input)) {
      return { ...f, input: { ...f.input, mode: 'polyline', points: pts.length >= 2 ? pts : f.input.points } };
    }
    const transform = transformFromPoints(pts, newCanvas);
    // Preserve a MANUAL thickness proportionally (transformFromPoints resets it
    // to the auto default), so fitting doesn't flatten deliberately-thick bars.
    // The auto sentinel (DEFAULT_THICKNESS) passes through untouched — physical
    // thickness re-derives from the new px-per-meter by itself.
    const origH = Number(f.input?.transform?.h);
    if (!isAutoThickness(origH)) transform.h = origH * scale;
    return { ...f, input: { ...f.input, mode: 'bar', transform, points: pointsFromTransform(transform, newCanvas) } };
  });
  return { ...show, composition: { ...(show.composition || {}), canvas: newCanvas }, fixtures: out };
}

// Snap a rotation (degrees) to the nearest `step`° increment, normalized to [0,360).
export const snapDeg = (deg, step = 90) => ((Math.round((Number(deg) || 0) / step) * step) % 360 + 360) % 360;
// Nearest 90° (explicit ⟳ quarter-turn button).
export const snap90 = (deg) => snapDeg(deg, 90);

// FLIP a fixture: toggle its pixel DIRECTION (which physical end is pixel 0).
// A reverse of the sample walk (applied in pipeline.js), NOT a geometry mirror —
// the bar/run stays exactly where it is on the canvas.
export function flipFixture(show, fxId) {
  return mapFixture(show, fxId, (f) => ({ ...f, input: { ...f.input, reversed: !f.input?.reversed } }));
}

// Patch one fixture's transform (merge) and recompute its derived points.
export function setFixtureTransform(show, fxId, patch) {
  const canvas = show.composition?.canvas;
  return {
    ...show,
    fixtures: show.fixtures.map((f) => {
      if (f.id !== fxId) return f;
      const transform = normTransform({ ...(f.input?.transform || transformFromPoints(f.input?.points, canvas)), ...patch });
      return { ...f, input: { ...f.input, transform, points: withZOf(f.input?.points, pointsFromTransform(transform, canvas, f.input?.mode === 'grid')) } };
    }),
  };
}
