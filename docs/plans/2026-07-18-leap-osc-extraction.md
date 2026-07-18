# leap-osc Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the `leap/` tree from LED Zeppelin into its own standalone **private** repo (`leap-osc`) with history, and remove every leap-specific file from LED Zeppelin, which keeps only its generic OSC-in → external-channel → mapping path.

**Architecture:** `git subtree split` preserves the leap history into a branch, which seeds a new private GitHub repo (minimal restructure — the `osc/` C project stays self-contained). LED Zeppelin then `git rm`s `leap/`, `LEAP.md`, and `test/leap-osc.test.js`; its generic `test/osc.test.js` keeps `parseOsc` covered, so no coverage is lost. The two repos share only standard OSC 1.0.

**Tech Stack:** git subtree, `gh` CLI, C/CMake (new repo), Node `node:test` (LZ suite).

**Design doc:** `docs/plans/2026-07-18-leap-osc-extraction-design.md`

**Branch:** work the LED-Zeppelin-side changes on `leap-extraction` (already created off `main`, holds the design doc at `d371a09`).

---

### Task 1: Land the pending cleanups on main so the extract carries them

The `leap-cleanup` branch (`29b32c5`) holds the `main.c` flag-table tidy (extracted) and the `mappings.js` change-detector tidy (stays in LZ). Both are wanted; land them before splitting.

**Step 1:** Confirm `leap-cleanup` is green: `git checkout leap-cleanup && sh leap/osc/run-tests.sh && node --check mappings/mappings.js`. Expected: `test_channels/test_osc: all passed`, `mappings.js` OK.

**Step 2:** Merge to main: `git checkout main && git merge --ff-only leap-cleanup` (it branched off main linearly, so ff works). Expected: main now at `29b32c5`'s tree.

**Step 3:** Rebase the extraction branch onto updated main so the design doc + upcoming removal sit on top of the clean tree: `git checkout leap-extraction && git rebase main`. Expected: clean rebase (design doc is the only unique commit).

**Step 4:** Do NOT push yet (LZ ships at Task 6).

---

### Task 2: Subtree-split the `leap/` history into a seed branch

**Step 1:** From updated `main`, split: `git checkout main && git subtree split --prefix=leap -b leap-split`. Expected: prints a commit SHA; `leap-split` branch now has a history whose tree root == the contents of `leap/` (i.e. `index.html` and `osc/` at the root).

**Step 2:** Sanity-check the split tree: `git ls-tree --name-only leap-split`. Expected: `index.html`, `osc`. And `git log --oneline leap-split | tail -3` shows the original leap commits (`b3a4fc4` Spot etc. will NOT be here — only commits that touched `leap/`; the earliest leap/osc commit is `78e0988`).

**Step 3:** Note: `leap-split` is local only; it seeds the new repo in Task 3.

---

### Task 3: Create the private repo and push the seed  ⚠️ NEEDS EXPLICIT GO

**This step creates a GitHub repo — an outward-facing action. Get Jonas's explicit confirmation and confirm `gh auth status` before running.**

**Step 1:** Verify auth: `gh auth status`. Expected: logged in as jonasjohansson.

**Step 2:** Create the private repo (empty, no push yet): `gh repo create jonasjohansson/leap-osc --private --description "LeapC → OSC hand-tracking bridge"`. Expected: repo created.

**Step 3:** Clone it fresh to a sibling dir and pull in the split history:
```bash
cd /Users/jonas/Documents/GitHub/org/jonasjohansson
git clone git@github.com:jonasjohansson/leap-osc.git
cd leap-osc
git pull /Users/jonas/Documents/GitHub/org/jonasjohansson/ledzeppelin leap-split
```
Expected: the `leap/` contents (index.html, osc/) land on the new repo's default branch with history.

**Step 4:** Push: `git push origin HEAD`. Expected: seed history on `github.com/jonasjohansson/leap-osc`.

---

### Task 4: Restructure the new repo (minimal) + verify it builds standalone

Work inside the cloned `leap-osc` repo. Keep the `osc/` C project self-contained (its files include each other by bare name — do NOT scatter them).

**Step 1:** Make `LEAP.md` the top-level README, keeping the terse build note:
```bash
git mv osc/README.md osc/BUILD.md          # keep the short build quickref
git mv LEAP.md README.md 2>/dev/null || cp osc/../LEAP.md README.md
```
(If `LEAP.md` came across at repo root, just `git mv LEAP.md README.md`.)

**Step 2:** Relabel the LaunchAgent: in `osc/com.ledzeppelin.leap-osc.plist`, change `Label` `com.ledzeppelin.leap-osc` → `com.leap-osc.bridge`; `git mv osc/com.ledzeppelin.leap-osc.plist osc/com.leap-osc.bridge.plist`.

**Step 3:** Fix any now-stale paths in `README.md` that referenced `leap/osc/…` — they become `osc/…` (the repo root is what `leap/` was). Grep: `grep -n "leap/osc" README.md osc/BUILD.md` and rewrite hits to `osc/`.

**Step 4:** Verify the C build + tests still pass from the new root:
```bash
export PATH="$HOME/.bun/bin:$PATH"   # not needed for C, but for parity
sh osc/run-tests.sh
cmake -S osc -B /tmp/leap-osc-build && cmake --build /tmp/leap-osc-build
```
Expected: `test_channels/test_osc: all passed`; CMake prints `LeapC NOT found — fake-only build` and compiles clean; `/tmp/leap-osc-build/leap-osc --fake --verbose` streams frames (Ctrl-C).

**Step 5:** Note in `README.md` that `index.html` is the phase-B monitor and currently expects an LZ-style `/frames` websocket (will get a self-hosted server in the UI phase). Commit: `git add -A && git commit -m "chore: restructure as standalone repo (README, plist label, paths)"`. Push.

---

### Task 5: Remove leap from LED Zeppelin

Back in the ledzeppelin repo, on `leap-extraction`.

**Step 1:** Remove the files: `git rm -r leap LEAP.md test/leap-osc.test.js`. Expected: staged deletions.

**Step 2:** Tidy the one stray reference — the `/leap/hand/y` example comment in `mappings/mappings.js` (~line 86): change the example channel name to a generic one (e.g. `/osc/fader1`) or drop the specific example. Keep it a comment-only edit.

**Step 3:** Grep for any dangling leap references: `grep -rniE "leap" --include="*.js" --include="*.json" --include="*.md" src/ server/ mappings/ package.json README.md docs/*.md | grep -v node_modules | grep -vi "docs/plans/2026-07-1[68]-leap"`. Expected: no functional hits (only the two design/plan docs, which we keep as the record).

**Step 4:** Run the LZ suite: `lsof -ti :7191 -ti :7192 | xargs kill -9 2>/dev/null; node --test --test-timeout=120000 "test/*.test.js"`. Expected: all green except the known pre-existing `api-integration.test.js` file-timeout; **`test/osc.test.js` passes** (confirms `parseOsc` still covered without the leap test).

**Step 5:** Commit: `git add -A && git commit -m "chore(leap): extract leap-osc to its own repo; LZ keeps only generic OSC-in"`. The commit message should note the new repo URL.

---

### Task 6: Ship LED Zeppelin

**Step 1:** Merge `leap-extraction` → `main`: `git checkout main && git merge --no-ff leap-extraction -m "chore: remove leap/ (extracted to jonasjohansson/leap-osc); design+plan docs"`.

**Step 2:** Push: `git push origin main`.

**Step 3:** Auto-ship per the standing memory (the app loses its `/leap/` web route, so a real rebuild is warranted):
```bash
export PATH="$HOME/.bun/bin:$PATH"
export SIGN_ID="Developer ID Application: JONAS JOHANSSON (4C8U4BC896)"
export NOTARY_PROFILE="lz-notary"
npm run build:mac
```
Expected: `✓ signed + notarized + stapled`, installed to `/Applications`.

**Step 4:** Verify `/leap/` is gone from the app: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7070/leap/` after a quick `npm start` (expected 404), or confirm `dist/LEDZeppelin.app` has no `leap` in `Contents/Resources`. Kill the daemon after.

**Step 5:** Clean up branches: `git branch -d leap-cleanup leap-extraction leap-split` (once merged/consumed).

---

### Task 7: Loose ends (record, don't necessarily do)

- `origin/leapmotion` remains the old archive branch — now doubly superseded. Deleting it is Jonas's call.
- Phase B (standalone bridge UI) is a separate future plan in the new repo.
- Optional LZ follow-up: make "toggle a named effect" a first-class mapping target (out of scope here).
