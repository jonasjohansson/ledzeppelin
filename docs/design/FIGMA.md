# Led Zeppelin — Figma UI Kit

Native Figma component library, **authored directly from `src/ui/ui.css`** via the
Figma Dev Mode MCP (write-to-canvas) — not an html.to.design import. Every fill,
stroke, and text colour is a live Variable binding; type is Spline Sans Mono.

**File:** https://www.figma.com/design/stY4vK2oHvazhcNIbYcm17  (Jonas's drafts, "Led Zeppelin — UI Kit")

## Foundations (Variables + styles, from `tokens.json`)
- **Color** — 16 vars (surface / line / text / accent / status), scoped, with `var(--…)` Dev Mode code syntax
- **Spacing** — s1–s5 · **Radius** — radius, radius-sm · **Layout** — side-w, row-h, ctrl-h, columns…
- **Typography** — font-size vars (micro→glyph) + 5 text styles

## Components (one page per family)
- **Buttons** — Button (ghost: Default/Active/Disabled), Base, Primary (Default/Hover), Segmented, Header Toggle (Off/On), TAP
- **Tabs** — Section Tab, Sub Tab, Workspace Tab, Tab Dot
- **Fields** — Text, Number, Select, Checkbox, Color, Badge, OSC Address
- **Param Rows** — Slider, Bool, Brightness, Dual-handle Range
- **Cards** — Collapsible Section, Chain, Control Layer, Companion Header
- **Lists & Status** — Output Row (Default/Selected), Device Dot (4 states), HUD, Controller Group, Patch Bar, Stat List
- **Menus** — Dropdown Popover, Shortcuts Card

## Regenerating / extending
Built with the Figma MCP `figma-generate-library` + `figma-use` skills. To add a
component, author it on its family page bound to the existing Variables. Keep the
gallery (`design/index.html`) and `tokens.json` in sync with `ui.css` as the spec.

## Next steps (not yet done)
- **Code Connect** — map each component back to its `src/ui/` selector so Dev Mode
  emits the real ledzeppelin classes (closes the round-trip + seeds future sites).
- **Publish as a library** — Assets → Publish, to reference in new design files.
