import { samplePoints, samplePoints3D } from '../model/sampling.js';
import { buildPipelineInputs } from '../model/pipeline.js';
import {
  orbitCamera, cameraBasis, project, unproject, rayPlaneZ,
  ORBIT_EL_MIN, ORBIT_EL_MAX, ORBIT_DIST_MIN, ORBIT_DIST_MAX,
} from '../model/project3d.js';
import { gridPoints, isGridFixture } from '../model/grid.js';
import { chainOffset, runsOf, runKey, controllerColorMap } from '../model/chains.js';
import { isDmxFixture } from '../model/dmx.js';
import {
  setFixtureTransform, isPolylineFixture, snapDeg, transformFromPoints,
  setFixturePoints, setFixtureVertex, addFixtureVertex, removeFixtureVertex, fixtureLabel,
  thicknessOf, setBezierControl,
} from '../model/fixture-transform.js';
import { isBezierFixture, bezierToPoints } from '../model/bezier.js';
import { FIELD_IDS, axisGradient, noise3d } from '../engine/fields.js';

// Rotate-knob offset from a selected bar's centre, in NORMALIZED canvas units
// (so draw() and hitTest() — which use different pixel scales — agree).
const ROTATE_KNOB = 0.06;
// Minimum on-canvas size (px) when corner-resizing a bar, so it can't collapse.
const MIN_W = 6, MIN_H = 3;
// Bounding box (normalized) of the selected fixtures' DRAWN footprint, for a GROUP
// resize — only when 2+ are selected. BARS include their thickness rectangle (so
// the box hugs the visible fixture, not just its centreline); polylines use their
// vertices. baseW/baseH are the logical drawing dims (BASE_W/BASE_H). Module-scope
// so both the chrome and the hit-test share it.
function groupBox(show, selectedIds, baseW, baseH) {
  if (!selectedIds || !selectedIds.has || selectedIds.size < 2) return null;
  const W = baseW || 1280, Hh = baseH || 720;
  const cv = show.composition?.canvas || { w: W, h: Hh };
  let minX = 1, minY = 1, maxX = 0, maxY = 0, any = false;
  const acc = (xn, yn) => { if (xn < minX) minX = xn; if (xn > maxX) maxX = xn; if (yn < minY) minY = yn; if (yn > maxY) maxY = yn; any = true; };
  for (const f of show.fixtures || []) {
    if (!selectedIds.has(f.id)) continue;
    const eps = f.input?.points || [];
    if (!eps.length) continue;
    // A bezier's box hugs the EVALUATED curve (the arch bulges past its chord).
    if (isBezierFixture(f.input)) { for (const [x, y] of geomOf(f)) acc(x, y); continue; }
    if (isPolylineFixture(f.input) || eps.length < 2) { for (const [x, y] of eps) acc(x, y); continue; }
    // BAR: the 4 outer corners of the thickness rectangle (same math as buildChrome).
    const ax = eps[0][0] * W, ay = eps[0][1] * Hh, bx = eps[eps.length - 1][0] * W, by = eps[eps.length - 1][1] * Hh;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, perpX = -dy / len, perpY = dx / len;
    const ht = (thicknessOf(f, cv) / 2) * (Hh / (cv.h || Hh));
    for (const sgn of [1, -1]) {
      acc((ax + perpX * ht * sgn) / W, (ay + perpY * ht * sgn) / Hh);
      acc((bx + perpX * ht * sgn) / W, (by + perpY * ht * sgn) / Hh);
    }
  }
  return any && maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}
// The 8 resize handles of a group box: 4 corners + 4 edge midpoints. col/row ∈
// {0,1,2}; a handle scales X when col≠1 (left/right) and Y when row≠1 (top/bottom).
// fx/fy are its normalized position on the box.
function groupHandles(gb) {
  const xs = [gb.minX, (gb.minX + gb.maxX) / 2, gb.maxX];
  const ys = [gb.minY, (gb.minY + gb.maxY) / 2, gb.maxY];
  return [[0, 0], [2, 0], [2, 2], [0, 2], [1, 0], [2, 1], [1, 2], [0, 1]]
    .map(([col, row]) => ({ col, row, fx: xs[col], fy: ys[row] }));
}

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

// The composition's 3D view state when 3D mode is ON (else null). Shared by
// createPreview's draw() and enableDragPlacement's gesture routing so both
// switch together. The sampled output projects through the chosen PROJECTION
// preset (view3d.projectionCamera; 'Flat (2D)' by default keeps the LEDs
// byte-identical with 2D — see project3d.js PROJECTION_PRESETS).
const view3dOf = (show) => {
  const v = show?.composition?.view3d;
  return v && v.mode === '3d' ? v : null;
};
// A polyline as clean 3-tuples for viewport projection (missing z = 0).
const pts3Of = (pts) => (pts || []).map((p) => [p?.[0] || 0, p?.[1] || 0, p?.[2] || 0]);
// A fixture's DRAWN/SAMPLED centreline: the evaluated curve for a bezier, the
// raw points otherwise. Everything that walks geometry goes through this.
const geomOf = (f) => (isBezierFixture(f.input) ? bezierToPoints(f.input) : f.input.points);

export function createPreview(canvasEl, opts = {}) {
  const ctx = canvasEl.getContext('2d');
  const svg = opts.svg || null;   // vector chrome layer (footprints/arrows/handles/labels)
  const dotR = opts.dotRadius ?? 4;
  const showLabels = opts.labels ?? true;
  // getBoundingClientRect forces a layout flush — too costly to call every frame
  // in the lights loop. Cache it; it only changes on resize/scroll and on a
  // zoom/pan (which always calls setRenderScale), so invalidate there.
  let rectCache = null;
  const invalidateRect = () => { rectCache = null; };
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', invalidateRect);
    window.addEventListener('scroll', invalidateRect, true);
  }
  const canvasRect = () => rectCache || (rectCache = canvasEl.getBoundingClientRect());
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
  // Live view: show ALL fixtures' cells at full strength (it's the "wall", not the
  // editor — selection-isolation doesn't apply).
  let liveView = false;
  function setLiveView(on) { liveView = !!on; }
  // The theme accent (driven from app on change) → fixture chrome border/fill, so
  // the canvas follows the chosen accent (not a hardcoded orange). [r,g,b].
  let accentRGB = [232, 163, 92];
  const accCss = (a) => `rgba(${accentRGB[0]},${accentRGB[1]},${accentRGB[2]},${a})`;
  function setAccentColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return;
    const n = parseInt(m[1], 16); accentRGB = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    chromeKey = null;   // force a chrome rebuild in the new accent
  }
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
    // Sample positions for the LIT preview, in NON-reversed geometric order (the
    // loop maps colour index by `reversed`). A matrix samples its cols×rows block;
    // a strip resamples its centreline.
    const samplePts = fixtureOrder.map((f) => (isGridFixture(f)
      ? gridPoints(f.input?.transform, f.cols, f.rows, f.distribution, show.composition?.canvas)
      : samplePoints(geomOf(f), f.input.samples)));
    const { runColor } = controllerColorMap(show);
    const chainColors = {};
    for (const r of runsOf(show)) chainColors[r.key] = runColor(r.deviceId, r.port);
    piCache = { show, fixtureOrder, spans, samplePts, chainColors, samplePts3D: null };
    return piCache;
  }
  // PHYSICAL (3D arc-length) sample positions per fixture, for the 3D viewport's
  // LED dots. Computed lazily on first 3D draw and cached with the pipeline (2D
  // mode never pays for it); grids sit on the canvas plane at z = 0.
  function samplePts3DFor(show) {
    const pi = pipelineFor(show);
    if (!pi.samplePts3D) {
      pi.samplePts3D = pi.fixtureOrder.map((f) => (isGridFixture(f)
        ? gridPoints(f.input?.transform, f.cols, f.rows, f.distribution, show.composition?.canvas).map((p) => [p[0], p[1], 0])
        : samplePoints3D(pts3Of(geomOf(f)), f.input.samples)));
    }
    return pi.samplePts3D;
  }
  // Volumetric field GHOSTS (3D viewport only): the SAME packed fields the GPU
  // sampler gets this frame ({ count, meta, a, b, colA, colB, time, trigSecs }
  // from packVolumetrics — see the app.js glue), or null when the FIELDS chip
  // is off / nothing volumetric is active. Pushed per frame by app.js so what
  // the ghost shows IS what the LEDs get (params, colours, opacity, ≤4 cap).
  let ghostVol = null;
  function setVolumetrics(vol) { ghostVol = vol; }

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
    invalidateRect();   // a zoom/pan moved the canvas — refresh the cull rect
  }

  const isSelected = (sel, id) => sel && (sel.has ? sel.has(id) : sel === id);

  function draw(show, rgba, selectedIds = null, snapGrid = 0, guides = null, marquee = null) {
    // 3D mode → render the scene through the ORBIT camera instead of the flat
    // 2D footprints (snap grid / guides / marquee are 2D-editing chrome — none
    // apply while the viewport is an angled 3D scene).
    if (view3dOf(show)) { draw3D(show, rgba, selectedIds); return; }
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
    const vr = canvasRect();
    const Lx = W / (vr.width || 1), Ly = Hh / (vr.height || 1);
    const vx0 = -vr.left * Lx - 24, vx1 = (window.innerWidth - vr.left) * Lx + 24;
    const vy0 = -vr.top * Ly - 24, vy1 = (window.innerHeight - vr.top) * Ly + 24;

    // Bright = SELECTED. Unselected cells always sit back at ~22% (even when nothing
    // is selected), so a lit fixture reads as "selected", not the default — and a
    // marquee/selection lights up only what it actually catches.

    for (let fi = 0; fi < fixtureOrder.length; fi++) {
      const f = fixtureOrder[fi];
      // Cull off-screen fixtures (footprint AABB vs the visible region). Grids skip
      // the cull — their 2-pt centreline cache understates the rectangle footprint.
      // Beziers cull on their EVALUATED curve (the chord understates an arch).
      const P0 = geomOf(f);
      if (P0 && P0.length && !isGridFixture(f)) {
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
      // Live view → all cells full (the wall). Otherwise selected → full, rest 22%.
      ctx.globalAlpha = (liveView || isSelected(selectedIds, f.id)) ? 1 : 0.22;
      if (count >= 1 && rgba) {
        if (isGridFixture(f)) {
          // MATRIX: a filled cell per LED at its grid position. Cell size = the
          // footprint divided by cols/rows (a small gap so cells read as pixels);
          // rotated with the panel. Colour index follows the wiring via `reversed`.
          const cvT2 = show.composition?.canvas;
          const sX = W / ((cvT2 && cvT2.w) || W), sY = Hh / ((cvT2 && cvT2.h) || Hh);
          const tw = Number(f.input?.transform?.w) || 0, th = Number(f.input?.transform?.h) || 0;
          const cw = Math.max(1.5, (tw / Math.max(1, f.cols)) * sX) * 0.92;
          const chh = Math.max(1.5, (th / Math.max(1, f.rows)) * sY) * 0.92;
          const ang = (Number(f.input?.transform?.rotation) || 0) * Math.PI / 180;
          const aa = Math.abs(ang) < 1e-3;
          let last = '';
          for (let i = 0; i < count; i++) {
            const si = (span.start + (reversed ? count - 1 - i : i)) * 4;
            let r = 0, g = 0, b = 0;
            if (si + 2 <= rgba.length - 1) { r = rgba[si]; g = rgba[si + 1]; b = rgba[si + 2]; }
            const css = `rgb(${r},${g},${b})`;
            if (css !== last) { ctx.fillStyle = css; last = css; }
            const cx = sx(i), cy = sy(i);
            if (aa) ctx.fillRect(Math.round(cx - cw / 2), Math.round(cy - chh / 2), Math.round(cw), Math.round(chh));
            else { ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); ctx.fillRect(-cw / 2, -chh / 2, cw, chh); ctx.restore(); }
          }
        } else if (!isPolylineFixture(f.input) && !isBezierFixture(f.input) && count >= 2) {
          // (a bezier takes the per-LED fallback below — its LEDs lie on a CURVE,
          // not on the straight endpoint-to-endpoint row this fast path blits)
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
          // Each LED is a cell: its ALONG-the-run size is the lit package (~5 mm, so
          // sparse strips read as dots, dense ones fill in); its ACROSS size is the
          // FULL fixture thickness — so resizing Height visibly fattens the strip,
          // not just the bounds. Axis-aligned bars draw crisp rects; angled ones rotate.
          const along = Math.max(1.5, Math.min(pitch, pitch * litFrac));
          const across = Math.max(1.5, thick);
          const axisAligned = Math.abs(ux) < 1e-3 || Math.abs(uy) < 1e-3;
          const ang = Math.atan2(uy, ux);
          let last = '';
          for (let i = 0; i < count; i++) {
            const si = (span.start + (reversed ? count - 1 - i : i)) * 4;
            let r = 0, g = 0, b = 0;
            if (si + 2 <= rgba.length - 1) { r = rgba[si]; g = rgba[si + 1]; b = rgba[si + 2]; }
            const css = `rgb(${r},${g},${b})`;
            if (css !== last) { ctx.fillStyle = css; last = css; }
            const cx = ax + ux * i * pitch, cy = ay + uy * i * pitch;
            if (axisAligned) {
              const horiz = Math.abs(ux) >= Math.abs(uy);
              const w = horiz ? along : across, h = horiz ? across : along;
              ctx.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
            } else {
              ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); ctx.fillRect(-along / 2, -across / 2, along, across); ctx.restore();
            }
          }
        } else {
          // Polyline fallback: a square per LED, sized to the same physical duty
          // cycle (litFrac of the pitch along the line), capped by the bar thickness.
          const spacing = count >= 2 ? (Math.hypot(sx(1) - sx(0), sy(1) - sy(0)) || thick) : thick;
          const cell = Math.max(1.5, Math.min(Math.max(2, thick), spacing * litFrac));
          let last = '';   // only touch fillStyle when the colour changes (matches the bar path)
          for (let i = 0; i < count; i++) {
            const si = (span.start + (reversed ? count - 1 - i : i)) * 4;
            let r = 0, g = 0, b = 0;
            if (si + 2 <= rgba.length - 1) { r = rgba[si]; g = rgba[si + 1]; b = rgba[si + 2]; }
            const css = `rgb(${r},${g},${b})`;
            if (css !== last) { ctx.fillStyle = css; last = css; }
            ctx.fillRect(sx(i) - cell / 2, sy(i) - cell / 2, cell, cell);
          }
        }
      }

    }
    ctx.globalAlpha = 1;   // reset after the isolate-dim pass
    // (Fixture footprints, handles, arrows, labels, chain wiring, snap grid/guides
    //  and the marquee are all drawn on the SVG chrome layer — see buildChrome.)

    drawDragHint(ck);
  }

  // Numeric value tag at the cursor while dragging/rotating/scaling — so you read
  // the value where you're working, not in a sidebar. Shared by the 2D draw and
  // the 3D viewport (a vertex drag in 3D shows its position/height the same way).
  function drawDragHint(ck) {
    if (!dragHint) return;
    const W = BASE_W, Hh = BASE_H;
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

  // --- 3D viewport --------------------------------------------------------------
  // Renders the SCENE through the orbit (view-only) camera: a ground grid on the
  // z=0 canvas plane, the canvas rectangle (where the composition lives), every
  // fixture's polyline projected to screen, and its lit LED dots. The flat
  // composite is dimmed via body.mode-3d CSS (app.js): drawn flat behind an
  // angled scene it would be spatially wrong, but a faint ghost keeps context of
  // what's playing at zero cost — this is a MAPPING view, not the wall.
  function draw3D(show, rgba, selectedIds) {
    const W = BASE_W, Hh = BASE_H;
    const ck = viewZoom <= 1 ? 1 / viewZoom : 1 / Math.pow(viewZoom, 1.35);
    ctx.setTransform(canvasEl.width / BASE_W, 0, 0, canvasEl.height / BASE_H, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    const v3 = view3dOf(show);
    const cam = orbitCamera(v3.orbit, W / Hh);

    // SVG chrome — rebuilt when the show ref changes (any orbit move produces a
    // new show object, so the scene follows the camera) or selection/zoom change.
    if (svg) {
      const selKey = selectedIds ? [...selectedIds].join(',') : '';
      const key = `3d|${selKey}|${viewZoom}`;
      if (show !== chromeShow || key !== chromeKey) {
        chromeShow = show; chromeKey = key;
        svg.innerHTML = buildChrome3D(show, selectedIds, cam, ck);
      }
    }
    // Volumetric field GHOSTS — schematic stand-ins for where each active field
    // sits in space. Drawn FIRST on the lights canvas so the LED dots (below)
    // paint over them, and the SVG chrome (a separate layer above the canvas)
    // keeps strips/handles fully readable on top.
    drawFieldGhosts(cam, ck);
    if (!show || !show.fixtures?.length || !rgba) return;

    // Lit LED dots: each fixture's PHYSICAL (3D arc-length) sample points,
    // projected through the orbit camera, one small square per LED coloured
    // from the sampled composite — same selection/live alpha logic as 2D.
    // (Chain offsets shift WHERE a fixture samples, not where it physically
    // sits, so they don't move the dots here.)
    const { fixtureOrder, spans } = pipelineFor(show);
    const pts3 = samplePts3DFor(show);
    for (let fi = 0; fi < fixtureOrder.length; fi++) {
      const f = fixtureOrder[fi];
      if (f.hidden) continue;
      const span = spans[fi];
      const pts = pts3[fi];
      const count = pts.length;
      const reversed = !!f.input.reversed;
      ctx.globalAlpha = (liveView || isSelected(selectedIds, f.id)) ? 1 : 0.22;
      const cell = Math.max(1.5, 2.5 * ck);
      let last = '';
      for (let i = 0; i < count; i++) {
        const [u, v] = project(pts[i], cam);
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;   // behind the orbit camera
        const si = (span.start + (reversed ? count - 1 - i : i)) * 4;
        let r = 0, g = 0, b = 0;
        if (si + 2 <= rgba.length - 1) { r = rgba[si]; g = rgba[si + 1]; b = rgba[si + 2]; }
        const css = `rgb(${r},${g},${b})`;
        if (css !== last) { ctx.fillStyle = css; last = css; }
        ctx.fillRect(u * W - cell / 2, v * Hh - cell / 2, cell, cell);
      }
    }
    ctx.globalAlpha = 1;
    drawDragHint(ck);   // vertex-drag position/height tag, same as 2D
  }

  // --- Volumetric field ghosts ---------------------------------------------------
  // Schematic z extent for the ghosts' vertical span (x/y plane quads, the z
  // gradient arrow, the noise lattice) — fields are unbounded in z, so this is
  // a legibility choice, sized to where lifted rigs actually live.
  const GHOST_Z = 0.6;
  // Noise lattice: ~10×7×4 probes per clip, hard-capped across clips (this is
  // per-frame JS — the budget keeps a pathological show cheap).
  const NLAT_X = 10, NLAT_Y = 7, NLAT_Z = 4, NLAT_BUDGET = 900;

  // Draw a schematic ghost per ACTIVE volumetric clip (fields.js semantics —
  // no math re-derived here beyond placing geometry at the packed params):
  //   plane sweep   → translucent quad ⊥ its axis at `pos` + faint ±thickness/2 edges
  //   axis gradient → a thick segmented colorA→colorB arrow along the axis
  //   sphere pulse  → 3 great-circle rings at center/radius (+ expanding ⚡ shells)
  //   noise 3d      → a sparse dot lattice tinted by the ACTUAL field value
  // Everything projects through the same orbit camera as the strips; polyline
  // strokes split where a point falls behind the camera (poly3's pattern) and
  // quad fills bail to outline-only when a corner does.
  function drawFieldGhosts(cam, ck) {
    const gv = ghostVol;
    if (!gv || !gv.count) return;
    const W = BASE_W, Hh = BASE_H;
    const P = [0, 0, 0];   // reused world point (allocation-light: no per-probe arrays)
    const prj = (x, y, z) => {
      P[0] = x; P[1] = y; P[2] = z;
      const uv = project(P, cam);
      return Number.isFinite(uv[0]) && Number.isFinite(uv[1]) ? [uv[0] * W, uv[1] * Hh] : null;
    };
    // Stroke a run of world points, splitting at behind-camera points.
    const stroke3 = (pts, css, w) => {
      ctx.strokeStyle = css; ctx.lineWidth = w;
      ctx.beginPath();
      let open = false;
      for (const q3 of pts) {
        const q = prj(q3[0], q3[1], q3[2]);
        if (!q) { open = false; continue; }
        if (open) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); open = true; }
      }
      ctx.stroke();
    };
    // The quad spanning the canvas extent ⊥ `axis` at coordinate v (x/y planes
    // rise 0..GHOST_Z; the z plane covers the full canvas). Axis thresholds
    // match fields.js axisCoord (<0.5 x, <1.5 y, else z).
    const planeQuad = (axis, v) => (axis < 0.5
      ? [[v, 0, 0], [v, 1, 0], [v, 1, GHOST_Z], [v, 0, GHOST_Z]]
      : axis < 1.5
        ? [[0, v, 0], [1, v, 0], [1, v, GHOST_Z], [0, v, GHOST_Z]]
        : [[0, 0, v], [1, 0, v], [1, 1, v], [0, 1, v]]);
    const quadOutline = (c, css, w) => stroke3([c[0], c[1], c[2], c[3], c[0]], css, w);
    const quadFill = (c, css) => {
      const q0 = prj(...c[0]), q1 = prj(...c[1]), q2 = prj(...c[2]), q3 = prj(...c[3]);
      if (!q0 || !q1 || !q2 || !q3) return;   // a corner behind the camera → outline only
      ctx.fillStyle = css;
      ctx.beginPath();
      ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.lineTo(q3[0], q3[1]);
      ctx.closePath(); ctx.fill();
    };
    // A great-circle ring around c in one of the three axis planes (0 = xy,
    // 1 = xz, 2 = yz), 32 segments, behind-camera splits like stroke3.
    const ring = (cx, cy, cz, r, plane, css, w) => {
      ctx.strokeStyle = css; ctx.lineWidth = w;
      ctx.beginPath();
      let open = false;
      for (let k = 0; k <= 32; k++) {
        const a = (k / 32) * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        const q = plane === 0 ? prj(cx + ca, cy + sa, cz)
          : plane === 1 ? prj(cx + ca, cy, cz + sa) : prj(cx, cy + ca, cz + sa);
        if (!q) { open = false; continue; }
        if (open) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); open = true; }
      }
      ctx.stroke();
    };
    const rings3 = (cx, cy, cz, r, css, w) => { for (const pl of [0, 1, 2]) ring(cx, cy, cz, r, pl, css, w); };

    ctx.save();
    const t = gv.time || 0;
    const A = gv.a, M = gv.meta;
    let latBudget = NLAT_BUDGET;
    for (let i = 0; i < gv.count; i++) {
      const o4 = i * 4, o3 = i * 3;
      const id = M[o4], op = Math.max(0, Math.min(1, M[o4 + 2]));
      if (op <= 0.01) continue;
      const cr = Math.round(gv.colA[o3] * 255), cg = Math.round(gv.colA[o3 + 1] * 255), cb = Math.round(gv.colA[o3 + 2] * 255);
      const css = (a) => `rgba(${cr},${cg},${cb},${(a).toFixed(3)})`;

      if (id === FIELD_IDS.planesweep) {
        // A = (axis, pos, thickness, softness): the plane itself as a very
        // subtle fill + edge, and the band's ±thickness/2 bounds as fainter
        // outlines — WHERE the band is, without hiding what's behind it.
        const axis = A[o4], pos = A[o4 + 1], half = Math.max(1e-4, A[o4 + 2]) * 0.5;
        const q = planeQuad(axis, pos);
        quadFill(q, css(0.12 * op));
        quadOutline(q, css(0.55 * op), 1.25 * ck);
        quadOutline(planeQuad(axis, pos - half), css(0.22 * op), ck);
        quadOutline(planeQuad(axis, pos + half), css(0.22 * op), ck);
      } else if (id === FIELD_IDS.axisgradient) {
        // A = (axis, scroll): a thick arrow along the axis through the canvas
        // centre, in 8 segments coloured by the ACTUAL field (scroll included).
        const axis = A[o4], scroll = A[o4 + 1];
        const cA = [gv.colA[o3], gv.colA[o3 + 1], gv.colA[o3 + 2]];
        const cB = [gv.colB[o3], gv.colB[o3 + 1], gv.colB[o3 + 2]];
        const at = (tt) => (axis < 0.5 ? [tt, 0.5, 0] : axis < 1.5 ? [0.5, tt, 0] : [0.5, 0.5, tt * GHOST_Z]);
        const prm = { axis, colorA: cA, colorB: cB, scroll };
        let lastCol = null, e1 = null;
        for (let k = 0; k < 8; k++) {
          const p0 = at(k / 8), p1 = at((k + 1) / 8);
          const g = axisGradient([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], prm);
          lastCol = `rgba(${Math.round(g[0] * 255)},${Math.round(g[1] * 255)},${Math.round(g[2] * 255)},${(0.85 * op).toFixed(3)})`;
          stroke3([p0, p1], lastCol, 4.5 * ck);
          e1 = p1;
        }
        // Arrowhead at the increasing-coordinate end, in the last segment's colour.
        const qTip = prj(e1[0], e1[1], e1[2]), qBack = prj(...at(0.85));
        if (qTip && qBack) {
          const dx = qTip[0] - qBack[0], dy = qTip[1] - qBack[1], len = Math.hypot(dx, dy) || 1;
          const ux2 = dx / len, uy2 = dy / len, s = 8 * ck;
          ctx.fillStyle = lastCol;
          ctx.beginPath();
          ctx.moveTo(qTip[0] + ux2 * s, qTip[1] + uy2 * s);
          ctx.lineTo(qTip[0] - uy2 * s * 0.6, qTip[1] + ux2 * s * 0.6);
          ctx.lineTo(qTip[0] + uy2 * s * 0.6, qTip[1] - ux2 * s * 0.6);
          ctx.closePath(); ctx.fill();
        }
      } else if (id === FIELD_IDS.spherepulse) {
        // A = (cx, cy, cz, radius), B = (thickness, softness, speed): wireframe
        // rings at the static shell, plus one ring set per EXPANDING ⚡ shell
        // (radius = age·speed — the sampler's exact clock math: age = time −
        // trigSec over the last 8 triggers).
        const cx = A[o4], cy = A[o4 + 1], cz = A[o4 + 2], r = A[o4 + 3];
        const speed = gv.b[o4 + 2];
        if (r > 1e-3) rings3(cx, cy, cz, r, css(0.6 * op), 1.25 * ck);
        const trigs = gv.trigSecs || [];
        for (let k = Math.max(0, trigs.length - 8); k < trigs.length; k++) {
          const rr = (t - trigs[k]) * speed;
          if (rr > 0.02 && rr < 2) rings3(cx, cy, cz, rr, css(0.4 * op), ck);
        }
      } else if (id === FIELD_IDS.noise3d && latBudget >= NLAT_X * NLAT_Y * NLAT_Z) {
        // A = (scale, speed): a sparse lattice probe — evaluate the REAL field
        // (fields.js noise3d, drift included) on a coarse grid and dot where it
        // reads bright, so the volume's texture is visible off the strips.
        latBudget -= NLAT_X * NLAT_Y * NLAT_Z;
        const prm = { scale: A[o4], speed: A[o4 + 1], color: [1, 1, 1] };   // colour applied via css() below
        const dot = Math.max(1.5, 2.4 * ck);
        for (let zi = 0; zi < NLAT_Z; zi++) {
          for (let yi = 0; yi < NLAT_Y; yi++) {
            for (let xi = 0; xi < NLAT_X; xi++) {
              P[0] = (xi + 0.5) / NLAT_X; P[1] = (yi + 0.5) / NLAT_Y; P[2] = ((zi + 0.5) / NLAT_Z) * GHOST_Z;
              const v = noise3d(P, t, prm)[3];
              if (v < 0.4) continue;   // small-alpha probes stay invisible → skip the draw
              const q = prj(P[0], P[1], P[2]);
              if (!q) continue;
              ctx.fillStyle = css(v * op * 0.7);
              ctx.fillRect(q[0] - dot / 2, q[1] - dot / 2, dot, dot);
            }
          }
        }
      }
    }
    ctx.restore();
  }

  // The 3D scene's vector chrome (grid / canvas plane / strips) as one SVG
  // markup string — the 3D counterpart of buildChrome, same colour logic
  // (controller Tint, selection accent, hidden ghosts).
  function buildChrome3D(show, selectedIds, cam, ck) {
    const W = BASE_W, Hh = BASE_H;
    const p = [];
    const prj = (x, y, z) => { const uv = project([x, y, z], cam); return [uv[0] * W, uv[1] * Hh]; };
    const finite = (q) => Number.isFinite(q[0]) && Number.isFinite(q[1]);
    // A 3D polyline → one or more <polyline> strings (split where points fall
    // behind the orbit camera rather than drawing a degenerate segment).
    const poly3 = (pts3, stroke, w, dash) => {
      let run = [];
      const flush = () => {
        if (run.length >= 2) p.push(`<polyline points="${run.map((q) => `${nz(q[0])},${nz(q[1])}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${nz(w)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
        run = [];
      };
      for (const pt of pts3) { const q = prj(pt[0], pt[1], pt[2] || 0); if (finite(q)) run.push(q); else flush(); }
      flush();
    };
    const du = viewZoom <= 1 ? 1 / viewZoom : 1 / Math.pow(viewZoom, 0.6);
    const DASH = `${nz(9 * du)} ${nz(5 * du)}`;

    // Ground grid: 10×10 cells on the z=0 plane over the canvas extent (subtle).
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      poly3([[t, 0, 0], [t, 1, 0]], 'rgba(255,255,255,.09)', ck);
      poly3([[0, t, 0], [1, t, 0]], 'rgba(255,255,255,.09)', ck);
    }
    // The canvas rectangle — the z=0 composition plane the visuals project onto.
    poly3([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]], 'rgba(170,176,186,.55)', 1.25 * ck);

    // PROJECTION-camera frustum gizmo: a marker at the camera position + a line
    // to each canvas-plane corner it frames, so the chosen preset's placement is
    // legible while orbiting. Ortho is drawn the same way (schematic — its rays
    // are really parallel). Flat = no camera object → no gizmo. NOT draggable in
    // v1: placement is preset-only; free placement is future work.
    const pcam = view3dOf(show)?.projectionCamera;
    if (pcam && pcam.mode !== 'flat' && Array.isArray(pcam.pos)) {
      for (const corner of [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]) poly3([pcam.pos, corner], accCss(.35), ck, DASH);
      const q = prj(pcam.pos[0], pcam.pos[1], pcam.pos[2] || 0);
      if (finite(q)) {
        p.push(rectS(q[0] - 3.5 * ck, q[1] - 3.5 * ck, 7 * ck, 7 * ck, accCss(.9), 1.25 * ck));
        p.push(labelS('PROJ', q[0], q[1] - 9 * ck, false, ck));
      }
    }

    if (show && show.fixtures?.length) {
      const { fixtureOrder, chainColors } = pipelineFor(show);
      const routed = new Set(fixtureOrder.map((f) => f.id));
      const drawList = fixtureOrder.concat(show.fixtures.filter((f) => !routed.has(f.id)));
      const dim = (c) => (colorTint ? c : accCss(.9));
      for (const f of drawList) {
        const eps = f.input.points; if (!eps || !eps.length) continue;
        const bez = isBezierFixture(f.input);
        const pts3 = pts3Of(geomOf(f));                  // bezier draws its EVALUATED curve
        const selected = isSelected(selectedIds, f.id);
        if (f.hidden) {                                  // faint ghost outline
          poly3(pts3, selected ? accCss(.55) : 'rgba(150,156,166,.28)', 1.25 * ck, DASH);
          continue;
        }
        const stroke = selected ? accCss(1) : dim(chainColors[runKey(f)] || accCss(.9));
        poly3(pts3, stroke, (selected ? 2 : 1.25) * ck);
        if (selected) {
          // Vertex handles + the label. Polyline vertices and bezier ENDS are
          // DRAGGABLE in 3D (ground-plane move; Alt = vertical) so they get the
          // same 8px chrome as 2D; bar/grid endpoints are view-only markers.
          const hs = (isPolylineFixture(f.input) || bez) ? 4 * ck : 3 * ck;
          for (const pt of pts3Of(bez ? [eps[0], eps[eps.length - 1]] : eps)) {
            const q = prj(pt[0], pt[1], pt[2]);
            if (finite(q)) p.push(rectS(q[0] - hs, q[1] - hs, hs * 2, hs * 2, stroke, 1.25 * ck));
          }
          if (bez) {
            // The CONTROL: a hollow diamond, tethered to both ends by faint
            // dashed guides — Alt-drag it up to raise the arch.
            const c = pts3Of([f.input.bezier?.c || eps[0]])[0];
            const e0 = pts3Of([eps[0]])[0], e1 = pts3Of([eps[eps.length - 1]])[0];
            poly3([e0, c, e1], accCss(.45), ck, DASH);
            const q = prj(c[0], c[1], c[2]);
            if (finite(q)) p.push(diamondS(q[0], q[1], 5 * ck, stroke, 1.5 * ck));
          }
          if (showLabels) {
            const q = prj(pts3[0][0], pts3[0][1], pts3[0][2]);
            if (finite(q)) p.push(labelS(fixtureLabel(f, show.fixtures.indexOf(f)), q[0], q[1] - 10 * ck, true, ck));
          }
        }
      }
    }
    return p.join('');
  }

  // --- SVG chrome string builders (same 0..BASE coords as the lights canvas) ----
  const nz = (n) => Math.round(n * 100) / 100;                 // trim coordinate noise
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rectS = (x, y, w, h, stroke, sw) =>
    `<rect x="${nz(x)}" y="${nz(y)}" width="${nz(w)}" height="${nz(h)}" fill="rgba(20,20,24,.9)" stroke="${stroke}" stroke-width="${nz(sw)}"/>`;
  // Hollow diamond — the bezier CONTROL handle, visually distinct from the
  // square end/vertex handles so "this shapes the curve" reads at a glance.
  const diamondS = (cx, cy, r, stroke, sw) =>
    `<polygon points="${nz(cx)},${nz(cy - r)} ${nz(cx + r)},${nz(cy)} ${nz(cx)},${nz(cy + r)} ${nz(cx - r)},${nz(cy)}" fill="rgba(20,20,24,.9)" stroke="${stroke}" stroke-width="${nz(sw)}"/>`;
  // Filled arrowhead at p0 pointing toward p1 (direction / pixel-0). `thick` scales
  // it with a bar's thickness; omitted ⇒ constant screen size.
  const arrowS = (p0x, p0y, p1x, p1y, color, thick, ck) => {
    const dx = p1x - p0x, dy = p1y - p0y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    // Scale a little with a bar's thickness, but CAP it so a fat fixture doesn't
    // get a giant arrowhead (it reads as a small direction marker, not a wedge).
    const tip = thick != null ? Math.max(8 * ck, Math.min(thick * 0.9, 13 * ck)) : 9 * ck;
    const wide = thick != null ? Math.max(4 * ck, Math.min(thick * 0.5, 7 * ck)) : 4.5 * ck;
    return `<polygon points="${nz(p0x + ux * tip)},${nz(p0y + uy * tip)} ${nz(p0x + px * wide)},${nz(p0y + py * wide)} ${nz(p0x - px * wide)},${nz(p0y - py * wide)}" fill="${color}"/>`;
  };
  const labelS = (text, cx, cy, selected, ck) => {
    const fs = 11 * ck, fill = selected ? accCss(1) : 'rgba(205,210,218,.92)';
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
    // Dash unit: constant SCREEN size at zoom ≤ 1, then GROWS gently when zoomed in
    // (screen length ∝ zoom^0.4) so the dashes don't read as tiny ticks against a
    // big, zoomed-in fixture. Strokes still use the dampened `ck` to read as hairlines.
    const du = viewZoom <= 1 ? 1 / viewZoom : 1 / Math.pow(viewZoom, 0.6);
    const DASH = `${nz(9 * du)} ${nz(5 * du)}`;        // fixture outlines — long dashes
    const LINK_DASH = `${nz(1.5 * du)} ${nz(4 * du)}`; // chain connections — fine dots (distinct)

    if (snapGrid > 0) {
      for (let x = 0; x <= W; x += snapGrid) ln(x, 0, x, Hh, 'rgba(255,255,255,.09)', ck);
      for (let y = 0; y <= Hh; y += snapGrid) ln(0, y, W, y, 'rgba(255,255,255,.09)', ck);
    }
    if (guides) for (const g of guides) {
      if (g.axis === 'x') ln(g.v, 0, g.v, Hh, accCss(.85), ck);
      else ln(0, g.v, W, g.v, accCss(.85), ck);
    }

    if (show && show.fixtures?.length) {
      const { fixtureOrder, chainColors } = pipelineFor(show);
      // Draw ROUTED fixtures (with chain colours) AND unassigned ones (no device
      // yet) — a fixture you just added should appear on the canvas so you can
      // place it before wiring it to an output. Unassigned ⇒ neutral colour.
      const routed = new Set(fixtureOrder.map((f) => f.id));
      const drawList = fixtureOrder.concat(show.fixtures.filter((f) => !routed.has(f.id)));
      // Not tinting by controller → the fixture chrome uses the theme ACCENT (so a
      // fixture reads clearly on the canvas, in the chosen accent).
      const dim = (c) => (colorTint ? c : accCss(.9));
      const selFx = selectedIds && show.fixtures.find((f) => isSelected(selectedIds, f.id));
      const focusKey = selFx ? runKey(selFx) : null;
      for (const f of drawList) {
        const eps = f.input.points; if (!eps || !eps.length) continue;
        const reversed = !!f.input.reversed;
        if (f.hidden) {                                  // faint ghost outline
          const onSel = isSelected(selectedIds, f.id);
          poly(geomOf(f), onSel ? accCss(.55) : 'rgba(150,156,166,.28)', (onSel ? 1.5 : 1.25) * ck, DASH);
          continue;
        }
        const selected = isSelected(selectedIds, f.id);
        const isDmx = isDmxFixture(f);   // point fixture (par): no direction arrow / rotate / chain
        const stroke = selected ? accCss(1) : dim(chainColors[runKey(f)] || accCss(.9));
        // Only the SELECTED fixture gets the accent wash background; unselected ones
        // are outline-only (no coloured fill).
        const bodyFill = selected ? accCss(.18) : 'none';
        const lblLen = eps.length >= 2 ? Math.hypot((eps[eps.length - 1][0] - eps[0][0]) * W, (eps[eps.length - 1][1] - eps[0][1]) * Hh) : 0;
        const showLbl = selected || runKey(f) === focusKey || (!focusKey && lblLen * viewZoom >= 46 && viewZoom >= 1.1);
        if (!selected && runKey(f) !== focusKey && lblLen * viewZoom < 13) continue;   // LOD: tiny → no chrome
        const fIdx = show.fixtures.indexOf(f);
        const dash = selected ? null : DASH;

        if (isBezierFixture(f.input)) {
          // Bezier: the EVALUATED curve is the body; ends get square handles,
          // the control a hollow diamond tethered by faint dashed guides.
          const curve = geomOf(f);
          poly(curve, stroke, (selected ? 1 : 0.6) * ck, dash);   // hairline body (selected slightly heavier)
          const cL = curve.length - 1, a0 = reversed ? curve[cL] : curve[0], a1 = reversed ? curve[cL - 1] : curve[1];
          p.push(arrowS(a0[0] * W, a0[1] * Hh, a1[0] * W, a1[1] * Hh, stroke, null, ck));
          if (selected) {
            for (const e of [eps[0], eps[eps.length - 1]]) { const hx = e[0] * W, hy = e[1] * Hh, s = 4 * ck; p.push(rectS(hx - s, hy - s, s * 2, s * 2, stroke, 1.25 * ck)); }
            const c = f.input.bezier?.c || eps[0];
            poly([eps[0], c, eps[eps.length - 1]], accCss(.45), ck, DASH);
            p.push(diamondS(c[0] * W, c[1] * Hh, 5 * ck, stroke, 1.5 * ck));
          }
          if (showLabels && showLbl) p.push(labelS(fixtureLabel(f, fIdx), eps[0][0] * W, eps[0][1] * Hh - 10, selected, ck));
          continue;
        }
        if (isPolylineFixture(f.input)) {
          poly(eps, stroke, 0.6 * ck, dash);   // hairline body, matching the bar footprint
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
        p.push(`<polygon points="${nz(c1[0])},${nz(c1[1])} ${nz(c2[0])},${nz(c2[1])} ${nz(c3[0])},${nz(c3[1])} ${nz(c4[0])},${nz(c4[1])}" fill="${bodyFill}" stroke="${stroke}" stroke-width="${nz(0.6 * ck)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
        if (!isDmx) { if (reversed) p.push(arrowS(bx, by, ax, ay, stroke, ht, ck)); else p.push(arrowS(ax, ay, bx, by, stroke, ht, ck)); }
        const cx = (ax + bx) / 2, cy = (ay + by) / 2;
        if (selected) p.push(`<circle cx="${nz(cx)}" cy="${nz(cy)}" r="${nz((dotR + 4) * ck)}" fill="${accCss(.3)}" stroke="${stroke}" stroke-width="${nz(ck)}"/>`);
        const single = selected && (!selectedIds.has || selectedIds.size === 1);
        if (single) {
          for (const c of [c1, c2, c3, c4]) p.push(rectS(c[0] - 3 * ck, c[1] - 3 * ck, 6 * ck, 6 * ck, stroke, 1.5 * ck));
          // Edge-midpoint handles (resize ONE axis): end, start, +thick, -thick.
          const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
          for (const m of [mid(c2, c3), mid(c4, c1), mid(c1, c2), mid(c3, c4)]) p.push(rectS(m[0] - 3 * ck, m[1] - 3 * ck, 6 * ck, 6 * ck, stroke, 1.5 * ck));
          if (!isDmx) {   // par fixtures have no meaningful pixel direction → no rotate knob
            const e0 = eps[0], e1 = eps[eps.length - 1], cxN = (e0[0] + e1[0]) / 2, cyN = (e0[1] + e1[1]) / 2;
            const adx = e1[0] - e0[0], ady = e1[1] - e0[1], adl = Math.hypot(adx, ady) || 1;
            const knx = (cxN + (-ady / adl) * ROTATE_KNOB) * W, kny = (cyN + (adx / adl) * ROTATE_KNOB) * Hh;
            ln(cx, cy, knx, kny, stroke, ck);
            p.push(`<circle cx="${nz(knx)}" cy="${nz(kny)}" r="${nz(5 * ck)}" fill="rgba(20,20,24,.92)" stroke="${stroke}" stroke-width="${nz(1.5 * ck)}"/>`);
          }
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
        // Point fixtures (DMX pars) aren't daisy-chained pixel runs → no wiring lines.
        const members = ch.members.map((id) => show.fixtures.find((f) => f.id === id)).filter(Boolean).filter((f) => !isDmxFixture(f));
        if (members.length < 2) continue;
        const col = dim(chainColors[ch.key] || 'rgba(150,156,166,.45)');
        for (let i = 0; i < members.length - 1; i++) {
          const [ax, ay] = endOf(members[i], 'out');
          const [bx, by] = endOf(members[i + 1], 'in');
          ln(ax, ay, bx, by, col, 1.25 * ck, LINK_DASH);
          p.push(arrowS(bx, by, bx + (bx - ax), by + (by - ay), col, null, ck));
        }
        const [ox0, oy0] = endOf(members[0], 'in');
        p.push(`<circle cx="${nz(ox0)}" cy="${nz(oy0)}" r="${nz(5 * ck)}" fill="none" stroke="${col}" stroke-width="${nz(1.25 * ck)}"/>`);
      }
    }

    // Group-resize box + 8 handles (corners + edge midpoints) (2+ selected).
    const gb = groupBox(show, selectedIds, W, Hh);
    if (gb) {
      const x = gb.minX * W, y = gb.minY * Hh, w = (gb.maxX - gb.minX) * W, h = (gb.maxY - gb.minY) * Hh;
      p.push(`<rect x="${nz(x)}" y="${nz(y)}" width="${nz(w)}" height="${nz(h)}" fill="none" stroke="${accCss(1)}" stroke-width="${nz(ck)}" stroke-dasharray="${DASH}"/>`);
      for (const hd of groupHandles(gb)) p.push(rectS(hd.fx * W - 4 * ck, hd.fy * Hh - 4 * ck, 8 * ck, 8 * ck, accCss(1), 1.5 * ck));
    }

    if (marquee) {
      const x = marquee.x0 * W, y = marquee.y0 * Hh, w = (marquee.x1 - marquee.x0) * W, h = (marquee.y1 - marquee.y0) * Hh;
      p.push(`<rect x="${nz(x)}" y="${nz(y)}" width="${nz(w)}" height="${nz(h)}" fill="${accCss(.1)}" stroke="${accCss(.85)}" stroke-width="${nz(ck)}" stroke-dasharray="${DASH}"/>`);
    }
    return p.join('');
  }

  return { draw, setRenderScale, setBaseSize, setColorTint, setAccentColor, setLiveView, setVolumetrics };
}

// Drag-placement on the Output overlay:
//   • drag a fixture body → move the whole fixture (bar transform x/y, or all
//     polyline points)
//   • drag a polyline vertex → reshape that bend
//   • double-click a segment → insert a vertex (a bar becomes a bendable run)
//   • right-click a vertex → remove it
// Edits derive a new show and call onEdit(next) per move; onCommit on release.
export function enableDragPlacement(canvasEl, { getShow, onEdit, onCommit, onSelect, getSelected, snap, onMarqueeStart, onMarquee, onMarqueeEnd, onView }, opts = {}) {
  const hitR = opts.hitRadius ?? 26;      // body click tolerance (bigger = easier to grab a thin strip)
  const vtxR = opts.vertexRadius ?? 12;   // handle grab radius
  let dragState = null;
  let enabled = opts.enabled ?? true;
  // Listen on a LARGER surface than the composition canvas (the pasteboard) so a
  // fixture dragged OUTSIDE the canvas stays grabbable. Coordinates are still
  // measured against canvasEl (#preview), so points outside 0..1 map correctly.
  const evEl = opts.eventTarget || canvasEl;

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
  // Map a corner's screen-space direction (dx,dy from the fixture centre) to the
  // matching resize cursor — so a horizontal end reads ↔, a vertical end ↕, and a
  // diagonal corner the ⤡/⤢ diagonals (depends on the fixture's rotation).
  function resizeCursor(dx, dy) {
    let a = (Math.atan2(dy, dx) * 180 / Math.PI % 180 + 180) % 180;   // 0..180 (symmetric)
    if (a < 22.5 || a >= 157.5) return 'ew-resize';
    if (a < 67.5) return 'nwse-resize';
    if (a < 112.5) return 'ns-resize';
    return 'nesw-resize';
  }
  // The cursor for whatever's under the pointer (hover feedback).
  function cursorFor(hit) {
    if (!hit) return 'default';
    if (hit.rotate) return 'grab';                 // rotate knob
    if (hit.scaleCorner != null || hit.scaleEdge != null || hit.groupHandle) return hit.cursor || 'nwse-resize';
    if (hit.vertex != null || hit.control || hit.seg != null || hit.bez) return 'move';   // body / vertex / bezier control → move
    return 'default';
  }

  // 3D viewport hit-test: project each fixture's polyline through the orbit
  // camera and test in screen space (same tolerances as 2D). Precedence mirrors
  // 2D: POLYLINE vertex handles first (precise, ≤ vtxR), then the nearest body
  // segment (≤ hitR). Returns { fxId, vertex } for a vertex grab, or
  // { fxId, seg, t } for a body hit — `t` is the parametric position along the
  // hit segment (screen space) so a dblclick can insert a vertex ON the run,
  // z interpolated. Bars/grids are select-only in 3D (their shape is a 2D
  // transform; lift them with the editor's Z field).
  function hitTest3D(ev, v3) {
    const show = getShow();
    const [px, py, rw, rh] = localPx(ev);
    const cam = orbitCamera(v3.orbit, rw / rh);
    const fixtures = show.fixtures ?? [];
    const toScreen = (pts) => pts3Of(pts || []).map((e) => {
      const uv = project(e, cam);
      return Number.isFinite(uv[0]) && Number.isFinite(uv[1]) ? [uv[0] * rw, uv[1] * rh] : null;
    });
    // Handles first (topmost wins): a bezier's control diamond + its two ends;
    // a polyline's vertices. Both drag in world space (Alt = vertical).
    for (let i = fixtures.length - 1; i >= 0; i--) {
      const f = fixtures[i];
      const bez = isBezierFixture(f.input);
      if (!bez && !isPolylineFixture(f.input)) continue;
      if (bez && f.input.bezier?.c) {
        const [qc] = toScreen([f.input.bezier.c]);
        if (qc && Math.hypot(px - qc[0], py - qc[1]) <= vtxR) return { fxId: f.id, control: true };
      }
      const q = toScreen(f.input.points);
      for (const v of bez ? [0, q.length - 1] : q.keys()) {
        if (q[v] && Math.hypot(px - q[v][0], py - q[v][1]) <= vtxR) return { fxId: f.id, vertex: v };
      }
    }
    // Then bodies — the NEAREST segment across all fixtures wins (as in 2D).
    // A bezier's body is its EVALUATED curve (seg/t then address the curve, so
    // dblclick-insert is disabled for beziers — see the dblclick handler).
    let best = null;
    for (let i = fixtures.length - 1; i >= 0; i--) {
      const f = fixtures[i];
      const q = toScreen(geomOf(f));
      for (let s = 0; s < q.length - 1; s++) {
        const a = q[s], b = q[s + 1];
        if (!a || !b) continue;
        const d = segDist(px, py, a[0], a[1], b[0], b[1]);
        if (d <= hitR && (!best || d < best.dist)) {
          const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
          const t = len2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) : 0;
          best = { fxId: f.id, seg: s, t, dist: d };
        }
      }
    }
    return best ? { fxId: best.fxId, seg: best.seg, t: best.t } : null;
  }

  function hitTest(ev) {
    const show = getShow();
    if (view3dOf(show)) return null;   // 3D mode: 2D handles/bodies don't exist on screen
    const [px, py, rw, rh] = localPx(ev);
    const fixtures = show.fixtures ?? [];
    // Rotate knob (a single selected bar) wins over everything — test it first.
    const sel = getSelected?.();
    // Group-resize: 2+ selected → 8 handles (corners + edge midpoints) on the box.
    // Corners scale both axes (diagonal), edges scale one (↔ / ↕).
    if (sel && sel.has && sel.size > 1) {
      const gb = groupBox(show, sel, rw, rh);
      if (gb) {
        const ccx = (gb.minX + gb.maxX) / 2 * rw, ccy = (gb.minY + gb.maxY) / 2 * rh;
        for (const h of groupHandles(gb)) {
          const hx = h.fx * rw, hy = h.fy * rh;
          if (Math.hypot(px - hx, py - hy) <= vtxR) {
            const cur = (h.col !== 1 && h.row !== 1) ? resizeCursor(hx - ccx, hy - ccy) : (h.col !== 1 ? 'ew-resize' : 'ns-resize');
            return { groupHandle: h, cursor: cur };
          }
        }
      }
    }
    const selId = sel ? (sel.has ? (sel.size === 1 ? [...sel][0] : null) : sel) : null;
    if (selId) {
      const f = fixtures.find((x) => x.id === selId);
      // Rotate/resize chrome is BAR-only (a bezier/polyline has no box transform).
      if (f && !isPolylineFixture(f.input) && !isBezierFixture(f.input)) {
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
        const ccx = cxN * rw, ccy = cyN * rh;
        for (let c = 0; c < 4; c++) {
          if (Math.hypot(px - corners[c][0], py - corners[c][1]) <= vtxR) return { fxId: selId, scaleCorner: c, cursor: resizeCursor(corners[c][0] - ccx, corners[c][1] - ccy) };
        }
        // Edge midpoints (resize one axis): 0=end(+u), 1=start(−u), 2=+thick(+p), 3=−thick(−p).
        const mid = (u, v) => [(corners[u][0] + corners[v][0]) / 2, (corners[u][1] + corners[v][1]) / 2];
        const edges = [[mid(1, 2), 0], [mid(3, 0), 1], [mid(0, 1), 2], [mid(2, 3), 3]];
        for (const [m, e] of edges) {
          if (Math.hypot(px - m[0], py - m[1]) <= vtxR) return { fxId: selId, scaleEdge: e, cursor: resizeCursor(m[0] - ccx, m[1] - ccy) };
        }
      }
    }
    // Body hits: gather EVERY fixture within tolerance and pick the one whose
    // centreline is NEAREST the cursor — with overlapping/parallel strips the
    // topmost used to win even when another strip was visibly closer. Vertex
    // handles (precise) still win over any body.
    let best = null;   // { hit, dist }
    const consider = (hit, dist) => { if (!best || dist < best.dist) best = { hit, dist }; };
    for (let i = fixtures.length - 1; i >= 0; i--) {
      const f = fixtures[i];
      const pts = f.input.points;
      if (isBezierFixture(f.input)) {
        // Control diamond first (precise), then the two end handles, then the
        // EVALUATED curve as the body.
        const c = f.input.bezier?.c;
        if (c && Math.hypot(px - c[0] * rw, py - c[1] * rh) <= vtxR) return { fxId: f.id, control: true };
        for (const v of [0, pts.length - 1]) {
          if (Math.hypot(px - pts[v][0] * rw, py - pts[v][1] * rh) <= vtxR) return { fxId: f.id, vertex: v };
        }
        const curve = geomOf(f);
        for (let v = 0; v < curve.length - 1; v++) {
          const d = segDist(px, py, curve[v][0] * rw, curve[v][1] * rh, curve[v + 1][0] * rw, curve[v + 1][1] * rh);
          if (d <= hitR) consider({ fxId: f.id, bez: true }, d);
        }
        continue;
      }
      if (isPolylineFixture(f.input)) {
        for (let v = 0; v < pts.length; v++) {            // vertices first (precise)
          if (Math.hypot(px - pts[v][0] * rw, py - pts[v][1] * rh) <= vtxR) return { fxId: f.id, vertex: v };
        }
        for (let v = 0; v < pts.length - 1; v++) {        // then any segment (body)
          const d = segDist(px, py, pts[v][0] * rw, pts[v][1] * rh, pts[v + 1][0] * rw, pts[v + 1][1] * rh);
          if (d <= hitR) consider({ fxId: f.id, seg: v }, d);
        }
      } else {
        const ax = pts[0][0] * rw, ay = pts[0][1] * rh;
        const bx = pts[pts.length - 1][0] * rw, by = pts[pts.length - 1][1] * rh;
        // Hit ANYWHERE on the footprint: perpendicular distance within the bar's
        // half-thickness (min hitR so thin strips stay grabbable) and the projection
        // within the run — i.e. the whole rotated rectangle, not just the centreline.
        const cv = show.composition?.canvas || { w: rw, h: rh };
        const half = Math.max(hitR, (thicknessOf(f, cv) / 2) * (rh / (cv.h || rh)));
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
        const t = ((px - ax) * dx + (py - ay) * dy) / len2;
        const tc = Math.max(0, Math.min(1, t));
        const perp = Math.hypot(px - (ax + tc * dx), py - (ay + tc * dy));
        if (perp <= half && t >= -hitR / Math.sqrt(len2) && t <= 1 + hitR / Math.sqrt(len2)) consider({ fxId: f.id, seg: 0 }, perp);
      }
    }
    return best ? best.hit : null;
  }

  const canvasPx = (ev, cv) => {
    const r = canvasEl.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width * cv.w, (ev.clientY - r.top) / r.height * cv.h];
  };
  const norm = (ev) => {
    const r = canvasEl.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  };

  // A bar's DRAWN frame, in canvas px: axis u runs along the centreline
  // (endpoint→endpoint), p is perpendicular. Built from the derived `points` (the
  // same geometry hitTest and draw() use), so the aspect-based orientation — a box
  // taller than wide draws VERTICAL — is honoured. The raw transform.rotation alone
  // is 90° off for such fixtures, which is what made horizontal drags warp the shape.
  function drawnFrame(f, cv) {
    const pts = f.input.points;
    const ax = pts[0][0] * cv.w, ay = pts[0][1] * cv.h;
    const bx = pts[pts.length - 1][0] * cv.w, by = pts[pts.length - 1][1] * cv.h;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    return { ux, uy, pxx: -uy, pyy: ux, cx: (ax + bx) / 2, cy: (ay + by) / 2,
      len, thick: thicknessOf(f, cv), rotDeg: Math.atan2(dy, dx) * 180 / Math.PI };
  }

  evEl.addEventListener('pointerdown', (ev) => {
    if (!enabled) return;
    if (ev.button !== 0) return;   // left only — middle is the hand-pan, right the context menu
    // UI chrome parked OVER the stage (the projection preset row + FIELDS chip)
    // needs its native clicks: capturing the pointer here retargets the click
    // to the pasteboard and the buttons never fire.
    if (ev.target?.closest?.('#proj-row')) return;
    const v3 = view3dOf(getShow());
    if (v3) {
      // 3D mode: a CLICK selects the strip under the cursor; a DRAG orbits the
      // view (Shift = pan the target) — EXCEPT on a polyline vertex handle,
      // which drags that vertex in world space: on the HORIZONTAL plane through
      // its current z by default, or VERTICALLY (z only) while Alt is held.
      // (Alt, not Shift — Shift already pans the orbit target in 3D.)
      // Orbit/pan changes flow through onView — view-only state that must save
      // WITHOUT entering undo history (like zoom/pan, it isn't an edit).
      const hit3 = hitTest3D(ev, v3);
      if (hit3) onSelect?.(hit3.fxId, ev);
      if (hit3 && (hit3.vertex != null || hit3.control)) {
        // ctl: the bezier CONTROL rides the same plane/Alt gestures as a vertex
        // — Alt-dragging it up pulls a flat strip into a standing arch.
        dragState = { kind: 'vertex3d', id: hit3.fxId, index: hit3.vertex, ctl: !!hit3.control,
          lastY: ev.clientY, cursor: 'move' };
      } else {
        const o = v3.orbit || {};
        dragState = ev.shiftKey
          ? { kind: 'orbitpan', x0: ev.clientX, y0: ev.clientY, target0: (Array.isArray(o.target) ? o.target : [0.5, 0.5, 0]).slice() }
          : { kind: 'orbit', x0: ev.clientX, y0: ev.clientY, az0: Number(o.az) || 0, el0: Number(o.el) || 0, hitFx: hit3?.fxId ?? null };
        dragState.cursor = 'grabbing';
      }
      evEl.style.cursor = dragState.cursor;
      evEl.setPointerCapture(ev.pointerId); ev.preventDefault();
      return;
    }
    const hit = hitTest(ev);
    if (!hit) {
      // Empty canvas → rubber-band marquee select (Shift = add to selection).
      const [nx, ny] = norm(ev);
      dragState = { kind: 'marquee', x0: nx, y0: ny, additive: !!ev.shiftKey };
      onMarqueeStart?.(dragState.additive);
      evEl.setPointerCapture(ev.pointerId); ev.preventDefault();
      return;
    }
    if (hit.fxId != null) onSelect?.(hit.fxId, ev);   // group-corner grabs have no fxId — keep the multi-selection
    const show = getShow();
    const cv = show.composition?.canvas || { w: 1280, h: 720 };

    if (hit.groupHandle) {
      // Directional group resize: a corner scales both axes, an edge scales one.
      // The OPPOSITE side stays pinned (anchor); Shift locks the aspect ratio.
      const h = hit.groupHandle;
      const gb = groupBox(show, getSelected?.(), cv.w, cv.h);
      const ax = h.col !== 1, ay = h.row !== 1;
      const anchor = { x: (h.col === 0 ? gb.maxX : gb.minX) * cv.w, y: (h.row === 0 ? gb.maxY : gb.minY) * cv.h };
      const corner0 = { x: (h.col === 0 ? gb.minX : gb.maxX) * cv.w, y: (h.row === 0 ? gb.minY : gb.maxY) * cv.h };
      const items = [...getSelected()].map((id) => {
        const f = show.fixtures.find((x) => x.id === id); if (!f) return null;
        if (isBezierFixture(f.input)) return { id, mode: 'bez', pts0: f.input.points.map((q) => q.slice()), c0: (f.input.bezier?.c || f.input.points[0]).slice() };
        if (isPolylineFixture(f.input)) return { id, mode: 'poly', pts0: f.input.points.map((q) => q.slice()) };
        const tf = f.input?.transform || transformFromPoints(f.input.points, cv);
        return { id, mode: 'bar', x0: tf.x, y0: tf.y, w0: Number(tf.w) || 0, h0: Number(tf.h) || 0, rot: Number(tf.rotation) || 0 };
      }).filter(Boolean);
      dragState = { kind: 'gscale', cv, ax, ay, anchor, corner0, items };
    } else if (hit.rotate) {
      dragState = { kind: 'rotate', id: hit.fxId, cv };
    } else if (hit.scaleCorner != null) {
      // Resize from the grabbed corner, keeping the OPPOSITE corner pinned.
      const f = show.fixtures.find((x) => x.id === hit.fxId);
      const sgn = [[-1, 1], [1, 1], [1, -1], [-1, -1]];   // corner 0..3 in (u,p)
      const [su, sp] = sgn[(hit.scaleCorner + 2) % 4];     // opposite corner = anchor
      if (f.input?.mode !== 'grid') {
        // Plain bar: work in the DRAWN frame and commit a canonical transform
        // (w=length, h=thickness, rotation=axis angle) so it never flips mid-drag.
        const fr = drawnFrame(f, cv), hw = fr.len / 2, hh = fr.thick / 2;
        const anchor = { x: fr.cx + fr.ux * su * hw + fr.pxx * sp * hh, y: fr.cy + fr.uy * su * hw + fr.pyy * sp * hh };
        dragState = { kind: 'scale', id: hit.fxId, cv, ux: fr.ux, uy: fr.uy, pxx: fr.pxx, pyy: fr.pyy, anchor, rotDeg: fr.rotDeg, canonical: true };
      } else {
        // Matrix: w/h are the rectangle dims (not length/thickness) — keep the
        // raw-transform frame so a grid resizes as a rectangle.
        const t = f.input.transform || transformFromPoints(f.input.points, cv);
        const a = (Number(t.rotation) || 0) * Math.PI / 180;
        const ux = Math.cos(a), uy = Math.sin(a), pxx = -Math.sin(a), pyy = Math.cos(a);
        const hw = (Number(t.w) || 0) / 2, hh = (Number(t.h) || 8) / 2;
        const anchor = { x: t.x + ux * su * hw + pxx * sp * hh, y: t.y + uy * su * hw + pyy * sp * hh };
        dragState = { kind: 'scale', id: hit.fxId, cv, ux, uy, pxx, pyy, anchor };
      }
    } else if (hit.scaleEdge != null) {
      // Resize ONE axis (length or thickness), keeping the OPPOSITE edge pinned.
      const f = show.fixtures.find((x) => x.id === hit.fxId);
      const e = hit.scaleEdge;
      if (f.input?.mode !== 'grid') {
        // Plain bar: DRAWN frame + canonical commit (see scaleCorner above).
        const fr = drawnFrame(f, cv), hw = fr.len / 2, hh = fr.thick / 2;
        const base = { id: hit.fxId, cv, ux: fr.ux, uy: fr.uy, pxx: fr.pxx, pyy: fr.pyy, rotDeg: fr.rotDeg, len0: fr.len, thick0: fr.thick, canonical: true };
        if (e === 0 || e === 1) {                            // length edge → anchor = opposite END
          const su = e === 0 ? -1 : 1;
          dragState = { kind: 'scaleEdge', axis: 'u', ...base, anchor: { x: fr.cx + fr.ux * su * hw, y: fr.cy + fr.uy * su * hw } };
        } else {                                             // thickness edge → anchor = opposite SIDE
          const sp = e === 2 ? -1 : 1;
          dragState = { kind: 'scaleEdge', axis: 'p', ...base, anchor: { x: fr.cx + fr.pxx * sp * hh, y: fr.cy + fr.pyy * sp * hh } };
        }
      } else {
        const t = f.input.transform || transformFromPoints(f.input.points, cv);
        const a = (Number(t.rotation) || 0) * Math.PI / 180;
        const ux = Math.cos(a), uy = Math.sin(a), pxx = -Math.sin(a), pyy = Math.cos(a);
        const hw = (Number(t.w) || 0) / 2, hh = (Number(t.h) || 8) / 2;
        if (e === 0 || e === 1) {
          const su = e === 0 ? -1 : 1;
          dragState = { kind: 'scaleEdge', axis: 'u', id: hit.fxId, cv, ux, uy, pxx, pyy, anchor: { x: t.x + ux * su * hw, y: t.y + uy * su * hw } };
        } else {
          const sp = e === 2 ? -1 : 1;
          dragState = { kind: 'scaleEdge', axis: 'p', id: hit.fxId, cv, ux, uy, pxx, pyy, anchor: { x: t.x + pxx * sp * hh, y: t.y + pyy * sp * hh } };
        }
      }
    } else if (hit.control) {
      dragState = { kind: 'bezctl', id: hit.fxId };   // bezier control — x/y here; z via 3D Alt-drag
    } else if (hit.vertex != null) {
      dragState = { kind: 'vertex', id: hit.fxId, index: hit.vertex };
    } else {
      // Whole-fixture move — group with the selection if part of a multi-select.
      const sel = getSelected?.();
      const ids = (sel?.has?.(hit.fxId) && sel.size > 1) ? [...sel] : [hit.fxId];
      const items = ids.map((id) => {
        const f = show.fixtures.find((x) => x.id === id);
        if (!f) return null;
        if (isBezierFixture(f.input)) return { id, mode: 'bez', pts0: f.input.points.map((p) => p.slice()), c0: (f.input.bezier?.c || f.input.points[0]).slice() };
        if (isPolylineFixture(f.input)) return { id, mode: 'poly', pts0: f.input.points.map((p) => p.slice()) };
        const tf = f.input?.transform;
        return tf ? { id, mode: 'bar', x0: tf.x, y0: tf.y } : null;
      }).filter(Boolean);
      const [px0, py0] = canvasPx(ev, cv);
      const [nx0, ny0] = norm(ev);
      dragState = { kind: 'move', items, px0, py0, nx0, ny0, cv };
    }
    // Keep the right cursor for the WHOLE drag (resize arrows / grab), not just on
    // hover — pointer capture means the cursor would otherwise revert mid-drag.
    dragState.cursor = (dragState.kind === 'rotate') ? 'grabbing'
      : (dragState.kind === 'move') ? 'grabbing'
      : (dragState.kind === 'marquee') ? 'crosshair'
      : (hit.cursor || cursorFor(hit));
    evEl.style.cursor = dragState.cursor;
    evEl.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  evEl.addEventListener('pointermove', (ev) => {
    if (!enabled) return;
    if (!dragState) {   // hover feedback (resize/move cursors; 3D: move/grab/pointer)
      const v3h = view3dOf(getShow());
      if (v3h) {
        const h3 = hitTest3D(ev, v3h);
        evEl.style.cursor = h3 ? ((h3.vertex != null || h3.control) ? 'move' : 'pointer') : 'grab';
      } else evEl.style.cursor = cursorFor(hitTest(ev));
      return;
    }
    if (dragState.cursor) evEl.style.cursor = dragState.cursor;               // hold it through the drag
    if (dragState.kind === 'vertex3d') {
      // Per-vertex 3D drag. Default: move on the HORIZONTAL plane at the
      // vertex's current z (unproject the pointer → intersect that plane).
      // Alt: VERTICAL — keep x/y, map pointer Δy → Δz scaled to world units at
      // the vertex's distance from the camera. (The axis-drag mapping, chosen
      // over a vertical-plane intersection: it stays stable at any camera
      // angle, where a facing-plane ray goes degenerate near top-down views.)
      // Alt is read LIVE, so one drag can slide then lift without re-grabbing.
      const show3 = getShow();
      const v3d = view3dOf(show3); if (!v3d) return;   // mode flipped mid-drag
      const f = (show3.fixtures || []).find((x) => x.id === dragState.id);
      const cur = dragState.ctl
        ? (f?.input?.bezier?.c && pts3Of([f.input.bezier.c])[0])
        : pts3Of(f?.input?.points || [])[dragState.index];
      if (!cur) return;
      const write = (nx, ny, nzz) => (dragState.ctl
        ? setBezierControl(show3, dragState.id, [nx, ny, nzz])
        : setFixtureVertex(show3, dragState.id, dragState.index, nx, ny, nzz));
      const [px3, py3, rw3, rh3] = localPx(ev);
      const cam3 = orbitCamera(v3d.orbit, rw3 / rh3);
      const cvH3 = (show3.composition?.canvas?.h) || 720;
      let next3 = show3, hint3 = null;
      if (ev.altKey) {
        const camDist = Math.hypot(cur[0] - cam3.pos[0], cur[1] - cam3.pos[1], cur[2] - cam3.pos[2]);
        const wpp = (2 * camDist * Math.tan((cam3.fov * Math.PI / 180) / 2)) / (rh3 || 1);
        const z = cur[2] - (ev.clientY - dragState.lastY) * wpp;   // drag up → +z
        next3 = write(cur[0], cur[1], z);
        hint3 = `z ${Math.round(z * cvH3)} px`;
      } else {
        const hit = rayPlaneZ(unproject(px3 / rw3, py3 / rh3, cam3), cur[2]);
        if (hit) {
          next3 = write(hit[0], hit[1], cur[2]);
          const cvW3 = (show3.composition?.canvas?.w) || 1280;
          hint3 = `${Math.round(hit[0] * cvW3)}, ${Math.round(hit[1] * cvH3)}`;
        }
      }
      dragState.lastY = ev.clientY;
      dragHint = hint3 ? { nx: (px3 / rw3), ny: (py3 / rh3), text: hint3 } : null;
      dragState.moved = true;
      onEdit?.(next3);
      return;
    }
    if (dragState.kind === 'orbit' || dragState.kind === 'orbitpan') {
      const show = getShow();
      const v3 = view3dOf(show); if (!v3) return;   // mode flipped mid-drag — ignore
      const dx = ev.clientX - dragState.x0, dy = ev.clientY - dragState.y0;
      // A small dead zone keeps a click a CLICK (select/deselect), not a 0.4° orbit.
      if (!dragState.moved && Math.hypot(dx, dy) < 3) return;
      dragState.moved = true;
      let orbit;
      if (dragState.kind === 'orbit') {
        orbit = { ...v3.orbit,
          az: dragState.az0 + dx * 0.4,
          el: Math.max(ORBIT_EL_MIN, Math.min(ORBIT_EL_MAX, dragState.el0 + dy * 0.4)) };
      } else {
        // Pan the TARGET in the camera's screen plane: world units per pixel at
        // the target's depth (vertical fov over the viewport height). The basis
        // is translation-invariant, so reusing the live orbit's camera is stable.
        const [, , , rh] = localPx(ev);
        const cam = orbitCamera(v3.orbit, 1);
        const { r, u } = cameraBasis(cam);
        const dist = Math.max(ORBIT_DIST_MIN, Math.min(ORBIT_DIST_MAX, Number(v3.orbit?.dist) || 1.6));
        const ps = (2 * dist * Math.tan((cam.fov * Math.PI / 180) / 2)) / (rh || 1);
        const t0 = dragState.target0;
        orbit = { ...v3.orbit, target: [
          t0[0] - r[0] * dx * ps + u[0] * dy * ps,
          t0[1] - r[1] * dx * ps + u[1] * dy * ps,
          (t0[2] || 0) - r[2] * dx * ps + u[2] * dy * ps,
        ] };
      }
      onView?.({ ...show, composition: { ...show.composition, view3d: { ...v3, orbit } } });
      return;
    }
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
      let [cxp, cyp] = canvasPx(ev, dragState.cv);
      if (snap) { const s = snap(cxp, cyp, id, [id]); cxp = s[0]; cyp = s[1]; }   // snap the dragged corner to the grid/guides
      const vx = cxp - anchor.x, vy = cyp - anchor.y;
      const du = vx * ux + vy * uy, dp = vx * pxx + vy * pyy;
      const w = Math.max(MIN_W, Math.abs(du)), h = Math.max(MIN_H, Math.abs(dp));
      next = setFixtureTransform(next, id, {
        x: anchor.x + ux * (du / 2) + pxx * (dp / 2),
        y: anchor.y + uy * (du / 2) + pyy * (dp / 2), w, h,
        ...(dragState.canonical ? { rotation: dragState.rotDeg } : {}),
      });
      hintText = `${Math.round(w)}×${Math.round(h)} px`;
    } else if (dragState.kind === 'scaleEdge') {
      // One-axis resize about the pinned opposite edge.
      const { ux, uy, pxx, pyy, anchor, id, axis } = dragState;
      let [cxp, cyp] = canvasPx(ev, dragState.cv);
      if (snap) { const s = snap(cxp, cyp, id, [id]); cxp = s[0]; cyp = s[1]; }
      const vx = cxp - anchor.x, vy = cyp - anchor.y;
      if (axis === 'u') {
        const du = vx * ux + vy * uy; const w = Math.max(MIN_W, Math.abs(du));
        // Canonical commit also re-asserts thickness + drawn angle so the box keeps
        // its orientation (length stays the long axis; no aspect flip).
        next = setFixtureTransform(next, id, { x: anchor.x + ux * (du / 2), y: anchor.y + uy * (du / 2), w,
          ...(dragState.canonical ? { h: dragState.thick0, rotation: dragState.rotDeg } : {}) });
        hintText = `${Math.round(w)} px`;
      } else {
        const dp = vx * pxx + vy * pyy; const h = Math.max(MIN_H, Math.abs(dp));
        next = setFixtureTransform(next, id, { x: anchor.x + pxx * (dp / 2), y: anchor.y + pyy * (dp / 2), h,
          ...(dragState.canonical ? { w: dragState.len0, rotation: dragState.rotDeg } : {}) });
        hintText = `${Math.round(h)} px`;
      }
    } else if (dragState.kind === 'gscale') {
      // Directional scale of the selection about the pinned anchor. Per-axis factors
      // sx/sy (1 on an inactive axis); Shift locks the aspect ratio (uniform).
      const { anchor, corner0, cv, items, ax, ay } = dragState;
      const [cxp, cyp] = canvasPx(ev, cv);
      let sx = ax ? (cxp - anchor.x) / ((corner0.x - anchor.x) || 1) : 1;
      let sy = ay ? (cyp - anchor.y) / ((corner0.y - anchor.y) || 1) : 1;
      sx = Math.max(0.05, sx); sy = Math.max(0.05, sy);
      if (ev.shiftKey) { const drive = (ax && ay) ? Math.max(sx, sy) : (ax ? sx : sy); sx = drive; sy = drive; }
      for (const it of items) {
        if (it.mode === 'poly' || it.mode === 'bez') {
          // Scale x/y about the anchor; z (height) rides along unchanged. A
          // bezier's control scales with its ends so the arch keeps its shape.
          const map2 = (q) => {
            const m = [(anchor.x + sx * (q[0] * cv.w - anchor.x)) / cv.w, (anchor.y + sy * (q[1] * cv.h - anchor.y)) / cv.h];
            return q.length > 2 ? [...m, q[2]] : m;
          };
          next = setFixturePoints(next, it.id, it.pts0.map(map2));
          if (it.mode === 'bez') next = setBezierControl(next, it.id, map2(it.c0));
        } else {
          // A bar's LENGTH runs along its rotation axis; map the box's x/y scale to
          // length/thickness by the bar's dominant orientation (exact at 0°/90°).
          const rad = (it.rot || 0) * Math.PI / 180, horiz = Math.abs(Math.cos(rad)) >= Math.abs(Math.sin(rad));
          const sLen = horiz ? sx : sy, sThk = horiz ? sy : sx;
          const patch = { x: anchor.x + sx * (it.x0 - anchor.x), y: anchor.y + sy * (it.y0 - anchor.y), w: Math.max(MIN_W, it.w0 * sLen) };
          if (it.h0 > 0) patch.h = Math.max(MIN_H, it.h0 * sThk);   // only scale thickness if it was manual
          next = setFixtureTransform(next, it.id, patch);
        }
      }
      hintText = (ax && ay) ? `${sx.toFixed(2)}×${sy.toFixed(2)}` : (ax ? `↔ ${sx.toFixed(2)}` : `↕ ${sy.toFixed(2)}`);
    } else if (dragState.kind === 'bezctl') {
      // Bezier control in 2D: move c in x/y (its height is preserved by
      // setBezierControl's 2-arg form; lift it with Alt-drag in 3D).
      const [nx, ny] = norm(ev);
      next = setBezierControl(next, dragState.id, [nx, ny]);
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
        if (it.mode === 'poly' || it.mode === 'bez') {
          // Shift x/y; z (height) rides along. The bezier control moves WITH
          // its ends so the whole arch translates rigidly.
          const shift = (q) => [q[0] + dxN, q[1] + dyN, ...(q.length > 2 ? [q[2]] : [])];
          next = setFixturePoints(next, it.id, it.pts0.map(shift));
          if (it.mode === 'bez') next = setBezierControl(next, it.id, shift(it.c0));
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
    dragState.moved = true;                   // an actual geometry edit happened
    onEdit?.(next);
  });

  function end(ev) {
    if (!dragState) return;
    const wasMarquee = dragState.kind === 'marquee';
    const wasOrbit = dragState.kind === 'orbit' || dragState.kind === 'orbitpan';
    // An orbit CLICK (no movement) on empty space deselects — the 3D twin of the
    // 2D empty-click/marquee clear.
    const emptyOrbitClick = dragState.kind === 'orbit' && !dragState.moved && dragState.hitFx == null;
    const moved = dragState.moved;
    dragState = null; dragHint = null;
    const v3 = view3dOf(getShow());   // back to hover feedback
    evEl.style.cursor = v3 ? (hitTest3D(ev, v3) ? 'pointer' : 'grab') : cursorFor(hitTest(ev));
    try { evEl.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
    if (wasOrbit) {   // view-only — no commit/rebuild; onView already saved (debounced)
      if (emptyOrbitClick) onSelect?.(null, ev);
      return;
    }
    // Only COMMIT (which rebuilds the sampler — a one-frame flash) when the drag
    // actually moved something. A plain click just SELECTS; committing it would
    // pointlessly rebuild and flicker the lit cells.
    if (wasMarquee) onMarqueeEnd?.();
    else if (moved) onCommit?.(getShow());
  }
  evEl.addEventListener('pointerup', end);
  evEl.addEventListener('pointercancel', end);
  evEl.addEventListener('pointerleave', () => { if (!dragState) evEl.style.cursor = 'default'; });

  // Double-click a fixture body → insert a vertex there (bend / segment the run).
  // In 3D the vertex is inserted ON the run at the clicked spot — the hit's
  // parametric t interpolates all three components, so the new bend sits at the
  // run's height, not on the floor.
  evEl.addEventListener('dblclick', (ev) => {
    if (!enabled) return;
    const v3 = view3dOf(getShow());
    if (v3) {
      const hit3 = hitTest3D(ev, v3);
      if (!hit3 || hit3.vertex != null || hit3.control || hit3.seg == null) return;
      const f = (getShow().fixtures || []).find((x) => x.id === hit3.fxId);
      if (isBezierFixture(f?.input)) return;   // a quadratic has no insertable vertices
      // Only EXISTING polylines take new vertices — a dblclick no longer converts
      // a bar (polyline isn't offered anymore; arcs are bezier's job, and the rig's
      // runs are straight). Legacy/imported polylines stay fully editable.
      if (!isPolylineFixture(f?.input)) return;
      const pts3 = pts3Of(f?.input?.points || []);
      const a = pts3[hit3.seg], b = pts3[hit3.seg + 1];
      if (!a || !b) return;
      const t = hit3.t ?? 0.5;
      const at = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      onCommit?.(addFixtureVertex(getShow(), hit3.fxId, hit3.seg, at));
      ev.preventDefault();
      return;
    }
    const hit = hitTest(ev);
    if (!hit || hit.vertex != null || hit.control || hit.bez) return;
    // Same rule as 3D: dblclick adds vertices to EXISTING polylines only — it no
    // longer converts a bar into one.
    const f2 = (getShow().fixtures || []).find((x) => x.id === hit.fxId);
    if (!isPolylineFixture(f2?.input)) return;
    const [nx, ny] = norm(ev);
    const next = addFixtureVertex(getShow(), hit.fxId, hit.seg ?? 0, [nx, ny]);
    onCommit?.(next);
    ev.preventDefault();
  });

  // Right-click a vertex → remove it (2D and 3D alike).
  evEl.addEventListener('contextmenu', (ev) => {
    if (!enabled || document.body.classList.contains('native-ctx')) return;
    const v3 = view3dOf(getShow());
    const hit = v3 ? hitTest3D(ev, v3) : hitTest(ev);
    if (hit && hit.vertex != null) {
      const f = (getShow().fixtures || []).find((x) => x.id === hit.fxId);
      if (isBezierFixture(f?.input)) return;   // a bezier's two ends aren't removable
      ev.preventDefault();
      onCommit?.(removeFixtureVertex(getShow(), hit.fxId, hit.vertex));
    }
  });

  return {
    setEnabled(v) { enabled = !!v; if (!enabled) dragState = null; },
    isEnabled() { return enabled; },
  };
}
