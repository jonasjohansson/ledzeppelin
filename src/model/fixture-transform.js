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

// Ensure a fixture has a transform (migrate from points if absent) and a fresh
// derived `points` cache for the given canvas. Pure — returns a new fixture.
export function syncFixtureGeometry(fixture, canvas) {
  const input = fixture.input || {};
  const transform = input.transform
    ? normTransform(input.transform)
    : transformFromPoints(input.points, canvas);
  const points = pointsFromTransform(transform, canvas);
  return { ...fixture, input: { ...input, transform, points } };
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
