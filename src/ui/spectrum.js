// Live FFT spectrum for a clip's Audio Trigger inspector. Pure draw-model helpers (tested)
// + a self-animating <canvas> that stops when detached. Reads the mic via externalFFT.
import { externalFFT, externalBinCount, externalBand, AUDIO_BAND_SPLIT } from '../model/audio.js';

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

// createClipSpectrum({ band, trigsFor }) → { el } — a small self-animating canvas.
// `band`: the clip's selected band (highlighted). `trigsFor()`: () => number[] of that clip's
// trigger timestamps (flash when the newest grows). Both optional.
export function createClipSpectrum({ band = 'bass', trigsFor } = {}, doc = document) {
  const el = doc.createElement('canvas');
  el.className = 'clip-spectrum';
  el.width = 240; el.height = 48;                 // CSS can scale; DPR handled on first draw
  const ctx = el.getContext('2d');
  const buf = new Uint8Array(externalBinCount());
  let lastTrig = -Infinity, flashUntil = 0, started = false;
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

  function sizeOnce() { if (started) return; started = true; el.width = 240 * dpr; el.height = 48 * dpr; el.style.width = '240px'; el.style.height = '48px'; ctx.scale(dpr, dpr); }

  function frame() {
    if (!el.isConnected) return;                  // detached (inspector re-render) → stop
    sizeOnce();
    const W = 240, H = 48;
    ctx.clearRect(0, 0, W, H);
    const n = externalFFT(buf);
    if (!n) {                                     // mic off
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
    // spectrum bars (bin → x across width)
    const hs = barHeights(buf, n, H);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < n; i++) { const x = (i / n) * W; ctx.fillRect(x, H - hs[i], Math.max(1, W / n), hs[i]); }
    // level tick for the selected band
    const lv = externalBand(band);
    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    const reg = bandRegions(AUDIO_BAND_SPLIT, W).find((r) => r.band === band);
    if (reg) ctx.fillRect(reg.x0, H - lv * H, reg.x1 - reg.x0, 2);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { el };
}
