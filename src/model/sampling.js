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
