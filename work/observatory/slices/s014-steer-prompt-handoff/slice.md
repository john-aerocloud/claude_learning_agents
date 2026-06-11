---
slice: s014-steer-prompt-handoff
chunk: CHK-5
status: defined
created: 2026-06-10
value: HIGH
cost: M   # ~10h across 4 UCs; heavy reuse of existing UI patterns; no new server infra
vc_ratio: HIGH/M
---

# s014 — Steer prompt handoff (CHK-5 first slice)

## Job served

**J3 — Steer the pipeline without hand-editing files.**
When the operator sees something on the dashboard that needs action — a re-slice,
a queue re-order, a defect raise, a re-prioritisation — they want to compose a
structured, preview-first prompt and hand it to Claude so that all writes go
through the human-accept gate and the UI never writes a single byte to the repo.

_Functional:_ every steer action surfaces a filled-in, copy-ready prompt in a
preview panel; the operator reviews it before accepting; the UI provides no
write path of its own.

_Emotional:_ "I can act on what I see without opening a terminal or hunting for
the right slash command — but I also know Claude is writing, not me bypassing the
agents."

_Social:_ the UI signals that all authority stays with the agents; the operator
is the director, not the editor.

---

## Thin scope (what this slice delivers)

This slice delivers the **core steer-engine mechanics** end-to-end thin:

1. **Steer-action menu on pipeline items** — a "Steer" affordance (button/
   context-menu) reachable from the value-stream map WIP chips and the
   work-item tree. Surfaces the four atomic steer-action types:
   - Raise defect
   - Re-prioritise item
   - Request re-slice / split
   - Custom steer (free-text intent)

2. **Prompt-builder panel** — a read-only form panel that auto-fills a
   structured prompt template from context (item id, current state, selected
   action type, and operator intent notes). The panel is a preview, not an
   editor of the underlying files.

3. **Formatted prompt output** — the panel renders the complete, copy-ready
   Claude prompt. The prompt template follows the `intake` / `defect` slash
   command conventions already in `.claude/commands/`, so the operator can
   paste it directly into a Claude session. All fields are human-meaningful
   (item id, human-readable names, not raw CSV ids).

4. **One-click copy to clipboard** — a "Copy prompt" button places the
   rendered text on the system clipboard; a toast confirms copy. The button is
   the only write action the UI performs, and it writes only to the clipboard,
   never to the filesystem.

5. **SSE refresh of context** — the steer panel re-fetches item context on
   SSE file-change so the prompt builder always reflects the current item state,
   not stale data from a prior fetch.

---

## Explicitly NOT in scope

- Writing anything to the filesystem, any queue CSV, or any ledger row —
  the UI is read-only; the slice.md hard constraint (§2 of the requirements
  doc) is absolute.
- Automatic prompt submission to Claude — the operator always copies and pastes;
  no API call to Claude is made by the UI.
- CHK-6 WIP-navigation: browsing WIP and proposing re-slice/split/merge is a
  separate chunk. This slice enables the prompt-handoff mechanics; CHK-6 builds
  the navigational surface on top of them.
- The "raise defect" action composing a full `/defect` intake form with the
  four DEFECT fields pre-filled from the ledger — that is CHK-6 context-enriched
  behaviour. This slice builds the routing and copy mechanism; CHK-6 can deepen
  the prompt content.
- Custom slash-command authoring — the operator edits the natural-language intent;
  the template structure is fixed by this slice.
- Mobile layout or responsive design.
- Multi-project steer: single active project only, matching all existing views.

---

## Success measures (basis for acceptance)

| # | Measure | How observed |
|---|---------|--------------|
| SM-S5-1 | "Steer" affordance visible on ≥1 WIP chip and ≥1 work-item tree node | Button/menu present in DOM (`data-testid="steer-btn"` or equivalent); no console error |
| SM-S5-2 | Selecting an action type and entering intent note produces a fully-populated prompt with item id, human-readable item job text, action type, intent, and the correct slash-command form | Prompt text rendered in panel contains real item id (e.g. "CHK-5") and "intent:" field non-empty after operator types it |
| SM-S5-3 | "Copy prompt" button places the prompt on the clipboard and shows a toast within 2 s | Toast element appears; clipboard.readText() in a Vitest/browser test returns the prompt string; operator can paste it into a text editor |
| SM-S5-4 | The UI writes zero bytes to the filesystem during any steer interaction | Server-side write-guard returns 405 on any non-GET; no file stat change after copy action |
| SM-S5-5 | On SSE file-change event the steer panel re-fetches item context and reflects updated item state without manual reload | Append a test row to items.csv; open steer panel for that item; state badge updates within SSE window |
| SM-S5-6 | All steer-panel labels are human-meaningful — no raw CSV column names or timestamps exposed as labels | Spot-check: action type label reads "Raise defect", not "raise_defect"; item job field shows the job sentence, not the raw CSV id cell |

**Real-data done-condition (EXP-033 policy):** acceptance is NOT done against
fixtures alone. The tester MUST open the steer panel against a live item from
the running app (e.g. CHK-5 or CHK-6), enter an intent note, generate a prompt,
and confirm the prompt contains: the item's real id, the item's real job sentence
from items.csv, the chosen action type, and the operator intent note verbatim.
result.md must contain a copy of the generated prompt for at least one live item.

---

## Architecture notes for solution-architect / cicd

**Seam co-declarations (for flow-manager path registry):**
- UC-S014-1 owns: `src/app/components/SteerMenu.jsx` (new, composed into VSM
  WIP chips and WorkItemTree row)
- UC-S014-2 owns: `src/app/components/SteerPanel.jsx` (new, floating/drawer
  panel); `src/app/hooks/useSteerContext.js` (new)
- UC-S014-3 owns: `src/app/lib/promptBuilder.js` (new, pure function — action
  type + item context → prompt string); `src/app/templates/steer-prompts/`
  (static template strings for each action type)
- UC-S014-4 owns: clipboard write + toast in `SteerPanel.jsx`; SSE re-fetch
  wiring in `useSteerContext.js` (extends existing `subscribeEvents` pattern)

**No new server routes required for this slice.** All item context is sourced
from existing endpoints (`/api/projects/:id/items`, `/api/projects/:id/stage-flow`).
The clipboard write is client-only.

**Prompt template convention:** templates reference `.claude/commands/` slash
command forms already committed. The product agent will supply the template
content in use-cases.md; the engineer implements them as static strings in
`src/app/templates/steer-prompts/`.
