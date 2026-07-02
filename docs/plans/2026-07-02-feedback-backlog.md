# Feedback backlog — 2026-07-02

24 feedback items triaged into actionables; ambiguous ones resolved by interview.
Decisions below are settled — implement as written.

## A · Quick wins (mechanical, one batch)

- **A1 (#23/#24) Rename:** "Devices" panel → **Output**; "Inventory" → **Library**. Everywhere: island title, tooltips, popout page title, guide pages, captions.
- **A2 (#12) Remove undo/redo icons** from the top bar (⌘Z/⇧⌘Z remain; keep the menu entries if any).
- **A3 (#15) Remove Save/Load from Settings** — the header has Save/Open.
- **A4 (#17) Tint icon → a color-palette glyph** (Pixelarticons style, inline symbol).
- **A5 (#18) New Library icon** — currently reuses `#ic-grid` (same as the Grid toggle). Draw a distinct symbol (e.g. shelf/box).
- **A6 (#8) Right-align parameter values** in editors (`.fx-field` inputs/selects: `text-align: right`).
- **A7 (#13) Duplicate naming:** copies get `Name 2`, `Name 3`… (find highest existing suffix), not "Copy copy copy". Applies to clips (and fixtures/devices if they share the pattern).
- **A8 (#21) Scan results formatting** — clean up the scan text/rows (alignment, spacing, truncation).
- **A9 (#2) Lines source: `Num Lines` param** (int, default 1, animatable like other shader params).

## B · Bugs (root-cause first — systematic-debugging)

- **B1 (#3) macOS app "Application Not Responding" in Dock.** Hypothesis: the compiled binary never pumps the macOS event loop / responds to Apple Events, so the Dock marks it stalled even though the server runs. Investigate the app wrapper (`scripts/build-macapp.sh` / launcher): likely needs `LSUIElement`/`LSBackgroundOnly` in Info.plist, or the launcher should `open` the browser and let a real minimal event loop own the app process.
- **B2 (#11) "Physical size" section swallows clicks** — clicking a parameter inside toggles the section closed. Stop propagation on the body / restrict the toggle to the header.
- **B3 (#20) Drag-drop fixture → device group broken.** This *was* wired (`assignFixturesTo` + drop-zones on `.out-group`). Likely a regression from the always-expanded `devSection` rework (drop handlers no longer attached to the new header/body). Reproduce, then fix.
- **B4 (#10) Click surfaces (interview: hit area too small + wrong thing selects).** Make the ENTIRE fixture row / controller header clickable (full-width hit area incl. badges); fix cases where clicking a fixture row selects the controller or clicks near badges do nothing.

## C · Decided design changes (from the interview)

- **C1 (#19) Templates stay standalone + explicit push.** Placed fixtures remain independent (KEEP this invariant). Add a **"push to placed fixtures"** action per template in the Library: updates spec fields (pixelCount, LEDs/m, length, DMX map…) on all placed instances of that template's typeId, repacks offsets, undoable in one step. Show a count ("update 12 placed fixtures").
- **C2 (#4/#6) Popups everywhere.** Library, Mapping, **and Settings** open as sized popup windows (`window.open` with width/height — minimal chrome; truly chromeless in the installed app). Settings gets a **top-left header button**; remove the Settings tab from the left island. Reverses the earlier tabs decision — intentional.
- **C3 (#14) Controller colors.** Each device gets a `color`; **auto-assigned from a distinct palette** (editable in the device editor). Shown as: (a) a **color dot** on controller headers + their fixture rows in the Output list; (b) the canvas **Tint mode uses the assigned color** (today it generates colors).
- **C4 (#1) Every source gets a Color param** — white-only generators (pulse, line, sine, checkers, grid, radial…) get a `color` input so no Colorize effect is needed. Default white; animatable/mappable like other params.
- **C5 (#5) Daemon icon removed; offline-only chip.** No permanent health icon. A small warning chip appears in the top bar ONLY when the daemon is down/unreachable (and in the installed app that basically never shows). Update guide (03/12 reference the "Daemon icon").
- **C6 (#7) Uppercase all UI chrome.** Global `text-transform: uppercase` on app-authored text (labels, buttons, params, menus, tabs, tooltips stay readable-case if needed). **User-entered names stay as typed.** System85 lowercase is the motivation.
- **C7 (#9) Source/effect picker: internal horizontal scroll** — keep the popover where it is; long option groups scroll-x inside it instead of overflowing.

## D · Bigger tracks

- **D1 (#22) HTTP control API on the daemon** (decided: REST/WS first, MCP wrapper later). Endpoints: list/select fixtures & devices, trigger clips, set params, blackout, scene recall, status. Document it; auth = local-only by default. Design doc before code.
- **D2 (#16) 3D mode** — Phase 1 merged (engine seam). Next: Phase 2 orbit viewport + 2D/3D toggle (prereqs recorded in `2026-07-01-3d-mapping.md`).

## Suggested order

1. **B batch** (bugs — B2/B3/B4 quick, B1 investigate) → release.
2. **A batch** (quick wins incl. renames) → release.
3. **C batch** (C7, C5, C6, C4 are small; C1/C2/C3 medium) → release.
4. **D1 design → build**, **D2 Phase 2** as separate tracks.
