# TD-style Source Browser — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A TouchDesigner-style source browser — color-coded family tabs + search + dense card grid + a description line — shared by the Output-pane **Sources tab** and the **`+` clip source picker**.

**Architecture:** A pure, unit-tested `source-catalog.js` (categories, colors, `sourceCategory`, `filterSources`) + per-source `desc` in the manifest, consumed by a new `sourceBrowser()` DOM component in `layers.js` used in BOTH `openPicker` (source branch) and the Sources tab (replacing `buildSourceRail`), styled in `ui.css`.

**Tech Stack:** Vanilla JS ES modules, `node --test`, CSS.

**Design doc:** `docs/plans/2026-07-08-td-style-source-browser-design.md`

**Run tests:** `node --test test/*.test.js`.

---

### Task 1: `source-catalog.js` — categories, colors, pure helpers

**Files:**
- Create: `src/ui/source-catalog.js`
- Create: `test/source-catalog.test.js`
- Modify: `src/ui/layers.js` (remove the local `SOURCE_CATEGORIES` ~1557; import from the new module)

**Step 1: Write the failing test** (`test/source-catalog.test.js`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_CATEGORIES, CATEGORY_COLORS, CATEGORY_TABS, sourceCategory, filterSources } from '../src/ui/source-catalog.js';
import { generatorNames } from '../src/engine/shaders/manifest.js';

test('sourceCategory maps a source to its family, else More', () => {
  assert.equal(sourceCategory('solid'), 'Basic');
  assert.equal(sourceCategory('flowfield'), 'Volumetric');
  assert.equal(sourceCategory('nope-xyz'), 'More');
});

test('CATEGORY_TABS = All + families + More', () => {
  assert.deepEqual(CATEGORY_TABS, ['All', 'Basic', 'Pattern', 'Motion', 'Liquid', 'Organic', 'Volumetric', 'More']);
  for (const t of CATEGORY_TABS) assert.ok(CATEGORY_COLORS[t] || t === 'All', `color for ${t}`);
});

test('filterSources: a tab returns its members (in order); All returns everything', () => {
  const all = generatorNames();
  assert.deepEqual(filterSources(all, { tab: 'Basic' }), ['solid', 'gradient', 'line'].filter((n) => all.includes(n)));
  assert.ok(filterSources(all, { tab: 'Volumetric' }).includes('flowfield'));
  assert.equal(filterSources(all, { tab: 'All' }).length, all.length);   // every generator, no dupes
  assert.equal(new Set(filterSources(all, { tab: 'All' })).size, all.length);
});

test('filterSources: a query filters across ALL sources by label/name, overriding tab', () => {
  const all = generatorNames();
  const hits = filterSources(all, { tab: 'Basic', query: 'noise' });
  assert.ok(hits.includes('noise'));
  assert.ok(hits.includes('noise3d'));   // across categories despite tab=Basic
  assert.ok(!hits.includes('solid'));
});

test('filterSources: More = uncategorised generators only', () => {
  const cat = new Set(SOURCE_CATEGORIES.flatMap(([, ns]) => ns));
  for (const n of filterSources(generatorNames(), { tab: 'More' })) assert.ok(!cat.has(n), n);
});
```

**Step 2: Run `node --test test/source-catalog.test.js` → FAIL** (module missing).

**Step 3: Create `src/ui/source-catalog.js`:**

```js
// Source families for the browser/picker tabs + the pure filtering logic. No DOM —
// unit-tested. Category source-of-truth (moved out of layers.js so it's shared + testable).
import { generatorNames, labelOf } from '../engine/shaders/manifest.js';

// Order = tab order. Volumetric = per-LED 3D fields (evaluated in the sampler pass).
export const SOURCE_CATEGORIES = [
  ['Basic', ['solid', 'gradient', 'line']],
  ['Pattern', ['grid', 'checkers', 'spectrum']],
  ['Motion', ['sine', 'pulse', 'radial', 'plasma', 'tunnel']],
  ['Liquid', ['domainwarp', 'metaballs']],
  ['Organic', ['noise']],
  ['Volumetric', ['planesweep', 'axisgradient', 'noise3d', 'spherepulse', 'bodywave', 'planepulse', 'flowfield']],
];

// MUTED per-family hues — drive a small card dot + a 2px active-tab underline, never a
// filled tab (restrained, per the house aesthetic). 'More' = neutral.
export const CATEGORY_COLORS = {
  Basic: '#8a94a6', Pattern: '#5cb8e8', Motion: '#e8a35c', Liquid: '#5ce8c8',
  Organic: '#6ee07d', Volumetric: '#b98cff', More: '#737a84',
};

export const CATEGORY_TABS = ['All', ...SOURCE_CATEGORIES.map(([l]) => l), 'More'];

export function sourceCategory(name) {
  for (const [label, names] of SOURCE_CATEGORIES) if (names.includes(name)) return label;
  return 'More';
}

// Ordered source names to SHOW for a tab + query. A non-empty query filters across ALL
// sources by label/name (overriding the tab); else the tab's members in category order
// ('All' = every generator, category order then uncategorised; 'More' = uncategorised).
export function filterSources(allNames, { tab = 'All', query = '' } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (q) return allNames.filter((n) => labelOf(n).toLowerCase().includes(q) || n.toLowerCase().includes(q));
  if (tab === 'All') {
    const ordered = [];
    for (const [, names] of SOURCE_CATEGORIES) for (const n of names) if (allNames.includes(n) && !ordered.includes(n)) ordered.push(n);
    for (const n of allNames) if (!ordered.includes(n)) ordered.push(n);
    return ordered;
  }
  if (tab === 'More') {
    const cat = new Set(SOURCE_CATEGORIES.flatMap(([, ns]) => ns));
    return allNames.filter((n) => !cat.has(n));
  }
  const entry = SOURCE_CATEGORIES.find(([label]) => label === tab);
  return entry ? entry[1].filter((n) => allNames.includes(n)) : [];
}
```

**Step 4: Point `layers.js` at the module.** Remove the local `const SOURCE_CATEGORIES = [...]` (~1557) and add to the top imports of `src/ui/layers.js`:

```js
import { SOURCE_CATEGORIES, CATEGORY_COLORS, CATEGORY_TABS, sourceCategory, filterSources } from './source-catalog.js';
```

(Leave `buildSourceRail`/`openPicker` using `SOURCE_CATEGORIES` for now — Task 3 replaces them. Just make sure the local const is gone and the import supplies it.)

**Step 5: Run `node --test test/*.test.js` → PASS**; `node -e "import('./src/ui/layers.js').then(()=>console.log('layers OK'))"`.

**Step 6: Commit**

```bash
git add src/ui/source-catalog.js test/source-catalog.test.js src/ui/layers.js
git commit -m "feat(ui): source-catalog module (families, colors, filterSources) + tests"
```

---

### Task 2: Per-source descriptions in the manifest

**Files:**
- Modify: `src/engine/shaders/manifest.js` (add `desc` to the ~21 generator source entries; add `descOf`)
- Test: `test/source-catalog.test.js` (add a `descOf` case) OR `test/fields.test.js`

**Step 1: Write the failing test** (add to `test/source-catalog.test.js`, import `descOf` from manifest):

```js
import { descOf } from '../src/engine/shaders/manifest.js';
test('descOf returns a short description for a source, else empty', () => {
  assert.ok(descOf('solid').length > 0);
  assert.ok(descOf('flowfield').toLowerCase().includes('wind') || descOf('flowfield').length > 0);
  assert.equal(descOf('nope-xyz'), '');
});
```

**Step 2: Run → FAIL** (`descOf` missing).

**Step 3: Add `desc` to each generator entry** in `src/engine/shaders/manifest.js`. One short line each, added alongside `name`/`type`. Suggested copy (keep plain, ≤~60 chars):
- solid: `'A flat colour fill.'` · gradient: `'A two-colour ramp across the canvas.'` · line: `'Sweeping lines / bars.'`
- grid: `'A grid of cells.'` · checkers: `'A checkerboard.'` · spectrum: `'Audio spectrum bars.'`
- sine: `'Scrolling sine bands.'` · pulse: `'A pulsing radial burst.'` · radial: `'A radial gradient / rings.'` · plasma: `'Classic flowing plasma.'` · tunnel: `'An infinite zoom tunnel.'`
- domainwarp: `'Domain-warped liquid noise.'` · metaballs: `'Blobby metaballs.'`
- noise: `'Animated fBm value noise.'`
- planesweep: `'3D: a lit plane swept along an axis.'` · axisgradient: `'3D: a colour ramp along a world axis.'` · noise3d: `'3D: volumetric fBm noise with drift.'` · spherepulse: `'3D: expanding spherical shells (triggerable).'` · bodywave: `'3D: a travelling sine wave along an axis.'` · planepulse: `'3D: planes sweeping per trigger.'` · flowfield: `'3D: curl-noise filaments streaming on the wind.'`

Then add the helper near `getEntry`/`labelOf`:

```js
// One-line source/effect description for the browser's info line ('' if none).
export const descOf = (name) => REGISTRY[name]?.desc || '';
```

**Step 4: Run `node --test test/*.test.js` → PASS.**

**Step 5: Commit**

```bash
git add src/engine/shaders/manifest.js test/source-catalog.test.js
git commit -m "feat(manifest): per-source descriptions + descOf()"
```

---

### Task 3: `sourceBrowser()` component + wire into openPicker & the panel

**Files:**
- Modify: `src/ui/layers.js` (add `sourceBrowser()` in the `createLayerPanel` factory; use it in `openPicker` source branch ~1579-1605; expose it on the return object; import `descOf`)

**Step 1: Import `descOf`** — add to the manifest import at the top of `layers.js` (the one with `labelOf`/`generatorNames`/`effectNames`).

**Step 2: Add the component** inside `createLayerPanel` (near `buildSourceRail`, before the `return`). It reuses the factory's `el`, `thumbnails`, `labelOf`, `generatorNames`, `drag`, `show`, `commit`, `addClip`, and the layer helpers:

```js
  // TD-style source BROWSER: family tabs + search + dense card grid + a description
  // line. Shared by the Output-pane Sources tab (draggable, click-adds-to-active-layer)
  // and the '+' clip picker (click → onPick). Filtering/categories are pure (source-catalog).
  function sourceBrowser({ onPick, draggable = false, onVideo } = {}) {
    const root = el('div', { className: 'src-browser' });
    let tab = 'All', query = '';
    const tabbar = el('div', { className: 'src-tabs' });
    const search = el('input', { className: 'src-search', type: 'search', placeholder: 'search sources…' });
    const gridEl = el('div', { className: 'src-grid' });
    const descEl = el('div', { className: 'src-desc' });
    const setDesc = (name) => { descEl.textContent = name ? (descOf(name) || sourceCategory(name)) : ''; };

    const card = (name) => {
      const cat = sourceCategory(name);
      const c = el('div', { className: 'src-card', title: labelOf(name), draggable: !!draggable });
      c.style.setProperty('--cat', CATEGORY_COLORS[cat] || 'var(--faint)');
      const thumb = thumbnails[name];
      if (thumb) c.append(el('img', { className: 'src-thumb', src: thumb, alt: '', draggable: false }));
      c.append(el('span', { className: 'src-dot' }), el('span', { className: 'src-label', textContent: labelOf(name) }));
      c.addEventListener('mouseenter', () => setDesc(name));
      if (onPick) c.addEventListener('click', () => onPick(name));
      if (draggable) {
        c.addEventListener('dragstart', (e) => { drag = { kind: 'source', name }; e.dataTransfer.effectAllowed = 'copy'; try { e.dataTransfer.setData('text/plain', name); } catch { /* */ } });
        c.addEventListener('dragend', () => { drag = null; });
      }
      return c;
    };

    const renderGrid = () => {
      gridEl.textContent = '';
      const names = filterSources(generatorNames(), { tab, query });
      names.forEach((n) => gridEl.append(card(n)));
      // ISF examples + video only in All/More (or a search that has no generator hits): keep parity.
      if ((tab === 'All' || tab === 'More') && !query) {
        const examples = (getISFExamples && getISFExamples()) || [];
        if (examples.length && onAddISF) examples.forEach((file) => {
          const c = el('div', { className: 'src-card src-isf', title: file });
          c.style.setProperty('--cat', CATEGORY_COLORS.More);
          c.append(el('span', { className: 'src-dot' }), el('span', { className: 'src-label', textContent: file.replace(/\.[^.]+$/, '') }));
          c.addEventListener('click', () => onAddISF(file));
          gridEl.append(c);
        });
        if (onVideo) {
          const v = el('div', { className: 'src-card src-video', title: 'add a video clip' });
          v.append(el('span', { className: 'src-label', textContent: '+ video…' }));
          v.addEventListener('click', () => onVideo());
          gridEl.append(v);
        }
      }
      if (!gridEl.childNodes.length) gridEl.append(el('div', { className: 'seg-hint', textContent: 'no sources' }));
    };

    const renderTabs = () => {
      tabbar.textContent = '';
      for (const t of CATEGORY_TABS) {
        const b = el('button', { className: 'src-tab' + (t === tab && !query ? ' is-on' : ''), textContent: t });
        if (CATEGORY_COLORS[t]) b.style.setProperty('--cat', CATEGORY_COLORS[t]);
        b.addEventListener('click', () => { tab = t; query = ''; search.value = ''; renderTabs(); renderGrid(); });
        tabbar.append(b);
      }
    };

    search.addEventListener('input', () => { query = search.value; renderTabs(); renderGrid(); });
    root.append(tabbar, search, gridEl, descEl);
    renderTabs(); renderGrid();
    return root;
  }
```

**Step 3: Use it in `openPicker`** — replace the `if (kind === 'source') { … }` block (layers.js ~1579-1605) with:

```js
    if (kind === 'source') {
      pop.classList.add('src-browser-pop');
      pop.append(sourceBrowser({ onPick: (n) => { closePicker(); onPick(n); }, onVideo: opts.onVideo }));
    } else {
```

(Keep the `else { const names = opts.colorOnly ? … }` effect branch unchanged. The `item`/`grid` local helpers are still used by the effect branch — leave them.)

**Step 4: Expose it on the panel return** — add `sourceBrowser` to the returned object (the line with `buildSourceRail`). Keep `buildSourceRail` for now (Task 4 stops using it; you may delete it in Task 4).

**Step 5: Verify** — `node -e "import('./src/ui/layers.js').then(()=>console.log('layers OK'))"`; `node --test test/*.test.js` (unchanged, still green).

**Step 6: Commit**

```bash
git add src/ui/layers.js
git commit -m "feat(ui): sourceBrowser component (tabs/search/grid/desc); use in the picker"
```

---

### Task 4: Mount the browser in the Sources tab (`app.js`)

**Files:**
- Modify: `src/app.js` (`setPatchTab`, ~2582 — swap `buildSourceRail()` for `sourceBrowser(...)`)
- Modify: `src/ui/layers.js` (optional: delete the now-unused `buildSourceRail` + its return entry)

**Step 1:** In `src/app.js` `setPatchTab`, change the sources-mount line (~2582) from:

```js
    if (which === 'sources') { src.textContent = ''; src.append(layerPanel.buildSourceRail()); }
```
to:
```js
    if (which === 'sources') {
      src.textContent = '';
      src.append(layerPanel.sourceBrowser({
        draggable: true,
        onPick: (name) => layerPanel.addSourceToActiveLayer?.(name),   // click adds to the active/master layer
        onVideo: () => layerPanel.pickVideoActive?.(),
      }));
    }
```

**Step 2: Add the two tiny panel helpers** the tab needs, in `createLayerPanel` (they use the factory's `show`/`commit`/`addClip`/active-layer logic — mirror how `openPicker`'s empty-slot add resolves a layer; reuse `pickVideo` for video). Add `addSourceToActiveLayer` and `pickVideoActive` to the return object:

```js
  function addSourceToActiveLayer(name) {
    const layers = show().composition?.layers || [];
    const target = /* active/selected layer, else first */ (layers.find((l) => l.n === activeLayerId) || layers[0]);
    if (target) commit(addClip(show(), target.n, name));
  }
  function pickVideoActive() { pickVideo(null); }   // pickVideo already falls back to the active/top layer
```

(Find the real active-layer accessor in the factory — there is a selected/active layer concept used by `pickVideo`/`onLayerSelect`. Use the SAME resolution `pickVideo` uses for its fallback layer, so click-add and video-add target the same layer. If there's no distinct "active layer" id, add to the first/master layer.)

**Step 3:** Add `addSourceToActiveLayer, pickVideoActive, sourceBrowser` to the panel's return object; delete `buildSourceRail` (and its return entry) if nothing else references it (grep first).

**Step 4: Verify** — `node -e "import('./src/ui/layers.js').then(()=>console.log('OK'))"`; `node --check src/app.js`; `node --test test/*.test.js`.

**Step 5: Commit**

```bash
git add src/app.js src/ui/layers.js
git commit -m "feat(ui): Sources tab uses the TD-style sourceBrowser (drag + click-add)"
```

---

### Task 5: Styles (`ui.css`)

**Files:**
- Modify: `src/ui/ui.css` (add `.src-browser` and children near the `.src-rail`/`.pick-*` rules)

**Step 1: Add the styles.** Square corners, hairline, mono, near-black; the category colour is a SMALL dot + a 2px active-tab underline (restrained). Reuse existing tokens (`--line`, `--field-bg`, `--field-border`, `--accent`, `--faint`, `--ctrl-h`, `--mono`, `--radius`).

```css
/* TD-style source browser (Sources tab + '+' picker). Family tabs (colour = a small
   dot + a 2px active underline, restrained), search, dense card grid, description line. */
.src-browser { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.src-browser-pop { width: min(680px, calc(100vw - 16px)); max-width: none; padding: 6px; }
.src-browser-pop .src-browser { max-height: min(60vh, 520px); }

.src-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--line); overflow-x: auto; flex: none; }
.src-tab { flex: 0 0 auto; background: transparent; border: none; border-bottom: 2px solid transparent;
  color: var(--muted); font: var(--fs-ctrl) var(--sans); letter-spacing: var(--ls-ui); padding: 5px 9px; cursor: pointer; white-space: nowrap; }
.src-tab:hover { color: var(--text); }
.src-tab.is-on { color: var(--text); border-bottom-color: var(--cat, var(--accent)); }

.src-search { flex: none; margin: 6px 0; height: var(--ctrl-h); background: var(--field-bg); color: var(--text);
  border: 1px solid var(--field-border); border-radius: var(--radius); padding: 0 7px; font: var(--fs-ctrl) var(--mono); }

.src-grid { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 4px; align-content: start; padding: 2px; }
.src-card { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 4px; cursor: grab;
  background: var(--field-bg); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.src-card:hover { border-color: var(--cat, var(--accent)); }
.src-card:active { cursor: grabbing; }
.src-thumb { width: 100%; height: 46px; object-fit: cover; display: block; background: #000; }
.src-dot { position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--cat, var(--faint)); }
.src-label { font: var(--fs-micro) var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.src-isf .src-label, .src-video .src-label { color: var(--faint); }

.src-desc { flex: none; min-height: 16px; padding: 4px 2px 0; border-top: 1px solid var(--line);
  color: var(--faint); font: var(--fs-micro) var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

(Verify `--fs-ctrl`/`--fs-micro`/`--sans`/`--mono`/`--ls-ui`/`--ctrl-h`/`--radius`/`--field-bg`/`--field-border` all exist in `ui.css` `:root`; adjust names if the repo differs. The old `.src-rail` rules can be deleted once `buildSourceRail` is gone.)

**Step 2: Verify** — `node --test test/*.test.js` (CSS doesn't affect tests; confirm green).

**Step 3: Commit**

```bash
git add src/ui/ui.css
git commit -m "style(ui): TD-style source browser (tabs/search/grid/desc)"
```

---

### Task 6: Full suite + in-app verification

**Step 1:** `node --test test/*.test.js` → all pass.

**Step 2:** REQUIRED SUB-SKILL: `verify`/`run` — launch the app and:
1. Output pane → **Sources** tab: the browser shows family tabs (All/Basic/…/Volumetric/More) with colored active underline + card dots; a search box; a dense grid of source cards with thumbnails; a description line updating on hover.
2. Click a tab → grid filters to that family. Type in search → filters across all families (overriding the tab). Clear → returns to the tab.
3. Click a card → adds a clip to the active layer. Drag a card onto a layer slot → adds a clip. `+ video…` works; ISF examples appear under All/More.
4. Click **`+`** on an empty clip slot → the SAME browser appears in the popover; picking a source adds the clip; the popover sizes to fit.
5. No console errors; the effect picker (`+ effect`) is unchanged (still the plain grid, incl. the volumetric color-only filter).

**Step 3:** If any category color reads too strong for the house aesthetic, tune `CATEGORY_COLORS` (they're muted by design — a dot + underline only).

---

## Invariants / gotchas
- `source-catalog.js` is PURE (no DOM) so it's unit-tested; the component (`layers.js`) is UI.
- The shared `drag = { kind:'source', name }` payload + the existing layer-slot `makeDropTarget` handle drag-to-add — the browser just sets `drag` on `dragstart` (same as the old rail).
- Effects picker UNCHANGED (Task 3 only replaces the `kind==='source'` branch of `openPicker`).
- Keep click-add and drag-add targeting the SAME layer as `pickVideo`'s fallback, so behaviour is consistent.
- Restrained color: a dot + 2px underline in the family hue — never a filled tab (house aesthetic).
