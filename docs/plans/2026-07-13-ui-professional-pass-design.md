# UI Professional Pass — design

**Goal:** Remove the "looks AI-generated" read from LED Zeppelin's UI while keeping its identity (near-black, monospace, hairline, square-corner, no floating glass). Move it toward the crafted density of Resolume / Notch / Ableton.

**Diagnosis (from a 4-lens audit):** the bones are right; the *execution rhythm* betrays it — inconsistency and default-y choices, not the concept.

**Locked decisions:**
- **Stay all-mono** — keep the monospace identity; de-AI via weight/casing/size, NOT by adding a sans.
- **Toolbar → floating island** over the top of the canvas/preview viewport (Resolume-style overlay).

## Prioritized changes

### Pass 1 — the de-AI core (CSS/palette, coherent, low-risk)
1. **Slider fill**: kill the full-height orange gradient block on every param row → a quiet dark well + thin (3px) accent fill line + a bright 2px value marker (adopt the existing `.range-track` idiom). `ui.css` `.ly-row input[type=range]`.
2. **Accent**: retune off the bootstrap 30°/73° orange → desaturated amber-gold `#d4a24a`; cut the 9-hue rainbow `ACCENT_PRESETS` to 4 curated/desaturated. `prefs.js` ACCENT_DEFAULT, `settings.js` ACCENT_PRESETS.
3. **Weight**: turn on a second weight (`--fw-med`) for section headers / active tab / modified label / readout — hierarchy without color.
4. **Casing**: stop uppercasing content (source/effect/clip names, menu items) — caps reserved for section-header eyebrows only.
5. **Contrast/grays** (follow-up within pass): lift `--bg` off pure black, ease `--text` off pure white; commit the cool-blue grays to one neutral/warm temperature (`palette.js` SURFACES + TEXT anchors).

### Pass 2 — structure & controls
6. **Sources as a name list** (drop the rainbow thumbnail wall — user directive).
7. **Toolbar floating island** over the canvas (user directive).
8. **Drag-to-scrub numbers** on `input.ly-readout` (`kit/slider.js`) — the biggest "instrument" lift; then hide the −/+ steppers, reveal the slider on row hover.
9. **One 4px spacing grid**: monotonic `--s*` scale, replace raw 3/5/7/10/14 pixels; one label-alignment model shared across param + fixture rows; tighter rows (`--row-h:22`); derived column widths; one 16:9 thumbnail; one source-browser component.
10. **Icon unification**: replace Unicode/CSS-shape glyphs (−, +, ✕, ▸, ⋯, ●) with the Pixelarticons sprite already loaded.
11. **Depth & states**: inset shadows on wells, subtle raise on buttons, real `:active` press + accent `:focus-visible`, one transition token.

**Already shipped (v1.0.487):** cog-on-hover, left-aligned param labels.

**Execution note:** implement by a single hand (not parallel agents) — inconsistency is the very tell we're removing. Verify each pass visually (Playwright screenshot) before deploying to the Pi / rebuilding the Mac app.
