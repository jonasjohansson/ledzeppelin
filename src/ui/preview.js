import { samplePoints } from '../model/sampling.js';
import { buildPipelineInputs } from '../model/pipeline.js';
import { setFixtureTransform } from '../model/fixture-transform.js';

// Virtual-fixture preview: draws each fixture's resampled points onto a 2D
// overlay canvas, colored by the latest sampled RGB. Hardware-free dev view.
//
// `rgba` is the flat RGBA8 readback from the sampler, ordered by the same
// fixture concatenation order app.js uses (fixtures sorted by
// output.pixelOffset ascending). We recompute that ordering via
// buildPipelineInputs() so the color spans line up exactly.
export function createPreview(canvasEl, opts = {}) {
  const ctx = canvasEl.getContext('2d');
  const dotR = opts.dotRadius ?? 4;
  const showLabels = opts.labels ?? true;

  function draw(show, rgba, selectedId = null) {
    const W = canvasEl.width, Hh = canvasEl.height;
    // Transparent overlay: the live composite (WebGL stage) shows THROUGH, so in
    // Output you see the canvas content and can place fixtures over it.
    ctx.clearRect(0, 0, W, Hh);
    if (!show || !show.fixtures?.length) return;

    const { fixtureOrder, spans } = buildPipelineInputs(show);

    for (let fi = 0; fi < fixtureOrder.length; fi++) {
      const f = fixtureOrder[fi];
      const span = spans[fi];
      const pts = samplePoints(f.input.points, f.input.samples);

      for (let i = 0; i < pts.length; i++) {
        const [u, v] = pts[i];
        const x = u * W, y = v * Hh;
        let r = 30, g = 30, b = 30;
        if (rgba) {
          const idx = (span.start + i) * 4;
          if (idx + 2 <= rgba.length - 1) { r = rgba[idx]; g = rgba[idx + 1]; b = rgba[idx + 2]; }
        }
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();
      }

      // Fixture footprint: a rotated rectangle (w×h) with a CENTRE handle. The
      // whole fixture is repositioned by dragging the centre (see
      // enableDragPlacement); width/height/rotation are set numerically.
      const eps = f.input.points;
      const ax = eps[0][0] * W, ay = eps[0][1] * Hh;
      const bx = eps[eps.length - 1][0] * W, by = eps[eps.length - 1][1] * Hh;
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const perpX = -dy / len, perpY = dx / len; // unit perpendicular
      const cv = show.composition?.canvas || { w: W, h: Hh };
      const halfThick = ((f.input.transform?.h ?? 8) / 2) * (Hh / (cv.h || Hh));
      ctx.beginPath();
      ctx.moveTo(ax + perpX * halfThick, ay + perpY * halfThick);
      ctx.lineTo(bx + perpX * halfThick, by + perpY * halfThick);
      ctx.lineTo(bx - perpX * halfThick, by - perpY * halfThick);
      ctx.lineTo(ax - perpX * halfThick, ay - perpY * halfThick);
      ctx.closePath();
      const selected = f.id === selectedId;
      const stroke = selected ? '#e8b27f' : '#5cc8ff';
      ctx.strokeStyle = stroke; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.stroke();

      const cx = (ax + bx) / 2, cy = (ay + by) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, dotR + (selected ? 5 : 3), 0, Math.PI * 2);
      ctx.fillStyle = selected ? 'rgba(232,178,127,.3)' : 'rgba(92,200,255,.25)'; ctx.fill();
      ctx.strokeStyle = stroke; ctx.stroke();
      if (showLabels) {
        ctx.fillStyle = '#8fd6e8';
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText(f.name || f.id, cx + 8, cy - 8);
      }
    }
  }

  return { draw };
}

// Drag-placement: hit-test a fixture's CENTRE handle on the preview canvas and
// let the user drag to reposition the whole fixture (its pixel-space transform
// x/y). On every move it derives a new show via setFixtureTransform and calls
// onEdit(nextShow); on release onCommit. Width/height/rotation are numeric.
export function enableDragPlacement(canvasEl, { getShow, onEdit, onCommit, onSelect }, opts = {}) {
  const hitR = opts.hitRadius ?? 14;
  let dragging = null; // { fxId }
  // Gate: drag editing is only active when enabled (Output tab → Input mode).
  let enabled = opts.enabled ?? true;

  const toNorm = (ev) => {
    const r = canvasEl.getBoundingClientRect();
    return [
      (ev.clientX - r.left) / r.width,
      (ev.clientY - r.top) / r.height,
    ];
  };

  const centreOf = (f) => {
    const pts = f.input.points;
    return [
      (pts[0][0] + pts[pts.length - 1][0]) / 2,
      (pts[0][1] + pts[pts.length - 1][1]) / 2,
    ];
  };

  function hitTest(ev) {
    const show = getShow();
    const r = canvasEl.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    for (const f of show.fixtures ?? []) {
      const [u, v] = centreOf(f);
      if (Math.hypot(u * r.width - px, v * r.height - py) <= hitR) return { fxId: f.id };
    }
    return null;
  }

  canvasEl.addEventListener('pointerdown', (ev) => {
    if (!enabled) return;
    const hit = hitTest(ev);
    if (!hit) return;
    dragging = hit;
    onSelect?.(hit.fxId);
    canvasEl.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  canvasEl.addEventListener('pointermove', (ev) => {
    if (!enabled || !dragging) return;
    const [u, v] = toNorm(ev);
    const show = getShow();
    const cv = show.composition?.canvas || { w: 1280, h: 720 };
    const next = setFixtureTransform(show, dragging.fxId, {
      x: Math.max(0, Math.min(1, u)) * cv.w,
      y: Math.max(0, Math.min(1, v)) * cv.h,
    });
    onEdit?.(next);
  });

  function end(ev) {
    if (!dragging) return;
    dragging = null;
    try { canvasEl.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
    onCommit?.(getShow());
  }
  canvasEl.addEventListener('pointerup', end);
  canvasEl.addEventListener('pointercancel', end);

  // Handle: lets the caller gate drag editing on view state (tab + mode).
  // Disabling mid-drag drops any in-progress drag so it can't commit later.
  return {
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) dragging = null;
    },
    isEnabled() { return enabled; },
  };
}
