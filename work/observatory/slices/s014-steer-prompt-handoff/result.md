# Validation result — UC-S014-2 (s014-steer-prompt-handoff)

**Verdict: FAIL — S14-2-A11Y-2 focus-on-open defect**

UC: UC-S014-2 — Steer panel (item context block + intent note + guarded Generate)  
SHA under test: 1111636  
Current HEAD at run time: d872ac2  
Live server: http://localhost:5173 (probe 200; active project: observatory)  
Run date: 2026-06-11

---

## Summary

The steer panel renders correctly and passes all functional, geometry, and figure
conditions. One accessibility condition fails: **S14-2-A11Y-2 focus management** —
the panel does not reliably move focus to its heading (`data-testid="steer-panel-heading"`)
on open. The race condition between the SteerMenu's synchronous `focusTrigger()` call and
the SteerPanel's `useEffect` focus call causes focus to remain on `steer-btn` rather than
moving to the panel heading. This is a WCAG 2.4.3 (Focus Order) violation.

Defect handed to engineering. All other conditions pass.

---

## Defect Brief (for engineering)

**Condition:** S14-2-A11Y-2 — "on open focus moves into the panel" (acceptance.md)  
**Symptom:** After the panel mounts (visible in DOM), `document.activeElement` is `steer-btn`
(the SteerMenu trigger) instead of `steer-panel-heading`.  
**Spec:** `steer-panel.spec.js:148` — "S14-2-A11Y-1/2 — keyboard-only: open → focus heading…"  
**Failure:** `Expected: "steer-panel-heading" / Received: "steer-btn"` at line 157  
**Root cause:** `SteerMenu.choose()` calls `close(true)` which synchronously calls
`focusTrigger()` BEFORE Preact processes the `setSteer` state update (which mounts the panel).
The SteerPanel's `useEffect` then calls `headingRef.current.focus()`, BUT the SteerMenu's
synchronous `focusTrigger()` may WIN over the async effect, leaving focus on `steer-btn`.  
**Fix direction:** Replace `useEffect` with `useLayoutEffect` in SteerPanel to ensure the
heading focus call runs synchronously after the DOM update (before the browser paints),
OR add a `requestAnimationFrame` defer in the SteerPanel mount effect to run AFTER the
SteerMenu's synchronous focus-return.  
**Evidence:** `steer-panel.spec.js` fails consistently at line 157 when run serialized
(`--workers=1`); passes under parallel load (7 workers) suggesting a timing race.
Real-data spec (`steer-panel-real-data.spec.js`) confirms Esc-return focus works correctly
(the RETURN path is fine; only the INITIAL open-time focus move is broken).

---

## Passing conditions evidence

### Functional (F-1..F-5) — all PASS

- **F-1 (EXP-033 real-data):** Panel opened from REQ-OBSERVATORY on live :5173 server.
  `data-item-id="REQ-OBSERVATORY"`, `steer-ctx-id="REQ-OBSERVATORY — Observe and steer the
  delivery-agent pipeline from a single local read-only surface"`. Real item, real job, real
  action label. `data-source="work/observatory/items/items.csv#id=REQ-OBSERVATORY"`.
- **F-2:** `steer-ctx-state="active"`, `steer-ctx-value="HIGH"`, `steer-ctx-cost="XL"`.
  Panel text grep confirms zero occurrences of `vc_ratio`, `done_ts`, `started_ts`,
  `created_ts`, `dora_ref`. Human action label "Re-prioritise" ≠ `re-prioritise` enum.
- **F-3:** `intent-note` enabled and accepts text; `window.__steerNoReload=1` sentinel
  unchanged; zero non-GET requests fired.
- **F-4:** `steer-generate` has `aria-disabled="true"` on empty note; flips to `"false"`
  after `note.fill('x')`; flips back on `note.fill('')`.
- **F-5:** `Cancel` button click → panel count 0. `×` button click → panel count 0.
  Zero non-GET requests. Confirmed on fixture (REQ-DEMO) and live (REQ-OBSERVATORY).

### Accessibility (A11Y) — 6/7 PASS, 1 FAIL

- **A11Y-2 (Esc return):** Esc from `intent-note` closes panel; `document.activeElement`
  is `steer-btn` with `data-steer-item-id="REQ-OBSERVATORY"`. Focus return path CORRECT.
- **A11Y-2 (focus-on-open):** FAIL — see defect brief above.
- **A11Y-3:** `steer-generate[aria-disabled]` correctly conveys disabled state;
  focused controls show non-empty `box-shadow` (the `--focus-ring` token).
- **A11Y-4:** All three hit boxes (×, Cancel, Generate) ≥ 24×24 CSS px.
- **A11Y-5:** `role="dialog"` without `aria-modal` (non-modal); named "Steer: REQ-DEMO"
  (fixture). `getByRole('textbox', { name: /intent/i })` visible. axe zero violations
  on open panel (tested under reducedMotion to avoid animation-in-flight contrast phantom).
- **A11Y-6:** Under `prefers-reduced-motion: reduce`, `animationName=none` or
  `animationDuration=0s` on the panel element.
- **A11Y-7:** 6 dt/dd pairs rendered; each `<dd>` has `<dt>` sibling; all non-empty.

### Geometry (GEO-S014-2-1..4) — all PASS

GEO tested on both fixture (REQ-DEMO) and live real-data (REQ-OBSERVATORY). Snapshot
methodology: closed snapshot taken after focus-scroll-into-view settles (post-focus,
pre-Enter), open snapshot taken after the panel and its context block are fully loaded.

- **GEO-S014-2-1/2:** `vsmRegion`, `treeRegion`, `treeRow`, `pageScroll`, `mainScroll`,
  `railScroll` — all byte-identical panel-open vs panel-closed. Zero added flow height.
- **GEO-S014-2-3:** `position=fixed`, `parentElement.tagName=BODY`, `zIndex≥40`.
- **GEO-S014-2-4:** `box.x≥0`, `box.y≥0`, `box.x+box.width≤1440`. Fully on-screen.
  Context `<dd>` elements: monotonically increasing `top` offset; shared `left` offset.
  Fields STACK correctly (labelled list, not a collapsed line).

### Figure legibility (S14-2-FIG-1..4) — all PASS

- **FIG-1:** `steer-ctx-id` = "REQ-OBSERVATORY — Observe and steer…" (id WITH job).
  Action field = "Request re-slice / split" (human phrase, not `re-slice` enum).
- **FIG-2:** Human labels and values. Raw CSV keys absent from panel text.
- **FIG-3:** Covered by A11Y-7 (all 6 dt/dd pairs have non-empty values). Unit-level
  absent-value guard (`dash()` function) asserted in jsdom unit suite.
- **FIG-4:** Chip D-1 (queue-only, not in items.csv): `steer-context-notfound` element
  shows "Item D-1 not found"; intent-note and steer-generate absent; zero console errors.

### Coexistence — PASS

Panel opened over an open DetailPane: SteerPanel `zIndex` > DetailPane `zIndex`. The
SteerPanel is the topmost drawer when both are open simultaneously.

---

## Spec authoring this run

`steer-panel-real-data.spec.js` — authored during this validation (process v23 §33
tooling self-service). Gates on `REUSE_SERVER=1`. Exercises F-1..5 + A11Y-2 Esc-return
+ A11Y-5 axe + GEO-S014-2-1..4 against live REQ-OBSERVATORY. Relevancy: `pinned`.
8/8 PASS on live :5173 server.

---

# Validation result — UC-S014-1 (s014-steer-prompt-handoff)

**Verdict: PASS**

UC: UC-S014-1 — Steer-action menu on pipeline items (⋯ button + 4-action popover)  
SHAs: 0a5bb8b (SteerMenu primitive) + f7b9489 (composition into VSM + tree)  
Live server: http://localhost:5173 (Vite dev, auto-deployed via HMR, probe 200)  
Current HEAD at run time: e8f1d8e (DEFECT-011 WIP horizon fix — concurrent, unrelated to UC-S014-1)  
Run date: 2026-06-10

---

## Summary

All acceptance conditions for UC-S014-1 pass. The validation was conducted through
two committed Playwright specs against the deployed live browser surface:

1. **`steer-menu.spec.js`** (fixture-backed, ephemeral :5199): 14/14 tests pass.  
   Covers the WIP chip path (StageNode → QueueDepth chip → SteerMenu) with deterministic
   fixture items D-1..D-3 in the intake queue.

2. **`steer-menu-real-data.spec.js`** (live :5173, real observatory data): 14/14 tests pass.  
   Covers the tree row path (TreeNode → SteerMenu) with real project items anchored at
   `REQ-OBSERVATORY` (the live observatory root requirement). Written as part of this
   validation run; committed to `e2e/`.

---

## Evidence

### EXP-033 real-data cross-check

- The live dashboard at :5173 shows the real observatory work-item tree with `REQ-OBSERVATORY`
  as the root item and all 49 items from `work/observatory/items/items.csv`.
- The steer trigger for `REQ-OBSERVATORY` carries `aria-label="Steer REQ-OBSERVATORY — Observe and steer the delivery-agent pipeline from a single local read-only surface"` — a human-meaningful reference, not a machine token.
- No `row:\d+` or bare numeric IDs appear in any trigger's accessible name.
- Items.csv ground truth: 49 items (header + 49 data rows). Tree renders non-zero nodes.
- Queue ground truth: all queue CSVs have header-only rows (0 queued items). This is the
  correct state — there are no items awaiting processing in any queue at this point in
  the delivery cycle.

### WIP chip path (fixture evidence)

The intake queue in the fixture has 3 items (D-1, D-2, D-3). The fixture-backed spec
confirms:
- `[data-testid="queued-item-intake-D-1"]` carries a `[data-testid="steer-btn"]`
- The chip button opens the 4-action menu, the GEO overlay constraint is satisfied
  (chip bboxes byte-identical menu-open vs closed), and all A11Y conditions hold.
- This path shares the same `SteerMenu` component as the tree row path; the composition
  is validated end-to-end through the chip.

### F-1..F-4 functional conditions

- **F-1**: steer-btn present on ≥1 tree row (live data: REQ-OBSERVATORY) AND ≥1 WIP chip
  (fixture data: D-1). Both paths green.
- **F-2**: menu lists exactly 4 items with exact labels "Raise defect", "Re-prioritise",
  "Request re-slice / split", "Custom steer". Confirmed via both specs.
- **F-3**: selecting "Re-prioritise" closes the menu; `window.__steerNoReload` sentinel
  confirms same document, no page reload.
- **F-4**: steer-btn present on all item-bearing elements; zero triggers outside
  `li.queue-item` or `[role="treeitem"]`; zero in `+N more` chips; zero in headings.
  All `chipsWithWrongCount` = 0; all `rowsWithWrongCount` = 0.

### A11Y conditions (WCAG 2.2 AA)

- **A11Y-1**: Tab walk (≤80 keystrokes on real tree, ≤50 on fixture) reaches a
  `data-testid="steer-btn"`; Enter opens the menu; Esc closes; Space re-opens.
- **A11Y-2**: Focus lands on `steer-action-raise-defect` on open; ArrowDown → re-prioritise;
  ArrowUp → raise-defect; ArrowUp (wrap) → custom. Esc closes + returns focus to trigger
  with `aria-label` containing the item id. Tab escapes without trap.
- **A11Y-3**: Focused trigger shows non-empty `box-shadow` (the `--focus-ring` token).
  `aria-expanded` flips `false` → `true` on click → `false` on Esc.
- **A11Y-4**: Trigger bounding box ≥ 24×24 CSS px. Each of the 4 menuitem boxes ≥ 24px
  height and width.
- **A11Y-5**: `aria-haspopup="menu"`, `aria-label="Steer REQ-OBSERVATORY…"` on trigger;
  `role="menu"` with `aria-label="Steer actions"` on popover; `aria-controls` links
  trigger to menu; 4 `role="menuitem"` with exact label text. Zero axe violations on the
  open steer menu.
- **A11Y-6**: Under `prefers-reduced-motion: reduce`, `animationName=none` or
  `animationDuration=0s` on the open menu element.
- **A11Y-7**: `rowsWithWrongCount=0` (every `role="treeitem"` has exactly 1 steer-btn);
  `inHeadings=0`; `inMoreChip=0`; `outsideItemBearing=0`.

### GEO geometry / no-reflow conditions

- **GEO-S014-1**: `treeRow`, `treeRegion`, `pageScroll`, `mainScroll`, `railScroll` all
  byte-identical snapshot-closed vs snapshot-open. Snapshot taken after focus-scroll
  settles but before Enter opens the menu (post-focus/pre-Enter methodology).
- **GEO-S014-2**: `documentElement.scrollHeight`, `mainScroll`, `railScroll` identical —
  the menu adds zero block height to the flow.
- **GEO-S014-3**: `getComputedStyle(steer-menu).position === 'fixed'` (fixture spec,
  chip test). The popover is portalled to `document.body`.
- **GEO-S014-4**: Menu bounding box: x ≥ 0, y ≥ 0, x+w ≤ innerWidth. Fully on-screen.

### STEER-FIG-1..2

- **STEER-FIG-1**: Every trigger `aria-label` starts with `"Steer "`, contains the item's
  `data-steer-item-id`, has no `row:\d+` or bare numeric id.
- **STEER-FIG-2**: Visible text of each menuitem ≠ its `data-action` value (e.g. visible
  "Raise defect" ≠ `"raise-defect"`). All 4 labels confirmed as human phrases.

### Tree drill non-regression

Steer button click opens the menu WITHOUT triggering detail-pane drill. Row click (on
`.tree-node__row`) still opens the detail pane as expected (UC-S005-3 preserved).

---

## Process notes

**Tooling finding (advisory)**: `make impacted-tests SINCE=f7b9489` reports 33 uncovered
changed nodes because the spec uses `@covers uc-s014-1` (full name) while the tool
matches short IDs (`S14UC1`). The coverage IS provided by the committed specs. Node-ID
naming inconsistency between `use-case-deps.mmd` short IDs and spec `@covers` tags
should be resolved in a tooling improvement slice.

**Spec authoring this run**: `e2e/steer-menu-real-data.spec.js` was authored during this
validation (process v23 §33 tooling self-service). It uses `REQ-OBSERVATORY` as the
stable real-data anchor. Relevancy: `pinned` — update if the root requirement changes.

**GEO snapshot methodology finding**: the fixture GEO spec takes the closed snapshot
before focus(), which works only because the fixture's tree item is already in the
viewport. For real-data trees where the item requires scroll-into-view on focus, the
correct methodology is post-focus/pre-Enter. The new real-data spec uses the correct
approach. The fixture spec is still correct for its use case.
