# OBJ → Fixture Import (Phase C) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Drag a Wavefront `.obj` exported from any 3D tool onto LED Zeppelin and have each named polyline become a fixture (3D positions, pixel count, output wiring), reusing the tested LEDger importer underneath.

**Architecture:** A new pure module `src/model/obj-import.js` parses OBJ text into ordered named polylines, reads LED metadata from object names (`Name__leds=…__out=…`), and builds a LEDger/Kagora preset that the existing `importKagora()` ingests. A thin branch in the drag-drop/open handler routes `.obj` files through it.

**Tech Stack:** Vanilla ESM, Node built-in test runner. No new deps.

---

## Background the implementer needs

- **LEDger preset shape** (target of `objToKagora`; see `test/fixtures/kagora-sample.json` and
  `src/model/kagora-import.js`): `{ version, types[], instances[], edges[] }`.
  - `types`: `{ kind:'stripType', id, name, pixelCount, length_m, ledsPerMeter, colorOrder, ports:[{id:'data-in',dir:'in',signal:'data'},{id:'data-out',dir:'out',signal:'data'}] }`
    and one `{ kind:'controllerType', id, name, ports:[…] }`.
  - `instances`: `{ kind:'controller', id, name, typeId }` and
    `{ kind:'strip', id, typeId, points:[{x,y}|{x,y,z}] }`.
  - `edges`: `{ id, from:{ id:'data-out-<port>', instId:<controllerId> }, to:{ id:'data-in', instId:<stripId> }, channel:'signal' }`;
    daisy-chain extra strips on a port via `from:{ id:'data-out', instId:<prevStripId> }`.
- **`importKagora(preset)`** (`src/model/kagora-import.js:23`) → `{ devices, fixtures, fixtureTypes, composition, warnings }`.
  It normalizes all strip points into 0..1 by a shared bounding box, keeps any run with >2
  points or any z as a `polyline` fixture (`samples = pixelCount`), reads `stripType.pixelCount`
  / `colorOrder` / `ledsPerMeter`, and derives `output.port` from the **trailing integer** of the
  controller port id (`data-out-2` → `2`; `data-out-0` → `0`). IP is left blank.
- **Coordinate contract:** points may be in any units — the importer normalizes by bbox, so only
  ORIENTATION matters. Pass OBJ `x,y,z` straight through and document "export **Y-up**" (app: x =
  horizontal, y = vertical, z = depth off the plane).
- **Drop/open wiring:** `src/ui/project-io.js` — the `window` `drop` handler (~line 129) already
  branches ISF vs `.json`; the `.json` branch calls `applyFullShow(normalizeComposition(data))` for
  full projects. `applyFullShow` and `normalizeComposition` are already in scope there (hook +
  import). Add an `.obj` branch alongside.

---

## Task 1: OBJ parser — `parseObj(text)`

**Files:** Create `src/model/obj-import.js`; Test `test/obj-import.test.js`

**Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseObj } from '../src/model/obj-import.js';

test('parses vertices grouped by object, ordered by declaration when no l-lines', () => {
  const obj = `
o RunA
v 0 0 0
v 1 0 0
v 2 0 0
o RunB
v 0 1 0
v 0 2 0
`;
  const r = parseObj(obj);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, 'RunA');
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
  assert.equal(r[1].name, 'RunB');
  assert.deepEqual(r[1].points, [[0, 1, 0], [0, 2, 0]]);
});

test('orders points by l (line) elements when present, incl. negative indices', () => {
  // vertices declared out of path order; the l-line gives the true order.
  const obj = `o Bend
v 0 0 0
v 1 1 0
v 2 0 0
l 1 2 3`;
  const r = parseObj(obj);
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 1, 0], [2, 0, 0]]);

  const rel = parseObj(`o R
v 5 0 0
v 6 0 0
l -2 -1`);
  assert.deepEqual(rel[0].points, [[5, 0, 0], [6, 0, 0]]);
});

test('geometry before any o/g goes into a default object; f/vn/vt ignored', () => {
  const r = parseObj(`v 0 0 0\nv 1 0 0\nvn 0 0 1\nf 1 2 1\n`);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].points, [[0, 0, 0], [1, 0, 0]]);
});
```

**Step 2: Run — `node --test test/obj-import.test.js` — FAIL (no module).**

**Step 3: Implement `parseObj` in `src/model/obj-import.js`**

```js
// Import a Wavefront OBJ as fixture runs. Pure (no DOM): parse → name metadata →
// LEDger preset, which src/model/kagora-import.js turns into fixtures. Agnostic —
// any 3D tool exports OBJ; LED data rides in object names (see parseName).

// Parse OBJ text into ordered named polylines: [{ name, points: [[x,y,z], …] }].
// Vertices (`v`) are global + 1-indexed per the OBJ spec; `o`/`g` start a new object;
// `l` lines give explicit path order (preferred), else vertices order by declaration
// under their object. `f`/`vn`/`vt`/material lines are ignored.
export function parseObj(text) {
  const verts = [];                 // global vertex list, 0-based here (OBJ refs are 1-based)
  const objects = [];               // { name, vids: [globalIdx…], lines: [[globalIdx…]] }
  let cur = null;
  const ensure = (name) => { cur = { name: name || 'object', vids: [], lines: [] }; objects.push(cur); return cur; };
  const resolve = (ref) => { const n = parseInt(ref, 10); if (!Number.isFinite(n) || n === 0) return -1; return n > 0 ? n - 1 : verts.length + n; };

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const sp = line.indexOf(' ');
    const tag = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    if (tag === 'v') {
      const n = rest.split(/\s+/).map(Number);
      const idx = verts.push([n[0] || 0, n[1] || 0, n[2] || 0]) - 1;
      if (!cur) ensure('object');
      cur.vids.push(idx);
    } else if (tag === 'o' || tag === 'g') {
      ensure(rest);
    } else if (tag === 'l') {
      if (!cur) ensure('object');
      const ids = rest.split(/\s+/).map(resolve).filter((i) => i >= 0 && i < verts.length);
      if (ids.length) cur.lines.push(ids);
    }
    // v-normals (vn), texcoords (vt), faces (f), usemtl, mtllib … ignored.
  }

  return objects.map((o) => {
    let order;
    if (o.lines.length) {
      order = [];
      for (const seg of o.lines) for (const id of seg) if (order[order.length - 1] !== id) order.push(id);
    } else {
      order = o.vids;
    }
    return { name: o.name, points: order.map((i) => verts[i]) };
  }).filter((o) => o.points.length >= 1);
}
```

**Step 4: Run — PASS.**

**Step 5: Commit** — `git add src/model/obj-import.js test/obj-import.test.js && git commit -m "feat(import): OBJ parser — named polylines from v/o/l"`
(End every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. The pre-commit hook auto-bumps src/version.js — expected.)

---

## Task 2: Name-metadata parser — `parseName(name)`

**Files:** Modify `src/model/obj-import.js`; Test `test/obj-import.test.js`

**Step 1: Add the failing test**

```js
import { parseName } from '../src/model/obj-import.js';

test('parseName splits base name from __key=val tokens with defaults', () => {
  assert.deepEqual(parseName('Tail__leds=204__order=GRBW__out=oct110.0'),
    { name: 'Tail', leds: 204, lpm: 60, order: 'GRBW', out: { dev: 'oct110', port: 0 }, dir: 'fwd' });
  // minimal: only leds; defaults fill in; no out → null
  assert.deepEqual(parseName('Rib__leds=90'),
    { name: 'Rib', leds: 90, lpm: 60, order: '', out: null, dir: 'fwd' });
  // no leds → leds null (caller drops + warns)
  assert.equal(parseName('Ghost').leds, null);
  // dir + lpm
  const p = parseName('Spine__leds=120__lpm=144__dir=rev');
  assert.equal(p.lpm, 144); assert.equal(p.dir, 'rev');
});
```

**Step 2: Run — FAIL.**

**Step 3: Implement `parseName` (append to `src/model/obj-import.js`)**

```js
// Parse an object name "Base__key=val__key=val" into fixture metadata.
// Tokens: leds (int, required — null if absent), lpm (int, default 60),
// order (color order string, default ''), out ("dev.port" → {dev,port} | null),
// dir ('fwd'|'rev', default 'fwd').
export function parseName(name) {
  const parts = String(name ?? '').split('__');
  const base = (parts.shift() || '').trim() || 'run';
  const kv = {};
  for (const tok of parts) { const i = tok.indexOf('='); if (i > 0) kv[tok.slice(0, i).trim().toLowerCase()] = tok.slice(i + 1).trim(); }
  const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  let out = null;
  if (kv.out) { const m = String(kv.out).match(/^(.+)\.(\d+)$/); if (m) out = { dev: m[1], port: parseInt(m[2], 10) }; }
  return {
    name: base,
    leds: int(kv.leds),
    lpm: int(kv.lpm) || 60,
    order: kv.order || '',
    out,
    dir: kv.dir === 'rev' ? 'rev' : 'fwd',
  };
}
```

**Step 4: Run — PASS.**

**Step 5: Commit** — `feat(import): OBJ object-name metadata parser`

---

## Task 3: Build the LEDger preset — `objToKagora(objects)`

**Files:** Modify `src/model/obj-import.js`; Test `test/obj-import.test.js`

**Step 1: Add the failing test**

```js
import { objToKagora } from '../src/model/obj-import.js';

test('objToKagora builds strips/types/controllers/edges + warns on bad runs', () => {
  const objs = [
    { name: 'Tail__leds=3__order=GRBW__out=oct.0', points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
    { name: 'Rib__leds=2__out=oct.0', points: [[0, 1, 0], [0, 2, 0]] },   // same port → daisy-chain
    { name: 'NoLeds', points: [[0, 0, 0], [1, 0, 0]] },                    // dropped + warned
    { name: 'Short__leds=5', points: [[0, 0, 0]] },                        // <2 pts → dropped + warned
  ];
  const { preset, warnings } = objToKagora(objs);
  const strips = preset.instances.filter((i) => i.kind === 'strip');
  assert.equal(strips.length, 2);
  assert.equal(warnings.length, 2);
  // controller present
  assert.ok(preset.instances.some((i) => i.kind === 'controller' && i.id === 'oct'));
  // first run wired to controller data-out-0; second daisy-chains off the first
  const e0 = preset.edges.find((e) => e.to.instId === strips[0].id);
  assert.deepEqual([e0.from.instId, e0.from.id], ['oct', 'data-out-0']);
  const e1 = preset.edges.find((e) => e.to.instId === strips[1].id);
  assert.deepEqual([e1.from.instId, e1.from.id], [strips[0].id, 'data-out']);
});

test('objToKagora reverses points when dir=rev', () => {
  const { preset } = objToKagora([{ name: 'R__leds=2__dir=rev', points: [[0, 0, 0], [9, 0, 0]] }]);
  const s = preset.instances.find((i) => i.kind === 'strip');
  assert.deepEqual([s.points[0].x, s.points[1].x], [9, 0]);
});
```

**Step 2: Run — FAIL.**

**Step 3: Implement `objToKagora`**

```js
import { parseName as _parseName } from './obj-import.js';  // (already in this file — use the local fn)

// Build a LEDger/Kagora preset from parsed OBJ objects. Returns { preset, warnings }.
// Dedupes a stripType per (leds,lpm,order); a controller per `out.dev`; wires the
// first run on each (dev,port) to the controller and daisy-chains the rest.
export function objToKagora(objects) {
  const warnings = [];
  const types = [];
  const instances = [];
  const edges = [];
  const stripTypeByKey = new Map();
  const controllerIds = new Set();
  const lastStripOnPort = new Map();  // `${dev}.${port}` → last strip id (for daisy-chaining)
  let sn = 0, en = 0;

  const CONTROLLER_TYPE = { kind: 'controllerType', id: 'ct_obj', name: 'Imported', ports: [] };
  types.push(CONTROLLER_TYPE);

  for (const o of objects) {
    const meta = parseName(o.name);
    if (meta.leds == null) { warnings.push(`Skipped "${o.name}": no leds=N in the name.`); continue; }
    if (!o.points || o.points.length < 2) { warnings.push(`Skipped "${meta.name}": needs at least 2 points.`); continue; }

    const key = `${meta.leds}|${meta.lpm}|${meta.order}`;
    let st = stripTypeByKey.get(key);
    if (!st) {
      st = { kind: 'stripType', id: `st_${stripTypeByKey.size}`, name: `${meta.leds}px`,
        pixelCount: meta.leds, length_m: meta.leds / meta.lpm, ledsPerMeter: meta.lpm, colorOrder: meta.order,
        ports: [{ id: 'data-in', dir: 'in', signal: 'data' }, { id: 'data-out', dir: 'out', signal: 'data' }] };
      stripTypeByKey.set(key, st); types.push(st);
    }

    const pts = meta.dir === 'rev' ? [...o.points].reverse() : o.points;
    const stripId = `run_${sn++}`;
    instances.push({ kind: 'strip', id: stripId, typeId: st.id,
      points: pts.map((p) => (Math.abs(p[2] || 0) > 1e-9 ? { x: p[0], y: p[1], z: p[2] } : { x: p[0], y: p[1] })) });

    if (meta.out) {
      const { dev, port } = meta.out;
      if (!controllerIds.has(dev)) { controllerIds.add(dev); instances.push({ kind: 'controller', id: dev, name: dev, typeId: 'ct_obj' }); }
      const pk = `${dev}.${port}`;
      const prev = lastStripOnPort.get(pk);
      edges.push(prev
        ? { id: `e${en++}`, from: { id: 'data-out', instId: prev }, to: { id: 'data-in', instId: stripId }, channel: 'signal' }
        : { id: `e${en++}`, from: { id: `data-out-${port}`, instId: dev }, to: { id: 'data-in', instId: stripId }, channel: 'signal' });
      lastStripOnPort.set(pk, stripId);
    }
  }
  return { preset: { version: 1, types, instances, edges }, warnings };
}
```
(Note: `parseName` is already defined in this file from Task 2 — call it directly; delete the illustrative import line above.)

**Step 4: Run — PASS.**

**Step 5: Commit** — `feat(import): build LEDger preset from OBJ runs (objToKagora)`

---

## Task 4: End-to-end round-trip through `importKagora`

**Files:** Test `test/obj-import.test.js`

**Step 1: Add the failing test** (the real proof — OBJ text → live fixtures)

```js
import { importKagora } from '../src/model/kagora-import.js';

test('OBJ text round-trips through importKagora into correct fixtures', () => {
  const objText = `
o Tail__leds=204__order=GRBW__out=oct110.0
v 0 0 1
v 1 0 1
v 2 0 1
o Rib__leds=90__out=oct110.1
v 0 1 0
v 0 2 0
`;
  const { preset, warnings } = objToKagora(parseObj(objText));
  assert.equal(warnings.length, 0);
  const show = importKagora(preset);
  const byName = Object.fromEntries(show.fixtures.map((f) => [f.name, f]));
  // Tail: 204px GRBW, on device oct110 port 0, lifted (z) → polyline
  assert.equal(byName.Tail.pixelCount, 204);
  assert.equal(byName.Tail.colorFormat, 'GRBW');
  assert.equal(byName.Tail.output.deviceId, 'oct110');
  assert.equal(byName.Tail.output.port, 0);
  assert.equal(byName.Tail.input.mode, 'polyline');
  assert.equal(byName.Tail.input.samples, 204);
  assert.ok(byName.Tail.input.points.every((p) => p.length === 3));   // z preserved
  // Rib: 90px on the same device, port 1
  assert.equal(byName.Rib.pixelCount, 90);
  assert.equal(byName.Rib.output.deviceId, 'oct110');
  assert.equal(byName.Rib.output.port, 1);
  // points normalized into 0..1
  for (const f of show.fixtures) for (const p of f.input.points) { assert.ok(p[0] >= 0 && p[0] <= 1); assert.ok(p[1] >= 0 && p[1] <= 1); }
});
```

**Step 2: Run — expect PASS immediately** (Tasks 1-3 already implement it). If it fails, fix the
root cause in `obj-import.js` (likely a preset-shape mismatch vs what `importKagora` expects — read
the importer and align; do NOT weaken the assertions).

**Step 3: Commit** — `test(import): OBJ→importKagora round-trip into fixtures`

---

## Task 5: UI wiring + golden sample + docs

**Files:** Modify `src/ui/project-io.js`; Create `test/fixtures/whale-sample.obj`; Modify a guide/README.

**Step 1: Wire `.obj` into the drop + open handlers** (`src/ui/project-io.js`)

Import at top:
```js
import { parseObj, objToKagora } from '../model/obj-import.js';
```
Add an `.obj` applier near the other appliers (it converts → imports → assembles a full show →
applies via the existing `applyFullShow`). `importKagora` returns `{ devices, fixtures, fixtureTypes, composition, warnings }`:
```js
  async function applyObjFile(file) {
    try {
      const { preset, warnings } = objToKagora(parseObj(await file.text()));
      const imp = importKagora(preset);          // import from '../model/kagora-import.js'
      const allWarn = [...warnings, ...(imp.warnings || [])];
      if (!imp.fixtures.length) { window.alert('No fixtures in that OBJ. Name each run e.g. Tail__leds=204__out=dev.0'); return; }
      applyFullShow(normalizeComposition({ version: 1, devices: imp.devices, fixtureTypes: imp.fixtureTypes, fixtures: imp.fixtures, composition: imp.composition }));
      if (allWarn.length) window.alert('Imported with notes:\n• ' + allWarn.join('\n• '));
    } catch (e) { window.alert('OBJ import failed: ' + e.message); }
  }
```
Add `import { importKagora } from '../model/kagora-import.js';` at the top. In the `drop` handler,
add `.obj` to the file scan and dispatch:
```js
    const objs = all.filter((f) => /\.obj$/i.test(f.name));
    if (!isf.length && !json.length && !objs.length) return;
    …
    for (const f of objs) await applyObjFile(f);
```
(Confirm `applyFullShow` + `normalizeComposition` are in scope — they are: hook + existing import.)

**Step 2: Golden sample** — create `test/fixtures/whale-sample.obj`:
```
# LED Zeppelin OBJ import sample — name each run Base__leds=N__out=dev.port
o Spine__leds=120__order=GRBW__out=quinA.0
v 0 0 0
v 1 0 0.2
v 2 0 0
o FinL__leds=48__out=quinA.1
v 0 1 0.5
v 0.5 1.2 0.5
```
Add a test asserting the file imports (read it with `node:fs`, run parseObj→objToKagora→importKagora,
assert 2 fixtures with the right ports/pixelCounts).

**Step 3: Docs** — add a short "Import from 3D (OBJ)" note (the naming convention table + "export
Y-up") to the in-app guide (`guide/` or the README the project uses for such notes — grep for where
the LEDger import is documented and mirror it).

**Step 4: Verify** — `npm test` (all pass, incl. new obj-import tests). `node --check src/ui/project-io.js`.

**Step 5: Manual smoke** — `npm start`; drag `test/fixtures/whale-sample.obj` onto the window;
confirm 2 fixtures appear wired to `quinA` on ports 0/1, positioned in 3D. Then cut a signed release
(session cadence).

**Step 6: Commit** — `feat(import): drag-drop OBJ import + sample + docs`
