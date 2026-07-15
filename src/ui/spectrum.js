// Live FFT spectrum for a clip's Audio Trigger inspector. Pure draw-model helpers (tested)
// + a self-animating <canvas> that stops when detached. Reads the mic via externalFFT.
import { externalFFT, externalBinCount, externalBand, externalChannelCount, AUDIO_BAND_SPLIT } from '../model/audio.js';

// Pixel spans for each band across `width`, ordered, gapless. [{band, x0, x1}].
export function bandRegions(split, width) {
  return ['bass', 'mid', 'high'].map((band) => {
    const [lo, hi] = split[band];
    return { band, x0: Math.round(lo * width), x1: Math.round(hi * width) };
  });
}

// Per-bin bar heights (px), fft value 0..255 → 0..height.
export function barHeights(fft, n, height) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (fft[i] || 0) / 255 * height;
  return out;
}

// Pure map between a 0..1 level and a y in the [0,H] logical space (0 = top, H = bottom),
// and its clamped inverse. Import-safe (no browser deps).
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const thresholdY = (t, H) => (1 - clamp01(t)) * H;
export const yToThreshold = (y, H) => clamp01(1 - y / H);

// createClipSpectrum({ band, trigsFor, mode, threshold, onThresholdChange }) → { el } — a small
// self-animating canvas. `band`: the clip's selected band (highlighted). `trigsFor()`: () =>
// number[] of that clip's trigger timestamps (flash when the newest grows). `mode`: 'onset' |
// 'level'. In 'level' mode a draggable threshold line + band fill + peak-hold are drawn and
// `threshold` (0..1) is the control; `onThresholdChange(v)` streams new values while dragging.
// Each call is a FRESH closure — peak-hold/baseline state below reset per widget (so a re-render
// that recreates the widget starts clean). All params optional.
export function createClipSpectrum({ band = 'bass', channel = 0, trigsFor, mode = 'onset', threshold, onThresholdChange } = {}, doc = document) {
  const el = doc.createElement('canvas');
  el.className = 'clip-spectrum';
  el.width = 240; el.height = 48;                 // CSS can scale; DPR handled on first draw
  const ctx = el.getContext('2d');
  const buf = new Uint8Array(externalBinCount(channel));
  let lastTrig = -Infinity, flashUntil = 0, started = false;
  let peak = 0, base = 0;                          // peak-hold (level mode) + baseline EMA (onset)
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

  function sizeOnce() { if (started) return; started = true; el.width = 240 * dpr; el.height = 48 * dpr; el.style.width = '240px'; el.style.height = '48px'; ctx.scale(dpr, dpr); }

  function frame() {
    if (!el.isConnected) return;                  // detached (inspector re-render) → stop
    sizeOnce();
    const W = 240, H = 48;
    ctx.clearRect(0, 0, W, H);
    // Own dark scope backdrop FIRST so the white/cyan bars stay legible whatever the
    // panel colour (the chrome may be light — this display surface stays dark).
    ctx.fillStyle = 'rgba(12,12,14,0.9)'; ctx.fillRect(0, 0, W, H);
    const n = externalFFT(buf, channel);
    // A DAEMON channel has band values but no FFT (the daemon streams levels, not
    // bins) — draw its bands as three region bars instead of a dead "mic off" scope.
    const bandsOnly = !n && channel >= 1 && externalChannelCount() >= channel;
    if (!n && !bandsOnly) {                       // mic off
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '10px monospace';
      ctx.fillText('mic off — turn on the Microphone above', 8, H / 2 + 3);
      requestAnimationFrame(frame); return;
    }
    // shaded band regions (+ highlight the selected one)
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    const trigs = (typeof trigsFor === 'function' && trigsFor()) || [];
    const newest = trigs.length ? trigs[trigs.length - 1] : -Infinity;
    if (newest > lastTrig) { lastTrig = newest; flashUntil = now + 150; }
    const flashing = now < flashUntil;
    for (const r of bandRegions(AUDIO_BAND_SPLIT, W)) {
      const sel = r.band === band;
      ctx.fillStyle = sel ? (flashing ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)') : 'rgba(255,255,255,0.03)';
      ctx.fillRect(r.x0, 0, r.x1 - r.x0, H);
    }
    // spectrum bars (bin → x across width) — or, for a daemon channel, one bar per
    // band region at that band's live level (same layout the FFT view shades).
    if (n) {
      const hs = barHeights(buf, n, H);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < n; i++) { const x = (i / n) * W; ctx.fillRect(x, H - hs[i], Math.max(1, W / n), hs[i]); }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const r of bandRegions(AUDIO_BAND_SPLIT, W)) {
        const v = externalBand(r.band, channel);
        ctx.fillRect(r.x0 + 2, H - v * H, (r.x1 - r.x0) - 4, v * H);
      }
    }
    // level tick for the selected band
    const lv = externalBand(band, channel);
    const reg = bandRegions(AUDIO_BAND_SPLIT, W).find((r) => r.band === band);
    peak = Math.max(peak * 0.94, lv);             // decaying peak-hold for the selected band
    base = base * 0.9 + lv * 0.1;                 // trailing average ≈ onset running baseline
    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    if (reg) ctx.fillRect(reg.x0, H - lv * H, reg.x1 - reg.x0, 2);

    if (reg && mode === 'level' && threshold != null) {
      // fill the band region from the bottom up to the live level; accent while flashing
      ctx.fillStyle = flashing ? 'rgba(120,200,255,0.35)' : 'rgba(120,200,255,0.16)';
      ctx.fillRect(reg.x0, thresholdY(lv, H), reg.x1 - reg.x0, H - thresholdY(lv, H));
      // peak-hold tick (headroom marker)
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(reg.x0, thresholdY(peak, H) - 1, reg.x1 - reg.x0, 2);
      // threshold hairline across the band + a small handle nub at the right edge
      const ty = thresholdY(threshold, H);
      ctx.fillStyle = flashing ? 'rgba(150,220,255,1)' : 'rgba(255,255,255,0.85)';
      ctx.fillRect(reg.x0, ty - 0.5, reg.x1 - reg.x0, 1);
      ctx.fillRect(reg.x1 - 5, ty - 2, 5, 4);      // handle nub
      // numeric value near the line
      ctx.font = '9px monospace';
      const label = threshold.toFixed(2);
      const lw = ctx.measureText(label).width;
      const lx = Math.max(reg.x0 + 2, reg.x1 - 8 - lw);
      ctx.fillText(label, lx, Math.min(H - 2, Math.max(8, ty - 3)));
    } else if (reg && mode === 'onset') {
      // faint dotted baseline — read-only reference of the running average
      const by = thresholdY(base, H);
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      for (let x = reg.x0; x < reg.x1; x += 4) ctx.fillRect(x, by - 0.5, 2, 1);
    }
    requestAnimationFrame(frame);
  }

  // Threshold drag (level mode only). DPR-correct: the CSS size stays 48px while only the
  // backing store scales, so mapping client-Y via getBoundingClientRect().height → the 48
  // logical units is resolution-independent.
  let dragging = false;
  const yCanvas = (clientY) => { const r = el.getBoundingClientRect(); return (clientY - r.top) / r.height * 48; };
  el.addEventListener('pointerdown', (e) => {
    if (mode !== 'level' || threshold == null) return;
    if (Math.abs(yCanvas(e.clientY) - thresholdY(threshold, 48)) <= 8) {
      dragging = true; el.setPointerCapture(e.pointerId); el.style.cursor = 'ns-resize';
      threshold = yToThreshold(yCanvas(e.clientY), 48);   // move the drawn line with the cursor (no re-render)
      onThresholdChange?.(threshold);
    }
  });
  el.addEventListener('pointermove', (e) => { if (dragging) { threshold = yToThreshold(yCanvas(e.clientY), 48); onThresholdChange?.(threshold); } });
  el.addEventListener('pointerup', (e) => { if (dragging) { dragging = false; try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ } el.style.cursor = ''; } });

  requestAnimationFrame(frame);
  return { el };
}
