# Design language

How ledzeppelin's UI stays consistent, and how to add features fast. Distilled from
a three-part audit (components, tokens, architecture).

## Principles

- **One weight, never bold.** `--fw-reg` / `--fw-med` are both `400`. No `600`/`700`/`bold`.
- **Gapless mosaic.** Tiles butt together with 1px hairline seams. No floating gaps,
  no rounded-card notches, no outer borders on tiled lists. Selection is a FILLED
  accent highlight, never an outline.
- **One accent.** Warm orange (`--accent`); `--green`/`--amber`/`--cyan` alias it.
- **Tokens own appearance, factories own class names.** Components never read CSS
  variables in JS and never hard-code a colour, size, or spacing. They emit a class;
  `ui.css` resolves the look. That single rule is what keeps the language consistent.

## Tokens (the source of truth, in `:root`)

The current set is good. Type scale `--fs-micro/body/ctrl/title/glyph` (10/11/12/13/15),
spacing `--s1..--s5` (2/4/6/10/14), `--radius`/`--radius-sm`, the surface ladder
(`--bg` → `--panel` → `--panel-2` → `--hover`, with `--field-bg` deliberately darker).

Worthwhile cleanups (curated, NOT a mass rewrite):
- Collapse the misleading `--fw-med` (it is 400) so there is one weight token.
- Tokenise the handful of hard-coded values that recur: canvas/video black (`#000`),
  the online green (`#57c98a` → a real `--success`, not the accent alias), the dark
  on-accent text (`#07151f`), the scrim (`rgba(0,0,0,.55)`).
- Add the missing spacing step `--s6: 8px` (it is hard-coded in ~50 places) and a
  small shadow set (`--shadow-pop`, `--shadow-modal`).
- DEFER mass-tokenising every gap/margin. Low value, large churn; do it opportunistically.

## Component kit

Framework-free. Lives in `src/ui/kit/` (one small file per component + an `index.js`
barrel). Each component is a pure factory `Name(primaryArg, value?, opts = {})` that
returns a DOM node, built on `el()` from `dom.js`. Handlers are always `on…`, called
with the semantic value (a number/string), never a raw event. State stays with the
caller (panels already rebuild from `getShow()` + `commit()`).

Initial set (highest call-site frequency / most duplicated today):
`Button({variant})`, `IconButton`, `Toggle`, `SegBtns`, `Tabs`, `Field`, `TextInput`
/`NumInput` (with `commit: 'live'|'release'`), `Select`, `Checkbox`, `Slider` (exists),
`Section` (exists), `ListRow`/`Badge`, and `Popover` → `Picker`/`Menu` (extract the
shared anchored-popup mechanic). ~13 factories, ~600 lines, no new dependency.

Why this helps: today a new settings row means re-spelling input classes + event
wiring (and risking the focus-loss footgun). With the kit it is two lines
(`Field('Max FPS', NumInput(v, {commit:'release', onInput}))`) that cannot produce the
wrong height, a stray gap, or bold text, because the factory targets the locked CSS.

## Phased plan (incremental, no big-bang)

- **Phase 0 (safe, zero behaviour change).** Create `src/ui/kit/`. Move `Slider`,
  `Section`, `field`+`selectInput` into it; leave one-line re-export shims at the old
  paths. Add the curated token cleanups + a `/* === KIT === */` band in `ui.css`.
- **Phase 1.** Extract the duplicated factories (`Button`, `Tabs`, `Field`/inputs,
  `ListRow`, `Popover`/`Picker`/`Menu`) and swap their definitions one file at a time,
  verifying visually. Biggest win: the popover mechanic (de-dupes the clamp + dismiss
  logic in `openPicker`/`animModeMenu`/`fxMenu`).
- **Phase 2.** Adopt-in-new-code rule: never write a fresh `el('button'…)`/`el('input'…)`
  in a panel again. Migrate old inline controls opportunistically when touched.
- **Phase 3 (optional).** Fold near-duplicate button CSS into the KIT band.

Each phase is independently shippable and observable. No framework, no build step.
