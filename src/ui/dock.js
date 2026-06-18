// Lightweight, framework-free dock helpers for the modular window layout.
//
// For now this is just resizable RAILS: each side panel (#side, #side-2) gets a
// thin drag handle on its inner edge that sets a CSS width variable (so everything
// keyed off that token — insets, the HUD dodge, the gapless seams — reflows for
// free) and persists the width to localStorage. Layout state lives under one key so
// "Reset layout" can wipe it in one call.

const KEY = 'lz.layout';

const loadLayout = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch { return {}; }
};
const saveLayout = (obj) => {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch { /* private mode */ }
};

// Apply any persisted rail widths to the root CSS variables. Call once at startup
// BEFORE first layout so the panels open at the saved size (no flash).
export function applyLayout() {
  const l = loadLayout();
  const root = document.documentElement;
  if (l.sideW) root.style.setProperty('--side-w', l.sideW + 'px');
  if (l.side2W) root.style.setProperty('--side2-w', l.side2W + 'px');
}

// Clear all persisted layout (widths) and restore the stylesheet defaults.
export function resetLayout(onChange) {
  saveLayout({});
  const root = document.documentElement;
  root.style.removeProperty('--side-w');
  root.style.removeProperty('--side2-w');
  onChange?.();
}

// Make a right-docked rail resizable by dragging its INNER (left) edge. `cssVar` is
// the width token to drive (e.g. '--side-w'); `field` is the lz.layout key to persist
// under. `onResize` runs each move (→ updateStageInsets / camera reflow).
export function enableRailResize(railEl, { cssVar, field, min = 220, max = 640, onResize } = {}) {
  if (!railEl) return;
  const handle = document.createElement('div');
  handle.className = 'rail-resize';
  handle.title = 'drag to resize';
  railEl.appendChild(handle);
  let startX = 0, startW = 0;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    startX = e.clientX;
    startW = railEl.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture?.(e.pointerId)) return;
    // The rail is on the RIGHT: dragging the left edge leftwards (smaller clientX)
    // widens it, so width grows as the cursor moves left of where it started.
    const w = Math.max(min, Math.min(max, Math.round(startW + (startX - e.clientX))));
    document.documentElement.style.setProperty(cssVar, w + 'px');
    onResize?.();
  });
  const end = (e) => {
    if (!handle.hasPointerCapture?.(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove('dragging');
    const w = Math.round(railEl.getBoundingClientRect().width);
    const l = loadLayout(); l[field] = w; saveLayout(l);
    onResize?.();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
