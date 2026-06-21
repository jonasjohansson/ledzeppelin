// Traditional DMX fixtures (pars + generic channel fixtures). A fixture is a
// PROFILE (an ordered channel layout) patched to an Art-Net universe + start
// address; it samples the canvas at its position and that colour drives its colour
// channels, while `fixed` channels carry a set value. Pure + unit-tested — see
// docs/dmx-fixtures.md for the design.

// Channel kinds. Colour kinds (red/green/blue/white/amber) are driven by the sampled
// canvas colour; `dimmer` carries brightness; the rest (uv/strobe/fixed) are manual
// channels — a per-fixture fader (default value), optionally layer-bound.
export const DMX_CHANNEL_KINDS = ['dimmer', 'red', 'green', 'blue', 'white', 'amber', 'uv', 'strobe', 'fixed'];
// Colour kinds come from the canvas; everything else is a manually controllable channel.
export const DMX_COLOUR_KINDS = new Set(['red', 'green', 'blue', 'white', 'amber']);
// Human labels for the kind dropdowns (lowercase keys are the stored values).
export const DMX_KIND_LABELS = { dimmer: 'Dimmer', red: 'Red', green: 'Green', blue: 'Blue', white: 'White', amber: 'Amber', uv: 'UV', strobe: 'Strobe', fixed: 'Fixed' };
export const dmxKindOptions = () => DMX_CHANNEL_KINDS.map((k) => ({ value: k, label: DMX_KIND_LABELS[k] || k }));
// Infer a channel's function from its name: standard colour / control names map to
// their kind (Red→red, UV→uv, Dimming→dimmer…); anything else is a manual `fixed`
// channel. Lets the channel editor be a single name field per channel.
const NAME_TO_KIND = { red: 'red', green: 'green', blue: 'blue', white: 'white', amber: 'amber', uv: 'uv', dimmer: 'dimmer', dimming: 'dimmer', strobe: 'strobe' };
export const kindFromName = (name) => NAME_TO_KIND[String(name || '').trim().toLowerCase()] || 'fixed';

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

// Ordered colour channels for a Color Format string; '' (inherit) defaults to RGB,
// 'NONE' yields no colour channels (a params-only fixture, e.g. a Dimmer or Generic).
export function colorFormatChannels(fmt) {
  const s = String(fmt || '');
  if (s.toUpperCase() === 'NONE') return [];
  const out = [];
  for (const ch of s.toLowerCase()) {
    const k = FORMAT_KIND[ch];
    if (k) out.push({ kind: k });
  }
  return out.length ? out : [{ kind: 'red' }, { kind: 'green' }, { kind: 'blue' }];
}

// The full DMX channel-block for a unified fixture type: Parameters marked `before`
// the pixel block, then the colour channels (from the Color Format), then the rest of
// the Parameters. Order is exact — DMX addressing depends on it (e.g. a master Dimmer
// + Strobe ahead of RGBWA, with UV after). A `fixed` param keeps its default value;
// colour-kind params (dimmer/red/…) are driven by the sampled canvas colour.
export function fixtureTypeChannels(type) {
  // DMX-profile mode: an explicit ordered channel list is the source of truth.
  if (Array.isArray(type?.channels) && type.channels.length) {
    return type.channels.map((c) => ({ kind: c.kind, value: clamp8(c.value ?? 0), ...(c.name ? { name: c.name } : {}) }));
  }
  // Pixel mode: colour channels from the Color Format, with named Parameters around.
  const all = Array.isArray(type?.params) ? type.params : [];
  const toCh = (p) => ({ kind: p.kind, value: clamp8(p.value ?? 0), ...(p.name ? { name: p.name } : {}) });
  const before = all.filter((p) => p.before).map(toCh);
  const after = all.filter((p) => !p.before).map(toCh);
  return [...before, ...colorFormatChannels(type?.colorFormat), ...after];
}

// --- Parameters: NAME + channel COUNT ---------------------------------------
// A DMX fixture is a list of PARAMETERS, each a NAME + a channel COUNT. The name
// decides behaviour: a colour name (RGB/RGBW/RGBWA/RGBA) → a canvas-sampled colour
// block; a known function (Dimmer/Strobe/UV/White/Amber/Red/Green/Blue) → a 1-channel
// control; anything else → `count` manual channels. Flat `channels` is the expansion.
const FORMAT_KINDS = {
  RGB: ['red', 'green', 'blue'], RGBW: ['red', 'green', 'blue', 'white'],
  RGBWA: ['red', 'green', 'blue', 'white', 'amber'], RGBA: ['red', 'green', 'blue', 'amber'],
};
const COLOUR_NAME_FMT = { rgb: 'RGB', rgbw: 'RGBW', rgbwa: 'RGBWA', rgba: 'RGBA' };
const SINGLE_NAME_KIND = { dimmer: 'dimmer', dimming: 'dimmer', strobe: 'strobe', uv: 'uv', white: 'white', amber: 'amber', red: 'red', green: 'green', blue: 'blue' };
export const isColourParam = (name) => !!COLOUR_NAME_FMT[String(name || '').trim().toLowerCase()];
// A fixture TYPE is a DMX fixture (channel layout) vs a pixel strip/matrix (W×H +
// Color Format). Every placed instance's output kind follows this — a pixel strip is
// never a DMX fixture, a DMX type's instances always are.
export const isDmxType = (t) =>
  (Array.isArray(t?.params) && t.params.some((p) => p && p.count != null)) ||
  (Array.isArray(t?.channels) && t.channels.length > 0);
// The channel kinds a parameter expands to, from its name (+ count for generic).
export function paramKinds(name, count) {
  const lc = String(name || '').trim().toLowerCase();
  if (COLOUR_NAME_FMT[lc]) return FORMAT_KINDS[COLOUR_NAME_FMT[lc]];
  if (SINGLE_NAME_KIND[lc]) return [SINGLE_NAME_KIND[lc]];
  return Array(Math.max(1, Math.round(Number(count) || 1))).fill('fixed');
}
export const paramSpan = (p) => paramKinds(p?.name, p?.count).length;

// Expand a param list → flat channels (the runtime/output truth).
export function paramsToChannels(params) {
  const out = [];
  for (const p of (Array.isArray(params) ? params : [])) {
    const kinds = paramKinds(p.name, p.count);
    if (kinds.length === 1) { out.push({ kind: kinds[0], name: p.name || DMX_KIND_LABELS[kinds[0]] || kinds[0], value: clamp8(p.value ?? 0) }); continue; }
    const colour = isColourParam(p.name);
    kinds.forEach((k, j) => out.push({ kind: k, name: colour ? (DMX_KIND_LABELS[k] || k) : `${p.name} ${j + 1}` }));
  }
  return out;
}

// Group a flat channel list → params (migrate/display a legacy flat fixture): a run
// of red,green,blue(+white)(+amber) collapses into one colour param named by format.
export function channelsToParams(channels) {
  const cs = Array.isArray(channels) ? channels : []; const out = []; let i = 0;
  const k = (j) => cs[j]?.kind;
  while (i < cs.length) {
    if (k(i) === 'red' && k(i + 1) === 'green' && k(i + 2) === 'blue') {
      if (k(i + 3) === 'white' && k(i + 4) === 'amber') { out.push({ name: 'RGBWA', count: 5 }); i += 5; continue; }
      if (k(i + 3) === 'white') { out.push({ name: 'RGBW', count: 4 }); i += 4; continue; }
      if (k(i + 3) === 'amber') { out.push({ name: 'RGBA', count: 4 }); i += 4; continue; }
      out.push({ name: 'RGB', count: 3 }); i += 3; continue;
    }
    const c = cs[i]; out.push({ name: c.name || DMX_KIND_LABELS[c.kind] || c.kind, count: 1, value: c.value }); i++;
  }
  return out;
}

// The manually controllable channels of a type (everything that isn't a sampled
// colour) with their channel index, kind, name + default — drives the per-fixture
// faders and layer-binding pickers. Works for both DMX-profile and pixel+params types.
const KIND_LABEL = { dimmer: 'Dimmer', uv: 'UV', strobe: 'Strobe', fixed: 'Fixed' };
export function fixtureControlChannels(type) {
  return fixtureTypeChannels(type)
    .map((c, index) => ({ index, kind: c.kind, value: c.value ?? 0, name: c.name || KIND_LABEL[c.kind] || c.kind }))
    .filter((c) => !DMX_COLOUR_KINDS.has(c.kind));
}

// For each of a type's Parameters (in declaration order), its channel index within
// the resolved block — so a named per-fixture fader can target the right channel.
// Layout: [before-params…, colour channels, after-params…].
export function fixtureParamChannelIndices(type) {
  const all = Array.isArray(type?.params) ? type.params : [];
  const nColour = colorFormatChannels(type?.colorFormat).length;
  const idx = new Array(all.length);
  let b = 0;
  all.forEach((p, i) => { if (p.before) idx[i] = b++; });
  const afterBase = b + nColour;
  let a = 0;
  all.forEach((p, i) => { if (!p.before) idx[i] = afterBase + a++; });
  return idx;
}

// Resolve a profile + a sampled RGB (0..255) into the fixture's DMX channel bytes.
// `fixed` is an optional { channelIndex: value } override map. It overrides the
// 'fixed' channel default AND can manually drive ANY channel (a named per-fixture
// fader, e.g. a master Dimmer or UV), winning over the sampled/computed value.
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
      default: out[i] = clamp8(chans[i].value ?? 0); break;   // 'fixed'
    }
  }
  // Explicit overrides win for ANY channel (manual faders / layer-bound params).
  for (const k in fixed) {
    const i = +k;
    if (Number.isInteger(i) && i >= 0 && i < out.length && fixed[k] != null) out[i] = clamp8(fixed[k]);
  }
  return out;
}
