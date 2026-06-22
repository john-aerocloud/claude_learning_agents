# 2026-06-23 — render gate checked PRESENCE, not key-field CORRECTNESS

**Class:** validation-completeness gap / escaped defect (DEFECT-OAG-018). The render gate (EXP-074), created earlier the SAME session to stop DEFECT-OAG-016, immediately let a different escape through.

## What happened
After installing Playwright (EXP-074, render-observed validation), the FIDS board
passed its render gate: 49 rows rendered, A-10 grid geometry held, axe was clean.
But the board was still wrong — **every flight's Status read "Scheduled"** (the
field never reflected progression; DEFECT-OAG-018). The render assertions checked
that rows were NON-EMPTY and laid out, not that the key domain field showed CORRECT
values. A stuck/wrong key field sails through a non-emptiness check.

## Why it's a deviation
"Observe the render" was implemented as "content is present + correct layout".
That is the floor, not the bar. For a board, the customer outcome is the VALUES in
the key columns (Status, Carousel), not merely that cells are populated. A gate that
asserts presence but not correctness gives false assurance — the same failure shape
as DEFECT-OAG-016's false-green fixtures, one layer out (the test ran, but asserted
the wrong thing).

## Root cause
The render-validation rule + the first e2e suite specified non-emptiness, geometry,
and a11y — generic surface checks — but no per-slice assertion that the KEY field
takes its expected domain values. Nothing forced "assert Status ∈ {expected set} and
varies".

## Fix (routed → tester.md render rule + EXP-074 sharpening)
The render assertion must verify the slice's KEY DOMAIN FIELD shows the right values
(expected set / varies as the data dictates), not just non-emptiness — non-emptiness
is the floor, correctness is the bar. tester.md "OBSERVE THE RENDER" gains the
key-field-correctness clause; EXP-074's measurement now counts a key-field-correctness
escape as FAILED; e2e Spec 9 (AC3.7-VARY at the live level — Status takes >1 value,
incl. a progressed status) was added and is green. Applied forward to OI-019 (the
Carousel column must render real belts, not all "—"). Targets CFR.
