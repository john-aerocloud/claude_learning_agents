# IMP-007 — Impacted-tests lookup from the change-impact model

**Status:** queued (specced at v31 focused retro, 2026-06-07, human-directed)
**Owner:** tester (consumer/spec) / engineer (build) / cicd (make target + allowlist)

## Job
The tester is the named constraint (median 1130s) and most of its cost is
re-discovering what changed and what those changes can affect (s005-h2
validation: 96 tool uses, ~1061s wall, scope assembled by hand from commits,
slice docs, and live probing). Process v31 §12a gives the system a shared
change-impact model (`work/<project>/architecture/dependencies/*.mmd`, mermaid,
updated-in-commit with `classDef changed` marks) and `@covers <node-id>` tags
on specs — but the changed-node → impacted-spec lookup is manual until it is
tooled. Manual lookup will be skipped under time pressure; a §12a discipline
without mechanical support degrades into ornament.

## DORA target
Tester median task time (constraint): target < 900s on slices with a current
model. Secondary: CFR — a changed node with zero covering specs is surfaced
mechanically instead of being noticed (or not) by a human-level read.

## Done condition
`make impacted-tests SINCE=<sha>` (root Makefile, PROJECT-parameterised) that:
1. Diffs `work/<project>/architecture/dependencies/*.mmd` since `<sha>` and
   extracts changed/added/removed node ids (including `classDef changed` marks
   in the working tree).
2. Greps committed specs (tests/validation, tests/smoke, tests/skeleton, unit
   suites) for `@covers <node-id>` tags and emits two lists:
   **impacted specs** (node changed, spec exists) and
   **uncovered changed nodes** (node changed, NO covering spec) — the second
   list is the tester's new-spec work and is a non-empty=warning output.
3. Exits nonzero when a changed source file maps to a node with no covering
   spec AND no test-plan entry (wired into the tester's flow, not CI-blocking
   at first — promote to CI gate only after two slices of clean use).
Output is plain text consumable in a test-plan tick-off list.

## Protection
The target is committed, parameterised, and self-testing: a fixture model +
fixture specs under the tool's own test prove the three behaviours (impacted
listed, uncovered flagged, exit codes). Runs without credentials.

## Score
At the next two slice retros: tester median vs 900s target; count of defects
found in areas the model marked changed-but-uncovered (these should be caught
as warnings BEFORE validation, target: 100% of uncovered changed nodes either
get a spec or an explicit waiver in the test plan).
