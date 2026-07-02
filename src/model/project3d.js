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

// Default ORBIT (view-only inspect camera) for a fresh 3D view: a gentle
// over-the-shoulder three-quarter view of the canvas plane.
export const DEFAULT_ORBIT = { az: -30, el: 20, dist: 1.6 };

// toggleView3d(show): flip composition.view3d.mode between '2d' and '3d' (pure —
// returns a new show). Entering 3D initializes (or reuses) the view state:
//   • projectionCamera: FLAT — Phase 2's 3D mode is a VIEWPORT (arrange/inspect
//     the rig in 3D); the OUTPUT still projects flat-front, so the sampled UVs
//     are byte-identical in both modes. The projection-camera placement UI is a
//     later phase (then this default changes to a placeable front-ortho camera).
//   • orbit: az/el/dist of the view-only inspect camera (persisted so the view
//     survives a mode round-trip and a reload).
// Leaving 3D keeps the camera + orbit so re-entering restores the same view.
export function toggleView3d(show) {
  const comp = show.composition || {};
  const cur = comp.view3d;
  const entering = !cur || cur.mode !== '3d';
  const view3d = entering
    ? { ...cur, mode: '3d',
        projectionCamera: cur?.projectionCamera ?? flatCamera(),
        orbit: cur?.orbit ?? { ...DEFAULT_ORBIT } }
    : { ...cur, mode: '2d' };
  return { ...show, composition: { ...comp, view3d } };
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

// --- Orbit (view-only) camera for the 3D viewport ---------------------------
// Gesture clamps shared by the viewport and its pointer/wheel handlers.
export const ORBIT_EL_MIN = -5, ORBIT_EL_MAX = 85;
export const ORBIT_DIST_MIN = 0.5, ORBIT_DIST_MAX = 5;

// orbitCamera(orbit, aspect): the INSPECT camera the 3D viewport renders
// through, built from { az, el, dist, target } around a point on the canvas
// plane (default the canvas centre [0.5, 0.5, 0]). In the viewport, world z is
// "up" — strips lift off the z=0 ground/canvas plane — so the camera's up is
// +z; azimuth 0 looks from beyond the canvas top edge, elevation tilts down
// onto the plane. This camera is NEVER used for sampling (the projection
// camera is separate — see cameraFromView3d); it only draws the scene.
export function orbitCamera(orbit = {}, aspect = 1) {
  const az = ((Number(orbit.az) || 0) * Math.PI) / 180;
  const elDeg = Math.max(ORBIT_EL_MIN, Math.min(ORBIT_EL_MAX, Number(orbit.el) || 0));
  const el = (elDeg * Math.PI) / 180;
  const dist = Math.max(ORBIT_DIST_MIN, Math.min(ORBIT_DIST_MAX, Number(orbit.dist) || 1.6));
  const t = Array.isArray(orbit.target) ? orbit.target : [0.5, 0.5, 0];
  const tz = Number(t[2]) || 0;
  const c = Math.cos(el), s = Math.sin(el);
  const pos = [t[0] + dist * c * Math.sin(az), t[1] - dist * c * Math.cos(az), tz + dist * s];
  return perspectiveCamera({ pos, target: [t[0], t[1], tz], up: [0, 0, 1], fov: 50, aspect });
}

// cameraBasis(cam): the camera's unit right / up / forward vectors in world
// space — what a screen-space pan gesture needs to move the orbit target.
export function cameraBasis(cam) {
  const f = normalize(sub(cam.target, cam.pos));
  const r = normalize(cross(f, cam.up));
  const u = cross(r, f);
  return { r, u, f };
}

// unproject(u, v, cam): the world-space RAY through the screen point (u, v) —
// the inverse of projectFramed, for dragging vertices in the 3D viewport.
// Returns { origin, dir } (dir unit length). Perspective: origin = the eye,
// dir through the film point. Ortho: origin = the film point on the camera
// plane, dir = forward (parallel rays). The FLAT camera is not a viewport
// camera (it has no eye), so it returns null — 2D mode never unprojects.
export function unproject(u, v, cam) {
  if (!cam || cam.mode === 'flat') return null;
  const f = normalize(sub(cam.target, cam.pos)); // forward
  const r = normalize(cross(f, cam.up));          // right
  const up = cross(r, f);                          // true up (unit)
  const ndcx = u * 2 - 1;
  const ndcy = 1 - v * 2;                          // v grows downward on screen
  if (cam.mode === 'ortho') {
    const ox = ndcx * (cam.orthoHeight * cam.aspect) / 2;
    const oy = ndcy * cam.orthoHeight / 2;
    return {
      origin: [cam.pos[0] + r[0] * ox + up[0] * oy,
        cam.pos[1] + r[1] * ox + up[1] * oy,
        cam.pos[2] + r[2] * ox + up[2] * oy],
      dir: f,
    };
  }
  const t = Math.tan((cam.fov * Math.PI / 180) / 2);
  const dx = ndcx * t * cam.aspect, dy = ndcy * t;
  return {
    origin: [cam.pos[0], cam.pos[1], cam.pos[2]],
    dir: normalize([f[0] + r[0] * dx + up[0] * dy,
      f[1] + r[1] * dx + up[1] * dy,
      f[2] + r[2] * dx + up[2] * dy]),
  };
}

// rayPlaneZ(ray, z): intersect a ray with the HORIZONTAL plane at height z
// (world z = height off the canvas plane). Returns [x, y, z] with z exact, or
// null when the ray is parallel to the plane or the hit is behind the origin —
// so a drag can simply keep the previous position on a degenerate frame.
export function rayPlaneZ(ray, z) {
  if (!ray) return null;
  const dz = ray.dir[2];
  if (Math.abs(dz) < 1e-9) return null;              // parallel — no hit
  const t = (z - ray.origin[2]) / dz;
  if (t <= 0) return null;                           // behind the ray origin
  return [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, z];
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
