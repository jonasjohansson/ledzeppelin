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

  const isSelected = (sel, id) => sel && (sel.has ? sel.has(id) : sel === id);

  function draw(show, rgba, selectedIds = null, snapGrid = 0, guides = null) {
    const W = canvasEl.width, Hh = canvasEl.height;
    // Transparent overlay: the live composite (WebGL stage) shows THROUGH, so in
    // Output you see the canvas content and can place fixtures over it.
    ctx.clearRect(0, 0, W, Hh);
    // Snap grid (Output snap mode).
    if (snapGrid > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += snapGrid) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, Hh); ctx.stroke(); }
      for (let y = 0; y <= Hh; y += snapGrid) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    }
    // Alignment guides (snapping to other fixtures / canvas centre).
    if (guides && guides.length) {
      ctx.strokeStyle = 'rgba(232,178,127,.85)'; ctx.lineWidth = 1;
      for (const g of guides) {
        ctx.beginPath();
        if (g.axis === 'x') { ctx.moveTo(g.v + 0.5, 0); ctx.lineTo(g.v + 0.5, Hh); }
        else { ctx.moveTo(0, g.v + 0.5); ctx.lineTo(W, g.v + 0.5); }
        ctx.stroke();
      }
    }
    if (!show || !show.fixtures?.length) return;

    const { fixtureOrder, spans } = buildPipelineInputs(show);

    for (let fi = 0; fi < fixtureOrder.length; fi++) {
      const f = fixtureOrder[fi];
      if (f.hidden) continue; // visibility toggle: skip the overlay for hidden fixtures
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
      const selected = isSelected(selectedIds, f.id);
      const stroke = selected ? '#e8b27f' : '#5cc8ff';
      ctx.strokeStyle = stroke; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.stroke();

      const cx = (ax + bx) / 2, cy = (ay + by) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, dotR + (selected ? 5 : 3), 0, Math.PI * 2);
      ctx.fillStyle = selected ? 'rgba(232,178,127,.3)' : 'rgba(92,200,255,.25)'; ctx.fill();
      ctx.strokeStyle = stroke; ctx.stroke();
      if (showLabels) {
        const label = f.name || f.id;
        ctx.font = '11px ui-monospace, Menlo, monospace';
        const tw = ctx.measureText(label).width;
        let lx = Math.max(3, Math.min(W - tw - 3, cx - tw / 2)); // centred on the bar, clamped
        let ly = Math.max(12, Math.min(Hh - 4, cy - 10));
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(lx - 3, ly - 11, tw + 6, 15);
        ctx.fillStyle = selected ? '#e8b27f' : '#8fd6e8';
        ctx.fillText(label, lx, ly);
      }
    }
  }

  return { draw };
}

// Drag-placement: hit-test a fixture's CENTRE handle on the preview canvas and
// let the user drag to reposition the whole fixture (its pixel-space transform
// x/y). On every move it derives a new show via setFixtureTransform and calls
// onEdit(nextShow); on release onCommit. Width/height/rotation are numeric.
export function enableDragPlacement(canvasEl, { getShow, onEdit, onCommit, onSelect, getSelected, snap }, opts = {}) {
  const hitR = opts.hitRadius ?? 18;
  let dragState = null; // { items:[{id,x0,y0}], px0, py0, cv }
  // Gate: drag editing is only active when enabled (Output tab → Input mode).
  let enabled = opts.enabled ?? true;

  const toNorm = (ev) => {
    const r = canvasEl.getBoundingClientRect();
    return [
      (ev.clientX - r.left) / r.width,
      (ev.clientY - r.top) / r.height,
    ];
  };

  // Distance (px) from point P to segment A–B.
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  // Hit-test: clicking ANYWHERE on the fixture bar selects it (point-to-segment
  // distance, not just the centre handle). Iterate reversed so the topmost wins.
  function hitTest(ev) {
    const show = getShow();
    const r = canvasEl.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const fixtures = show.fixtures ?? [];
    for (let i = fixtures.length - 1; i >= 0; i--) {
      const pts = fixtures[i].input.points;
      const ax = pts[0][0] * r.width, ay = pts[0][1] * r.height;
      const bx = pts[pts.length - 1][0] * r.width, by = pts[pts.length - 1][1] * r.height;
      if (segDist(px, py, ax, ay, bx, by) <= hitR) return { fxId: fixtures[i].id };
    }
    return null;
  }

  const canvasPx = (ev, cv) => {
    const r = canvasEl.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width * cv.w, (ev.clientY - r.top) / r.height * cv.h];
  };

  canvasEl.addEventListener('pointerdown', (ev) => {
    if (!enabled) return;
    const hit = hitTest(ev);
    onSelect?.(hit ? hit.fxId : null, ev); // updates selection (shift = add); null clears
    if (!hit) return;
    // Capture the group to drag together: the whole selection if the clicked
    // fixture is part of a multi-selection, else just it.
    const show = getShow();
    const cv = show.composition?.canvas || { w: 1280, h: 720 };
    const sel = getSelected?.();
    const ids = (sel?.has?.(hit.fxId) && sel.size > 1) ? [...sel] : [hit.fxId];
    const items = ids
      .map((id) => { const tf = show.fixtures.find((x) => x.id === id)?.input?.transform; return tf ? { id, x0: tf.x, y0: tf.y } : null; })
      .filter(Boolean);
    const [px0, py0] = canvasPx(ev, cv);
    dragState = { items, px0, py0, cv };
    canvasEl.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  canvasEl.addEventListener('pointermove', (ev) => {
    if (!enabled || !dragState) return;
    const [pxNow, pyNow] = canvasPx(ev, dragState.cv);
    const dx = pxNow - dragState.px0, dy = pyNow - dragState.py0;
    const draggedIds = dragState.items.map((it) => it.id);
    let next = getShow();
    for (const it of dragState.items) {
      let nx = it.x0 + dx, ny = it.y0 + dy;
      if (snap) { const s = snap(nx, ny, it.id, draggedIds); nx = s[0]; ny = s[1]; }
      next = setFixtureTransform(next, it.id, { x: nx, y: ny });
    }
    onEdit?.(next);
  });

  function end(ev) {
    if (!dragState) return;
    dragState = null;
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
      if (!enabled) dragState = null;
    },
    isEnabled() { return enabled; },
  };
}
