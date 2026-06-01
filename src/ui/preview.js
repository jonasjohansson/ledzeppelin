import { samplePoints } from '../model/sampling.js';
import { buildPipelineInputs } from '../model/pipeline.js';

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

  function draw(show, rgba) {
    const W = canvasEl.width, Hh = canvasEl.height;
    ctx.clearRect(0, 0, W, Hh);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, Hh);
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

      // Endpoint handles (for drag editing) + optional label.
      const eps = f.input.points;
      for (const [u, v] of [eps[0], eps[eps.length - 1]]) {
        ctx.beginPath();
        ctx.arc(u * W, v * Hh, dotR + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#4af';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (showLabels) {
        const [u, v] = eps[0];
        ctx.fillStyle = '#9ad';
        ctx.font = '11px system-ui';
        ctx.fillText(f.name || f.id, u * W + 8, v * Hh - 8);
      }
    }
  }

  return { draw };
}

// Drag-placement: hit-test fixture endpoints on the preview canvas and let the
// user drag them to edit input.points live (normalized 0..1). On every drag
// move it mutates the show and calls onEdit(nextShow); on release onCommit.
export function enableDragPlacement(canvasEl, { getShow, onEdit, onCommit }, opts = {}) {
  const hitR = opts.hitRadius ?? 12;
  let dragging = null; // { fxId, end: 'first' | 'last' }
  // Gate: drag editing is only active when enabled (Output tab → Input mode).
  // Starts enabled to preserve prior always-on behavior unless the caller toggles.
  let enabled = opts.enabled ?? true;

  const toNorm = (ev) => {
    const r = canvasEl.getBoundingClientRect();
    return [
      (ev.clientX - r.left) / r.width,
      (ev.clientY - r.top) / r.height,
    ];
  };

  function hitTest(ev) {
    const show = getShow();
    const r = canvasEl.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    for (const f of show.fixtures ?? []) {
      const pts = f.input.points;
      const ends = [['first', pts[0]], ['last', pts[pts.length - 1]]];
      for (const [end, [u, v]] of ends) {
        const dx = u * r.width - px, dy = v * r.height - py;
        if (Math.hypot(dx, dy) <= hitR) return { fxId: f.id, end };
      }
    }
    return null;
  }

  canvasEl.addEventListener('pointerdown', (ev) => {
    if (!enabled) return;
    const hit = hitTest(ev);
    if (!hit) return;
    dragging = hit;
    canvasEl.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  canvasEl.addEventListener('pointermove', (ev) => {
    if (!enabled || !dragging) return;
    const [u, v] = toNorm(ev);
    const next = structuredClone(getShow());
    const f = next.fixtures.find((x) => x.id === dragging.fxId);
    if (!f) { dragging = null; return; }
    const pts = f.input.points;
    const i = dragging.end === 'first' ? 0 : pts.length - 1;
    pts[i] = [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))];
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
