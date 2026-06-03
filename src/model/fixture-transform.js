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
