// Video clips: a <video> element + GL texture per video clip (runtime only;
// the show stores only the object URL). syncVideos() reconciles the map with the
// show each frame; uploadVideos() pushes the current frame into each texture.
// Extracted verbatim from app.js (no behavior change): the render loop calls
// sync/upload per frame, the compositor samples via videoTex, and the
// GL-context-loss handler calls clearTextures() (the GL objects died with the
// context; the map rebuilds on the next sync).
//
//   createVideoRuntime({ getShow, gl }) → { syncVideos, uploadVideos, videoTex,
//                                           clearTextures }

import { registerMediaElement, unregisterMediaElement } from '../model/audio.js';

export function createVideoRuntime({ getShow, gl }) {
  const videoMap = new Map(); // clipId → { url, el, tex }
  function syncVideos() {
    const show = getShow();
    const clips = [];
    for (const L of show.composition?.layers || []) for (const c of L.clips || []) {
      if (c && c.generator === 'video' && c.videoUrl) clips.push(c);
    }
    if (!clips.length && !videoMap.size) return;   // no video clips, nothing mapped → nothing to do
    const live = new Set(clips.map((c) => c.id));
    for (const [id, v] of videoMap) {
      if (!live.has(id)) { unregisterMediaElement(v.el); try { v.el.pause(); } catch { /* ignore */ } gl.deleteTexture(v.tex); videoMap.delete(id); }
    }
    for (const c of clips) {
      const existing = videoMap.get(c.id);
      if (existing && existing.url === c.videoUrl) continue;
      if (existing) { unregisterMediaElement(existing.el); try { existing.el.pause(); } catch { /* ignore */ } gl.deleteTexture(existing.tex); }
      const el = document.createElement('video');
      el.src = c.videoUrl; el.loop = true; el.muted = true; el.playsInline = true; el.autoplay = true;
      el.play().catch(() => { /* will play on first user gesture */ });
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      videoMap.set(c.id, { url: c.videoUrl, el, tex });
      registerMediaElement(el);   // so the 'composition' audio source can analyse it
    }
  }
  function uploadVideos() {
    if (!videoMap.size) return;
    for (const v of videoMap.values()) {
      if (v.el.readyState >= 2 && v.el.videoWidth) {
        gl.bindTexture(gl.TEXTURE_2D, v.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v.el); } catch { /* not ready */ }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      }
    }
  }
  const videoTex = (clip) => videoMap.get(clip.id)?.tex || null;

  return { syncVideos, uploadVideos, videoTex, clearTextures: () => videoMap.clear() };
}
