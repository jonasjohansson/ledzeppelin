import { samplePoints } from '../model/sampling.js';
import { buildPipelineInputs } from '../model/pipeline.js';
import { chainOffset } from '../model/chains.js';
import {
  setFixtureTransform, isPolylineFixture,
  setFixturePoints, setFixtureVertex, addFixtureVertex, removeFixtureVertex,
} from '../model/fixture-transform.js';

// Virtual-fixture preview: draws each fixture's resampled points onto a 2D
// overlay canvas, colored by the latest sampled RGB. Hardware-free dev view.
//
// A fixture is either a BAR (a single straight segment with a centre handle) or
// a POLYLINE (a bendable, multi-segment run with a handle at every vertex) — see
// fixture-transform.js. The polyline lets one daisy-chained run zig-zag or sit
// as side-by-side segments while keeping contiguous pixel indices.
//
// `rgba` is the flat RGBA8 readback from the sampler, ordered by the same
// fixture concatenation order app.js uses (fixtures sorted by output.pixelOffset
// ascending). We recompute that ordering via buildPipelineInputs().
export function createPreview(canvasEl, opts = {}) {
  const ctx = canvasEl.getContext('2d');
  const dotR = opts.dotRadius ?? 4;
  const showLabels = opts.labels ?? true;

  const isSelected = (sel, id) => sel && (sel.has ? sel.has(id) : sel === id);

  function draw(show, rgba, selectedIds = null, snapGrid = 0, guides = null) {
    const W = canvasEl.width, Hh = canvasEl.height;
    // Transparent overlay: the live composite (WebGL stage) shows THROUGH.
    ctx.clearRect(0, 0, W, Hh);
    if (snapGrid > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += snapGrid) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, Hh); ctx.stroke(); }
      for (let y = 0; y <= Hh; y += snapGrid) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    }
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
      if (f.hidden) continue;
      const span = spans[fi];
      const pts = samplePoints(f.input.points, f.input.samples);
      const [ox, oy] = chainOffset(show, f.id);   // dots show WHERE it samples (cascade)

      // Sampled pixel dots, colored by the live readback.
      for (let i = 0; i < pts.length; i++) {
        const [u, v] = pts[i];
        const x = (u + ox) * W, y = (v + oy) * Hh;
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

      const selected = isSelected(selectedIds, f.id);
      const stroke = selected ? '#e8b27f' : '#5cc8ff';
      const eps = f.input.points;

      if (isPolylineFixture(f.input)) {
        // Footprint: the full polyline + a square handle at every vertex.
        ctx.beginPath();
        ctx.moveTo(eps[0][0] * W, eps[0][1] * Hh);
        for (let i = 1; i < eps.length; i++) ctx.lineTo(eps[i][0] * W, eps[i][1] * Hh);
        ctx.strokeStyle = stroke; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.stroke();
        // Mark the START with a filled dot so chain order / direction reads.
        for (let i = 0; i < eps.length; i++) {
          const hx = eps[i][0] * W, hy = eps[i][1] * Hh;
          const s = (selected ? 4 : 3);
          ctx.beginPath(); ctx.rect(hx - s, hy - s, s * 2, s * 2);
          ctx.fillStyle = i === 0 ? stroke : 'rgba(20,20,24,.85)';
          ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.25; ctx.stroke();
        }
        if (showLabels) drawLabel(f, eps[0][0] * W, eps[0][1] * Hh - 10, selected, W, Hh);
        continue;
      }

      // BAR: a rotated rectangle (w×h) with a centre handle.
      const ax = eps[0][0] * W, ay = eps[0][1] * Hh;
      const bx = eps[eps.length - 1][0] * W, by = eps[eps.length - 1][1] * Hh;
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const perpX = -dy / len, perpY = dx / len;
      const cv = show.composition?.canvas || { w: W, h: Hh };
      const halfThick = ((f.input.transform?.h ?? 8) / 2) * (Hh / (cv.h || Hh));
      ctx.beginPath();
      ctx.moveTo(ax + perpX * halfThick, ay + perpY * halfThick);
      ctx.lineTo(bx + perpX * halfThick, by + perpY * halfThick);
      ctx.lineTo(bx - perpX * halfThick, by - perpY * halfThick);
      ctx.lineTo(ax - perpX * halfThick, ay - perpY * halfThick);
      ctx.closePath();
      ctx.strokeStyle = stroke; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.stroke();

      const cx = (ax + bx) / 2, cy = (ay + by) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, dotR + (selected ? 5 : 3), 0, Math.PI * 2);
      ctx.fillStyle = selected ? 'rgba(232,178,127,.3)' : 'rgba(92,200,255,.25)'; ctx.fill();
      ctx.strokeStyle = stroke; ctx.stroke();
      if (showLabels) drawLabel(f, cx, cy - 10, selected, W, Hh);
    }
  }

  function drawLabel(f, cx, cy, selected, W, Hh) {
    const label = f.name || f.id;
    ctx.font = '11px "Spline Sans Mono", ui-monospace, Menlo, monospace';
    const tw = ctx.measureText(label).width;
    const lx = Math.max(3, Math.min(W - tw - 3, cx - tw / 2));
    const ly = Math.max(12, Math.min(Hh - 4, cy));
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(lx - 3, ly - 11, tw + 6, 15);
    ctx.fillStyle = selected ? '#e8b27f' : '#8fd6e8';
    ctx.fillText(label, lx, ly);
  }

  return { draw };
}

// Drag-placement on the Output overlay:
//   • drag a fixture body → move the whole fixture (bar transform x/y, or all
//     polyline points)
//   • drag a polyline vertex → reshape that bend
//   • double-click a segment → insert a vertex (a bar becomes a bendable run)
//   • right-click a vertex → remove it
// Edits derive a new show and call onEdit(next) per move; onCommit on release.
export function enableDragPlacement(canvasEl, { getShow, onEdit, onCommit, onSelect, getSelected, snap }, opts = {}) {
  const hitR = opts.hitRadius ?? 18;
  const vtxR = opts.vertexRadius ?? 9;
  let dragState = null;
  let enabled = opts.enabled ?? true;

  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  const localPx = (ev) => {
    const r = canvasEl.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top, r.width, r.height];
  };

  // Hit-test reversed (topmost wins). Returns {fxId} for a body hit, or
  // {fxId, vertex:i} when a polyline vertex handle is grabbed.
  function hitTest(ev) {
    const show = getShow();
    const [px, py, rw, rh] = localPx(ev);
    const fixtures = show.fixtures ?? [];
    for (let i = fixtures.length - 1; i >= 0; i--) {
      const f = fixtures[i];
      const pts = f.input.points;
      if (isPolylineFixture(f.input)) {
        for (let v = 0; v < pts.length; v++) {            // vertices first (precise)
          if (Math.hypot(px - pts[v][0] * rw, py - pts[v][1] * rh) <= vtxR) return { fxId: f.id, vertex: v };
        }
        for (let v = 0; v < pts.length - 1; v++) {        // then any segment (body)
          if (segDist(px, py, pts[v][0] * rw, pts[v][1] * rh, pts[v + 1][0] * rw, pts[v + 1][1] * rh) <= hitR) return { fxId: f.id, seg: v };
        }
      } else {
        const ax = pts[0][0] * rw, ay = pts[0][1] * rh;
        const bx = pts[pts.length - 1][0] * rw, by = pts[pts.length - 1][1] * rh;
        if (segDist(px, py, ax, ay, bx, by) <= hitR) return { fxId: f.id, seg: 0 };
      }
    }
    return null;
  }

  const canvasPx = (ev, cv) => {
    const r = canvasEl.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width * cv.w, (ev.clientY - r.top) / r.height * cv.h];
  };
  const norm = (ev) => {
    const r = canvasEl.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  };

  canvasEl.addEventListener('pointerdown', (ev) => {
    if (!enabled) return;
    const hit = hitTest(ev);
    onSelect?.(hit ? hit.fxId : null, ev);
    if (!hit) return;
    const show = getShow();
    const cv = show.composition?.canvas || { w: 1280, h: 720 };

    if (hit.vertex != null) {
      dragState = { kind: 'vertex', id: hit.fxId, index: hit.vertex };
    } else {
      // Whole-fixture move — group with the selection if part of a multi-select.
      const sel = getSelected?.();
      const ids = (sel?.has?.(hit.fxId) && sel.size > 1) ? [...sel] : [hit.fxId];
      const items = ids.map((id) => {
        const f = show.fixtures.find((x) => x.id === id);
        if (!f) return null;
        if (isPolylineFixture(f.input)) return { id, mode: 'poly', pts0: f.input.points.map((p) => p.slice()) };
        const tf = f.input?.transform;
        return tf ? { id, mode: 'bar', x0: tf.x, y0: tf.y } : null;
      }).filter(Boolean);
      const [px0, py0] = canvasPx(ev, cv);
      const [nx0, ny0] = norm(ev);
      dragState = { kind: 'move', items, px0, py0, nx0, ny0, cv };
    }
    canvasEl.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  canvasEl.addEventListener('pointermove', (ev) => {
    if (!enabled || !dragState) return;
    let next = getShow();
    if (dragState.kind === 'vertex') {
      const [nx, ny] = norm(ev);
      next = setFixtureVertex(next, dragState.id, dragState.index, nx, ny);
    } else {
      const [pxNow, pyNow] = canvasPx(ev, dragState.cv);
      const dxPx = pxNow - dragState.px0, dyPx = pyNow - dragState.py0;
      const [nxNow, nyNow] = norm(ev);
      const dxN = nxNow - dragState.nx0, dyN = nyNow - dragState.ny0;
      const draggedIds = dragState.items.map((it) => it.id);
      for (const it of dragState.items) {
        if (it.mode === 'poly') {
          next = setFixturePoints(next, it.id, it.pts0.map(([x, y]) => [x + dxN, y + dyN]));
        } else {
          let nx = it.x0 + dxPx, ny = it.y0 + dyPx;
          if (snap) { const s = snap(nx, ny, it.id, draggedIds); nx = s[0]; ny = s[1]; }
          next = setFixtureTransform(next, it.id, { x: nx, y: ny });
        }
      }
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

  // Double-click a fixture body → insert a vertex there (bend / segment the run).
  canvasEl.addEventListener('dblclick', (ev) => {
    if (!enabled) return;
    const hit = hitTest(ev);
    if (!hit || hit.vertex != null) return;
    const [nx, ny] = norm(ev);
    const next = addFixtureVertex(getShow(), hit.fxId, hit.seg ?? 0, [nx, ny]);
    onCommit?.(next);
    ev.preventDefault();
  });

  // Right-click a vertex → remove it.
  canvasEl.addEventListener('contextmenu', (ev) => {
    if (!enabled) return;
    const hit = hitTest(ev);
    if (hit && hit.vertex != null) {
      ev.preventDefault();
      onCommit?.(removeFixtureVertex(getShow(), hit.fxId, hit.vertex));
    }
  });

  return {
    setEnabled(v) { enabled = !!v; if (!enabled) dragState = null; },
    isEnabled() { return enabled; },
  };
}
