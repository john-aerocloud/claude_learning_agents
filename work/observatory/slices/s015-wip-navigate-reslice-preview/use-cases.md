---
slice: s015-wip-navigate-reslice-preview
chunk: CHK-6
produced-by: product
date: 2026-06-10
---

# Use cases — s015 WIP navigate & re-slice/split before/after preview

All UCs serve **J3 — Steer the pipeline without hand-editing files** (SECONDARY).
Ordered thinnest-first (dependency-safe build order).

---

## UC-S015-1 — WIP navigation panel (list + time-in-stage sort)

**One-line JTBD:** When the operator wants to find the in-flight items most
likely to need steering action, they want a dedicated WIP panel that lists all
in-flight items sorted by longest-in-stage first.

**Actor:** Pipeline operator

**Trigger:** Operator opens the WIP panel (nav entry in sidebar or main nav)

**Observable outcome:**
- A panel renders listing every currently in-flight item (recency-based WIP,
  matching DEFECT-010's recency-only definition: open ≤30 min, no close event)
- Each row shows: item id, job sentence (from `items.csv`), current stage,
  value, cost, and time-in-stage formatted with a time unit (e.g. "2 h 14 min")
- Rows sorted by time-in-stage descending (longest-waiting first)
- An empty state ("No items currently in flight") renders gracefully when WIP is zero
- Panel header is labelled "In-flight WIP" or equivalent human-meaningful title

**Data sources:**
- `/api/projects/:id/stage-flow` (existing; WIP chip data contains item ids and
  stage assignments)
- `/api/projects/:id/items` (existing; item job, value, cost)
- Time-in-stage computed client-side from the `task_start` timestamp in
  stage-flow data

**Seams / paths owned:**
- `src/app/components/WipPanel.jsx` (new)
- `src/app/hooks/useWipItems.js` (new — composes stage-flow + items data;
  computes time-in-stage)
- Sidebar nav entry / nav route (new — read-only addition to nav component)

**Value:** HIGH (without the WIP panel there is no navigation surface for CHK-6;
this is the entry point for all steering actions from a WIP-browsing context)
**Cost estimate:** 3 h

**Dependencies:** none from s015 UCs. Reads from existing endpoints. Can be
built independently of s014 completion (no s014 components composed here).

**Acceptance conditions:**
- AC-1: Panel renders in the app with a nav entry; clicking the nav entry shows
  the panel without hiding the value-stream map (map still accessible via its
  own nav entry)
- AC-2: All currently in-flight items appear in the list; row count matches the
  WIP count shown on the value-stream map for the same project
- AC-3: Each row shows item id, job sentence (not raw CSV key), current stage
  name (human-readable stage label, not enum key), value, cost, and time-in-stage
  with a time unit; no raw CSV column names visible
- AC-4: Rows are sorted longest-in-stage first (verified by checking the
  first-listed item against its ledger `task_start` row)
- AC-5: Empty state ("No items currently in flight" or equivalent) renders
  without a crash when WIP is zero; no null-pointer error in console

**Done condition:** All five ACs pass against the live running app with real
ledger data.

---

## UC-S015-2 — Steer action routing from WIP panel rows

**One-line JTBD:** When the operator has found an item in the WIP panel they
want to steer, they want to trigger a steer action without leaving the WIP
panel — so item selection and action dispatch are one flow, not two.

**Actor:** Pipeline operator

**Trigger:** Operator clicks/activates a WIP row item to steer it

**Observable outcome:**
- A "Steer" affordance (same `SteerMenu` component from s014) appears on each
  WIP panel row; clicking it opens the same four-option action-type picker
  ("Raise defect", "Re-prioritise", "Request re-slice / split", "Custom steer")
- Selecting an action type other than "Request re-slice / split" opens the
  standard s014 `SteerPanel` with the item pre-loaded — no new behaviour, full
  reuse of UC-S014-2/UC-S014-3/UC-S014-4
- Selecting "Request re-slice / split" opens the new `ReslicePreviewPanel`
  (UC-S015-3) instead of the standard `SteerPanel`
- The WIP panel remains visible behind the steer panel / preview panel
  (does not navigate away)

**Seams / paths owned:**
- `SteerMenu.jsx` (READ-ONLY reuse from s014 / UC-S014-1 — no changes to the
  component itself; composed into WipPanel rows via a props slot)
- `WipPanel.jsx` — adds `onSteer(itemId, actionType)` handler (extending
  UC-S015-1's shell)
- Routing logic: if actionType === 're-slice', open `ReslicePreviewPanel`;
  else open `SteerPanel` (s014 — the existing component)

**Value:** HIGH (without action routing from the WIP panel the navigation
surface is browse-only; the steer engine does not activate)
**Cost estimate:** 1.5 h

**Dependencies:** UC-S015-1 (WipPanel shell must exist to compose SteerMenu
into); UC-S014-1 (SteerMenu must be delivered by s014 before this UC can
compose it — explicit cross-slice dependency)

**Acceptance conditions:**
- AC-1: `data-testid="steer-btn"` is present on each WIP panel row in the
  live app; clicking it shows the four-option action-type picker
- AC-2: Selecting "Raise defect", "Re-prioritise", or "Custom steer" from a
  WIP panel row opens the s014 SteerPanel with the correct item id pre-loaded
  (same behaviour as triggering from the VSM or work-item tree)
- AC-3: Selecting "Request re-slice / split" opens the ReslicePreviewPanel,
  not the standard SteerPanel (data-testid="reslice-preview-panel" present in DOM)
- AC-4: WIP panel rows remain rendered (not unmounted) while a steer panel or
  preview panel is open; operator can close the panel and select a different row

**Done condition:** All four ACs pass against the live running app.

---

## UC-S015-3 — Re-slice/split before/after preview panel

**One-line JTBD:** When the operator is about to request a re-slice/split, they
want to see the current item's scope beside their proposed split so they can
verify the proposal is coherent before handing it to Claude.

**Actor:** Pipeline operator

**Trigger:** Operator selects "Request re-slice / split" from the steer action
picker (via UC-S015-2 or from the VSM/work-item tree steer menu from s014)

**Observable outcome:**
- A `ReslicePreviewPanel` opens as a modal or side drawer (consistent with the
  s014 `SteerPanel` pattern) with two columns:
  - **Before column** (read-only, headed "Current item"):
    - Item id, job sentence, value, cost, current stage
    - A note: "After split, this item will be replaced by Part A and Part B"
  - **After column** (operator input, headed "Proposed split"):
    - Part A job field: free-text, labelled "Part A job sentence", placeholder
      "Describe what Part A will deliver…"
      (`data-testid="part-a-job"`)
    - Part B job field: free-text, labelled "Part B job sentence", placeholder
      "Describe what Part B will deliver…"
      (`data-testid="part-b-job"`)
    - A directional cost note (computed, read-only): "Each part will be smaller
      than the original — favours flow" when both fields are non-empty; empty
      when fields are empty
- An intent-note textarea ("Why are you splitting this item?") matching the
  s014 panel pattern
- A "Looks right — generate prompt" button (disabled until Part A, Part B, and
  intent note are all non-empty)
- Cancel closes without generating a prompt; no filesystem write

**Seams / paths owned:**
- `src/app/components/ReslicePreviewPanel.jsx` (new)
- `src/app/hooks/useReslicePreview.js` (new — manages Part A, Part B, intent
  state; no server calls; pure local state)
- Reuses: `SteerPanel.jsx` CSS/layout patterns (read-only style reuse, not
  component composition); `useSteerContext.js` to load item context by id

**Value:** HIGH (this is the core differentiator of CHK-6 over CHK-5; without
before/after preview the slice does not advance the chunk's done-condition)
**Cost estimate:** 3 h

**Dependencies:** UC-S015-2 (routing must dispatch 're-slice' to open this
panel); UC-S014-2 (`useSteerContext.js` must exist to load item context — explicit
cross-slice dependency on s014)

**Acceptance conditions:**
- AC-1: `data-testid="reslice-preview-panel"` present in DOM when "Request
  re-slice / split" is selected; panel shows two visible columns headed "Current
  item" and "Proposed split"
- AC-2: Before column shows the live item's id, job sentence, value, cost, and
  stage — all human-readable labels; no raw CSV column names
- AC-3: Part A and Part B fields accept free text; typing in them does not
  trigger any file write (server write-guard 405 still active)
- AC-4: "Looks right — generate prompt" button is disabled until Part A, Part B,
  and intent note all contain at least one character
- AC-5: Cancel closes the panel without generating a prompt; WIP panel remains
  open and unmodified behind it

**Done condition:** All five ACs pass against a live item from the running app.

---

## UC-S015-4 — Enriched re-slice/split prompt with before/after content

**One-line JTBD:** When the operator has completed the before/after preview and
clicks "Generate prompt", they want the handoff prompt to include both the
current scope and the proposed split so Claude receives a structured proposal,
not a vague request.

**Actor:** Pipeline operator (via ReslicePreviewPanel "Looks right — generate
prompt" action)

**Trigger:** Click "Looks right — generate prompt" in UC-S015-3's panel

**Observable outcome:**
- The existing s014 `SteerPanel` prompt-output area (or an equivalent output
  area inside `ReslicePreviewPanel`) renders the enriched prompt containing:
  - Item id and current job sentence (before)
  - Part A job sentence (after)
  - Part B job sentence (after)
  - Operator intent note verbatim
  - The `/slice-next (re-slice / split request)` command form from the s014
    re-slice template, extended with Part A and Part B tokens
- Copy-to-clipboard and toast behave identically to s014 UC-S014-4 (reused,
  no changes to the copy mechanic)
- The prompt is generated client-side only; no server call for generation

**Template extension (product-supplied wording for UC-S015-4):**

The `re-slice.txt` template from s014 is extended. New form:

```
/slice-next (re-slice / split request)

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current state: {{item_state}} / Value: {{item_value}} / Cost: {{item_cost}}

Proposed split:
  Part A: {{part_a_job}}
  Part B: {{part_b_job}}

Re-slice intent (operator):
{{intent_note}}

Please show the before/after with explicit NOT-in-scope for each part and
confirm both parts pass Killick's test before writing.
```

The `promptBuilder.js` function gains two optional parameters `partAJob` and
`partBJob` (default empty string); existing call sites are unaffected. The
Part A / Part B block is omitted from the output when both are empty.

**Seams / paths owned:**
- `src/app/lib/promptBuilder.js` — EXTENSION (adds partAJob, partBJob
  parameters; backward-compatible; UC-S014-3 owns the existing function;
  this UC extends it — potential seam collision with s014 if both are in
  flight simultaneously; architect to confirm merge strategy)
- `src/app/templates/steer-prompts/re-slice.txt` — UPDATED (extends the
  existing template; owned by UC-S014-3 in s014)

**Value:** MED-HIGH (without this UC the before/after preview is a form that
goes nowhere; this closes the CHK-6 first-slice end-to-end loop)
**Cost estimate:** 2 h (small: pure function extension + template update +
wiring into ReslicePreviewPanel)

**Dependencies:** UC-S015-3 (ReslicePreviewPanel must expose Part A, Part B,
and intent values); UC-S014-3 (promptBuilder.js must be delivered by s014 before
this UC can extend it — explicit cross-slice dependency)

**Acceptance conditions:**
- AC-1: Generated prompt for a live item (e.g. CHK-5) contains all five
  required fields verbatim: item id, current job sentence, Part A text, Part B
  text, and operator intent note
- AC-2: Generated prompt contains the `/slice-next` command form and the
  "Proposed split:" block with both Part A and Part B labelled
- AC-3: When Part A and Part B are both empty (standard re-slice triggered
  from the s014 SteerPanel path), the "Proposed split:" block is omitted from
  the output — existing s014 re-slice prompt is unchanged
- AC-4: No server request is made during prompt generation (promptBuilder is
  pure; verified via network panel or mock in unit test)
- AC-5: `promptBuilder.js` unit test: given a fixture item context + 're-slice'
  action + Part A + Part B + intent, asserts output contains all five fields;
  given the same without Part A / Part B, asserts output matches the s014 re-slice
  template exactly (backward-compatibility regression)

**Done condition:** All five ACs pass; AC-5 passes as a standalone Vitest unit test.

---

## Dependency edges

```
UC-S015-1  ──► UC-S015-2  ──► UC-S015-3  ──► UC-S015-4
                  │
                  ▼
            [s014 UC-S014-1]   (SteerMenu — must be delivered before UC-S015-2
                                can compose it)

UC-S015-3  ──► [s014 UC-S014-2]  (useSteerContext — must exist before
                                   UC-S015-3 can load item context)

UC-S015-4  ──► [s014 UC-S014-3]  (promptBuilder.js — must exist before
                                   UC-S015-4 can extend it)
```

Build sequence (dependency-safe):

1. UC-S015-1 (WIP panel shell + data fetch + sort) — no s015 dependencies;
   no s014 dependencies; independently buildable
2. UC-S015-3 (ReslicePreviewPanel shell + before/after form) — depends on
   s014 UC-S014-2 (`useSteerContext`) being delivered; independently buildable
   from UC-S015-1 and UC-S015-2 (the panel is a standalone component)
3. UC-S015-2 (steer routing from WIP rows) — depends on UC-S015-1 (WipPanel
   shell) AND s014 UC-S014-1 (SteerMenu); can be built once both are available
4. UC-S015-4 (enriched prompt + template extension) — depends on UC-S015-3
   (Part A/B values) AND s014 UC-S014-3 (promptBuilder.js)

UC-S015-1 and UC-S015-3 can be built in parallel once s014 UC-S014-2 delivers.
UC-S015-4's `promptBuilder.js` extension is a small additive change — architect
to confirm whether it can be a separate PR from UC-S014-3's initial delivery
or must wait for UC-S014-3 to merge first.

---

## Shared-seam notes (for flow-manager path registry)

- `promptBuilder.js` is owned by s014 UC-S014-3; UC-S015-4 extends it. This is
  a genuine seam collision if both slices are building simultaneously. The
  extension is additive and backward-compatible, but architect must rule whether
  UC-S015-4 can proceed as a branch from UC-S014-3's delivered state or
  must wait for s014 to be fully merged. Flag this at the s015 build gate.
- `re-slice.txt` template is similarly co-owned (s014 creates it; s015 extends
  it). Same ruling applies.
- `WipPanel.jsx` is owned entirely by s015 and has no seam collision with any
  s014 component.
- `ReslicePreviewPanel.jsx` is owned entirely by s015; no collision.
- `SteerMenu.jsx` is READ-ONLY reuse by UC-S015-2 — no changes to the component.
  Collision risk: none.

---

## Value / cost summary

| UC | Job served | Value | Cost (h) | Dependencies |
|----|-----------|-------|----------|--------------|
| UC-S015-1 | WIP navigation panel (list + time-in-stage sort) | HIGH | 3.0 | none |
| UC-S015-2 | Steer action routing from WIP panel rows | HIGH | 1.5 | UC-S015-1; s014 UC-S014-1 |
| UC-S015-3 | Re-slice/split before/after preview panel | HIGH | 3.0 | UC-S015-2; s014 UC-S014-2 |
| UC-S015-4 | Enriched re-slice/split prompt with before/after content | MED-HIGH | 2.0 | UC-S015-3; s014 UC-S014-3 |
| **Total** | | | **9.5 h** | |

_Estimate is within the M (~10h) band. Main uncertainty is the promptBuilder.js
seam timing relative to s014 completion; if s014 is fully merged before s015
builds UC-S015-4, the seam is clean._
