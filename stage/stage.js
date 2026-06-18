// The broken-out stage window. It owns NO WebGL — the editor keeps the single GL
// context, renders once, and ships each finished frame here as an ImageBitmap via
// postMessage (transferable, by-reference, lossless). We blit it with a
// bitmaprenderer context: zero per-frame allocation, no second compositor.
const cv = document.getElementById('out');
const hint = document.getElementById('hint');
const ctx = cv.getContext('bitmaprenderer');
let gotFrame = false;

window.addEventListener('message', (e) => {
  const bmp = e.data && e.data.frame;
  if (!(bmp instanceof ImageBitmap)) return;
  if (cv.width !== bmp.width || cv.height !== bmp.height) { cv.width = bmp.width; cv.height = bmp.height; }
  ctx.transferFromImageBitmap(bmp);   // consumes (closes) the bitmap — no leak
  if (!gotFrame) { gotFrame = true; flashHint('click for fullscreen'); }
});

// A browser can't open a borderless window, but FULLSCREEN is frameless — click
// (a user gesture) to toggle it. On a second monitor this gives a clean, chrome-free
// output. Hide the cursor while fullscreen so nothing overlays the canvas.
document.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  document.body.style.cursor = document.fullscreenElement ? 'none' : '';
});

// Briefly show a hint, then fade it out (no permanent overlay on the output).
let hintTimer = 0;
function flashHint(text) {
  if (!hint) return;
  hint.textContent = text; hint.style.opacity = '1';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hint.style.opacity = '0'; }, 2500);
}

// Tell the opener we're ready so it can start (or resume) shipping frames.
try { window.opener?.postMessage({ lzStageReady: true }, '*'); } catch { /* cross-origin — n/a */ }
