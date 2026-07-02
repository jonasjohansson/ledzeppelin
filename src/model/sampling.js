// Resample a polyline into n points evenly spaced by arc length.
export function samplePoints(points, n) {
  if (!Array.isArray(points) || !points.length) return [];   // nothing to sample (guards points[-1])
  if (n === 1 || points.length === 1) return [points[0].slice()];
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0]-points[i-1][0], dy = points[i][1]-points[i-1][1];
    const len = Math.hypot(dx, dy); seg.push(len); total += len;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = (total * k) / (n - 1), i = 0;
    while (i < seg.length && d > seg[i]) { d -= seg[i]; i++; }
    if (i >= seg.length) { out.push(points[points.length-1].slice()); continue; }
    const t = seg[i] === 0 ? 0 : d / seg[i];
    out.push([
      points[i][0] + (points[i+1][0]-points[i][0])*t,
      points[i][1] + (points[i+1][1]-points[i][1])*t,
    ]);
  }
  return out;
}

// Resample a 3D polyline into n points evenly spaced by true 3D arc length.
export function samplePoints3D(points, n) {
  if (!Array.isArray(points) || !points.length) return [];   // nothing to sample (guards points[-1])
  // Normalize mixed 2-/3-tuples ONCE up front (a 2-tuple in a 3D run — e.g. a
  // freshly inserted 2D midpoint — reads missing z as 0). Done here, not per
  // iteration, so the hot interpolation loop below stays branch-free.
  if (points.some((p) => p.length < 3)) points = points.map((p) => [p[0], p[1], p[2] ?? 0]);
  if (n === 1 || points.length === 1) return [points[0].slice()];
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0]-points[i-1][0], dy = points[i][1]-points[i-1][1], dz = points[i][2]-points[i-1][2];
    const len = Math.hypot(dx, dy, dz); seg.push(len); total += len;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = (total * k) / (n - 1), i = 0;
    while (i < seg.length && d > seg[i]) { d -= seg[i]; i++; }
    if (i >= seg.length) { out.push(points[points.length-1].slice()); continue; }
    const t = seg[i] === 0 ? 0 : d / seg[i];
    out.push([
      points[i][0] + (points[i+1][0]-points[i][0])*t,
      points[i][1] + (points[i+1][1]-points[i][1])*t,
      points[i][2] + (points[i+1][2]-points[i][2])*t,
    ]);
  }
  return out;
}
