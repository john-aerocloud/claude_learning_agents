---
date: 2026-07-12
project: ROC
iteration: 1
principle: "CORE-job done-gate + no-silent-partial (§12d / EXP-106)"
dora_metric_harmed: change_failure_rate
---

## Expected
`§12d` (v84) already says: a slice/chunk carrying a CORE `job` is done "in fact"
only when its acceptance is validated against that job's success measure, and a
deliberately-partial CORE slice MUST register its undelivered remainder as a
tracked item **before it closes** — "a CORE job may not leave `items/active/`
empty while unfulfilled." We believed this rule, in force, would keep a
LOCAL-only CORE slice from reading as fully delivered.

## Actual
ROC shipped three chunks entirely on the emulator stack with a fake (contract-
tested) Jira adapter. `CHK-ROC-001`'s done-condition is "one **real** ROC Jira
`PPSM Alert` ticket, end to end". It folded to `done` because its only child
slice (`SLC-ROC-001`, honestly LOCAL-scoped — its own file defers "no real
Azure / no real Jira HTTP call" to `SLC-ROC-002`) was done. But `SLC-ROC-002`
was **never registered** — it lived only as a forecast paragraph in
`chunk-plan.md`. So `items/active/` read as "CORE delivered", `REQ-ROC-001`
folded to `done`, and **`stats.md` showed CFR 0.0% / rework 0.0%** the whole
time — blind to a requirement-level gap: no real device fault has ever produced
a real ticket. Same class as OFS/OAG `2026-07-11-core-slice-false-done-and-
delivery-model-inversion` — now recurring on a THIRD project.

## Why the principle did not hold
The rule is TEXT, enforced only by an operator remembering it at close. Nothing
mechanical checks it. ROC's deliberately LOCAL-first plan framed the real half
as "the next chunk / a forecast", which masked that it is the SAME CORE job's
remainder — so at C1/C2 close no one registered it, and the structural
`done_when_all_children_done` fold happily marked the chunk done. The recurrence
across three projects is the signal: a text-only gate on a CORE invariant is not
load-bearing.

## Guidance for next time
Make §12d MECHANICAL, not remembered: a `wi-validate` invariant (queued as
improvement-slice IMP-011) that FAILS when an aggregate carrying a CORE `job`
is `done` without either (a) a job-success-measure validation event on it, or
(b) a registered, not-yet-done remainder child. Until it lands, the slice-close
parts-check (EXP-100 / loop-run) must explicitly ask "does this carry a CORE
job? is its success measure validated, or its remainder registered?" before any
CORE aggregate is allowed to close. Detection signal: `REQ`/`CHK` folds to
`done` while its CORE job's success measure has no validation event anywhere in
its subtree.
</content>
