---
slice: s018-guided-cod-intake
chunk: CHK-7
status: defined
created: 2026-06-11
value: MED
cost: M   # ~10h across 4 UCs; new panel + server endpoint; reuses s014 prompt-builder for handoff
vc_ratio: MED/M
---

# s018 — Guided cost-of-delay intake (CHK-7 first slice)

## Job served

**J4 — Bring new work in responsibly.**
When the operator has a raw need or idea, they want to be guided step-by-step
through JTBD framing and cost-of-delay capture, see where the item would rank
in the queue before committing, and hand off the fully-structured intake prompt
to Claude — so work enters the pipeline prioritisable and costed, never as a
vague free-text spike.

_Functional:_ a guided wizard collects job sentence, user/situation/outcome, CoD
signals (value, urgency, risk-of-delay), shows a live rank preview against the
existing queue, then produces a complete `/intake`-ready prompt that the operator
copies to Claude. The UI writes nothing; Claude and the agents do all writes
through the normal accept gate.

_Emotional:_ "I can translate a half-formed idea into a real, ranked work item
without knowing the CSV format or the slash-command syntax — and I see where it
sits before it's even in the queue."

_Social:_ the intake wizard signals that work authority stays with the agents;
the operator is the author of value intent, not a CSV editor.

---

## Thin scope (what this slice delivers)

1. **JTBD capture step** — a guided panel with three prompting fields:
   - "Situation" (when…): what is happening that makes this work needed now
   - "Motivation" (I want to…): what the operator wants to do or observe
   - "Outcome" (so I can…): what becomes possible as a result
   The panel assembles these into a single job sentence preview as the operator types.

2. **Cost-of-delay signals step** — a second step (or expandable section) that
   captures three CoD signals without requiring the operator to know the scoring rules:
   - Value (HIGH / MED / LOW) with a plain-language one-line label per option
     ("HIGH — directly impacts the team's ability to deliver"; "MED — improves
     the experience but work continues without it"; "LOW — nice-to-have")
   - Urgency (time-critical? yes/no + free text "why it matters now")
   - Risk-of-delay (what worsens if this is deferred? free text, optional)
   From these three signals the panel computes a single `value` token
   (HIGH/MED/LOW) via a simple deterministic rule: if the operator rated
   HIGH AND time-critical → HIGH; if LOW AND no urgency → LOW; otherwise MED.
   No cost estimate in this slice — cost is left for the agent at intake.

3. **Queue-rank preview** — before generating the prompt, the panel calls the
   existing `/api/projects/:id/items` endpoint and computes where the new item
   would rank among Intake-queue items by value (HIGH > MED > LOW). It renders:
   "Your item (MED) would rank after N HIGH items and before M LOW items."
   This is a directional rank only, not a precise insertion index.

4. **Intake prompt generation + handoff** — a "Generate intake prompt" button
   builds and renders a complete, copy-ready `/intake` prompt in the same steer
   panel pattern as s014:
   - Command form: `/intake <job sentence>`
   - Prefilled JTBD block: situation / motivation / outcome
   - Value signal: `value: HIGH/MED/LOW` with the reasoning
   - Urgency / risk-of-delay notes (if provided)
   A "Copy prompt" button with a toast confirm, identical to s014. The steer-panel
   clipboard copy path is reused; no new clipboard mechanic.

---

## Explicitly NOT in scope

- Writing to `items.csv`, any queue CSV, or any ledger file — the UI is strictly
  read-only; all writes go through Claude's accept gate, same hard constraint as
  every other slice.
- Submitting the prompt to Claude automatically — copy-paste handoff only.
- Cost estimation in the wizard — left for the intake agent to assess; operator
  provides value signals only.
- Precise queue insertion position — the rank preview is directional only (relative
  to value tier) and makes no write-side commitment.
- Defect intake path — the wizard is for new requirements/needs only; defects use
  the existing `/defect` slash command and the s014 Raise Defect steer action.
- Multi-project intake — single active project, matching all existing views.
- Mobile / responsive layout.
- Saving draft wizard state between sessions.
- WSJF / CD3 scoring models — simple HIGH/MED/LOW value token only; a richer
  scoring model is a deliberate follow-on if the human signals the need.

---

## Success measures (basis for acceptance)

| # | Measure | How observed |
|---|---------|--------------|
| SM-CHK7-1 | JTBD panel renders three fields and assembles a live job-sentence preview as the operator types | Typing in Situation, Motivation, Outcome fields causes the preview sentence to update in real time; no console error |
| SM-CHK7-2 | CoD step renders three signals (Value selector, Urgency, Risk-of-delay) and computes a value token matching the deterministic rule | Enter HIGH + time-critical → computed token = HIGH; enter LOW + no urgency → computed token = LOW; enter MED + no urgency → computed token = MED; spot-check all three |
| SM-CHK7-3 | Queue-rank preview shows a directional count of higher-ranked and lower-ranked existing items without a file write | Panel text contains "after N HIGH items" and "before M LOW items"; N + M matches the count of Intake-queue items in the live items.csv; no write call made |
| SM-CHK7-4 | "Generate intake prompt" produces a complete prompt containing: job sentence, situation, motivation, outcome, value token, urgency text — all verbatim | Prompt text hand-checked against the wizard inputs; each field present; paste into editor and verify |
| SM-CHK7-5 | "Copy prompt" copies the generated text to clipboard and shows a toast within 2 s | Toast element appears; clipboard.readText() in browser test returns the prompt string |
| SM-CHK7-6 | The UI writes zero bytes to the filesystem during any intake wizard interaction | Server write-guard 405 check still active; no file stat change after any wizard interaction |
| SM-CHK7-7 | The value-stream map and all other panels remain unaffected when the intake wizard is open | Existing views render fully; no geometry change; no console errors |

**Real-data done-condition (EXP-033 policy):** acceptance is NOT done against
fixtures alone. The tester MUST open the intake wizard on the live running app,
complete a full JTBD + CoD capture for a real work idea, confirm the rank
preview reflects the live items.csv, generate the prompt, and verify all six
required fields are present verbatim. result.md must contain a copy of the
generated intake prompt for at least one live item.

---

## Architecture notes for solution-architect / cicd

**Seam co-declarations (for flow-manager path registry):**
- UC-S018-1 owns: `src/app/components/IntakeWizard.jsx` (new — step container +
  step state machine); sidebar nav entry "New Work"
- UC-S018-2 owns: `src/app/components/CodStep.jsx` (new — Value selector +
  Urgency + Risk fields + computed token display); `src/app/lib/codScorer.js`
  (new pure fn, deterministic HIGH/MED/LOW rule)
- UC-S018-3 owns: `src/app/hooks/useQueueRank.js` (new — calls existing
  `/api/projects/:id/items`, counts Intake-queue items by value tier, returns
  rank summary string); renders rank preview inside `IntakeWizard.jsx`
- UC-S018-4 owns: `src/app/lib/intakePromptBuilder.js` (new pure fn — JTBD
  fields + CoD signals → `/intake` prompt string); reuses
  `SteerPanel.jsx` clipboard-copy + toast path (READ-ONLY, no new mechanic)

**No new server routes required.** All data is sourced from the existing
`/api/projects/:id/items` endpoint. The CoD scorer and intake prompt builder
are pure client-side functions with no server dependency.

**s014 dependency:** UC-S018-4 reuses the clipboard-copy + toast mechanic from
`SteerPanel.jsx` (UC-S014-4). This is a READ-ONLY reuse of the rendered panel
shell — `IntakeWizard.jsx` may compose `SteerPanel.jsx` in display-only mode or
extract the toast/copy logic into a shared hook. Architect to confirm the seam;
the copy mechanic must NOT be re-implemented from scratch.

**Prompt template convention:** the `/intake` prompt produced by
`intakePromptBuilder.js` follows the structure of the `/intake` slash command
in `.claude/commands/intake.md` exactly: job sentence as the argument, then a
structured JTBD block. The product agent supplies the template; the engineer
implements it as a static template string in
`src/app/templates/intake-prompt.txt` (or inline in the builder if short).
