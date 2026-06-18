import { resolveDmxChannels } from '../src/model/dmx.js';

// Build the 512-byte DMX buffers for a frame, keyed by universe. Each DMX fixture
// reads its sampled colour from the frame's RGB at `colourIndex`, resolves the
// profile into channel bytes, and writes them at `address` (1-based) in its universe.
// dmxList: [{ colourIndex, universe, address, channels, fixed }]  → Map(universe → Uint8Array(512)).
export function packDmxUniverses(rgb, dmxList) {
  const byUniverse = new Map();
  for (const fx of dmxList || []) {
    const i = (fx.colourIndex || 0) * 3;
    const color = [rgb[i] || 0, rgb[i + 1] || 0, rgb[i + 2] || 0];
    const bytes = resolveDmxChannels({ channels: fx.channels }, color, fx.fixed || {});
    const u = fx.universe || 0;
    let buf = byUniverse.get(u);
    if (!buf) { buf = new Uint8Array(512); byUniverse.set(u, buf); }
    const start = Math.max(0, (fx.address || 1) - 1);   // DMX addresses are 1-based
    for (let k = 0; k < bytes.length && start + k < 512; k++) buf[start + k] = bytes[k];
  }
  return byUniverse;
}
