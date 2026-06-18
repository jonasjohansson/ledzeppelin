// Mark the active tab in a strip: toggles `activeClass` on the element whose
// data-<dataKey> equals `value`. Used by every tab row (section + sub-tabs) so the
// active-state logic lives in one place instead of being copy-pasted per strip.
export function activateTabs(container, dataKey, value, activeClass = 'subtab-active') {
  container?.querySelectorAll(`[data-${dataKey}]`).forEach((b) =>
    b.classList.toggle(activeClass, b.dataset[dataKey] === value));
}
