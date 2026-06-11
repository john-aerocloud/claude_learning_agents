---
slice: s015-wip-navigate-reslice-preview
chunk: CHK-6
status: defined
created: 2026-06-10
value: MED-HIGH
cost: M   # ~11h across 4 UCs; builds on s014 steer engine; no new server infra required
vc_ratio: MED-HIGH/M
---

# s015 — WIP navigate & re-slice/split before/after preview (CHK-6 first slice)

## Job served

**J3 — Steer the pipeline without hand-editing files.**
When the operator sees in-flight WIP and wants to act on items that are too large,
stuck, or blocking the flow, they want to browse ALL current in-flight items in
one panel, pick any item, and see a structured before/after preview of a proposed
re-slice/split — so they can decide whether to hand the action to Claude with
confidence, not by guessing at what the split will look like.

_Functional:_ a dedicated WIP navigation panel surfaces every in-flight item
(recency-based, matching the existing WIP definition) with its key signals;
selecting any item and choosing "Request re-slice / split" opens a before/after
preview that shows the current item scope alongside the operator's proposed split
intent before generating the handoff prompt.

_Emotional:_ "I can see everything in flight, spot what needs splitting, and see
exactly what I'm proposing before I hand it to Claude — I'm not flying blind."

_Social:_ the preview gate reinforces that Claude writes, not the operator; the
UI shows the proposal, not the result.

---

## Thin scope (what this slice delivers)

This slice delivers ONE enriched action type (re-slice/split) with before/after
preview, built on s014's prompt-handoff engine. It adds:

1. **WIP navigation panel** — a panel (accessible from the main nav or as a
   supplementary view) listing all currently in-flight WIP items. Each row shows:
   item id, job sentence, current stage, value, cost, and time-in-stage (derived
   from the most recent `task_start` ledger row for the item). Sorted by
   time-in-stage descending (longest-waiting first — the items most likely to
   need action).

2. **Item selection → steer action routing** — selecting an item in the WIP
   panel surfaces the four action types from s014's steer menu (via the same
   `SteerMenu` component); the panel provides item context so the steer engine
   receives it without the operator navigating to the VSM or work-item tree.

3. **Re-slice/split before/after preview panel** — when the operator selects
   "Request re-slice / split" from the WIP panel, before generating the handoff
   prompt the UI renders:
   - **Before column:** current item id, job sentence, value, cost, current stage,
     and (if available) NOT-in-scope notes from the item's slice.md
   - **After column (operator-composed):** two free-text fields for the proposed
     Part A and Part B job sentences; the panel computes the vc_ratio change
     directionally (e.g. "split cost, each part smaller — faster flow") without
     accessing the filesystem
   - A "Looks right — generate prompt" button that passes both the before data
     and the after fields into `promptBuilder.js` to produce the enriched
     re-slice/split prompt

4. **Enriched re-slice/split prompt** — the generated prompt (still
   clipboard-only, same handoff mechanic as s014) includes the before/after
   preview content: current item scope, proposed Part A, proposed Part B, and
   the operator's intent note — so Claude receives a structured proposal, not
   just a free-text request.

---

## Explicitly NOT in scope

- Writing anything to the filesystem — read-only, no exceptions, consistent
  with the hard constraint in §2 of the requirements doc.
- Before/after preview for Raise defect, Re-prioritise, or Custom steer action
  types — those remain at the s014 template level. CHK-6 follow-on slices may
  enrich them.
- Automatic suggestion of split strategies by the UI — the operator proposes
  the split; the UI previews and hands off. No AI inference in the client.
- Merge action (collapsing two items into one) — too complex for a first CHK-6
  slice; follow-on after the split flow proves out.
- Reprioritise with side-by-side queue position preview — that is a natural
  follow-on for the second CHK-6 slice.
- Cross-project WIP navigation — single active project, matching all existing
  views.
- Mobile / responsive layout optimisation.
- Automated re-slice prompt submission to Claude — copy-paste handoff only,
  same as s014.
- Rendering slice.md NOT-in-scope content from disk — the "Before" column shows
  only data already available from `items.csv` and the ledger endpoint; slice
  artifact parsing is a follow-on enrichment.

---

## Success measures (basis for acceptance)

| # | Measure | How observed |
|---|---------|--------------|
| SM-S6-1 | WIP navigation panel renders all currently in-flight items, sorted longest-in-stage first | Panel row count matches the count of items with a `task_start` ledger entry and no `task_end` within the recency window; DEFECT-010's recency-only definition must be honoured |
| SM-S6-2 | Each WIP row shows item id, human-readable job sentence, current stage, value, cost, and time-in-stage with a time unit | Spot-check: a known in-flight item (e.g. CHK-5) shows its job text and "X h Y min in Decompose" (not raw seconds) |
| SM-S6-3 | Selecting an item in the WIP panel and choosing "Request re-slice / split" opens the before/after preview panel | data-testid="reslice-preview-panel" is present in the DOM; before column shows the item's current data; after column has two empty Part A / Part B fields |
| SM-S6-4 | The before column shows data from the live item; the after column accepts free text without triggering any file write | Typing in Part A / Part B fields does not modify any file; server write-guard 405 check still active |
| SM-S6-5 | "Looks right — generate prompt" produces a prompt containing: item id, current job, Part A text, Part B text, and intent note — all verbatim | Generated prompt text contains all five fields; verified by pasting into a text editor and checking each token |
| SM-S6-6 | The WIP panel refreshes on SSE file-change without manual reload | Append a `task_start` ledger row for a test item; panel row count increments within SSE window |
| SM-S6-7 | The value-stream map and work-item tree remain unaffected by the WIP panel being open | Existing views render fully; no geometry change; no console errors |

**Real-data done-condition (EXP-033 policy):** acceptance is NOT done against
fixtures alone. The tester MUST open the WIP panel against the live running app,
confirm the in-flight items match the recency-based WIP from the dashboard, select
at least one item, complete a re-slice/split before/after preview with real Part A
and Part B text, generate a prompt, and confirm the prompt contains all five
required fields verbatim. result.md must contain a copy of the generated prompt
for at least one live item.

---

## Architecture notes for solution-architect / cicd

**Seam co-declarations (for flow-manager path registry):**
- UC-S015-1 owns: `src/app/components/WipPanel.jsx` (new); `src/app/hooks/useWipItems.js` (new — fetches from existing `/api/projects/:id/stage-flow` WIP signal); sidebar nav entry
- UC-S015-2 owns: composition of `SteerMenu.jsx` (s014, READ-ONLY reuse) into `WipPanel.jsx` rows
- UC-S015-3 owns: `src/app/components/ReslicePreviewPanel.jsx` (new — before/after two-column layout); `src/app/hooks/useReslicePreview.js` (new — manages Part A / Part B state)
- UC-S015-4 owns: `src/app/lib/promptBuilder.js` — EXTENSION of the re-slice template (already owned by s014/UC-S014-3) to include before/after fields; template string updated in `src/app/templates/steer-prompts/re-slice.txt`

**No new server routes required.** WIP item data comes from existing
`/api/projects/:id/stage-flow` (WIP chip data) and `/api/projects/:id/items`
(item context). Time-in-stage computed client-side from the `task_start`
timestamp already returned in stage-flow data.

**s014 dependency note:** this slice REQUIRES s014's `SteerMenu.jsx`,
`SteerPanel.jsx`, `promptBuilder.js`, and `useSteerContext.js` to be delivered
before UC-S015-2, UC-S015-4 can be built. UC-S015-1 (WIP panel shell + data)
and UC-S015-3 (ReslicePreviewPanel shell + before/after form) can be built in
parallel with s014's completion, as long as they do not compose the s014
components until those are available. Architect to confirm the branch/seam
strategy.

**promptBuilder extension:** the `re-slice.txt` template extends the s014
version to add `{{part_a_job}}` and `{{part_b_job}}` tokens. The existing
template structure is preserved; new tokens are appended in the "Re-slice
intent" block. `promptBuilder.js` gains two new parameters: `partAJob` and
`partBJob`; existing call sites pass empty strings for these (backward compatible).
