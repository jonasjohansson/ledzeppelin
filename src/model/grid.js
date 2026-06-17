// GRID (matrix) fixtures — a W×H block of pixels sampled in a chosen WIRING order.
//
// A strip is just the H=1 case. The wiring order ("Distribution", Resolume's term)
// is how the physical panel is daisy-chained: which corner LED #0 sits in, whether
// the run advances along rows or columns, and whether alternate lines reverse
// (serpentine/"snake") or all run the same way (progressive).
//
// There are 4 start corners × 2 axes × 2 serpentine = 16 patterns — the same set
// MadMapper/Resolume expose. We index them 0..15 so the UI can show a 4×4 grid of
// icons, but each also carries its decoded {startCorner, axis, serpentine}.

const DEG = Math.PI / 180;
const DEFAULT_CANVAS = { w: 1280, h: 720 };
const canvasOf = (c) => ({ w: (c && c.w) || DEFAULT_CANVAS.w, h: (c && c.h) || DEFAULT_CANVAS.h });

const CORNERS = ['TL', 'TR', 'BL', 'BR'];

// The 16 distributions. Order: for each start corner, the four (axis × serpentine)
// combos — so column 0..3 of the icon grid is [row-snake, row-line, col-snake,
// col-line] and each row of icons is a start corner. Index 0 = the classic
// top-left, row-major snake (the most common LED-matrix wiring).
export const DISTRIBUTIONS = CORNERS.flatMap((startCorner) => [
  { startCorner, axis: 'row', serpentine: true },
  { startCorner, axis: 'row', serpentine: false },
  { startCorner, axis: 'col', serpentine: true },
  { startCorner, axis: 'col', serpentine: false },
]).map((d, i) => ({
  ...d, index: i,
  // A terse human label, e.g. "TL · rows · snake".
  label: `${d.startCorner} · ${d.axis === 'row' ? 'rows' : 'cols'} · ${d.serpentine ? 'snake' : 'line'}`,
}));

export const DEFAULT_DISTRIBUTION = 0;   // TL, row-major, serpentine

// Resolve a distribution from an index (or a {startCorner,axis,serpentine} object),
// clamped to a valid pattern so bad/old data never throws.
export function resolveDistribution(d) {
  if (d && typeof d === 'object' && d.axis) return d;
  const i = Math.max(0, Math.min(DISTRIBUTIONS.length - 1, Math.round(Number(d) || 0)));
  return DISTRIBUTIONS[i];
}

// 0..n-1 ascending, or n-1..0 descending.
const seq = (n, asc) => Array.from({ length: n }, (_, i) => (asc ? i : n - 1 - i));

// The visiting order of grid cells for a distribution: an array of [col, row]
// (length cols*rows) in LED-index order. LED #k lives at order[k].
export function gridCellOrder(cols, rows, dist) {
  const c = Math.max(1, Math.round(cols)), r = Math.max(1, Math.round(rows));
  const { startCorner = 'TL', axis = 'row', serpentine = true } = resolveDistribution(dist);
  const top = startCorner[0] !== 'B';     // start at the top edge unless 'B'
  const left = startCorner[1] !== 'R';    // start at the left edge unless 'R'
  const out = [];
  if (axis === 'col') {
    // Advance column-by-column; within a column walk the rows.
    const outer = seq(c, left), innerBase = seq(r, top);
    outer.forEach((col, k) => {
      const inner = serpentine && (k % 2) ? [...innerBase].reverse() : innerBase;
      for (const row of inner) out.push([col, row]);
    });
  } else {
    // Advance row-by-row; within a row walk the columns.
    const outer = seq(r, top), innerBase = seq(c, left);
    outer.forEach((row, k) => {
      const inner = serpentine && (k % 2) ? [...innerBase].reverse() : innerBase;
      for (const col of inner) out.push([col, row]);
    });
  }
  return out;
}

// The normalized 0..1 canvas UVs for every LED of a grid fixture, in wiring order.
// `transform` is the fixture's footprint rectangle {x,y,w,h,rotation} (px); each
// cell samples at its CENTRE inside that (optionally rotated) rectangle.
export function gridPoints(transform, cols, rows, dist, canvas) {
  const { w: W, h: H } = canvasOf(canvas);
  const c = Math.max(1, Math.round(cols)), r = Math.max(1, Math.round(rows));
  const cx = Number(transform?.x) || 0, cy = Number(transform?.y) || 0;
  const w = Number(transform?.w) || 0, h = Number(transform?.h) || 0;
  const a = (Number(transform?.rotation) || 0) * DEG;
  const cosA = Math.cos(a), sinA = Math.sin(a);
  return gridCellOrder(c, r, dist).map(([col, row]) => {
    const lx = -w / 2 + ((col + 0.5) / c) * w;   // cell centre in local (unrotated) px
    const ly = -h / 2 + ((row + 0.5) / r) * h;
    return [(cx + lx * cosA - ly * sinA) / W, (cy + lx * sinA + ly * cosA) / H];
  });
}

// Is this fixture a grid (matrix) rather than a 1-D strip? Grids carry rows>1.
export const isGridFixture = (f) => (Number(f?.rows) || 1) > 1 || f?.input?.mode === 'grid';
