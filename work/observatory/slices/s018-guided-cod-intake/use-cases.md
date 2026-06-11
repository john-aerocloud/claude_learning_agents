---
slice: s018-guided-cod-intake
chunk: CHK-7
created: 2026-06-11
---

# Use cases — s018 Guided cost-of-delay intake

Four separately buildable, separately testable interaction units delivering the
guided intake wizard end-to-end thin.

---

## UC-S018-1 — Intake wizard shell + JTBD capture step

**Actor:** operator  
**Trigger:** operator clicks "New Work" in the sidebar nav  
**Observable outcome:** an intake wizard panel opens with three labelled fields
(Situation / Motivation / Outcome) and a live job-sentence preview that updates
as the operator types  
**Own done condition:** wizard panel renders with all three fields; preview
sentence updates on keystroke; panel is reachable from the nav; no other UC's
components required

**Acceptance cases:**
- AC-S018-1-1: "New Work" nav entry present in sidebar; clicking it opens the
  `IntakeWizard` panel with three input fields labelled "Situation (when…)",
  "Motivation (I want to…)", "Outcome (so I can…)"
- AC-S018-1-2: typing in any of the three fields updates the job-sentence
  preview string without a page reload (live assembly: "When [situation], I
  want to [motivation], so I can [outcome]")
- AC-S018-1-3: the wizard panel does not displace the value-stream map; map
  still renders fully when wizard is open
- AC-S018-1-4: console is error-free on open and on all three field inputs

**Seam:** `src/app/components/IntakeWizard.jsx` (new); sidebar nav entry  
**Value:** 3 | **Cost:** 2h  
**Dependency edges:** none (requires SPA scaffold S2UC1, already delivered)

---

## UC-S018-2 — Cost-of-delay signals step + value-token scorer

**Actor:** operator  
**Trigger:** operator advances from the JTBD step (or the step is visible
together with JTBD fields in a single-page wizard layout)  
**Observable outcome:** three CoD signal inputs render (Value HIGH/MED/LOW
selector with plain-language labels, Urgency yes/no + free text, Risk-of-delay
optional free text); the computed value token updates live using the
deterministic rule  
**Own done condition:** all three CoD inputs render and the scorer produces the
correct token for all three combinations; no dependency on UC-S018-1's step
navigation (the `CodStep` component is independently renderable)

**Acceptance cases:**
- AC-S018-2-1: Value selector shows three labelled options with plain-language
  descriptions (no raw token labels alone); selecting HIGH + Urgency = yes
  produces computed token = HIGH
- AC-S018-2-2: selecting LOW + Urgency = no produces computed token = LOW
- AC-S018-2-3: selecting MED regardless of urgency produces computed token =
  MED; all other combinations produce MED
- AC-S018-2-4: `codScorer.js` unit test: pure function returns HIGH for
  (HIGH, true), LOW for (LOW, false), MED for all other combinations — no
  DOM dependency

**Seam:** `src/app/components/CodStep.jsx` (new); `src/app/lib/codScorer.js`
(new pure fn)  
**Value:** 2 | **Cost:** 2h  
**Dependency edges:** UC-S018-1 (composed inside IntakeWizard; scorer is
independently testable but rendering requires the wizard shell)

---

## UC-S018-3 — Queue-rank preview

**Actor:** operator  
**Trigger:** operator has filled at least the Value selector (CoD step); rank
preview section renders (or updates live) with a directional count  
**Observable outcome:** the panel shows "Your item ([value token]) would rank
after N HIGH items and before M LOW items" where N and M reflect the live
`items.csv` Intake-queue contents  
**Own done condition:** rank preview string renders with correct N and M for a
known live items.csv state; no write call issued; component is independently
testable with a mock items endpoint

**Acceptance cases:**
- AC-S018-3-1: rank preview text contains "after N HIGH items" and "before M
  LOW items" where N and M are non-negative integers matching the Intake-queue
  item counts from the live items.csv
- AC-S018-3-2: `useQueueRank` hook calls only GET `/api/projects/:id/items`;
  no write request is issued during rank preview
- AC-S018-3-3: changing the Value selector from HIGH to LOW updates the rank
  preview count (N decreases, M increases) without a page reload
- AC-S018-3-4: if the items endpoint returns an empty or header-only CSV, the
  preview renders gracefully ("No queued items — your item would be first")

**Seam:** `src/app/hooks/useQueueRank.js` (new); renders inside `IntakeWizard.jsx`  
**Value:** 3 | **Cost:** 2h  
**Dependency edges:** UC-S018-1 (panel shell), UC-S018-2 (value token drives
rank computation); server-side: existing `/api/projects/:id/items` (UC2/S001,
delivered)

---

## UC-S018-4 — Intake prompt builder + copy-to-clipboard handoff

**Actor:** operator  
**Trigger:** operator clicks "Generate intake prompt" after completing JTBD and
CoD steps  
**Observable outcome:** a complete, copy-ready `/intake`-form prompt renders in
a read-only panel containing job sentence, situation, motivation, outcome, value
token, urgency notes, and risk-of-delay notes; "Copy prompt" button copies to
clipboard and shows a toast within 2 s  
**Own done condition:** prompt builder pure function produces correct output for
all six fields; clipboard copy + toast work; the generated prompt passes the
intake.md template structure check

**Acceptance cases:**
- AC-S018-4-1: generated prompt contains the job sentence verbatim as the
  `/intake` command argument on line 1
- AC-S018-4-2: generated prompt contains labelled blocks: "situation:", 
  "motivation:", "outcome:", "value:", "urgency:", "risk-of-delay:" — each with
  the operator's typed text or "n/a" if omitted
- AC-S018-4-3: `intakePromptBuilder.js` unit test: pure function given a full
  input object returns a string matching the template; no DOM dependency
- AC-S018-4-4: "Copy prompt" button places the full prompt text on the clipboard
  (verified via clipboard.readText() in browser test); toast element appears in
  the DOM within 2 s
- AC-S018-4-5: no write call to any server endpoint is issued when the prompt
  is generated or copied; write-guard 405 check active

**Seam:** `src/app/lib/intakePromptBuilder.js` (new pure fn);
`src/app/templates/intake-prompt.txt` (or inline static string); clipboard-copy
+ toast path reused from `SteerPanel.jsx` (UC-S014-4, READ-ONLY — do not
re-implement)  
**Value:** 4 | **Cost:** 2h  
**Dependency edges:** UC-S018-1 (wizard shell renders the output panel),
UC-S018-2 (value token input), UC-S018-3 (rank preview complete before user
reaches "Generate"); **cross-slice:** UC-S014-3 (promptBuilder.js pattern as
model; intakePromptBuilder is a sibling, not an extension — separate file),
UC-S014-4 (SteerPanel clipboard-copy + toast reuse — read-only composition)

---

## Summary table

| UC | Job (one line) | Value | Cost (h) | Hard deps |
|----|----------------|-------|----------|-----------|
| UC-S018-1 | Wizard shell + JTBD three-field capture with live job-sentence preview | 3 | 2 | SPA scaffold (delivered) |
| UC-S018-2 | CoD signals step + deterministic value-token scorer | 2 | 2 | UC-S018-1 (render only); scorer independently testable |
| UC-S018-3 | Queue-rank preview: directional count from live items.csv | 3 | 2 | UC-S018-1, UC-S018-2; items endpoint (delivered) |
| UC-S018-4 | Intake prompt builder + clipboard handoff via SteerPanel reuse | 4 | 2 | UC-S018-1–3; UC-S014-4 (SteerPanel copy/toast) |

**Total cost:** ~8h (2h per UC; parallel where no hard dep)  
**Critical chain:** UC-S018-1 → UC-S018-2 → UC-S018-3 → UC-S018-4 (linear; each
UC is thin enough that the chain completes quickly)  
**Cross-slice hard dependency:** UC-S018-4 depends on UC-S014-4 (SteerPanel
clipboard-copy + toast) being delivered first.
