// The broken-out stage window. It owns NO WebGL — the editor keeps the single GL
// context, renders once, and ships each finished frame here as an ImageBitmap via
// postMessage (transferable, by-reference, lossless). We blit it with a
// bitmaprenderer context: zero per-frame allocation, no second compositor.
const cv = document.getElementById('out');
const hint = document.getElementById('hint');
const ctx = cv.getContext('bitmaprenderer');

window.addEventListener('message', (e) => {
  const bmp = e.data && e.data.frame;
  if (!(bmp instanceof ImageBitmap)) return;
  if (cv.width !== bmp.width || cv.height !== bmp.height) { cv.width = bmp.width; cv.height = bmp.height; }
  ctx.transferFromImageBitmap(bmp);   // consumes (closes) the bitmap — no leak
  if (hint) hint.remove();
});

// Tell the opener we're ready so it can start (or resume) shipping frames.
try { window.opener?.postMessage({ lzStageReady: true }, '*'); } catch { /* cross-origin — n/a */ }
