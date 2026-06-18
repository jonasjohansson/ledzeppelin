# Unified fixtures (Resolume model)

There is no "LED fixture" vs "DMX fixture" — there is just a **fixture**, defined by
its **channel layout**. A fixture definition is:

- a **pixel block** — Width × Height + Color Format (these are channels 1..N), plus
- optional **Parameters** — extra named channels appended after the pixels
  (dimmer, strobe, pan, tilt, gobo…), each with a kind + default value.

So: an RGB par = `1×1 RGB`; an RGBW par = `1×1 RGBW`; a strip = `N×1`; a matrix =
`W×H`; a moving head = `1×1 RGB + pan/tilt/gobo params`; a generic bar = `1×1` +
however many params. The strip/matrix split is already gone in our model (a strip is
`rows=1, cols=pixelCount`); Parameters complete the unification.

A placed fixture's full channel block = its pixels (sampled from the canvas, in
Color Format order) followed by its parameter channels (fixed value, later
automatable). Output goes to Art-Net at the fixture's universe + start address; a
pure-pixel fixture with no params can still stream DDP (WLED) as today.

## What we keep

- The W×H + Color Format model on `fixtureTypes` (already there: `cols`, `rows`,
  `colorFormat`).
- The Art-Net channel maths already built for DMX: `resolveDmxChannels` (colour →
  channel bytes) and `packDmxUniverses` (channels → universe at address) generalise
  to "pixels + params".

## What changes

- `fixtureTypes` gain `params: [{ name, kind, value }]` (extra channels).
- The Inventory fixture editor gains a **Parameters** list (add / name / kind /
  default / remove) — like Resolume's "+ parameter".
- A fixture can patch to a **universe + start address** (channel layout), not only a
  sequential pixel offset. Its output = pixels then params at that address.
- The standalone "DMX profile" / "+ DMX" path folds in: a DMX par is just a small
  fixture type. `src/model/dmx.js` becomes the channel-kind + resolution helpers.

## Phases

1. ✅ **Model** — `params` on fixture types (`makeFixtureType`/`normFixtureType`),
   pure + tested (show.test.js).
2. ✅ **Inventory editor** — a Parameters list on the fixture-type editor (name +
   kind + default-value for `fixed`, add/remove). `typeDetail` in `src/ui/fixtures.js`.
3. ✅ **Output (channel-block path)** — `colorFormatChannels`/`fixtureTypeChannels`
   in `dmx.js` turn a unified type into an ordered channel-block (colour channels
   from the Color Format + params); `convertFixture` (LED → DMX) derives a fixture's
   DMX channels from its TYPE, so params reach Art-Net output at a universe/address.
   Per-fixture `fixed` sliders already exist in the DMX editor. NOTE: params are
   carried on the DMX/channel-block output path only — appending params AFTER the
   pixels in the contiguous DDP/Art-Net pixel STREAM (multi-pixel fixtures) is still
   open (needs the per-fixture patch from Phase 4).
4. **Patch** — universe + start address on fixtures (reconcile with the existing
   pixelOffset/DDP path).
5. **Fold in** the separate DMX fixture/profile concept (a par = a 1×1 fixture type).

Not yet: per-frame parameter automation (pan/tilt LFOs), sACN, GDTF/QLC+ import.
