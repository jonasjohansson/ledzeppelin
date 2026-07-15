# The canvas: sources & effects

This is where you make the picture. Fixtures don't generate light on their own —
they **sample** a shared canvas, and everything in this page is about painting
that canvas: pick a source, shape it with parameters, stack effects, and make it
move. The mapping side (which pixels each fixture reads) lives in
[Mappings](08-mappings.md); see [concepts: pixel mapping](02-concepts.md) for the
big picture.

![The clip deck: one layer holding a grid of source clips, with the selected clip's source params, transform, and effect chain in the inspector.](img/canvas-clips.png)

## Where this lives in the window

The visual side of the app is spread across the **dock**:

- **Centre** — the **Stage** (the output canvas) sits above the **timeline
  island**, which holds the clip **deck**.
- **Left column** — an accordion whose **Composition**, **Layer** and **Clip**
  sections are the inspector for whatever you've selected (canvas size + tempo,
  layer blend, or the current clip's source params / transform / effects). One
  section is open at a time; click the open header again to fold the column shut.
- **Right column** — an accordion with a **Sources** section: the palette you
  pull generators from. (Its other sections, Output and Library, are the device
  side — see [Fixtures & the Library](05-fixtures-and-inventory.md).)

Everything is a top bar of icon buttons across the top of the window, not a
footer. The UI is dark, one fixed cyan accent — there's no theme or colour
picker to set.

## The composition and the canvas

The **composition** is the whole visual show: a canvas of a fixed pixel
resolution plus everything painted on it. **Title**, **BPM**, and canvas
**Width / Height** are one card at the top of the Composition section; fixtures
are placed in canvas pixel space, so the canvas size is the coordinate system
your whole rig lives in.

> Width and Height **commit when you blur the field or press Enter** — there is
> no Apply button. Resizing the canvas re-fits it to the stage automatically.

The composition holds **one layer**. This is a single-layer clip composer, not a
multi-layer VJ stack — you build looks by switching between clips and stacking
effects, not by piling up layers. (The model still stores a `layers` array of
length one so saved shows and the compositor keep working, and a layer's blend /
opacity / crossfade controls exist in the Layer section, but the everyday
workflow is one layer + a deck of clips.)

## The clip deck

The layer holds a **deck of clips** laid out as a grid. Each clip is one
**source** (a generator) plus its parameters plus an effect chain. Only one clip
is **active** (playing) at a time; switching clips crossfades over the layer's
transition time.

Two distinct interactions on a cell:

- **Click** a clip → *select* it. Selecting loads the clip into the Clip
  inspector (source params, transform, effects) without changing what's on the
  wall.
- **Double-click** a clip → *trigger* it. The compositor crossfades to that
  clip's source and marks it active.

A trailing **empty cell with a `+`** always sits at the end of the deck, and a
clip's cell shows badges at a glance: **⚡** (triggerable), **3D** (volumetric),
**fx** (carries effects), and **T / A / E** for parameters driven by the
timeline / audio / an external channel.

### Add a clip

Sources come from the **Sources palette** in the right column — the palette *is*
the source browser; there's no separate popup.

- **Click the deck's `+` cell** → the right column reveals the **Sources**
  section. Then **click a source card** to add it as a new clip on the layer, or…
- **Drag a source card onto the deck.** Dropping on the `+` cell (or an empty
  slot) makes a new clip in that slot; dropping onto an **existing** clip
  *replaces* that clip's source while keeping its slot.
- **Drag a clip between cells** to reorder it within the deck.

The palette is a compact **card grid** grouped into three families, each colour-
tagged, with a **description line** at the bottom that updates as you hover a
card:

- **2D** — the canvas generators (below), plus a **Video…** card at the end that
  loads a video file as a clip.
- **3D** — the volumetric field sources ([below](#volumetric-sources)).
- **Shaders** — any bundled ISF example shaders ([below](#isf-shaders)).

## Sources

Sources are the generators that draw the base image. The everyday 2D set:

| Source | What it draws |
| --- | --- |
| **Color** | Solid colour × brightness — the go-to wash. |
| **Gradient** | Two-stop colour ramp across the canvas at an angle. |
| **Lines** | Soft sweeping lines / bars (position, width, angle, speed, amplitude). |
| **Sine** | Scrolling sine bands with FM modulation, scroll speed, and crest sharpening. |
| **Grid** | Cols × rows cells outlined by lines — align fixtures to a known grid. |
| **Checkered** | Alternating black/white cells (cols × rows) — the go-to pattern for verifying the fixture mapping over the install. |
| **Pulse** | A *triggerable* radial burst: a head of light leaving a decaying trail. Fire it with the ⚡ button, or enable autoFire to loop. |
| **Radial** | A *triggerable* ring/gradient expanding from the centre (the in-the-round twin of Pulse). |
| **Noise** | Animated fbm value noise (clouds), mapped between two colours. |
| **Spectrum** | **Audio** spectrum bars — the live audio input drawn as a bar graph. |

Beyond these, the **2D** palette also carries a set of **shader generators**
(Domain Warp, Metaballs, Plasma, Tunnel) and a large **WLED-style effect pack**
(Running, Chase, Larson, Comet, Color Wipe, Sinelon, Rainbow / Rainbow Cycle,
Color Waves, Breathe, Theater, Starfield, Twinkle / Twinklefox / Color Twinkles,
Sparkle, Glitter, Fire 2012, Candle, Fire Flicker, Lightning, Pride 2015,
Matrix, Ripple, and more) — the familiar strip animations, ported to the canvas.
Hover any card to read its one-line description.

Each source exposes its own parameters in the inspector's **Source** section,
auto-generated from the shader manifest (sliders for numbers, a colour well for
colours, a segmented toggle for booleans). Right-click a slider to reset it to
default; the **↺** in the section header resets all source params at once.
`speed`-type sliders are symmetric — drag past 0 to run the motion backwards.

**Triggerable** sources (Pulse, Radial, and the triggerable fields) show a ⚡
badge on their clip thumbnail and a prominent **⚡ trigger** button in the Clip
inspector — press it to fire a beam / ring / shell. The Clip inspector's **audio
trigger** section can fire it automatically instead: **Onset** (a spike above the
running average), **Level** (band over a draggable line on the spectrum), or
**BPM** (the tempo grid).

On a **multi-channel audio interface** (e.g. a Behringer Flow 8 with a mic per
USB channel) the trigger's **Input** selector picks *which channel* it listens
to — **Mix** (default) or **Ch 1…N** — so different mics fire different clips:
mic 1 launches a Sphere Pulse while mic 3 drives a Shockwave, each with its own
Band/Threshold/Hold. Pick the interface under **Settings › Audio › Input**,
enable the mic once (any clip's trigger section), and the channels appear. The
browser's speech processing is switched off on capture, so a mixer feed arrives
clean and channel-separated.

### Volumetric sources

The palette's **3D** group holds sources that don't draw on the canvas at all —
they're **fields** evaluated at each LED's world position (x, y across the
canvas, z = height off the canvas plane) in the sampler pass, then blended onto
the sampled colour with the clip's opacity:

| Source | What it lights |
| --- | --- |
| **Plane Sweep** | A coloured band around a plane ⊥ a chosen axis at `pos` — animate `pos` on z and the band climbs a standing arch. |
| **Plane Pulse** | *Triggerable* planes sweeping outward per fire. |
| **Axis Gradient** | A two-colour ramp along a world axis, scrollable (wraps). |
| **Body Wave** | A travelling sine wave running along an axis of the rig. |
| **Noise 3D** | fbm value noise in space — give it a **drift** (axis + speed) and the volume flows along x/y/z; drift on z climbs a standing arch. |
| **Flow Field** | Curl-noise filaments streaming on the wind. |
| **Caustics** | Dancing underwater caustic light — rippling veins. |
| **Aurora** | Drifting northern-lights curtains. |
| **Pacifica** | A calm luminous ocean — layered swells with occasional crests. |
| **Sphere Pulse** | *Triggerable* — each ⚡ fires an expanding spherical shell from a point in space. |
| **Shockwave (3D)** | *Triggerable* concentric shells bursting per fire. |
| **Audio Bars** | Audio → fixtures: each fixture pulses with its own frequency band. |

They live in the deck like any clip (same triggering, params, animation,
MIDI/OSC mapping) and show a **3D** badge on their thumbnail. Honest limits:

- At most **4** volumetric clips can be **active** at once (extras are ignored).
- A volumetric clip has **no per-clip effect chain** — its inspector shows only a
  **Blend** section (an animatable opacity). Colour-grade a field by putting a
  colour effect on the **layer** chain instead; those reach the layer's 3D clips.
- They switch **instantly** (no crossfade).
- The `axis` param is numeric: **0 = x, 1 = y, 2 = z**.

The volumetric fields span the **full rig height** — each LED's z is rescaled so
the tallest fixture point sits at z = 1. That means a z-axis sweep or drift
climbs the whole rig rather than petering out partway up a tall, narrow set of
arches. (In a 2D show every LED sits at z = 0, so a z-plane field acts as a
global fade as it crosses 0, while x/y fields still sweep across the rig —
coherent, not a bug.)

The flat 2D stage shows **no** volumetric contribution (correct — it isn't on the
canvas); the **3D viewport** (the `mode3d` toggle) and the wall **Preview** are
where fields read. In the 3D viewport each active field also draws a schematic
**ghost** in its clip's colour — a translucent plane, a gradient arrow,
wireframe sphere rings, or a sparse noise lattice — so you can see *where* the
field sits in space even where no LED catches it. The footer's **Fields** icon
(3D only) toggles the ghosts; the **⟲** reset-view icon next to it returns the orbit
to home (angle, zoom, centre). 3D always samples through a fixed front-ortho camera —
there are no projection presets to choose.

The top bar's **Outlines** toggle (dashed-frame icon, next to the fixture-tint
button) hides the fixture outline strokes in both the 2D stage and the 3D
viewport — off gives a light-only view where the lit cells/dots carry the whole
scene (the selected fixture keeps its handles so it stays editable).

### ISF shaders

Beyond the built-ins, LED Zeppelin runs **ISF** shaders (the Interactive Shader
Format). Two ways to add one:

- **From the palette** — pick an entry under the Sources palette's **Shaders**
  group to import a bundled example as a clip.
- **By drag-and-drop** — drag an `.fs`, `.isf`, `.frag`, or `.glsl` file onto the
  window. A *generator* shader is imported as a **new generator clip**, landing
  on the deck cell under the cursor (drop near a clip to control where it goes).
  A *filter* shader (one that samples an input image) is instead appended as an
  **effect** on the clip under the drop.

ISF inputs become editable parameters in the **Source** section, just like the
built-ins — floats, integers, booleans, and colours get rows; an `image` input
gets a file picker for a texture.

## Effects

Effects process the image after the source. Each clip has its own **effect
chain** in the inspector's **Effects** section; effects run top to bottom.

- **Add** — click the **`+`** at the bottom of the Effects section to open the
  effect picker (a small grid popover anchored to the button), then pick one.
- **Reorder** — drag an effect block's header up/down within the chain.
- **Select / delete** — click an effect's header to select it (Backspace deletes
  the selected effect), or use the **✕** in its header menu.
- **Presets** — each effect (and each source) header carries a small menu: save
  the current params as a named preset (**⤓**), load one (**▾**), and reset (**↺**).

The built-in effects:

| Effect | Does |
| --- | --- |
| **Displace** | Horizontal noise displacement. |
| **Repeat** | Tile the image horizontally. |
| **Strobe** | Gate the image on/off at a rate. |
| **Trails** | Bright pixels leave decaying streaks (feedback). |
| **Feedback** | Zoom/rotate the faded last frame — infinite-tunnel / droste motion. |
| **Blur** | Soften the image. |
| **Segmenter** | Split an axis into N segments, pass only a chosen range. Maps content to physical column groups. |
| **Cascade** | Split into N bands and time-delay each along travel — a staircase cascade (the in-visual twin of fixture chains). |
| **Shockwave** | A *triggerable* ripple that distorts the image from a point per fire. |
| **Bass Warp** | Warps the image driven by the low end of the audio input. |
| **Hue** | Rotate hue (static shift and/or auto-cycle). |
| **Adjustments** | Bundled gamma → brightness → contrast → saturation grade. |
| **Invert / RGB / Threshold** | Per-channel and luminance grades. |
| **Colorize** | Tint any grayscale source between two colours. |

There are also **layer** and **composition** effect chains for effects that
should apply to the whole layer or the final composite (in the Layer and
Composition sections). The per-clip chain is where most work happens; the layer
chain is also how you colour-grade **volumetric** clips (which have no per-clip
chain of their own).

## Parameter modulation

Almost any numeric parameter can be **modulated** instead of held static. Each
such row has a **cog (⚙)**: click it (or the parameter name) and a small mode
picker flies out beside the sidebar, level with the row (the cog, `Esc`, or a
click elsewhere closes it). The modes:

- **Basic** — hold a single value (the plain slider), or sweep between an **in**
  and **out** value on a dual-handle range track.
- **Timeline** — an LFO across the clip: a base waveform (saw / sine / square /
  random sample-and-hold / smooth noise), with independent **reverse** and
  **bounce** (ping-pong) toggles. Duration is free **seconds** or **beat-synced**
  to the composition tempo (the `s`/♪ unit toggle); beat-synced loops show their
  beat grid as ticks on the track.
- **Dashboard** — follow one of the global **Dashboard** link knobs (a 4×4 grid in
  the Composition inspector). One knob can drive many params at once; **invert**
  flips the mapping.
- **Audio Ext.** / **Audio Comp.** — follow a frequency **band** of a hardware
  audio input, or of the composition's own clip audio. Pick the band and a gain.

When a param is animated, the row becomes an in/out range track with a live
marker that the render loop slides along, plus a live numeric readout. Grab a
track handle to type an exact in/out value. The clip thumbnail shows small badges
— **T** (a param runs on the timeline), **A** (follows audio), **E** (follows an
external channel) — so the deck tells you at a glance which clips are driven.

### External control (OSC / MIDI)

Any routable parameter can be driven from **outside** the app. Rather than a
dedicated menu entry, you bind a param to an incoming OSC/MIDI channel in
**Mapping** (the top bar's mapping button — see [Mappings](08-mappings.md)); the
cog picker additionally lets you publish a parameter to the phone Companion /
Control surface. Each routable param carries a canonical OSC address you can copy.

## Preview: seeing what the wall samples

The top bar's **Preview** button (the wall icon) flips the canvas into wall view:
it **dims the canvas** and lights only the pixels each fixture actually samples,
at full strength. Where the visuals cross a fixture, that fixture's LEDs glow;
everywhere else stays dark context. It's the honest answer to "what will the
install look like?" — only the sampled pixels, nothing else.

![Preview (wall) view: the canvas dims and only each fixture's sampled pixels light up.](img/output-preview.png)

Preview is CSS-only over the live composite, so it never changes what's actually
output — it just changes what *you* see. With no fixtures placed there's nothing
to light, so the dim is skipped until at least one fixture exists.

## How fixtures sample the canvas

A **fixture** is a light shape positioned in canvas pixel space (x / y / w / h /
rotation). Its pixels are points laid along that shape, and each frame every
fixture **reads the colour of the canvas at its points** — that sampled colour is
what gets sent to the device. Nothing about a source or effect targets a specific
fixture; you paint the canvas, fixtures read whatever crosses them. Move a fixture
and it samples a different region; change the visuals and every fixture follows.
(A fixture point that falls **off** the canvas reads black, and volumetric fields
still light LEDs that sit off-canvas, since fields live in world space.)

Use **Checkered** or **Grid** as a source and **Preview** together to verify the
mapping over the whole rig before you commit a look.

## Saving and loading visuals

There is no Import button for visuals — bring things in by **dragging files onto
the window**:

- an **ISF shader** (`.fs` / `.isf` / `.frag` / `.glsl`) → a new generator clip
  (or, for a filter shader, an effect on the clip under the drop);
- a **LED Zeppelin project** `.json` (has both fixtures and a composition) → loads
  the whole show (rig + visuals);
- a **composition** `.json` → loads the visuals only;
- an **`.obj`** model → imports a whole rig + a starter show (see
  [Importing from LEDger](09-importing-from-ledger.md));
- a **LEDger preset** `.json` → you'll be told to bring it in via the top bar's
  **Import from LEDger…** button (see [Importing from LEDger](09-importing-from-ledger.md)).

To save the whole project, use **⌘S**; **⌘O** opens one (or just drop a `.json`
onto the window). Project New/Open/Save live on the top bar, not in Settings.

_See also: [Concepts: pixel mapping](02-concepts.md) · [Fixtures & the Library](05-fixtures-and-inventory.md) · [Mappings](08-mappings.md) · [Scenes](07-scenes.md) · [Importing from LEDger](09-importing-from-ledger.md) · [Output & calibration](10-output-and-calibration.md)._
