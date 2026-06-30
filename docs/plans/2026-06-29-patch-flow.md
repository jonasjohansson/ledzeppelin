# Patch-Flow Simplification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make device/fixture patching direct, transparent, and bulk-editable — move
the type catalog into a popout template library, add fixtures/devices directly as
standalone instances, give one flat multi-select editor, and make scanning legible.

**Architecture:** Instances become the source of truth for their own spec (they are
already denormalized caches). `fixtureTypes`/`deviceTypes` stay in the show but become
a **template library** the Inventory *popout* edits — stamping a template *inlines* its
spec into a new standalone instance, with no live link. The main right column drops the
Inventory tab and gains direct `+ Fixture` / `+ Device`. A flat side panel edits one or
many selected instances; differing fields render dimmed ("mixed") and edits write to the
whole selection. Scanning shows live progress and the list re-renders on add.

**Tech Stack:** Vanilla ESM, `node:test` (model/pure logic), DOM glue in `src/ui`,
popout pages served as routes (mirrors `mappings/`), `BroadcastChannel` sync.

**Design doc:** `docs/plans/2026-06-29-patch-flow-design.md`

**Conventions:**
- Model + pure-logic tasks are TDD (`npm test`). UI tasks have no DOM harness in this
  repo — verify with `/run` and `/verify`, and extract any non-trivial pure logic into a
  tested model module rather than burying it in DOM code.
- Commit after every task. Run `npm test` before each commit.

---

## Phase 1 — Model: instances own their spec (TDD)

### Task 1: Stop refreshing fixture spec from the type (break the live link)

**Files:**
- Modify: `src/model/show.js:156-205` (`syncFixtureTypes`)
- Test: `test/show.test.js`

**Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncFixtureTypes } from '../src/model/show.js';

test('editing a type does NOT change an existing instance (standalone)', () => {
  const show = {
    fixtureTypes: [{ id: 't1', name: 'Strip', ledsPerMeter: 60, meters: 1, pixelCount: 60, colorOrder: 'GRB', cols: 60, rows: 1, distribution: 0 }],
    fixtures: [{ id: 'f1', typeId: 't1', pixelCount: 60, cols: 60, rows: 1, ledsPerMeter: 60, meters: 1, colorOrder: 'GRB', colorFormat: '', output: { deviceId: '', pixelCount: 60 }, input: { points: [[0,0],[1,0]], samples: 60 } }],
    devices: [],
  };
  // mutate the TEMPLATE to 144 px
  show.fixtureTypes[0].pixelCount = 144; show.fixtureTypes[0].cols = 144; show.fixtureTypes[0].ledsPerMeter = 144;
  const out = syncFixtureTypes(show);
  // the instance keeps its own 60 px — NOT refreshed from the type
  assert.equal(out.fixtures[0].pixelCount, 60);
  assert.equal(out.fixtures[0].output.pixelCount, 60);
});
```

**Step 2: Run to verify it fails**

Run: `node --test --test-name-pattern="standalone" test/show.test.js`
Expected: FAIL — current code copies `t.pixelCount` (144) onto the instance.

**Step 3: Implement**

In `syncFixtureTypes`, change the per-fixture map so it **validates/normalizes the
instance's own fields** and only falls back to the type/defaults when a field is
missing. Concretely:
- Keep type seeding + `byId` (templates still exist for the popout).
- Replace the `out = { ...f, typeId, ledsPerMeter: t.ledsPerMeter, ... }` block: read
  pixel/grid/colour fields from `f` first, type only as fallback for a truly missing
  field. Normalize with the existing helpers (`cols`/`rows`/`pixelCount = cols*rows`).
- **Remove** the "OUTPUT KIND FOLLOWS THE TYPE" block (lines 182-201) — DMX-vs-pixel is
  now an instance property, not derived from the type each rebuild. Preserve whatever
  `input.mode`/`input.dmx` the instance already carries.
- Keep `output.pixelCount`/`input.samples` mirrored to the **instance's** `pixelCount`.

**Step 4: Run to verify it passes**

Run: `node --test test/show.test.js`
Expected: PASS (new test + all existing `show.test.js` tests still green).

**Step 5: Commit**

```bash
git add src/model/show.js test/show.test.js
git commit -m "model(show): fixtures own their spec; type edits don't propagate"
```

---

### Task 2: Stop refreshing device spec from the model

**Files:**
- Modify: `src/model/show.js:35-63` (`syncDeviceTypes`)
- Test: `test/show.test.js`

**Step 1: Write the failing test** — same shape as Task 1: mutate a `deviceType`'s
`outputs`, assert the existing device instance keeps its own `outputs`.

**Step 2: Run to verify it fails.**

**Step 3: Implement** — in `syncDeviceTypes`, read `outputs`/`maxPerOutput`/`artnetSync`
from the **device** first, type only as fallback when missing. Keep type seeding + the
permanent `generic`. Keep `typeId` as provenance.

**Step 4: Run tests; Step 5: Commit**
`git commit -m "model(show): devices own their spec; model edits don't propagate"`

---

### Task 3: Migration — REVERSED (no separate bake function needed)

**What we actually did:** nothing new. Tasks 1–2 already made `syncFixtureTypes` /
`syncDeviceTypes` read each instance's spec first and fall back to the referenced
type when a field is missing. That fallback IS the migration: a legacy instance
carrying only `{ id, typeId }` gets its spec (`pixelCount`, `outputs`, …) inlined
from the type the first time the show is synced on load. Adding a separate
`bakeInstanceSpecs(show)` would have duplicated that logic, so it was dropped.

**Coverage:** the full-chain tests assert that running a legacy typeId-only fixture
and device through `syncFixtureTypes(syncDeviceTypes(show))` + `repackOffsets`
yields a valid show with the spec populated from the type — proving sync inlines
legacy instances without a dedicated migration step.

**No source change, no separate commit for this task.**

---

### Task 4: Pure multi-select helpers (mixed values + bulk apply)

**Files:**
- Create: `src/model/selection.js`
- Test: `test/selection.test.js`

**Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldState, applyField } from '../src/model/selection.js';

test('fieldState: shared value', () => {
  assert.deepEqual(fieldState([{ a: 5 }, { a: 5 }], 'a'), { value: 5, mixed: false });
});
test('fieldState: mixed value', () => {
  assert.deepEqual(fieldState([{ a: 5 }, { a: 9 }], 'a'), { value: undefined, mixed: true });
});
test('applyField writes to all selected', () => {
  assert.deepEqual(applyField([{ a: 1 }, { a: 2 }], 'a', 7), [{ a: 7 }, { a: 7 }]);
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement** `fieldState(items, key)` → `{ value, mixed }` (mixed when not all
equal) and `applyField(items, key, value)` → new array with `key` set on each. Support
dotted keys (e.g. `output.port`) — small helper for get/set.

**Step 4: Run tests; Step 5: Commit**
`git commit -m "model(selection): mixed-value + bulk-apply helpers"`

---

### Task 5: Pure template-stamp helper

**Files:**
- Create: `src/model/templates.js` (or extend `show.js`)
- Test: `test/templates.test.js`

**Step 1: Write failing test** — `stampFixture(template, id)` returns a standalone
fixture with the template spec inlined, a fresh `id`, default geometry/`output`/`input`,
and NO live link (a `typeId` provenance tag is fine).

**Step 2: fail → Step 3: implement → Step 4: pass → Step 5: commit**
`git commit -m "model(templates): stampFixture/stampDevice inline a template"`

---

## Phase 2 — UI: remove the Inventory tab, add direct add

### Task 6: Remove the Inventory tab from the right column

**Files:**
- Modify: `index.html:174-193` (the Patch island tabs + `#patch-inventory`)
- Modify: `src/ui/fixtures.js` (drop `libraryBox`/`inventory` tab wiring; keep the
  template data available to the add menu)

**Steps:** delete the `Inventory` tab button + `#patch-inventory` panel; make the Devices
panel the whole island. Remove tab-switch JS. **Verify:** `/run` — right column shows
only the device/patch list, no Inventory tab, nothing throws in console.
**Commit:** `feat(ui): drop the Inventory tab from the patch island`

### Task 7: Direct `+ Fixture` / `+ Device` with a template menu (fixes #5)

**Files:** Modify `src/ui/fixtures.js` (the `+ FIXTURE / + CONTROLLER` toolbar, ~line 181)

**Steps:** wire `+ Fixture` to a small popover menu listing fixture templates +
"Blank"; on pick, `stampFixture(...)`, push to `show.fixtures`, select it, `commit`.
Same for `+ Device` with device templates. Ensure `+ Fixture` is always visible.
**Verify:** `/verify` — from an empty show, add a strip and a matrix via the menu; they
appear and are selected. **Commit:** `feat(ui): add fixtures/devices directly from a template menu`

---

## Phase 3 — UI: flat editor + multi-select

### Task 8: Flatten the editor (remove toggles) (fixes #2)

**Files:** Modify `src/ui/fixtures.js` — `dmxChannelEditor` (75-132) and the fixture
editor body.

**Steps:** remove the `Custom…` dropdown reveal — the param row is always an editable
name field + always-editable channel count (drop the `disabled = !isCustom` gating at
117-120). Surface all fixture fields in the panel with nothing hidden. **Verify:**
`/run` — open a DMX fixture; every channel name + count is editable inline, no "Custom…".
**Commit:** `feat(ui): flat fixture editor — no Custom… reveal, all fields visible`

### Task 9: Multi-select + mixed-value editing

**Files:** Modify `src/ui/fixtures.js`, `src/app.js` (selection state); use
`src/model/selection.js`.

**Steps:**
- Selection becomes a Set of ids; shift/⌘-click toggles/extends in the list (and marquee
  on canvas if cheap — otherwise list only this task).
- The flat panel renders from the selection: for each field use `fieldState(sel, key)`;
  when `mixed`, add a `is-mixed` class (dim) and blank/placeholder the input.
- On edit, `applyField` across the selection → `commit`.
- Add a small `.is-mixed { opacity: .45 }` rule in `src/ui/ui.css`.

**Verify:** `/verify` — select 3 strips of different lengths; length shows dimmed/mixed;
set it once → all three become that length. **Commit:** `feat(ui): multi-select bulk edit with mixed-value fields`

---

## Phase 4 — Inventory popout

### Task 10: Scaffold the `inventory/` popout page

**Files:**
- Create: `inventory/index.html`, `inventory/inventory.js` (mirror `mappings/`)
- Modify: `scripts/build-macapp.sh:25` and `scripts/build-app.sh` — add `inventory` to
  the staged-assets list so it ships.

**Steps:** build a page that lists + edits fixture templates and device templates
(reuse the type editors). Persist via the shared show store (`saveShow`) and broadcast
changes on `BroadcastChannel('lz-inventory')`. **Verify:** open `/inventory/` directly in
a browser; edit a template; confirm it persists. **Commit:** `feat(inventory): popout template-library page`

### Task 11: Open the popout from the top bar + live sync

**Files:** Modify `index.html` (top-bar icon button, mirror `#menu-mapping` at line 87)
and `src/app.js` (`openInventoryWindow()` like `openMappingsWindow` at 2253; subscribe to
`BroadcastChannel('lz-inventory')` to refresh templates available to the add menu).

**Verify:** `/verify` — click the icon, popout opens; add a template there; it appears in
the main app's `+ Fixture` menu without reload. **Commit:** `feat(inventory): open popout from top bar + BroadcastChannel sync`

---

## Phase 5 — Scan transparency

### Task 12: Live scan progress (fixes the "mystery")

**Files:** Modify `src/ui/fixtures.js` — `runScan` (272-285) + `scanResults` (288-335).

**Steps:** while `scanState.running`, render a status block: spinner + "Scanning… WLED
subnet sweep + Art-Net ArtPoll", and update counts as each probe resolves (the two
`done()` legs already arrive independently). Show "0 found" states clearly. **Verify:**
`/run` — press Scan; progress is visible immediately and updates as results land.
**Commit:** `feat(ui): visible scan progress`

### Task 13: Re-render Devices on add (fixes GitHub #4)

**Files:** Modify `src/ui/fixtures.js` — the scan `foundRow` add handler (296-304) calls
`commit`, which calls `render()`; confirm `render()` rebuilds the **Devices list** (not
just the scan popover). If the scan runs in a separate render closure, route the add
through the main panel `render`/`commit` so the new device shows immediately.

**Step 1 (repro):** document the bug — after Scan→Add, the device only appears after a
tab switch. **Step 2 (fix):** ensure the add path triggers the main list render.
**Verify:** `/verify` — Scan, Add a controller; it appears in Devices immediately, no tab
switch. **Commit:** `fix(ui): show a scanned controller in Devices immediately (#4)`

---

## Phase 6 — Close out

### Task 14: Manual end-to-end + issue close

**Steps:**
- `npm test` green.
- `/verify` the whole flow: open inventory popout → define a strip template → main app
  `+ Fixture` stamps it → duplicate it 11× → multi-select all 12 → set length once → all
  update → scan → add a controller (appears immediately) → assign fixtures.
- Load a **real saved show** (a pre-change `examples/` or `mappings/` sample) and confirm
  nothing loses its spec (migration check).
- Reference GitHub #4 and #5 in the final commit; comment on both issues that the
  redesign addresses them.

**Commit:** `feat(patch): direct-add patch flow, flat multi-select editor, inventory popout, visible scan`

---

## Risks / watch-list

- **Migration (Task 3) is the highest risk.** Saved shows already carry cached spec, so
  most are no-ops — but legacy `typeId`-only or DMX fixtures need the bake. Test against a
  real saved show before closing out (Task 14).
- **DMX "output kind follows type" removal (Task 1)** changes long-standing behavior;
  make sure existing DMX fixtures keep `input.mode='dmx'` from their own state.
- No DOM test harness — UI correctness rests on `/verify`. Extract pure logic (Tasks 4,5)
  so the trickiest parts are unit-tested.
