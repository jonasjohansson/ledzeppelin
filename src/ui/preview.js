import { samplePoints } from '../model/sampling.js';
import { buildPipelineInputs } from '../model/pipeline.js';
import { chainOffset, runsOf, runKey, controllerColorMap } from '../model/chains.js';
import {
  setFixtureTransform, isPolylineFixture, snapDeg, transformFromPoints,
  setFixturePoints, setFixtureVertex, addFixtureVertex, removeFixtureVertex, fixtureLabel,
  thicknessOf,
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
  const svg = opts.svg || null;   // vector chrome layer (footprints/arrows/handles/labels)
  const dotR = opts.dotRadius ?? 4;
  const showLabels = opts.labels ?? true;
  let BASE_W = canvasEl.width || 1280, BASE_H = canvasEl.height || 720;
  // Match the SVG viewBox to the composition size NOW (the HTML default is only a
  // placeholder) so the vector chrome shares the canvas's coordinate space at load,
  // not just after a resize.
  if (svg) svg.setAttribute('viewBox', `0 0 ${BASE_W} ${BASE_H}`);
  // Update the logical drawing size when the COMPOSITION canvas aspect changes,
  // so the overlay maps uniformly (no stretch). Both the lights canvas and the SVG
  // chrome work in this 0..BASE space.
  function setBaseSize(w, h) {
    if (w > 0) BASE_W = w; if (h > 0) BASE_H = h;
    if (svg) svg.setAttribute('viewBox', `0 0 ${BASE_W} ${BASE_H}`);
    chromeKey = null;   // force a chrome rebuild at the new size
    setRenderScale(viewZoom);
  }

  // Crisp zoom: raise the canvas BACKING resolution as the stage is zoomed in, so
  // the CSS-scaled overlay renders sharp instead of upscaling a fixed 1280×720.
  // All draw code stays in BASE_W×BASE_H logical space; draw() maps it to the
  // backing via setTransform. Capped so the canvas never gets pathologically big.
  let viewZoom = 1;   // current stage zoom — chrome divides by this to stay a constant SCREEN size
  let colorTint = true;   // tint fixture chrome by controller colour (toggle in the corner)
  function setColorTint(on) { colorTint = !!on; chromeKey = null; }
  // SVG chrome rebuild cache — rebuild only when the show ref or this key changes.
  let chromeShow = null, chromeKey = null;

  // --- Per-frame cost savers --------------------------------------------------
  // Pipeline geometry only changes on EDITS (new show object), not every frame, so
  // cache it keyed by the show reference instead of rebuilding sample points /
  // run colours / spans 60×/s.
  let piCache = null;
  function pipelineFor(show) {
    if (piCache && piCache.show === show) return piCache;
    const { fixtureOrder, spans } = buildPipelineInputs(show);
    const samplePts = fixtureOrder.map((f) => samplePoints(f.input.points, f.input.samples));
    const { runColor } = controllerColorMap(show);
    const chainColors = {};
    for (const r of runsOf(show)) chainColors[r.key] = runColor(r.deviceId, r.port);
    piCache = { show, fixtureOrder, spans, samplePts, chainColors };
    return piCache;
  }
  function setRenderScale(zoom) {
    viewZoom = Math.max(0.25, Number(zoom) || 1);
    // The backing scales WITH zoom: the LED cells are 1-2px dots now, and CSS
    // upscaling smears them into mush when zoomed in. Quantized to half-steps
    // (wheel ticks rarely reallocate) and capped by an area budget so a deep
    // zoom never balloons the canvas.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const areaK = Math.sqrt(12_000_000 / Math.max(1, BASE_W * BASE_H));
    const want = Math.min(Math.max(dpr, dpr * viewZoom), areaK);
    const k = Math.max(1, Math.round(want * 2) / 2);
    const w = Math.round(BASE_W * k), h = Math.round(BASE_H * k);
    if (canvasEl.width !== w) { canvasEl.width = w; canvasEl.height = h; }
  }

  const isSelected = (sel, id) => sel && (sel.has ? sel.has(id) : sel === id);

  function draw(show, rgba, selectedIds = null, snapGrid = 0, guides = null, marquee = null) {
    const W = BASE_W, Hh = BASE_H;                 // logical drawing space
    // Chrome scale — constant SCREEN size at zoom ≤ 1, receding when zoomed in so a
    // dense rig doesn't crowd. Used by the SVG chrome layer (and the canvas drag-tag).
    const ck = viewZoom <= 1 ? 1 / viewZoom : 1 / Math.pow(viewZoom, 1.35);
    ctx.setTransform(canvasEl.width / BASE_W, 0, 0, canvasEl.height / BASE_H, 0, 0);
    ctx.clearRect(0, 0, W, Hh);   // transparent — the WebGL stage shows through

    // ---- Vector CHROME → SVG. Rebuilt only when geometry / selection / zoom /
    //      guides / marquee change (NOT per frame — the lit pixels below redraw
    //      every frame, the chrome doesn't). Crisp at any zoom (SVG re-rasterizes). ----
    if (svg) {
      const selKey = selectedIds ? [...selectedIds].join(',') : '';
      const gKey = guides ? guides.map((g) => g.axis + Math.round(g.v)).join('|') : '';
      const mKey = marquee ? `${marquee.x0.toFixed(3)},${marquee.y0.toFixed(3)},${marquee.x1.toFixed(3)},${marquee.y1.toFixed(3)}` : '';
      const key = `${selKey}|${viewZoom}|${snapGrid}|${gKey}|${mKey}`;
      if (show !== chromeShow || key !== chromeKey) {
        chromeShow = show; chromeKey = key;
        svg.innerHTML = buildChrome(show, selectedIds, snapGrid, guides, marquee, ck);
      }
    }
    if (!show || !show.fixtures?.length) return;

    // Cached pipeline geometry (rebuilt only when the show object changes). The
    // LIGHTS pass below uses only fixtureOrder/spans/samplePts; colours/selection
    // are the SVG chrome's concern (buildChrome).
    const { fixtureOrder, spans, samplePts } = pipelineFor(show);

    // Viewport cull bounds: the overlay canvas is CSS-scaled, so map the window
    // rect back into canvas-logical pixels. Fixtures whose footprint falls fully
    // outside (plus a small margin) are skipped — the big win when zoomed in.
    const vr = canvasEl.getBoundingClientRect();
    const Lx = W / (vr.width || 1), Ly = Hh / (vr.height || 1);
    const vx0 = -vr.left * Lx - 24, vx1 = (window.innerWidth - vr.left) * Lx + 24;
    const vy0 = -vr.top * Ly - 24, vy1 = (window.innerHeight - vr.top) * Ly + 24;

    for (let fi = 0; fi < fixtureOrder.length; fi++) {
      const f = fixtureOrder[fi];
      // Cull off-screen fixtures (footprint AABB vs the visible region).
      const P0 = f.input.points;
      if (P0 && P0.length) {
        let nx = 1, ny = 1, xx = 0, xy = 0;
        for (const p of P0) { if (p[0] < nx) nx = p[0]; if (p[0] > xx) xx = p[0]; if (p[1] < ny) ny = p[1]; if (p[1] > xy) xy = p[1]; }
        if (xx * W < vx0 || nx * W > vx1 || xy * Hh < vy0 || ny * Hh > vy1) continue;
      }
      if (f.hidden) continue;   // hidden → no lights; its ghost outline is drawn on the SVG chrome
      const span = spans[fi];
      const pts = samplePts[fi];               // cached resampled points
      const [ox, oy] = chainOffset(show, f.id);   // dots show WHERE it samples (cascade)
      const reversed = !!f.input.reversed;        // which geometric end is pixel 0
      const count = pts.length;
      const cvT = show.composition?.canvas;
      const thick = Math.max(2, thicknessOf(f, cvT) * (Hh / ((cvT && cvT.h) || Hh)));
      const sx = (i) => (pts[i][0] + ox) * W, sy = (i) => (pts[i][1] + oy) * Hh;

      // Light the strip from the sampled composite. A straight BAR blits its whole
      // pixel row in ONE drawImage (cheap); a bent polyline falls back to a square
      // per LED. The lit composite reads ON the strip; off pixels stay dark.
      // Physical duty cycle: an LED package is ~5 mm, so the lit fraction of each
      // cell is 5mm / pitch — 30 led/m (33 mm pitch) reads as sparse dots with big
      // gaps, 60 led/m about a third lit, 144 led/m nearly continuous. Falls back
      // to 60 led/m when the fixture predates the density fields.
      const lpm = Number(f.ledsPerMeter)
        || (Number(f.meters) > 0 ? count / Number(f.meters) : 60);
      const litFrac = Math.min(1, Math.max(0.08, 5 * lpm / 1000));
      if (count >= 1 && rgba) {
        if (!isPolylineFixture(f.input) && count >= 2) {
          // BINARY cells: each LED is an axis-aligned square SNAPPED to the device
          // pixel grid — only its POSITION follows the bar's angle; the square
          // itself stays straight, so every edge lands exactly on pixels: hard,
          // un-antialiased points of light (no AA fuzz, no rotation jaggies).
          // The side is the LED's lit length along the strip (~5 mm package),
          // capped by the bar thickness; sub-pixel pitches overlap into a
          // continuous line, which is what a dense strip looks like.
          const ax = sx(0), ay = sy(0), bx = sx(count - 1), by = sy(count - 1);
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const ux = (bx - ax) / len, uy = (by - ay) / len;
          const pitch = len / (count - 1);
          const k = canvasEl.width / W;                       // logical → device px
          const side = Math.max(1, Math.round(Math.max(1.5, Math.min(thick, pitch * litFrac)) * k)) / k;
          let last = '';
          for (let i = 0; i < count; i++) {
            const si = (span.start + (reversed ? count - 1 - i : i)) * 4;
            let r = 0, g = 0, b = 0;
            if (si + 2 <= rgba.length - 1) { r = rgba[si]; g = rgba[si + 1]; b = rgba[si + 2]; }
            const css = `rgb(${r},${g},${b})`;
            if (css !== last) { ctx.fillStyle = css; last = css; }
            const cx = ax + ux * i * pitch, cy = ay + uy * i * pitch;
            ctx.fillRect(Math.round((cx - side / 2) * k) / k, Math.round((cy - side / 2) * k) / k, side, side);
          }
        } else {
          // Polyline fallback: a square per LED, sized to the same physical duty
          // cycle (litFrac of the pitch along the line), capped by the bar thickness.
          const spacing = count >= 2 ? (Math.hypot(sx(1) - sx(0), sy(1) - sy(0)) || thick) : thick;
          const cell = Math.max(1.5, Math.min(Math.max(2, thick), spacing * litFrac));
          for (let i = 0; i < count; i++) {
            const si = (span.start + (reversed ? count - 1 - i : i)) * 4;
            let r = 0, g = 0, b = 0;
            if (si + 2 <= rgba.length - 1) { r = rgba[si]; g = rgba[si + 1]; b = rgba[si + 2]; }
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(sx(i) - cell / 2, sy(i) - cell / 2, cell, cell);
          }
        }
      }

    }
    // (Fixture footprints, handles, arrows, labels, chain wiring, snap grid/guides
    //  and the marquee are all drawn on the SVG chrome layer — see buildChrome.)

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

  // --- SVG chrome string builders (same 0..BASE coords as the lights canvas) ----
  const nz = (n) => Math.round(n * 100) / 100;                 // trim coordinate noise
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rectS = (x, y, w, h, stroke, sw) =>
    `<rect x="${nz(x)}" y="${nz(y)}" width="${nz(w)}" height="${nz(h)}" fill="rgba(20,20,24,.9)" stroke="${stroke}" stroke-width="${nz(sw)}"/>`;
  // Filled arrowhead at p0 pointing toward p1 (direction / pixel-0). `thick` scales
  // it with a bar's thickness; omitted ⇒ constant screen size.
  const arrowS = (p0x, p0y, p1x, p1y, color, thick, ck) => {
    const dx = p1x - p0x, dy = p1y - p0y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const tip = thick != null ? Math.max(8 * ck, thick * 1.9) : 9 * ck;
    const wide = thick != null ? Math.max(4 * ck, thick * 1.0) : 4.5 * ck;
    return `<polygon points="${nz(p0x + ux * tip)},${nz(p0y + uy * tip)} ${nz(p0x + px * wide)},${nz(p0y + py * wide)} ${nz(p0x - px * wide)},${nz(p0y - py * wide)}" fill="${color}"/>`;
  };
  const labelS = (text, cx, cy, selected, ck) => {
    const fs = 11 * ck, fill = selected ? '#e8b27f' : 'rgba(205,210,218,.92)';
    return `<text x="${nz(cx)}" y="${nz(cy)}" font-size="${nz(fs)}" font-family="'Spline Sans Mono',ui-monospace,Menlo,monospace" text-anchor="middle" fill="${fill}" stroke="rgba(0,0,0,.7)" stroke-width="${nz(1.6 * ck)}" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`;
  };

  // Build the whole vector chrome as one SVG markup string. Mirrors the old canvas
  // chrome exactly, in the same logical coords; rebuilt only on change (see draw).
  function buildChrome(show, selectedIds, snapGrid, guides, marquee, ck) {
    const W = BASE_W, Hh = BASE_H;
    const p = [];
    const ln = (x1, y1, x2, y2, stroke, w, dash) =>
      p.push(`<line x1="${nz(x1)}" y1="${nz(y1)}" x2="${nz(x2)}" y2="${nz(y2)}" stroke="${stroke}" stroke-width="${nz(w)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    const poly = (epspts, stroke, w, dash) =>
      p.push(`<polyline points="${epspts.map((e) => `${nz(e[0] * W)},${nz(e[1] * Hh)}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${nz(w)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    // Dash unit: CONSTANT screen size (1/zoom, NOT the dampened ck), with generous
    // lengths so dashes stay readable lines when zoomed in instead of shrinking to
    // dots. Strokes still use the dampened `ck` to read as hairlines.
    const du = 1 / viewZoom;
    const DASH = `${nz(9 * du)} ${nz(5 * du)}`;

    if (snapGrid > 0) {
      for (let x = 0; x <= W; x += snapGrid) ln(x, 0, x, Hh, 'rgba(255,255,255,.09)', ck);
      for (let y = 0; y <= Hh; y += snapGrid) ln(0, y, W, y, 'rgba(255,255,255,.09)', ck);
    }
    if (guides) for (const g of guides) {
      if (g.axis === 'x') ln(g.v, 0, g.v, Hh, 'rgba(232,178,127,.85)', ck);
      else ln(0, g.v, W, g.v, 'rgba(232,178,127,.85)', ck);
    }

    if (show && show.fixtures?.length) {
      const { fixtureOrder, chainColors } = pipelineFor(show);
      const dim = (c) => (colorTint ? c : 'rgba(150,156,166,.85)');
      const selFx = selectedIds && show.fixtures.find((f) => isSelected(selectedIds, f.id));
      const focusKey = selFx ? runKey(selFx) : null;
      for (const f of fixtureOrder) {
        const eps = f.input.points; if (!eps || !eps.length) continue;
        const reversed = !!f.input.reversed;
        if (f.hidden) {                                  // faint ghost outline
          const onSel = isSelected(selectedIds, f.id);
          poly(eps, onSel ? 'rgba(232,178,127,.55)' : 'rgba(150,156,166,.28)', (onSel ? 1.5 : 1.25) * ck, DASH);
          continue;
        }
        const selected = isSelected(selectedIds, f.id);
        const stroke = selected ? '#e8b27f' : dim(chainColors[runKey(f)] || 'rgba(150,156,166,.6)');
        const lblLen = eps.length >= 2 ? Math.hypot((eps[eps.length - 1][0] - eps[0][0]) * W, (eps[eps.length - 1][1] - eps[0][1]) * Hh) : 0;
        const showLbl = selected || runKey(f) === focusKey || (!focusKey && lblLen * viewZoom >= 46 && viewZoom >= 1.1);
        if (!selected && runKey(f) !== focusKey && lblLen * viewZoom < 13) continue;   // LOD: tiny → no chrome
        const fIdx = show.fixtures.indexOf(f);
        const dash = selected ? null : DASH;

        if (isPolylineFixture(f.input)) {
          poly(eps, stroke, ck, dash);
          if (selected) for (const e of eps) { const hx = e[0] * W, hy = e[1] * Hh, s = 4 * ck; p.push(rectS(hx - s, hy - s, s * 2, s * 2, stroke, 1.25 * ck)); }
          const L = eps.length - 1, a0 = reversed ? eps[L] : eps[0], a1 = reversed ? eps[L - 1] : eps[1];
          p.push(arrowS(a0[0] * W, a0[1] * Hh, a1[0] * W, a1[1] * Hh, stroke, null, ck));
          if (showLabels && showLbl) p.push(labelS(fixtureLabel(f, fIdx), eps[0][0] * W, eps[0][1] * Hh - 10, selected, ck));
          continue;
        }

        // BAR: rotated rectangle (the 4 outer corners).
        const ax = eps[0][0] * W, ay = eps[0][1] * Hh, bx = eps[eps.length - 1][0] * W, by = eps[eps.length - 1][1] * Hh;
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, perpX = -dy / len, perpY = dx / len;
        const cv = show.composition?.canvas || { w: W, h: Hh };
        const ht = (thicknessOf(f, cv) / 2) * (Hh / (cv.h || Hh));
        const c1 = [ax + perpX * ht, ay + perpY * ht], c2 = [bx + perpX * ht, by + perpY * ht], c3 = [bx - perpX * ht, by - perpY * ht], c4 = [ax - perpX * ht, ay - perpY * ht];
        p.push(`<polygon points="${nz(c1[0])},${nz(c1[1])} ${nz(c2[0])},${nz(c2[1])} ${nz(c3[0])},${nz(c3[1])} ${nz(c4[0])},${nz(c4[1])}" fill="none" stroke="${stroke}" stroke-width="${nz(ck)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
        if (reversed) p.push(arrowS(bx, by, ax, ay, stroke, ht, ck)); else p.push(arrowS(ax, ay, bx, by, stroke, ht, ck));
        const cx = (ax + bx) / 2, cy = (ay + by) / 2;
        if (selected) p.push(`<circle cx="${nz(cx)}" cy="${nz(cy)}" r="${nz((dotR + 4) * ck)}" fill="rgba(232,178,127,.3)" stroke="${stroke}" stroke-width="${nz(ck)}"/>`);
        const single = selected && (!selectedIds.has || selectedIds.size === 1);
        if (single) {
          for (const c of [c1, c2, c3, c4]) p.push(rectS(c[0] - 3 * ck, c[1] - 3 * ck, 6 * ck, 6 * ck, stroke, 1.5 * ck));
          const e0 = eps[0], e1 = eps[eps.length - 1], cxN = (e0[0] + e1[0]) / 2, cyN = (e0[1] + e1[1]) / 2;
          const adx = e1[0] - e0[0], ady = e1[1] - e0[1], adl = Math.hypot(adx, ady) || 1;
          const knx = (cxN + (-ady / adl) * ROTATE_KNOB) * W, kny = (cyN + (adx / adl) * ROTATE_KNOB) * Hh;
          ln(cx, cy, knx, kny, stroke, ck);
          p.push(`<circle cx="${nz(knx)}" cy="${nz(kny)}" r="${nz(5 * ck)}" fill="rgba(20,20,24,.92)" stroke="${stroke}" stroke-width="${nz(1.5 * ck)}"/>`);
        }
        if (showLabels && showLbl) p.push(labelS(fixtureLabel(f, fIdx), cx, cy - 10, selected, ck));
      }

      // Chain wiring: out-end(i) → in-end(i+1) per hop, arrow at the input, ring at origin.
      const endOf = (f, which) => {
        const pp = f.input?.points || []; if (!pp.length) return [0, 0];
        const rev = !!f.input.reversed;
        const e = (which === 'in') === !rev ? pp[0] : pp[pp.length - 1];
        return [e[0] * W, e[1] * Hh];
      };
      for (const ch of runsOf(show)) {
        if (ch.members.length < 2) continue;
        const members = ch.members.map((id) => show.fixtures.find((f) => f.id === id)).filter(Boolean);
        if (members.length < 2) continue;
        const col = dim(chainColors[ch.key] || 'rgba(150,156,166,.45)');
        for (let i = 0; i < members.length - 1; i++) {
          const [ax, ay] = endOf(members[i], 'out');
          const [bx, by] = endOf(members[i + 1], 'in');
          ln(ax, ay, bx, by, col, 1.25 * ck, DASH);
          p.push(arrowS(bx, by, bx + (bx - ax), by + (by - ay), col, null, ck));
        }
        const [ox0, oy0] = endOf(members[0], 'in');
        p.push(`<circle cx="${nz(ox0)}" cy="${nz(oy0)}" r="${nz(5 * ck)}" fill="none" stroke="${col}" stroke-width="${nz(1.25 * ck)}"/>`);
      }
    }

    if (marquee) {
      const x = marquee.x0 * W, y = marquee.y0 * Hh, w = (marquee.x1 - marquee.x0) * W, h = (marquee.y1 - marquee.y0) * Hh;
      p.push(`<rect x="${nz(x)}" y="${nz(y)}" width="${nz(w)}" height="${nz(h)}" fill="rgba(232,163,92,.10)" stroke="rgba(232,163,92,.85)" stroke-width="${nz(ck)}" stroke-dasharray="${DASH}"/>`);
    }
    return p.join('');
  }

  return { draw, setRenderScale, setBaseSize, setColorTint };
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
        const ht = (thicknessOf(f, cv) / 2) * (rh / (cv.h || rh));
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
    if (ev.button !== 0) return;   // left only — middle is the hand-pan, right the context menu
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
