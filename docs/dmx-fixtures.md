# DMX fixtures

Bring traditional DMX fixtures (RGB/RGBW/RGBA pars + generic channel fixtures)
alongside the existing pixel strips. Decisions (v1): canvas-sampled colour, Art-Net
output, a built-in profile library plus a generic channel editor.

## The model

A DMX fixture = a **profile** (an ordered channel layout) patched to an Art-Net
device at a **universe + start address**. It samples the canvas at its position (one
point, like a 1-pixel fixture) and that colour drives its colour channels; other
channels carry a fixed value.

Channel kinds: `dimmer`, `red`, `green`, `blue`, `white`, `amber`, `fixed`.

Built-in profiles: Dimmer (1ch), RGB par (3), RGBW par (4), RGBA par (4), plus a
**Generic** the user lays out channel-by-channel in the Inventory editor.

### Colour → channels (`resolveDmxChannels(profile, rgb, fixed)`, pure + tested)

From the sampled `rgb`:
- **white** present → `w = min(r,g,b)`, subtract it from r/g/b (standard RGBW pull).
- **amber** present → rough warm pull `a = min(r, g)`, subtract from r/g.
- **dimmer** present → `dim = max(r,g,b)`; colour channels are normalised to full so
  `dimmer x colour` reconstructs the original (no double-dimming). No dimmer → the
  colour channels carry brightness directly.
- **fixed** → the channel's set value (slider, 0..255), default 0.

## Pipeline (editor)

DMX fixtures each contribute ONE sample UV (their centre) to `sampleUVs`, so they
get a colour from the same GPU sample pass. `buildPipelineInputs` adds a `dmx` list
per Art-Net device: `[{ colourIndex, universe, address, channels }]` where
`colourIndex` points at the fixture's RGB in the frame buffer and `channels` is the
resolved layout (kinds + fixed values).

## Output (daemon)

A new Art-Net path: keep a 512-byte buffer per touched universe, write each DMX
fixture's resolved channels at `address-1`, send one ArtDmx per universe (honouring
ArtSync). Distinct from the pixel-strip packer, which chunks contiguous pixels.

## UI

- **Inventory:** DMX profiles (built-ins + a generic channel-layout editor).
- **Patch:** place a DMX fixture, set its Art-Net universe + start address.
- **#side-2 editor:** position, colour mode, and a slider per `fixed` channel.
- **Canvas:** a marker at the sample point (reuses the fixture overlay).

## Phases

1. **Model** (`src/model/dmx.js`, pure + unit-tested): channel kinds, built-in
   profiles, `resolveDmxChannels`. ← start here
2. **Daemon** Art-Net DMX output (universe buffers at address).
3. **Pipeline** wiring (sample DMX fixtures, build the `dmx` route).
4. **UI** (inventory profiles + generic editor, universe/address patch, editor).
5. **Preview** marker.

Not in v1: pan/tilt + moving-head effect channels, per-frame control automation,
sACN, GDTF/QLC+ import.
