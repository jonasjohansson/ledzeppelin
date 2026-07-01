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

// cameraFromView3d(view3d): resolve the projection camera for a composition's
// view3d state. In 2D mode (absent view3d, or mode !== '3d') return the flat
// camera so projection is a no-op (byte-identical with today). In 3D mode use
// the view's projectionCamera when it looks like a valid camera; otherwise fall
// back to flat so a half-configured 3D view can't crash the pipeline.
export function cameraFromView3d(view3d) {
  if (!view3d || view3d.mode !== '3d') return flatCamera();
  const cam = view3d.projectionCamera;
  if (cam && typeof cam === 'object' && typeof cam.mode === 'string') return cam;
  return flatCamera();
}

// perspectiveCamera: a pinhole camera framing the world with a vertical FOV.
// pos: eye position, target: look-at point, up: world up (default +y),
// fov: vertical field of view in degrees, aspect: width/height (default 1).
export function perspectiveCamera({ pos, target, up = [0, 1, 0], fov, aspect = 1 }) {
  return { mode: 'perspective', pos, target, up, fov, aspect };
}

// orthoCamera: a parallel-projection camera. Same basis as perspective but no
// depth divide; the frame is orthoHeight tall (world units) and
// orthoHeight*aspect wide.
export function orthoCamera({ pos, target, up = [0, 1, 0], orthoHeight, aspect = 1 }) {
  return { mode: 'ortho', pos, target, up, orthoHeight, aspect };
}

// project(P, cam): map a world point [x, y, z] to a 2D sample point [x, y].
// Flat (or absent) camera returns [P[0], P[1]] exactly — no math, no drift.
export function project(P, cam) {
  if (!cam || cam.mode === 'flat') return [P[0], P[1]];
  return projectFramed(P, cam);
}

// Vector helpers (3-component arrays).
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function normalize(a) {
  const len = Math.hypot(a[0], a[1], a[2]);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

// projectFramed(P, cam): project a world point through a perspective or ortho
// camera into UV space [0..1, 0..1], v flipped so +y world (up) → smaller v.
// Points at or behind the camera plane (depth ≤ 1e-6) return [NaN, NaN] so
// callers can drop them rather than render a mirrored/degenerate sample.
function projectFramed(P, cam) {
  const f = normalize(sub(cam.target, cam.pos)); // forward
  const r = normalize(cross(f, cam.up));          // right
  const u = cross(r, f);                           // true up (already unit)

  const d = sub(P, cam.pos);
  const cx = dot(d, r);
  const cy = dot(d, u);
  const cz = dot(d, f); // depth in front of camera (>0)

  if (cz <= 1e-6) return [NaN, NaN]; // behind/at camera plane — undefined

  let ndcx, ndcy;
  if (cam.mode === 'ortho') {
    ndcx = cx / ((cam.orthoHeight * cam.aspect) / 2);
    ndcy = cy / (cam.orthoHeight / 2);
  } else {
    const t = Math.tan((cam.fov * Math.PI / 180) / 2);
    ndcx = cx / (cz * t * cam.aspect);
    ndcy = cy / (cz * t);
  }

  return [(ndcx + 1) / 2, (1 - ndcy) / 2];
}
