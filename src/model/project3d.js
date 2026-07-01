// project3d — pure 3D→2D projection seam for fixture mapping.
//
// World coordinates share today's normalized canvas space: x, y ∈ 0..1, with
// z in the same unit scale and z = 0 being the canvas plane. A fixture point is
// [x, y, z]; projecting it yields the [x, y] sample position on the 2D
// composition.
//
// 2D mode is a special case: the flat-front camera drops z and returns [x, y]
// unchanged, reproducing today's behavior exactly (byte-identical, no float
// drift). Perspective/ortho framed cameras arrive in Task 2 via projectFramed.

export function flatCamera() {
  return { mode: 'flat' };
}

// project(P, cam): map a world point [x, y, z] to a 2D sample point [x, y].
// Flat (or absent) camera returns [P[0], P[1]] exactly — no math, no drift.
export function project(P, cam) {
  if (!cam || cam.mode === 'flat') return [P[0], P[1]];
  return projectFramed(P, cam);
}

function projectFramed(P, cam) {
  throw new Error('projectFramed not implemented until Task 2');
}
