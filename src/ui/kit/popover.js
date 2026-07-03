// The shared anchored-popup mechanic: viewport-clamped placement + click-outside /
// Esc dismissal. Pickers and menus use these instead of each re-implementing the
// clamp and the document-listener dance (a recurring source of leaks and bugs).

// Append `pop` to <body> and position it just below `anchor`, clamped to the
// viewport (flips above the anchor when there's no room below).
export function placePopover(pop, anchor) {
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let top = r.bottom + 4;
  if (top + ph > window.innerHeight - 6) top = Math.max(6, r.top - ph - 4);
  pop.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 6 - pw)) + 'px';
  pop.style.top = top + 'px';
}

// Wire click-outside (capture) + Escape to call `onClose`. Returns a cleanup fn
// that removes the listeners — call it from your own close(). The deferred attach
// avoids the opening click immediately dismissing the popup. `alsoInside` (optional)
// exempts a second element — the opener button of a body-appended popup — so its own
// click reaches the toggle handler instead of being eaten by the capture dismiss.
export function dismissOnOutside(pop, onClose, alsoInside) {
  const onClick = (ev) => { if (pop && !pop.contains(ev.target) && !alsoInside?.contains(ev.target)) onClose(); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } };
  setTimeout(() => document.addEventListener('click', onClick, true), 0);
  document.addEventListener('keydown', onKey, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  };
}
