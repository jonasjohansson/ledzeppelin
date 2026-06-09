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

const DEG = Math.PI / 180;
const DEFAULT_CANVAS = { w: 1280, h: 720 };
const DEFAULT_THICKNESS = 8;

const canvasOf = (c) => ({ w: (c && c.w) || DEFAULT_CANVAS.w, h: (c && c.h) || DEFAULT_CANVAS.h });

// Transform (px) → the two centreline endpoints in normalized 0..1 space.
export function pointsFromTransform(t, canvas) {
  const { w: W, h: H } = canvasOf(canvas);
  const a = (Number(t?.rotation) || 0) * DEG;
  const half = (Number(t?.w) || 0) / 2;
  const dx = Math.cos(a) * half, dy = Math.sin(a) * half;
  const cx = Number(t?.x) || 0, cy = Number(t?.y) || 0;
  return [
    [(cx - dx) / W, (cy - dy) / H],
    [(cx + dx) / W, (cy + dy) / H],
  ];
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

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const normPts = (pts) =>
  (Array.isArray(pts) ? pts : []).map((p) => [clamp01(Number(p?.[0]) || 0), clamp01(Number(p?.[1]) || 0)]);

// A fixture is POLYLINE mode (a bendable, multi-segment run) when it carries an
// explicit mode flag or more than two points; otherwise BAR mode (a single
// straight segment editable as a {x,y,w,h,rotation} transform). Polyline mode
// keeps `input.points` as the canonical geometry (no transform) so an imported
// Kagora strip with bends is NOT collapsed to a straight line.
export function isPolylineFixture(input) {
  const n = Array.isArray(input?.points) ? input.points.length : 0;
  return input?.mode === 'polyline' || (input?.mode !== 'bar' && n > 2);
}

// Auto fixture identity for the lists/canvas: a 1-based number ("#1", "#2", …).
// The internal `id` stays the stable routing handle (chains/selection); users no
// longer type it. Pass the fixture's index in the patch; falls back to id.
export function fixtureLabel(f, index) {
  return index != null ? `#${index + 1}` : (f?.name || f?.id || '');
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
  if (isPolylineFixture(input)) {
    const pts = normPts(input.points);
    const points = pts.length >= 2 ? pts : [[0.05, 0.5], [0.95, 0.5]];
    const { transform, ...rest } = input;          // polyline is canonical; drop any stale transform
    return { ...fixture, input: { ...rest, mode: 'polyline', points } };
  }
  const transform = input.transform
    ? normTransform(input.transform)
    : transformFromPoints(input.points, canvas);
  const points = pointsFromTransform(transform, canvas);
  return { ...fixture, input: { ...input, mode: 'bar', transform, points } };
}

const mapFixture = (show, fxId, fn) => ({
  ...show,
  fixtures: (show.fixtures || []).map((f) => (f.id === fxId ? fn(f) : f)),
});

// Replace a polyline fixture's full point list (normalized). Used by group-move.
export function setFixturePoints(show, fxId, points) {
  return mapFixture(show, fxId, (f) => ({
    ...f, input: { ...f.input, mode: 'polyline', points: normPts(points) },
  }));
}

// Move ONE vertex of a polyline fixture to an absolute normalized position.
export function setFixtureVertex(show, fxId, index, nx, ny) {
  return mapFixture(show, fxId, (f) => {
    const pts = normPts(f.input?.points);
    if (!(index >= 0 && index < pts.length)) return f;
    pts[index] = [clamp01(nx), clamp01(ny)];
    return { ...f, input: { ...f.input, mode: 'polyline', points: pts } };
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
    const mid = at
      ? [clamp01(at[0]), clamp01(at[1])]
      : [(base[i][0] + base[i + 1][0]) / 2, (base[i][1] + base[i + 1][1]) / 2];
    const points = [...base.slice(0, i + 1), mid, ...base.slice(i + 1)];
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
    if (pts.length > 2) return { ...f, input: { ...f.input, mode: 'polyline', points: pts } };
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
    const pts = (Array.isArray(f.input?.points) ? f.input.points : [])
      .map((p) => [(Number(p?.[0]) || 0) * cv.w, (Number(p?.[1]) || 0) * cv.h]);
    if (!pts.length) continue;
    if (!isPolylineFixture(f.input) && pts.length >= 2) {
      // Bar: expand to the rectangle's OUTER corners (centerline ± half-thickness)
      // so the canvas contains the strip's full footprint, not just its spine.
      const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const hx = -dy / len, hy = dx / len, ht = (Number(f.input?.transform?.h) || 0) / 2;
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
  // Map a current-canvas normalized point → fitted normalized point.
  const remap = (p) => {
    const px = (Number(p?.[0]) || 0) * cv.w, py = (Number(p?.[1]) || 0) * cv.h;
    return [((px - minX) * scale + pad) / newW, ((py - minY) * scale + pad) / newH];
  };
  const out = fixtures.map((f) => {
    const pts = (Array.isArray(f.input?.points) ? f.input.points : []).map(remap);
    if (isPolylineFixture(f.input)) {
      return { ...f, input: { ...f.input, mode: 'polyline', points: pts.length >= 2 ? pts : f.input.points } };
    }
    const transform = transformFromPoints(pts, newCanvas);
    // Preserve the bar's thickness proportionally (transformFromPoints resets it
    // to a default), so fitting doesn't flatten thick strips.
    const origH = Number(f.input?.transform?.h);
    if (Number.isFinite(origH) && origH > 0) transform.h = origH * scale;
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
      return { ...f, input: { ...f.input, transform, points: pointsFromTransform(transform, canvas) } };
    }),
  };
}
