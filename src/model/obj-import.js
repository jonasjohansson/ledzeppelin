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
