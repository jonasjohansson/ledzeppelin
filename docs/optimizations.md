# Optimization backlog (from the audit fan-out + Lighthouse)

Snapshot of a multi-agent audit. **Applied** items are done; **TODO** items are
worth doing but were left for a focused pass (the per-frame ones touch the hot render
loop and want careful before/after profiling).

## Lighthouse (local, `npx lighthouse`)
After the applied fixes below:

| | Perf | A11y | Best-pract. | SEO |
|---|---|---|---|---|
| Desktop | 99 | 86 | 100 | 100 |
| Mobile  | 86 | 86 | 96  | 100 |

(Was: desktop 95/53/100/91, mobile 66/53/96/91.)

## Applied
- **Static server gzip + caching** (`server/static.js`): gzip for text types, `ETag` + `304` revalidation, `immutable` 1-year cache on woff2/png/svg/ico. Biggest LAN/mobile win.
- **A11y**: icon-only controls keep an accessible name via `aria-label` even when tooltips are off (`stashTip`, `src/app.js`); dropped `user-scalable=no`; added `meta description`; aligned `theme-color` (→ SEO 100, a11y 53→86).
- **Fonts**: preload `crossorigin` removed (same-origin double-fetch); service worker precaches the active font (CommitMono) not Spline; SW `VERSION` bumped to `lz-v3`.
- **Bug**: Overlay view never cleared its body class (the `VIEWS` list omitted `overlay`) — fixed.
- Tooltips sentence-cased centrally; native-right-click setting added.

## Applied — runtime perf (per-frame GC in the rAF `loop`, `src/app.js`)
The loop is throttled to 42fps with async PBO readback; the remaining cost was per-frame
allocation. Done:
1. ✅ `signals` no longer rebuilt via spread each frame — a persistent `frameSignals` filled with `Object.assign`.
2. ✅ `extChannels()` called once per frame (was twice) and reused in the signal merge.
3. ✅ `dashboardSignals` reuses a persistent output object (no per-frame `{}`).
4. ✅ `updateAudio` reuses a persistent object + precomputed key strings (no 12 strings/frame).

### Still TODO (riskier — left for a profiled pass)
5. `applyBindings` (`model/mappings.js`) allocates per binding + linear `layerById` find — precompute a parsed list + `id→layer` Map (stateful; wants careful before/after profiling).
- `computeBands` (`model/audio.js`) still allocates `ext`/`comp` + `avg`/`clamp` closures twice/frame — hoist.
- Preview overlay (`ui/preview.js`): build the `rgb(...)` string only when the packed-int colour changes (per-pixel allocation today); cache `chainOffset`/AABB into `pipelineFor()`.
- Compositor (`engine/compositor.js`): avoid per-layer `filter()` + double `getEntry`; note `TIMEDELTA` hardcoded `1/60` while loop runs 42fps (ISF time runs ~1.4× slow — correctness).

## TODO — load/startup
- 50 ES modules fetched as a serial waterfall (HTTP/1.1, no bundle). Cheap: add `<link rel="modulepreload">` for first-tier hot modules. Best: an esbuild/rollup production bundle.
- Drop unused bundled fonts: `SpaceGrotesk.woff2`, `SpaceMono-400/700.woff2`, `MartianMono.woff2` (+ its `@font-face`) — none referenced. `SplineSansMono.woff2` is still used by `preview.js` canvas/SVG label text; unify those to Commit Mono first if you want to drop it too.

## TODO — dead code / cleanup (from the refactor)
- Unused: `activateTabs` import (`app.js:15`) + `src/ui/kit/tabs.js` + `src/ui/kit/index.js` barrel; `setSection` shim + its lone `setSection('design')` caller; `controlPanel` mounts into the permanently-hidden `#system-control` and `refresh()`es on every companion send (drop the mount/refresh, possibly `src/ui/control.js`).
- Dead CSS: `.dock-overlay*` block, `#mapping-pane`/`#control-pane`/`#mapping-frame`, `.subtab-active`. (Keep the `#system-settings` parts.)
- Stale `closest()` selector fragments referencing removed `#side`/`#side-2`/`#corner-controls` (`app.js` ~1696, ~2020).

## TODO — a11y remainder
- `color-contrast`: a few muted/faint labels fall below 4.5:1 on near-black — bump `--muted`/`--faint` slightly.
