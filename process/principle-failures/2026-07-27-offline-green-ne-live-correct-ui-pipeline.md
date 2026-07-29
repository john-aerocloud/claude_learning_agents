# Offline-green ≠ live-correct for UI/pipeline slices (recurring)

**Date:** 2026-07-27 · **Project:** ROC · **Slice:** SLC-ROC-014 (C4 rules-editing)

## What recurred
Across SLC-ROC-014's three use-cases the live-stack tester rejected **5 times**, each a
REAL defect that the engineer's full pre-`built_green` green bar (unit + component +
build-graph — 524 app + 336 dashboard tests, ALL green) structurally could not see:

1. **UC-056** no-reflow: a shared/ancestor `overflow-auto` shifted the rule-list panel on
   a blocked-Save `focus()` (jsdom has no layout).
2. **UC-056** live axe `label-title-only` on the editor text inputs in the `aria-invalid`
   state — the house `ACTextInput` drops its cross-element `aria-labelledby` when re-themed
   to `color="failure"`; jsdom axe never reports it (**2 occurrences** — number inputs, then
   name/node text inputs).
3. **UC-057** draft-test fault-gate PARITY: `computeDraftTestDelta` evaluated non-fault
   events without the pipeline's upstream `isFaultEvent` gate → fabricated a "before" alert
   the live pipeline never produces (DEF-ROC-005 class).
4. **UC-058** no-redeploy pickup: the local demo runners hand-rolled `makeDecide` WITHOUT
   `rulesFor`, bypassing `composeConsumer` → a published rule was never picked up, and the
   Simulator diverged from the driven pipeline (DEF-ROC-005 mirror-surface).

## Root cause
For UI and pipeline slices the meaningful defects live in the **rendered / driven /
integrated** layer. The engineer's local green bar exercises the artifact in ISOLATION
(jsdom axe, no-layout jsdom, mocked/empty stores, hand-rolled decide) — so those defects
first surface at the tester's live stage, as rejects (rework), not at `built_green`.

## System response (v111)
This is a **recurring** root cause (same family as v110 / EXP-115 offline-green≠live), so
it is logged here even though nothing "failed" in prod — every catch was in dev. Routed as
plain practice into `engineer.md` ("Your green bar must exercise the REAL artifact…"):
fully-themed live axe + prophylactic same-element `aria-label`; `focus({preventScroll:true})`
+ no scrollable ancestor; a committed composed-consumer-against-populated-store acceptance
driving `consume()` end-to-end. Measure: dev-validation failure rate should fall on the next
UI/pipeline slices (SLC-ROC-015 rule-creation is the first test).

## Not a regression of quality
CFR 10.1% / dev-validation 11.1% this window is HONEST dev-stage rejection accounting
(EXP-108 integrity) — the live discipline (EXP-115/G4) working, catching real defects in
dev before prod. The fix reduces the COST of that catch (shift left), not the catching.
