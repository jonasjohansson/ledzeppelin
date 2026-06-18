// Traditional DMX fixtures (pars + generic channel fixtures). A fixture is a
// PROFILE (an ordered channel layout) patched to an Art-Net universe + start
// address; it samples the canvas at its position and that colour drives its colour
// channels, while `fixed` channels carry a set value. Pure + unit-tested — see
// docs/dmx-fixtures.md for the design.

// Channel kinds. Colour kinds are driven by the sampled canvas colour; `fixed` is a
// constant value (a slider, 0..255).
export const DMX_CHANNEL_KINDS = ['dimmer', 'red', 'green', 'blue', 'white', 'amber', 'fixed'];

// Built-in profiles. `Generic` starts as one fixed channel and is edited in the UI.
export const DMX_PROFILES = [
  { id: 'dimmer', name: 'Dimmer', channels: [{ kind: 'dimmer' }] },
  { id: 'rgb', name: 'RGB Par', channels: [{ kind: 'red' }, { kind: 'green' }, { kind: 'blue' }] },
  { id: 'rgbw', name: 'RGBW Par', channels: [{ kind: 'red' }, { kind: 'green' }, { kind: 'blue' }, { kind: 'white' }] },
  { id: 'rgba', name: 'RGBA Par', channels: [{ kind: 'red' }, { kind: 'green' }, { kind: 'blue' }, { kind: 'amber' }] },
  { id: 'dimrgb', name: 'Dimmer + RGB', channels: [{ kind: 'dimmer' }, { kind: 'red' }, { kind: 'green' }, { kind: 'blue' }] },
  { id: 'generic', name: 'Generic', channels: [{ kind: 'fixed', value: 0 }] },
];

export const dmxProfile = (id) => DMX_PROFILES.find((p) => p.id === id) || null;
// Built-ins + the show's saved custom profiles (show.dmxProfiles), for pickers/editors.
export const allDmxProfiles = (custom = []) => [...DMX_PROFILES, ...(custom || [])];
export const findDmxProfile = (id, custom = []) => allDmxProfiles(custom).find((p) => p.id === id) || null;
export const isBuiltinProfile = (id) => DMX_PROFILES.some((p) => p.id === id);
// How many DMX channels (slots) a profile occupies.
export const dmxFootprint = (profile) => (profile?.channels?.length || 0);

// A fixture is a DMX fixture when it carries a `dmx` config on its input.
export const isDmxFixture = (f) => !!f?.input?.dmx;
// The channel layout for a fixture's dmx config: inline `channels` win, else the
// referenced built-in profile, else empty.
export const dmxChannelsOf = (cfg) =>
  (cfg?.channels?.length ? cfg.channels : dmxProfile(cfg?.profileId)?.channels) || [];

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// --- Unified fixtures: a fixture type's channel-block -------------------------
// A fixture is a CHANNEL LAYOUT: a Color Format (its colour channels) plus optional
// Parameters (extra channels). These helpers turn that unified type into the same
// ordered channel list resolveDmxChannels/packDmxUniverses already consume, so a
// fixture can be patched to a universe/address and output colour + params together.

// Each letter of a Color Format ('RGB', 'GRBW', 'RGBWA'…) is one colour channel.
const FORMAT_KIND = { r: 'red', g: 'green', b: 'blue', w: 'white', a: 'amber' };

// Ordered colour channels for a Color Format string; '' (inherit) defaults to RGB.
export function colorFormatChannels(fmt) {
  const out = [];
  for (const ch of String(fmt || '').toLowerCase()) {
    const k = FORMAT_KIND[ch];
    if (k) out.push({ kind: k });
  }
  return out.length ? out : [{ kind: 'red' }, { kind: 'green' }, { kind: 'blue' }];
}

// The full DMX channel-block for a unified fixture type: its colour channels (from
// the Color Format) followed by its Parameters. A `fixed` param keeps its default
// value; colour-kind params (dimmer/red/…) are driven by the sampled canvas colour.
export function fixtureTypeChannels(type) {
  const params = (Array.isArray(type?.params) ? type.params : []).map((p) =>
    (p.kind === 'fixed' ? { kind: 'fixed', value: clamp8(p.value ?? 0) } : { kind: p.kind }));
  return [...colorFormatChannels(type?.colorFormat), ...params];
}

// Resolve a profile + a sampled RGB (0..255) into the fixture's DMX channel bytes.
// `fixed` is an optional { channelIndex: value } override for `fixed` channels.
//   white  → pulls the shared min(r,g,b) into the W channel (standard RGBW).
//   amber  → rough warm pull min(r,g).
//   dimmer → carries brightness; colour channels normalise to full so that
//            dimmer × colour reconstructs the sampled colour (no double-dimming).
export function resolveDmxChannels(profile, rgb, fixed = {}) {
  const chans = profile?.channels || [];
  let r = clamp8(rgb?.[0] ?? 0), g = clamp8(rgb?.[1] ?? 0), b = clamp8(rgb?.[2] ?? 0);
  const has = (k) => chans.some((c) => c.kind === k);
  let w = 0, a = 0;
  if (has('white')) { w = Math.min(r, g, b); r -= w; g -= w; b -= w; }
  if (has('amber')) { a = Math.min(r, g); r -= a; g -= a; }
  let dim = 255;
  if (has('dimmer')) {
    dim = Math.max(r, g, b, w, a);
    if (dim > 0) { const s = 255 / dim; r *= s; g *= s; b *= s; w *= s; a *= s; }
  }
  const out = new Uint8Array(chans.length);
  for (let i = 0; i < chans.length; i++) {
    switch (chans[i].kind) {
      case 'red': out[i] = clamp8(r); break;
      case 'green': out[i] = clamp8(g); break;
      case 'blue': out[i] = clamp8(b); break;
      case 'white': out[i] = clamp8(w); break;
      case 'amber': out[i] = clamp8(a); break;
      case 'dimmer': out[i] = clamp8(dim); break;
      default: out[i] = clamp8(fixed[i] ?? chans[i].value ?? 0); break;   // 'fixed'
    }
  }
  return out;
}
