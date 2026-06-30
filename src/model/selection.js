// SELECTION — pure logic for multi-select bulk editing in the patch UI.
//
// Select N fixtures and a flat editor shows each field. A field whose value is
// EQUAL across the whole selection shows that value; a field that DIFFERS renders
// "mixed" (dimmed). Editing any field writes it to ALL selected instances.
//
// This module is framework-free: no DOM. The DOM layer just calls these two
// functions. Keys may be dotted paths (e.g. 'output.port').

// Read a (possibly dotted) path from an object. Missing intermediates yield
// undefined rather than throwing.
const getPath = (obj, key) => {
  const parts = key.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
};

// Immutably set a (possibly dotted) path. Returns a new object with fresh objects
// cloned along the path; siblings are preserved by reference. Missing intermediate
// objects are created.
const setPath = (obj, key, value) => {
  const parts = key.split('.');
  const head = parts[0];
  if (parts.length === 1) return { ...obj, [head]: value };
  const child = (obj && typeof obj[head] === 'object' && obj[head] != null) ? obj[head] : {};
  return { ...obj, [head]: setPath(child, parts.slice(1).join('.'), value) };
};

// fieldState(items, key) -> { value, mixed }
// Equality is strict (Object.is). The bulk-edited fields in this app are
// primitives (numbers/strings/bools), so deep equality is NOT required.
// Empty selection -> { value: undefined, mixed: false }.
export const fieldState = (items, key) => {
  if (!items || items.length === 0) return { value: undefined, mixed: false };
  const first = getPath(items[0], key);
  for (let i = 1; i < items.length; i++) {
    if (!Object.is(getPath(items[i], key), first)) {
      return { value: undefined, mixed: true };
    }
  }
  return { value: first, mixed: false };
};

// applyField(items, key, value) -> a NEW array where each item has `key` set to
// `value`. Inputs are never mutated; nested objects along the path are cloned.
export const applyField = (items, key, value) =>
  (items || []).map((item) => setPath(item, key, value));
