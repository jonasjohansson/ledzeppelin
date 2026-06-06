import { samplePoints } from '../model/sampling.js';
import { buildPipelineInputs } from '../model/pipeline.js';
import { chainOffset, runsOf, runKey, controllerColorMap } from '../model/chains.js';
import {
  setFixtureTransform, isPolylineFixture, snapDeg, transformFromPoints,
  setFixturePoints, setFixtureVertex, addFixtureVertex, removeFixtureVertex, fixtureLabel,
} from '../model/fixture-transform.js';

// Rotate-knob offset from a selected bar's centre, in NORMALIZED canvas units
// (so draw() and hitTest() — which use different pixel scales — agree).
const ROTATE_KNOB = 0.06;
// Minimum on-canvas size (px) when corner-resizing a bar, so it can't collapse.
const MIN_W = 6, MIN_H = 3;

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
// Transient value tag shown at the cursor during a drag/rotate/scale — set by
// enableDragPlacement, read by createPreview's draw(). {nx,ny} normalized 0..1.
let dragHint = null;

export function createPreview(canvasEl, opts = {}) {
  const ctx = canvasEl.getContext('2d');
  const dotR = opts.dotRadius ?? 4;
  const showLabels = opts.labels ?? true;
  let BASE_W = canvasEl.width || 1280, BASE_H = canvasEl.height || 720;
  // Update the logical drawing size when the COMPOSITION canvas aspect changes,
  // so the overlay maps uniformly (no stretch) and zoom stays crisp.
  function setBaseSize(w, h) {
    if (w > 0) BASE_W = w; if (h > 0) BASE_H = h;
    setRenderScale(viewZoom);
  }

  // Crisp zoom: raise the canvas BACKING resolution as the stage is zoomed in, so
  // the CSS-scaled overlay renders sharp instead of upscaling a fixed 1280×720.
  // All draw code stays in BASE_W×BASE_H logical space; draw() maps it to the
  // backing via setTransform. Capped so the canvas never gets pathologically big.
  let viewZoom = 1;   // current stage zoom — chrome divides by this to stay a constant SCREEN size
  function setRenderScale(zoom) {
    viewZoom = Math.max(0.25, Number(zoom) || 1);
    const dpr = window.devicePixelRatio || 1;
    // Raise the backing resolution with zoom for crisp overlay, bounded so the
    // backing never exceeds ~8192 px on its long side (GPU/canvas limit).
    const maxK = Math.max(2, 8192 / Math.max(1, BASE_W, BASE_H));
    const k = Math.max(1, Math.min(viewZoom * dpr, maxK));
    const w = Math.round(BASE_W * k), h = Math.round(BASE_H * k);
    if (canvasEl.width !== w) { canvasEl.width = w; canvasEl.height = h; }
  }

  const isSelected = (sel, id) => sel && (sel.has ? sel.has(id) : sel === id);

  function draw(show, rgba, selectedIds = null, snapGrid = 0, guides = null, marquee = null) {
    const W = BASE_W, Hh = BASE_H;                 // logical drawing space
    const ck = 1 / viewZoom;                        // chrome scale: line widths, dashes, handles, arrows, labels
    ctx.setTransform(canvasEl.width / BASE_W, 0, 0, canvasEl.height / BASE_H, 0, 0);
    // Transparent overlay: the live composite (WebGL stage) shows THROUGH.
    ctx.clearRect(0, 0, W, Hh);
    if (snapGrid > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = ck;
      for (let x = 0; x <= W; x += snapGrid) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, Hh); ctx.stroke(); }
      for (let y = 0; y <= Hh; y += snapGrid) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
    }
    if (guides && guides.length) {
      ctx.strokeStyle = 'rgba(232,178,127,.85)'; ctx.lineWidth = ck;
      for (const g of guides) {
        ctx.beginPath();
        if (g.axis === 'x') { ctx.moveTo(g.v + 0.5, 0); ctx.lineTo(g.v + 0.5, Hh); }
        else { ctx.moveTo(0, g.v + 0.5); ctx.lineTo(W, g.v + 0.5); }
        ctx.stroke();
      }
    }
    if (!show || !show.fixtures?.length) return;

    const { fixtureOrder, spans } = buildPipelineInputs(show);

    // Colour by CONTROLLER: every fixture on a device shares that device's hue,
    // and each output is a lightness tint of it — so you read "same controller"
    // by colour and "which output" by shade (shared with the placement list).
    const { runColor } = controllerColorMap(show);
    const chainColors = {};
    for (const r of runsOf(show)) chainColors[r.key] = runColor(r.deviceId, r.port);
    // The run key of the selection, if any → its chain is "focused" (labels shown).
    const selFx = selectedIds && show.fixtures.find((f) => isSelected(selectedIds, f.id));
    const focusKey = selFx ? runKey(selFx) : null;

    for (let fi = 0; fi < fixtureOrder.length; fi++) {
      const f = fixtureOrder[fi];
      if (f.hidden) {
        // Hidden fixtures still draw as a faint GHOST line so they stay visible AND
        // clickable on canvas (the hit-test includes them) — otherwise they could
        // only be un-hidden from the list. No per-pixel light, no handles.
        const P = f.input.points;
        if (P && P.length) {
          const onSel = isSelected(selectedIds, f.id);
          ctx.save();
          ctx.strokeStyle = onSel ? 'rgba(232,178,127,.55)' : 'rgba(150,156,166,.28)';
          ctx.setLineDash([4 * ck, 4 * ck]); ctx.lineWidth = (onSel ? 1.5 : 1.25) * ck;
          ctx.beginPath();
          ctx.moveTo(P[0][0] * W, P[0][1] * Hh);
          for (let k = 1; k < P.length; k++) ctx.lineTo(P[k][0] * W, P[k][1] * Hh);
          ctx.stroke();
          ctx.restore();
        }
        continue;
      }
      const fIdx = show.fixtures.indexOf(f);   // number matches the side-panel lists
      const span = spans[fi];
      const pts = samplePoints(f.input.points, f.input.samples);
      const [ox, oy] = chainOffset(show, f.id);   // dots show WHERE it samples (cascade)

      // Discrete LED CELLS (Resolume-style): every pixel is a little square lit by
      // its own sampled RGB, so the underlying graphic reads ON the strip — lit
      // pixels glow, unlit ones stay near-black. Cells are oriented along the strip.
      const reversed = !!f.input.reversed;       // which geometric end is pixel 0
      const count = pts.length;
      const thick = Math.max(2, Number(f.input?.transform?.h) || 8);
      const colAt = (i) => {
        let r = 0, g = 0, b = 0;
        if (rgba) {
          const hw = reversed ? count - 1 - i : i;   // honor flip (pixel-0 end)
          const idx = (span.start + hw) * 4;
          if (idx + 2 <= rgba.length - 1) { r = rgba[idx]; g = rgba[idx + 1]; b = rgba[idx + 2]; }
        }
        // Floor each channel to a dim value so an OFF pixel still reads as a faint
        // cell (the strip shows its pixel grid even over black); lit content lights
        // it brighter. Preview-only — the wall output uses the true rgba.
        return `rgb(${Math.max(r, 20)},${Math.max(g, 20)},${Math.max(b, 24)})`;
      };
      const sx = (i) => (pts[i][0] + ox) * W, sy = (i) => (pts[i][1] + oy) * Hh;
      ctx.save();
      if (count >= 1) {
        // Each LED is a RECTANGLE that fills the strip: pitch ALONG the run × the
        // strip thickness ACROSS it, rotated to the strip's angle. So the lit strip
        // is a solid band of per-pixel colour (the composite reads ON the strip),
        // not a thin dotted line.
        const ex = (f.input.points[f.input.points.length - 1] || [0, 0]), e0 = (f.input.points[0] || [0, 0]);
        const ang = Math.atan2((ex[1] - e0[1]) * Hh, (ex[0] - e0[0]) * W);
        const pitch = count >= 2 ? Math.hypot(sx(1) - sx(0), sy(1) - sy(0)) : thick;
        // Each LED is its own rectangle with a hairline gap on every side, so the
        // strip reads as a grid of defined pixels (Resolume-style), not a solid bar.
        const gap = Math.min(2, Math.max(0.4, pitch * 0.18));
        const along = Math.max(1, pitch - gap);
        const across = Math.max(2, thick - gap);     // fill the thickness, minus the gap
        for (let i = 0; i < count; i++) {
          ctx.save();
          ctx.translate(sx(i), sy(i));
          ctx.rotate(ang);
          ctx.fillStyle = colAt(i);
          ctx.fillRect(-along / 2, -across / 2, along, across);
          ctx.restore();
        }
      }
      ctx.restore();

      const selected = isSelected(selectedIds, f.id);
      const stroke = selected ? '#e8b27f' : (chainColors[runKey(f)] || '#5cc8ff');
      const eps = f.input.points;
      // Label LOD: only the selection, its whole chain, or (nothing selected) when
      // the strip is big enough on screen — so 120 labels don't pile up.
      const lblLen = eps.length >= 2 ? Math.hypot((eps[eps.length - 1][0] - eps[0][0]) * W, (eps[eps.length - 1][1] - eps[0][1]) * Hh) : 0;
      const showLbl = selected || runKey(f) === focusKey || (!focusKey && lblLen * viewZoom >= 46 && viewZoom >= 1.1);

      if (isPolylineFixture(f.input)) {
        // Footprint: dashed when unselected (Resolume-style), solid when selected.
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(eps[0][0] * W, eps[0][1] * Hh);
        for (let i = 1; i < eps.length; i++) ctx.lineTo(eps[i][0] * W, eps[i][1] * Hh);
        ctx.strokeStyle = stroke; ctx.lineWidth = (selected ? 2 : 1) * ck;
        if (!selected) ctx.setLineDash([5 * ck, 4 * ck]);
        ctx.stroke();
        ctx.restore();
        // Square handle at every vertex (uniform; direction is shown by the arrow).
        for (let i = 0; i < eps.length; i++) {
          const hx = eps[i][0] * W, hy = eps[i][1] * Hh;
          const s = (selected ? 4 : 3) * ck;
          ctx.beginPath(); ctx.rect(hx - s, hy - s, s * 2, s * 2);
          ctx.fillStyle = 'rgba(20,20,24,.85)';
          ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.25 * ck; ctx.stroke();
        }
        // Direction arrow at the pixel-0 end (honours reversed).
        const L = eps.length - 1;
        const a0 = reversed ? eps[L] : eps[0], a1 = reversed ? eps[L - 1] : eps[1];
        drawDirArrow(a0[0] * W, a0[1] * Hh, a1[0] * W, a1[1] * Hh, stroke);
        if (showLabels && showLbl) drawLabel(f, fIdx, eps[0][0] * W, eps[0][1] * Hh - 10, selected, W, Hh);
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
      ctx.save();
      ctx.strokeStyle = stroke; ctx.lineWidth = (selected ? 2 : 1) * ck;
      if (!selected) ctx.setLineDash([5 * ck, 4 * ck]);    // dashed unselected, solid selected
      ctx.stroke();
      ctx.restore();
      // Direction arrow at the pixel-0 end (honours reversed): pixel 0 is the
      // 'a' end normally, the 'b' end when reversed.
      if (reversed) drawDirArrow(bx, by, ax, ay, stroke, halfThick);
      else drawDirArrow(ax, ay, bx, by, stroke, halfThick);

      const cx = (ax + bx) / 2, cy = (ay + by) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, (dotR + (selected ? 4 : 2)) * ck, 0, Math.PI * 2);
      ctx.fillStyle = selected ? 'rgba(232,178,127,.3)' : 'rgba(92,200,255,.25)'; ctx.fill();
      ctx.strokeStyle = stroke; ctx.lineWidth = ck; ctx.stroke();

      // Rotate knob — only for a SINGLE selected bar. A short stem from the
      // centre out along the perpendicular (normalized units) to a grab circle.
      const single = selected && (!selectedIds.has || selectedIds.size === 1);
      if (single) {
        // Corner resize handles (length + thickness) at the rectangle corners.
        const corners = [
          [ax + perpX * halfThick, ay + perpY * halfThick],
          [bx + perpX * halfThick, by + perpY * halfThick],
          [bx - perpX * halfThick, by - perpY * halfThick],
          [ax - perpX * halfThick, ay - perpY * halfThick],
        ];
        const hs = 3 * ck;
        for (const [hx, hy] of corners) {
          ctx.beginPath(); ctx.rect(hx - hs, hy - hs, hs * 2, hs * 2);
          ctx.fillStyle = 'rgba(20,20,24,.92)'; ctx.fill();
          ctx.strokeStyle = stroke; ctx.lineWidth = 1.5 * ck; ctx.stroke();
        }
        const a0 = eps[0], a1 = eps[eps.length - 1];
        const cxN = (a0[0] + a1[0]) / 2, cyN = (a0[1] + a1[1]) / 2;
        const adx = a1[0] - a0[0], ady = a1[1] - a0[1], adl = Math.hypot(adx, ady) || 1;
        const knx = (cxN + (-ady / adl) * ROTATE_KNOB) * W;
        const kny = (cyN + (adx / adl) * ROTATE_KNOB) * Hh;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(knx, kny);
        ctx.strokeStyle = stroke; ctx.lineWidth = ck; ctx.stroke();
        ctx.beginPath(); ctx.arc(knx, kny, 5 * ck, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20,20,24,.92)'; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = 1.5 * ck; ctx.stroke();
      }
      if (showLabels && showLbl) drawLabel(f, fIdx, cx, cy - 10, selected, W, Hh);
    }

    // --- CHAIN pass: a connector from each member's OUTPUT end to the next
    //     member's INPUT end (the real daisy-chain wiring) + a bounding box
    //     around the chain whose member is selected. ---
    // 'in' = pixel-0 end, 'out' = last-pixel end (both honour input.reversed).
    const endOf = (f, which) => {
      const p = f.input?.points || []; if (!p.length) return [0, 0];
      const rev = !!f.input.reversed;
      const e = (which === 'in') === !rev ? p[0] : p[p.length - 1];
      return [e[0] * W, e[1] * Hh];
    };
    for (const ch of runsOf(show)) {
      if (ch.members.length < 2) continue;
      const members = ch.members.map((id) => show.fixtures.find((f) => f.id === id)).filter(Boolean);
      if (members.length < 2) continue;
      ctx.save();
      const col = chainColors[ch.key] || 'rgba(180,140,255,.7)';
      ctx.strokeStyle = col;
      // Each hop: dashed line out-end(i) → in-end(i+1), arrowhead at the input.
      for (let i = 0; i < members.length - 1; i++) {
        const [ax, ay] = endOf(members[i], 'out');
        const [bx, by] = endOf(members[i + 1], 'in');
        ctx.setLineDash([5 * ck, 4 * ck]); ctx.lineWidth = 1.25 * ck;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.setLineDash([]);
        drawDirArrow(bx, by, bx + (bx - ax), by + (by - ay), col);   // flow into the next input
      }
      // A small ring at the chain origin (first member's input = the controller).
      const [ox0, oy0] = endOf(members[0], 'in');
      ctx.lineWidth = 1.25 * ck; ctx.beginPath(); ctx.arc(ox0, oy0, 5 * ck, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Rubber-band selection box (drawn on top of everything).
    if (marquee) {
      const x = marquee.x0 * W, y = marquee.y0 * Hh;
      const w = (marquee.x1 - marquee.x0) * W, h = (marquee.y1 - marquee.y0) * Hh;
      ctx.save();
      ctx.fillStyle = 'rgba(140,200,255,.12)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(140,200,255,.9)'; ctx.lineWidth = ck; ctx.setLineDash([4 * ck, 3 * ck]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    // Numeric value tag at the cursor while dragging/rotating/scaling — so you read
    // the value where you're working, not in a sidebar.
    if (dragHint) {
      const fs = 11 * ck;
      ctx.save();
      ctx.font = `${fs}px "Spline Sans Mono", ui-monospace, Menlo, monospace`;
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(dragHint.text).width;
      const padX = 5 * ck, bh = 16 * ck;
      let bx = dragHint.nx * W + 12 * ck, by = dragHint.ny * Hh - 14 * ck;
      bx = Math.max(2, Math.min(W - tw - padX * 2 - 2, bx));
      by = Math.max(bh / 2 + 2, Math.min(Hh - bh / 2 - 2, by));
      ctx.fillStyle = 'rgba(13,14,18,.92)'; ctx.fillRect(bx, by - bh / 2, tw + padX * 2, bh);
      ctx.strokeStyle = 'rgba(60,65,75,.95)'; ctx.lineWidth = ck; ctx.strokeRect(bx, by - bh / 2, tw + padX * 2, bh);
      ctx.fillStyle = '#f4f5f7'; ctx.fillText(dragHint.text, bx + padX, by);
      ctx.restore();
    }
  }

  // A small filled arrowhead at the pixel-0 end (p0) pointing along the run
  // (toward p1) — makes direction / flip (input.reversed) visible at a glance.
  // `thick` (half the bar's thickness, in canvas px) scales the arrow WITH the
  // fixture so a bigger strip gets a bigger arrow; omitted → a constant screen
  // size (used for thin polylines that have no width). A screen-space floor keeps
  // tiny fixtures' arrows visible.
  function drawDirArrow(p0x, p0y, p1x, p1y, color, thick) {
    const dx = p1x - p0x, dy = p1y - p0y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;   // unit + perpendicular
    const ck = 1 / viewZoom;
    const tip = thick != null ? Math.max(8 * ck, thick * 1.9) : 9 * ck;
    const wide = thick != null ? Math.max(4 * ck, thick * 1.0) : 4.5 * ck;
    ctx.beginPath();
    ctx.moveTo(p0x + ux * tip, p0y + uy * tip);                       // tip into the run
    ctx.lineTo(p0x + px * wide, p0y + py * wide);                     // base corners at p0
    ctx.lineTo(p0x - px * wide, p0y - py * wide);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  function drawLabel(f, index, cx, cy, selected, W, Hh) {
    const label = fixtureLabel(f, index);
    const ck = 1 / viewZoom, fs = 11 * ck;     // constant SCREEN text size at any zoom
    ctx.font = `${fs}px "Spline Sans Mono", ui-monospace, Menlo, monospace`;
    const tw = ctx.measureText(label).width;
    const lx = Math.max(3, Math.min(W - tw - 3, cx - tw / 2));
    const ly = Math.max(fs + 1, Math.min(Hh - 4, cy));
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(lx - 3 * ck, ly - fs, tw + 6 * ck, fs + 4 * ck);
    ctx.fillStyle = selected ? '#e8b27f' : '#8fd6e8';
    ctx.fillText(label, lx, ly);
  }

  return { draw, setRenderScale, setBaseSize };
}

// Drag-placement on the Output overlay:
//   • drag a fixture body → move the whole fixture (bar transform x/y, or all
//     polyline points)
//   • drag a polyline vertex → reshape that bend
//   • double-click a segment → insert a vertex (a bar becomes a bendable run)
//   • right-click a vertex → remove it
// Edits derive a new show and call onEdit(next) per move; onCommit on release.
export function enableDragPlacement(canvasEl, { getShow, onEdit, onCommit, onSelect, getSelected, snap, onMarqueeStart, onMarquee, onMarqueeEnd }, opts = {}) {
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
    // Rotate knob (a single selected bar) wins over everything — test it first.
    const sel = getSelected?.();
    const selId = sel ? (sel.has ? (sel.size === 1 ? [...sel][0] : null) : sel) : null;
    if (selId) {
      const f = fixtures.find((x) => x.id === selId);
      if (f && !isPolylineFixture(f.input)) {
        const pts = f.input.points;
        const a0 = pts[0], a1 = pts[pts.length - 1];
        const cxN = (a0[0] + a1[0]) / 2, cyN = (a0[1] + a1[1]) / 2;
        const adx = a1[0] - a0[0], ady = a1[1] - a0[1], adl = Math.hypot(adx, ady) || 1;
        const kx = (cxN + (-ady / adl) * ROTATE_KNOB) * rw, ky = (cyN + (adx / adl) * ROTATE_KNOB) * rh;
        if (Math.hypot(px - kx, py - ky) <= vtxR) return { fxId: selId, rotate: true };
        // Corner resize handles win over the body (but not the rotate knob).
        const ax = a0[0] * rw, ay = a0[1] * rh, bx = a1[0] * rw, by = a1[1] * rh;
        const ddx = bx - ax, ddy = by - ay, dl = Math.hypot(ddx, ddy) || 1;
        const cpx = -ddy / dl, cpy = ddx / dl;
        const cv = show.composition?.canvas || { w: rw, h: rh };
        const ht = ((f.input.transform?.h ?? 8) / 2) * (rh / (cv.h || rh));
        const corners = [
          [ax + cpx * ht, ay + cpy * ht], [bx + cpx * ht, by + cpy * ht],
          [bx - cpx * ht, by - cpy * ht], [ax - cpx * ht, ay - cpy * ht],
        ];
        for (let c = 0; c < 4; c++) {
          if (Math.hypot(px - corners[c][0], py - corners[c][1]) <= vtxR) return { fxId: selId, scaleCorner: c };
        }
      }
    }
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
    if (!hit) {
      // Empty canvas → rubber-band marquee select (Shift = add to selection).
      const [nx, ny] = norm(ev);
      dragState = { kind: 'marquee', x0: nx, y0: ny, additive: !!ev.shiftKey };
      onMarqueeStart?.(dragState.additive);
      canvasEl.setPointerCapture(ev.pointerId); ev.preventDefault();
      return;
    }
    onSelect?.(hit.fxId, ev);
    const show = getShow();
    const cv = show.composition?.canvas || { w: 1280, h: 720 };

    if (hit.rotate) {
      dragState = { kind: 'rotate', id: hit.fxId, cv };
    } else if (hit.scaleCorner != null) {
      // Resize from the grabbed corner, keeping the OPPOSITE corner pinned and
      // rotation fixed. Work in the bar's local frame (axis u, perpendicular p).
      const f = show.fixtures.find((x) => x.id === hit.fxId);
      const t = f.input.transform || transformFromPoints(f.input.points, cv);
      const a = (Number(t.rotation) || 0) * Math.PI / 180;
      const ux = Math.cos(a), uy = Math.sin(a), pxx = -Math.sin(a), pyy = Math.cos(a);
      const hw = (Number(t.w) || 0) / 2, hh = (Number(t.h) || 8) / 2;
      const sgn = [[-1, 1], [1, 1], [1, -1], [-1, -1]];   // corner 0..3 in (u,p)
      const [su, sp] = sgn[(hit.scaleCorner + 2) % 4];     // opposite corner = anchor
      const anchor = { x: t.x + ux * su * hw + pxx * sp * hh, y: t.y + uy * su * hw + pyy * sp * hh };
      dragState = { kind: 'scale', id: hit.fxId, cv, ux, uy, pxx, pyy, anchor };
    } else if (hit.vertex != null) {
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
    if (dragState.kind === 'marquee') {
      const [nx, ny] = norm(ev);
      onMarquee?.({
        x0: Math.min(dragState.x0, nx), y0: Math.min(dragState.y0, ny),
        x1: Math.max(dragState.x0, nx), y1: Math.max(dragState.y0, ny),
      }, dragState.additive);
      return;
    }
    let next = getShow();
    let hintText = null;
    if (dragState.kind === 'rotate') {
      // Angle from the bar centre to the cursor (canvas-px metric, matches the
      // model's rotation). The knob sits on the perpendicular, so subtract 90°.
      const f = next.fixtures.find((x) => x.id === dragState.id);
      const tf = f?.input?.transform || transformFromPoints(f?.input?.points, dragState.cv);
      const [pxc, pyc] = canvasPx(ev, dragState.cv);
      let rot = Math.atan2(pyc - tf.y, pxc - tf.x) * 180 / Math.PI - 90;
      if (ev.shiftKey) rot = snapDeg(rot, 15);     // Shift → snap to 15° increments
      next = setFixtureTransform(next, dragState.id, { rotation: rot });
      hintText = `${Math.round(((rot % 360) + 360) % 360)}°`;
    } else if (dragState.kind === 'scale') {
      // Cursor offset from the pinned anchor, projected onto the bar's axes →
      // new length (w) and thickness (h); centre stays midway anchor↔cursor.
      const { ux, uy, pxx, pyy, anchor, id } = dragState;
      const [cxp, cyp] = canvasPx(ev, dragState.cv);
      const vx = cxp - anchor.x, vy = cyp - anchor.y;
      const du = vx * ux + vy * uy, dp = vx * pxx + vy * pyy;
      const w = Math.max(MIN_W, Math.abs(du)), h = Math.max(MIN_H, Math.abs(dp));
      next = setFixtureTransform(next, id, {
        x: anchor.x + ux * (du / 2) + pxx * (dp / 2),
        y: anchor.y + uy * (du / 2) + pyy * (dp / 2), w, h,
      });
      hintText = `${Math.round(w)}×${Math.round(h)} px`;
    } else if (dragState.kind === 'vertex') {
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
          if (it === dragState.items[0]) hintText = `${Math.round(nx)}, ${Math.round(ny)}`;
        }
      }
    }
    const [hnx, hny] = norm(ev);
    dragHint = hintText ? { nx: hnx, ny: hny, text: hintText } : null;
    onEdit?.(next);
  });

  function end(ev) {
    if (!dragState) return;
    const wasMarquee = dragState.kind === 'marquee';
    dragState = null; dragHint = null;
    try { canvasEl.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
    if (wasMarquee) onMarqueeEnd?.();        // selection-only — no geometry commit
    else onCommit?.(getShow());
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
