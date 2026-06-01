export function emptyShow() {
  return { version: 1, devices: [], fixtures: [],
    composition: { canvas: { w: 1280, h: 720 }, layers: [] } };
}
const clone = (s) => structuredClone(s);
export function addDevice(show, d) { const s = clone(show); s.devices.push({ port: 4048, ...d }); return s; }
export function addFixture(show, f) { const s = clone(show); s.fixtures.push(f); return s; }

export function validate(show) {
  const errors = [];
  const ids = new Set(show.devices.map((d) => d.id));
  for (const f of show.fixtures) {
    if (!ids.has(f.output?.deviceId)) errors.push(`fixture ${f.id}: unknown device ${f.output?.deviceId}`);
    if (f.output?.pixelCount !== f.pixelCount) errors.push(`fixture ${f.id}: output pixelCount mismatch`);
    if ((f.input?.points?.length ?? 0) < 2) errors.push(`fixture ${f.id}: input needs ≥2 points`);
  }

  // Per-device pixel ranges must start at 0 and be contiguous (no gaps/overlaps),
  // since the flat sampler buffer is dense 0-based (see pipeline.js INVARIANT).
  for (const d of show.devices) {
    const fs = show.fixtures
      .filter((f) => f.output?.deviceId === d.id)
      .sort((a, b) => (a.output?.pixelOffset ?? 0) - (b.output?.pixelOffset ?? 0));
    if (!fs.length) continue;
    let expected = 0;
    for (const f of fs) {
      if ((f.output?.pixelOffset ?? 0) !== expected) {
        errors.push(`device ${d.id}: fixture pixel offsets must start at 0 and be contiguous`);
        break;
      }
      expected += f.output?.pixelCount ?? 0;
    }
  }

  return { ok: errors.length === 0, errors };
}

export function deviceByteRange(show, deviceId) {
  const fs = show.fixtures.filter((f) => f.output.deviceId === deviceId);
  if (!fs.length) return null;
  const start = Math.min(...fs.map((f) => f.output.pixelOffset));
  const end = Math.max(...fs.map((f) => f.output.pixelOffset + f.output.pixelCount));
  return { byteStart: start * 3, byteEnd: end * 3 };
}
