# Capturing LED Zeppelin into Figma (html.to.design)

This folder is the **capture source** for turning the LED Zeppelin UI into a Figma
component library. Capture **this gallery**, not the live app — the app builds
components with JS and hides them behind tabs (Design / Output / System) plus three
WebGL/SVG canvases, so a live capture would be partial and flattened. The gallery
renders every primitive flat, visible, and styled by the real `src/ui/ui.css`.

## What's here
- `index.html` — flat catalog: every UI primitive in its states, one specimen frame each.
- `tokens.json` — the `:root` design tokens, grouped for Figma Variable collections.
- `CAPTURE.md` — this guide.

## 1. Serve it
The gallery loads `../src/ui/ui.css` and `../fonts/*.woff2` by relative path, so serve
the repo (don't open `file://` — relative fetches and fonts break there).

- Local server is already running: **http://localhost/org/jonasjohansson/ledzeppelin/design/**
- Or from the repo root: `python3 -m http.server 8080` → http://localhost:8080/design/

Confirm it renders: dark page, warm-orange accents, mono type, swatches at top.

## 2. Capture with html.to.design
Two routes — the **extension** is preferred (captures the real rendered DOM + fonts):

1. Install the html.to.design **browser extension** + the **Figma plugin**.
2. Open the gallery URL above. Wait for fonts to load (swatches + type specimens visible).
3. Run the extension → choose **viewport 1280** (the page is authored at width 1280),
   single theme (the app is dark-only). Click **Capture**.
   - For privacy / offline: download as a local **`.h2d`** file instead of sending to cloud.
4. In Figma, open the **html.to.design plugin** → Extension tab (or drop the `.h2d`).
5. Import settings: enable **layout/auto-layout** if offered; **map fonts** (see below).

## 3. Font mapping (important)
The UI is **mono-forward**: one self-hosted face, `Spline Sans Mono` (alt: `Martian Mono`).
These are local `.woff2` files, so the plugin will flag them as missing fonts. Map them:

- `Spline Sans Mono` → **Spline Sans Mono** (free on Google Fonts; add to Figma if absent),
  or fall back to any Figma mono (`Roboto Mono`, `JetBrains Mono`) if you just want layout.
- Keep weights to **300–700**, single weight in practice (`--fw-med` = 400, no bold).

## 4. After import — build the system in Figma
The capture gives you styled layers; turn them into a real library:

1. **Variables first.** Create Variable collections matching `tokens.json`:
   Color (surface / line / text / accent / status), Spacing, Radius, Typography, Layout.
   Bind imported fills/spacing to these so the library is themeable (e.g. swap the warm
   accent in one place). The CSS already centralizes all of this, so it's a 1:1 map.
2. **Components.** Promote each specimen frame to a component:
   tabs (section / sub / workspace), buttons (base / ghost / primary / segmented / toggle),
   fields (text / number / select / color / checkbox), param rows (slider / bool / brightness /
   dual-handle), cards (section / chain / control-layer), list rows + status dots, menus, HUD.
3. **Variants.** Fold states into one component with variants:
   button = {default, active, disabled}; tab = {default, active}; row = {default, animated, audio};
   dot = {online, offline, checking, no-ip}.
4. **Code Connect (optional, high value).** Map each Figma component back to its real
   selector/markup in `src/ui/` so Figma's Dev Mode MCP emits *your* classes, not generic
   markup — that closes the round-trip back into this site and seeds future sites.

## 5. Keeping it in sync
`tokens.json` and this gallery are **mirrors of `ui.css`** — if you change a token or add a
component, update them here so the next capture stays faithful. The gallery reads colors,
type sizes, and spacing live via `getComputedStyle`, so those self-update; only new
*components* need a new specimen frame added to `index.html`.
