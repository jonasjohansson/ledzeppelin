// Quadratic bezier fixtures — "pull the middle up into a standing arch".
//
// A bezier fixture stores its TWO ends as input.points (like a 2-point run) and
// one control point in input.bezier.c. The evaluated curve — not the raw
// control triangle — is the sampled centreline: bezierToPoints() produces an
// N-segment polyline that everything downstream (arc-length resampling,
// projection, drawing, hit-testing) consumes like any other polyline.
//
// 3D-aware: points are [x, y] or [x, y, z] (z ?? 0). Output tuples are
// 3-tuples when ANY of the three inputs carries z, else clean 2-tuples — the
// same promotion rule as normPts (the byte-identical 2D guard). Pure, zero deps.

const num = (v) => Number(v) || 0;
const zOf = (p) => num(p?.[2]);
const has3 = (p) => p != null && p.length > 2;

// evalQuadratic(p0, c, p1, n) → n+1 points along B(t) = (1−t)²·p0 + 2t(1−t)·c + t²·p1.
// Endpoints are returned EXACTLY (t=0/1 short-circuit — no float drift).
export function evalQuadratic(p0, c, p1, n) {
  const segs = Math.max(1, Math.round(num(n)) || 1);
  const is3 = has3(p0) || has3(c) || has3(p1);
  const tup = (p) => (is3 ? [num(p[0]), num(p[1]), zOf(p)] : [num(p[0]), num(p[1])]);
  const a = tup(p0), b = tup(c), d = tup(p1);
  const out = [a.slice()];
  for (let k = 1; k < segs; k++) {
    const t = k / segs, u = 1 - t;
    const w0 = u * u, w1 = 2 * t * u, w2 = t * t;
    const p = [w0 * a[0] + w1 * b[0] + w2 * d[0], w0 * a[1] + w1 * b[1] + w2 * d[1]];
    if (is3) p.push(w0 * a[2] + w1 * b[2] + w2 * d[2]);
    out.push(p);
  }
  out.push(d.slice());
  return out;
}

// A fixture input is BEZIER mode when flagged and it has its two ends.
export function isBezierFixture(input) {
  return input?.mode === 'bezier' && Array.isArray(input.points) && input.points.length >= 2;
}

// The evaluated centreline of a bezier fixture: ends = points[0]/points[last],
// control = input.bezier.c (falling back to the chord midpoint = a straight
// run, so a half-initialized bezier still draws/samples sanely).
export function bezierToPoints(input, segments = 24) {
  const pts = input?.points || [];
  const p0 = pts[0] || [0, 0], p1 = pts[pts.length - 1] || [1, 1];
  const c = Array.isArray(input?.bezier?.c) ? input.bezier.c : midOf(p0, p1);
  return evalQuadratic(p0, c, p1, segments);
}

// Chord midpoint (z-aware) — the seed control for a freshly-converted bezier.
export function midOf(p0, p1) {
  const is3 = has3(p0) || has3(p1);
  const m = [(num(p0?.[0]) + num(p1?.[0])) / 2, (num(p0?.[1]) + num(p1?.[1])) / 2];
  if (is3) m.push((zOf(p0) + zOf(p1)) / 2);
  return m;
}
