#!/usr/bin/env node
// Tent (∩) sampling remap for arch fixtures.
//
// PROBLEM: the Kagora canvas is a flattened FLOOR PLAN — no axis equals physical
// height — so a horizontal Lines clip swept by hand-height moves north↔south
// across the floor instead of climbing the arches.
//
// FIX: each strip runs foot → crest → foot, so height along it is a TENT (0 at the
// ends, peak at the middle). This rewrites every fixture's INPUT sampling polyline
// into an aligned ∩ on the canvas — both feet on the canvas bottom, crest at the
// top — so canvas-Y becomes HEIGHT. Sampling (input) is decoupled from wiring
// (output), so the physical dome is unchanged; only what each LED *reads* changes.
// A horizontal Lines clip driven by /leap/hand/y then lights every arch foot→crest.
//
// Usage:  node scripts/tent-remap.mjs <show-in.json> [show-out.json]
//   (defaults out to "<in>.tent.json"). Operates on a LED Zeppelin SHOW export
//   (the JSON under localStorage 'ledzeppelin.show').

import { readFileSync, writeFileSync } from 'node:fs';

// Canvas-Y (normalised, TOP-DOWN: 0 = top, 1 = bottom) for the crest and the feet.
// Small margins keep the extreme LEDs off the very edge.
export const CREST_Y = 0.04;   // top of canvas = highest point of each arch
export const FEET_Y  = 0.96;   // bottom of canvas = where the arch meets the ground

// Tent height 0..1 along a strip (0 at both ends, 1 at the middle) → canvas-Y.
const tentY = (t) => FEET_Y - (1 - Math.abs(2 * t - 1)) * (FEET_Y - CREST_Y);

// X along a polyline at arc-length fraction `frac` (0..1). Used to place the crest
// vertex at the strip's true midpoint for curved (polyline) fixtures.
function interpX(pts, cum, total, frac) {
  const target = frac * total;
  for (let i = 1; i < pts.length; i++) {
    if (target <= cum[i] || i === pts.length - 1) {
      const segLen = cum[i] - cum[i - 1];
      const u = segLen <= 0 ? 0 : (target - cum[i - 1]) / segLen;
      return pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u;
    }
  }
  return pts[pts.length - 1][0];
}

// Rebuild one fixture's input.points into a ∩ tent (keeps each point's X, maps its
// Y to the tent, and guarantees a crest vertex at the midpoint). Returns true if it
// changed the fixture. Skips grids and degenerate / non-polyline inputs.
export function tentFixture(f) {
  const input = f && f.input;
  // Skip matrices/grids (every fixture carries cols/rows, default 1 — a grid is
  // rows>1 or an explicit grid input; see model/grid.js isGridFixture).
  if (!input || (Number(f.rows) || 1) > 1 || input.mode === 'grid') return false;
  const P = input.points;
  if (!Array.isArray(P) || P.length < 2) return false;      // need a polyline

  // Cumulative arc length → per-vertex fraction t∈[0,1].
  const cum = [0];
  let total = 0;
  for (let i = 1; i < P.length; i++) {
    total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    cum.push(total);
  }
  if (total <= 0) return false;                             // zero-length strip

  const t = cum.map((c) => c / total);
  const pts = P.map((p, i) => [p[0], tentY(t[i])]);         // keep X, tent the Y

  // Ensure an exact crest vertex at the midpoint (a 2-point bar has none, so its
  // middle would otherwise interpolate flat — no peak).
  if (!t.some((ti) => Math.abs(ti - 0.5) < 1e-3)) {
    const xc = interpX(P, cum, total, 0.5);
    const idx = t.findIndex((ti) => ti > 0.5);
    pts.splice(idx < 0 ? pts.length : idx, 0, [xc, CREST_Y]);
  }

  input.points = pts;
  input.mode = 'polyline';
  input.samples = input.samples || f.pixelCount || pts.length;
  input.reversed = false;
  delete input.transform;                                  // polyline points are canonical
  return true;
}

// Transform a whole show in place; returns { changed, total }.
export function tentShow(show) {
  const fixtures = (show && show.fixtures) || [];
  let changed = 0;
  for (const f of fixtures) if (tentFixture(f)) changed++;
  return { changed, total: fixtures.length };
}

// --- CLI --------------------------------------------------------------------
const inPath = process.argv[2];
if (inPath) {
  const outPath = process.argv[3] || inPath.replace(/\.json$/i, '') + '.tent.json';
  const show = JSON.parse(readFileSync(inPath, 'utf8'));
  const { changed, total } = tentShow(show);
  writeFileSync(outPath, JSON.stringify(show));
  console.log(`tent-remap: ${changed}/${total} fixtures → ∩  ·  wrote ${outPath}`);
}
