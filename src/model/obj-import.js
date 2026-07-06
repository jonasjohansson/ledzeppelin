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
