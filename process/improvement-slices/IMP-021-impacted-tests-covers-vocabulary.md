# IMP-021 — impacted-tests understands the `@covers` prefix/label vocabulary natively

**Status:** QUEUED (re-decided v159 retro, ROC 2026-08-29) — real and unbuilt. Kept because change-impact selection that cannot be trusted pushes testers toward full-suite runs, which is lead time. Not scheduled this cycle: it lost the comparison against production-correctness defects and the Overview use-case chain.

**Opened:** 2026-07-23 (ROC v103 retro)
**Owner:** cicd (tooling — `.claude/tools/impacted-tests.js`)
**Target metric:** tester lead time + CFR (change-impact selection is trustworthy without a
per-project workaround, so a real changed-node isn't silently read as UNCOVERED)

## Problem (recurring, cross-instance)
`make impacted-tests` under-reports coverage: specs tag `@covers` with a project's
prefixed vocabulary (`domain-`/`functions-`/`adapter-`/`config-`) that never matches the
bare node ids in `class-deps.mmd`, so changed nodes read UNCOVERED even when real specs
cover them. Also, node **label text** (not just id) produces false-positive "changed"
nodes. This has now recurred across projects:
- ROC C3 (2026-07-23): `consumer`/`decisionRecord` + 4 port/interface nodes
  (`alertPayload`, `alertStatePort`, `jiraPort`, `soakTriggerPort`) read UNCOVERED; the
  tester patched it PROJECT-LOCALLY with `%% @alias` reconciliation lines in
  `class-deps.mmd`.
- AdixOut (2026-07-23): principle-failure
  `2026-07-23-uc-adix-018-impacted-tests-label-text-false-positive-nodes` — label-text
  false-positive nodes, same tool.
- Lineage: IMP-007 (impacted-tests-from-change-map), EXP-104 (nested-repo git-root),
  EXP-113 (loop-start freshness) — the impacted-tests tool has been a recurring
  fragility surface.

Per-project `@alias` lines are a workaround, not a fix: every project must maintain them,
and a missing alias silently degrades change-impact coverage (a CFR risk).

## Proposed change
Make `.claude/tools/impacted-tests.js` resolve `@covers` tags against BOTH the node id
and its label text, and normalise the common prefix vocabulary
(`domain-`/`functions-`/`adapter-`/`config-`) so a tag matches its node without a
per-project alias. Keep the 14+ self-tests; add cases for prefixed-tag matching and
label-text nodes. When it lands, projects can drop their `@alias` scaffolding.

## Done condition
On a project using the prefixed `@covers` convention with NO `@alias` lines, a changed
node covered by a real spec is reported COVERED (not UNCOVERED), and a node identified by
label text is not a false-positive; the tool's self-tests cover both; ROC + AdixOut both
run clean without per-project alias maintenance.

## Note
Queued with product/process work (§32). Until it lands, projects keep the `@alias`
workaround (ROC's is committed in `class-deps.mmd`).
