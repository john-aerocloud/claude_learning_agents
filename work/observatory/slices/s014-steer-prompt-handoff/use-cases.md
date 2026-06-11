---
slice: s014-steer-prompt-handoff
chunk: CHK-5
produced-by: product
date: 2026-06-10
---

# Use cases — s014 Steer prompt handoff

All UCs serve **J3 — Steer the pipeline without hand-editing files** (SECONDARY).
Ordered thinnest-first (dependency-safe build order).

---

## UC-S014-1 — Steer-action menu on pipeline items

**One-line JTBD:** When the operator sees an item in the dashboard (on a WIP chip
or in the work-item tree), they want a "Steer" affordance that surfaces the four
action types so they know what steering moves are available.

**Actor:** Pipeline operator

**Trigger:** Operator clicks/right-clicks a WIP chip on the value-stream map
or a work-item tree node

**Observable outcome:**
- A "Steer" button or context-menu item appears on the element
  (`data-testid="steer-btn"`)
- Clicking it opens a small action-type picker with four options:
  "Raise defect", "Re-prioritise", "Request re-slice / split", "Custom steer"
- Selecting an option fires an event that opens the steer panel
  (UC-S014-2) with the action type pre-selected
- The affordance is present on at least the VSM WIP chips and the work-item
  tree rows; it does not appear on header/label elements

**Seams / paths owned:**
- `src/app/components/SteerMenu.jsx` (new)
- Composed into: `src/app/components/VsmContainer.jsx` (WIP chip slot,
  read-only modification — add props; no logic change) and
  `src/app/components/WorkItemTree.jsx` (row slot, read-only modification)

**Value:** HIGH
**Cost estimate:** 2 h

**Dependencies:** none — reads only item id from existing rendered elements;
builds independently of SteerPanel

**Acceptance conditions:**
- AC-1: `data-testid="steer-btn"` is present in the DOM on at least one live
  WIP chip and one work-item tree row when the app is running against real data
- AC-2: Clicking the button opens an action-type picker showing exactly four
  labelled options; labels read "Raise defect", "Re-prioritise",
  "Request re-slice / split", "Custom steer" (exact text; no raw enum values)
- AC-3: Selecting any action type dismisses the picker and passes both the
  item id and the action type to the steer panel without a page reload
- AC-4: The steer affordance does not appear on stage-label or header elements;
  it is item-scoped only

**Done condition:** All four ACs pass against the live running app.

---

## UC-S014-2 — Steer panel (context display + intent note)

**One-line JTBD:** When the operator has chosen an action type, they want a
panel that shows the item's full context (id, job, current state, value, cost)
and lets them add a natural-language intent note so the generated prompt is
specific enough to be acted on.

**Actor:** Pipeline operator

**Trigger:** User selects an action type from UC-S014-1's picker

**Observable outcome:**
- A steer panel opens (floating drawer or modal) with:
  - Item context block: id, job sentence (from items.csv `job` field), current
    `state`, `value`, `cost` — all human-readable labels, not raw CSV column
    names
  - Action type displayed as the human-readable label chosen in UC-S014-1
  - A free-text textarea for the operator's intent note
    (`data-testid="intent-note"`) with a placeholder such as
    "Describe what you want to happen (e.g. split this UC into two…)"
  - A "Generate prompt" button that triggers UC-S014-3
- Panel closes with an "X" / Cancel without generating a prompt

**Data source:** `GET /api/projects/:id/items` (existing endpoint); item context
looked up by id already present in the calling element

**Seams / paths owned:**
- `src/app/components/SteerPanel.jsx` (new)
- `src/app/hooks/useSteerContext.js` (new — fetches/caches item context by id)

**Value:** HIGH
**Cost estimate:** 2.5 h

**Dependencies:** UC-S014-1 (SteerMenu must fire the open event with item id +
action type before SteerPanel can receive it); `/items` endpoint already delivered

**Acceptance conditions:**
- AC-1: Panel opens with correct item id and job text for a real item
  (e.g. CHK-5: job = "Compose a structured preview-first prompt…")
- AC-2: All context labels are human-meaningful — "State: planned",
  "Value: HIGH", "Cost: M"; no raw CSV key names visible (no "vc_ratio", no
  "done_ts", etc.)
- AC-3: Intent textarea accepts free text; typing in it does not cause a reload
  or write to any file
- AC-4: "Generate prompt" button is disabled/hidden until at least one
  character is entered in the intent note
- AC-5: Cancel closes the panel without generating a prompt; no filesystem write
  occurs

**Done condition:** All five ACs pass against a live item from the running app.

---

## UC-S014-3 — Prompt builder (template → formatted prompt)

**One-line JTBD:** When the operator clicks "Generate prompt", they want a
fully-populated, copy-ready Claude prompt rendered in the panel so they can
review it before handing it off.

**Actor:** Pipeline operator (via SteerPanel "Generate prompt" action)

**Trigger:** Click "Generate prompt" in the steer panel (UC-S014-2)

**Observable outcome:**
- A formatted prompt string is rendered in a read-only `<pre>` or styled
  output area (`data-testid="prompt-output"`) within the panel
- The prompt contains all four of: item id, item job sentence, action type as
  the correct slash-command or structured verb, operator intent note verbatim
- Template forms per action type:
  - "Raise defect": follows `/defect` command shape (project, item, description
    fields) with operator intent as the description seed
  - "Re-prioritise": follows `/intake` update shape with new-priority rationale
    from the intent note
  - "Request re-slice / split": follows `/slice-next` replenishment shape with
    the operator's decomposition intent
  - "Custom steer": a freeform block with item context as header and intent note
    as body
- Prompt is generated client-side only (pure `promptBuilder.js` function);
  no server call for prompt generation
- Prompt renders within 500 ms of button click (no spinner needed at this scale)

**Seams / paths owned:**
- `src/app/lib/promptBuilder.js` (new — pure function: action type + item
  context + intent note → string)
- `src/app/templates/steer-prompts/` (new static strings, one per action type;
  product supplies wording in this file; engineer implements)
- Output rendered in `SteerPanel.jsx` — serialised within the SteerPanel seam
  (build after UC-S014-2 shell exists)

**Value:** HIGH (this is the core deliverable of CHK-5; without it the chunk job
is not done)
**Cost estimate:** 3 h

**Dependencies:** UC-S014-2 (SteerPanel shell + item context must exist)

**Acceptance conditions:**
- AC-1: Generated prompt for action type "Raise defect" on item CHK-5 contains:
  "CHK-5", the job sentence text, "/defect" or "defect" verb, and the typed
  intent note verbatim
- AC-2: Generated prompt for "Re-prioritise" contains the item id and
  "re-prioritise" or equivalent human-readable verb — not raw enum key
- AC-3: Prompt renders in under 500 ms (measure from button click to
  `data-testid="prompt-output"` becoming non-empty in a Vitest/jsdom unit test)
- AC-4: No server request is made during prompt generation (verified by
  checking network panel / mock in unit test — `promptBuilder` is pure)
- AC-5: `promptBuilder.js` unit test: given a fixture item context + each of
  the four action types + an intent string, asserts the output string contains
  all required fields; passes without running the server

**Done condition:** All five ACs pass; AC-5 passes as a standalone Vitest unit test.

---

## UC-S014-4 — Copy to clipboard + SSE context refresh

**One-line JTBD:** When the operator has reviewed the prompt, they want to copy
it with one click and know the panel always reflects the current item state —
so handoff is frictionless and they never act on stale context.

**Actor:** Pipeline operator

**Trigger (copy):** Operator clicks "Copy prompt" button in the steer panel

**Trigger (refresh):** SSE file-change event fires while the steer panel is open

**Observable outcome (copy):**
- Clicking "Copy prompt" places the prompt string on the system clipboard
- A toast notification appears within 2 s confirming "Copied to clipboard"
  (`data-testid="copy-toast"`)
- The button label reverts to "Copy prompt" after 3 s (or stays as
  "Copied ✓" until the panel is closed — architect to confirm; either is
  acceptable as long as it does not mislead a second click)
- The UI writes nothing to the filesystem during this action

**Observable outcome (SSE refresh):**
- If the item's state changes (e.g. items.csv is updated) while the panel is
  open, the context block in the panel re-fetches and reflects the new state
  within the SSE window (≤ N seconds, consistent with all other SSE refresh
  behaviour in the app)
- The regenerated / displayed prompt does NOT auto-update after the operator
  has already generated it — only the context block refreshes so the operator
  can choose to regenerate manually

**Seams / paths owned:**
- Clipboard write + toast in `SteerPanel.jsx`
- SSE re-fetch wiring in `src/app/hooks/useSteerContext.js` (extends existing
  `subscribeEvents` pattern — no new SSE channel)

**Value:** MED (copy is the final handoff step; SSE refresh is resilience;
without copy the whole chain is incomplete, but value < the generator)
**Cost estimate:** 2.5 h

**Dependencies:** UC-S014-3 (prompt output must exist before copy can operate);
UC-S001-5 / existing SSE channel (read-only reuse)

**Acceptance conditions:**
- AC-1: Clicking "Copy prompt" when a prompt is displayed places the exact
  prompt string on the clipboard (verified via `navigator.clipboard.readText()`
  in a jsdom or browser test)
- AC-2: Toast element (`data-testid="copy-toast"`) is visible within 2 s of
  button click and disappears or updates appropriately
- AC-3: No file in `work/` or `process/` is modified during the steer
  interaction; server write-guard 405 is in place (already delivered by CHK-1
  read-only guard; confirm still active)
- AC-4: Updating items.csv while the steer panel is open causes the context
  block to show the new state within the SSE window; the prompt output area
  does NOT auto-change (operator must click "Generate prompt" again to update it)

**Done condition:** All four ACs pass; AC-3 verified by checking server write
guard still returns 405 on any POST/PUT/PATCH/DELETE to the API.

---

## Dependency edges

```
UC-S014-1  ──► UC-S014-2  ──► UC-S014-3  ──► UC-S014-4
```

Ordered build sequence:
1. UC-S014-1 (steer menu) — no dependencies; independently buildable
2. UC-S014-2 (steer panel shell + context display) — needs UC-S014-1 to fire
   the open event; independently testable once UC-S014-1 emits the correct event
3. UC-S014-3 (prompt builder) — needs UC-S014-2 shell for the output area;
   `promptBuilder.js` pure function is unit-testable independently
4. UC-S014-4 (copy + SSE refresh) — needs UC-S014-3 prompt output; SSE wiring
   is independently addable to `useSteerContext.js`

UC-S014-3's `promptBuilder.js` pure function can be written and unit-tested
before UC-S014-2's shell is merged — the function has no DOM dependency. The
seam collision is only in `SteerPanel.jsx` (UC-S014-2 creates the shell;
UC-S014-3 adds the output area; UC-S014-4 adds the copy button). Architect to
confirm whether UC-S014-3 and UC-S014-4 can be parallelised within SteerPanel
(different sub-elements, no overlapping lines) or must be serialised.

---

## Shared-seam notes (for flow-manager path registry)

- `SteerPanel.jsx` is a shared seam for UC-S014-2, UC-S014-3, UC-S014-4.
  UC-S014-2 creates the shell; subsequent UCs compose into distinct sub-areas.
  False-edge risk: if output area and copy button are in different JSX sections
  they may be built in parallel — architect to confirm at gate.
- `VsmContainer.jsx` and `WorkItemTree.jsx` are touched READ-ONLY by UC-S014-1
  (adding a `onSteer` prop slot and rendering `<SteerMenu>`). No logic change
  to the existing components; collision risk is low but architect to confirm.
- `subscribeEvents` / SSE channel is READ-ONLY reuse in UC-S014-4 — no collision
  with any other UC that uses it.

---

## Value / cost summary

| UC | Job served | Value | Cost (h) | Dependencies |
|----|-----------|-------|----------|--------------|
| UC-S014-1 | Steer-action menu on pipeline items | HIGH | 2.0 | none |
| UC-S014-2 | Steer panel (context display + intent note) | HIGH | 2.5 | UC-S014-1 |
| UC-S014-3 | Prompt builder (template → formatted prompt) | HIGH | 3.0 | UC-S014-2 |
| UC-S014-4 | Copy to clipboard + SSE context refresh | MED | 2.5 | UC-S014-3 |
| **Total** | | | **10.0 h** | |

_Estimate is within the M (~10h) band in slice.md. No new server routes; all
client-side. Main uncertainty is architect's ruling on SteerPanel seam
parallelism (could reduce to ~8 h elapsed if UC-S014-3 + UC-S014-4 run in
parallel)._

---

## Prompt templates (product-supplied wording for UC-S014-3)

These are the fixed structural templates the engineer encodes in
`src/app/templates/steer-prompts/`. The `{{}}` tokens are filled by
`promptBuilder.js` at runtime.

### raise-defect.txt
```
/defect

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current state: {{item_state}}

Defect description (operator intent):
{{intent_note}}

Please treat this as a defect intake: confirm the four fields (expected,
actual, importance, classification) with me before writing any record.
```

### re-prioritise.txt
```
/intake (priority update)

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current value: {{item_value}} / Cost: {{item_cost}}

Re-prioritisation rationale (operator intent):
{{intent_note}}

Please preview the updated value/cost/vc_ratio and queue position before
writing anything.
```

### re-slice.txt
```
/slice-next (re-slice / split request)

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current state: {{item_state}} / Value: {{item_value}} / Cost: {{item_cost}}

Re-slice intent (operator):
{{intent_note}}

Please propose the thinnest split that delivers a real user outcome and show
me the before/after with explicit NOT-in-scope before writing.
```

### custom-steer.txt
```
Steer request — {{project_id}}

Item: {{item_id}} — {{item_job}}
State: {{item_state}} / Value: {{item_value}} / Cost: {{item_cost}}

Operator intent:
{{intent_note}}

Please preview the proposed change and confirm before writing anything.
```
