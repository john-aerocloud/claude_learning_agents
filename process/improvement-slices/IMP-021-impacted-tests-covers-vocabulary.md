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


## Measured evidence, 2026-08-29 (ROC, UC-ROC-112 build) — the failure mode is a FALSE CLEAN

Found by an engineer who **ran the tool instead of trusting its own tags**, which is the
only way this class is ever caught.

`make impacted-tests` reported all **six** changed dashboard nodes as **UNCOVERED** —
while they were, in fact, covered. Cause: **`parseCoversTags` splits on COMMAS**, so
`@covers a b c` is parsed as a single identifier `"a b c"` that matches nothing.

**Why this is worse than an ordinary parser bug:** the failure direction is a *false
clean*. A tag the parser cannot read does not error — it silently contributes no
coverage, and the tool then reports the node as untested. An engineer who trusts it
either writes a duplicate test for something already covered, or (the expensive
direction) reads "UNCOVERED" as noise and stops trusting the tool at all.

**Blast radius, counted not estimated: 47 space- or `+`-separated `@covers` lists
elsewhere in ROC are invisible the same way.** They were recorded and deliberately NOT
swept — widening the parser is shared cross-project tooling and belongs in this slice,
not in a use-case build that happened to trip over it.

This is the third recorded instance of the family this slice exists to close, and it is
also an instance of the wider `OI-ROC-014` shape: **a declared control with no reader** —
here the declaration is readable but the reader's grammar is narrower than the
declaration's, which is the same failure one layer in.


## Second measured instance, 2026-08-29 (UC-ROC-114) — a MISTYPED tag is indistinguishable from NO tag

Found late by the UC-ROC-114 engineer, and it reports the finding as *"worth more than the
fix"* — correctly.

It tagged a new node `domain-derivedAlertStatus`, **copying the shape of
`domain-decisionRecord`**. That prefix is a **registered alias, not a convention**. So the
tag named a node the model does not have, and `make impacted-tests` reported the new node —
**on the production read path** — as **UNCOVERED while seven specs covered it**.

**The generalisable failure, stated by the engineer:** *a mistyped tag is indistinguishable
from no tag.* The tool cannot tell them apart, so a new node reaches the tester marked
"needs a new spec" when it is in fact well covered.

**Why this is the more dangerous half of the family.** The first instance (comma-splitting)
produced a **false clean** — coverage silently not counted. This one produces a **false
alarm** that is equally corrosive, and worse in one respect: it teaches the reader that the
tool is noisy. A tool that cries wolf about a covered node is on its way to being ignored,
which is how `DEF-ROC-146`'s tier ended up running nowhere.

**What this slice now owes, beyond the parser widening:** an unknown `@covers` identifier
must be a **hard error naming the unknown id**, not a silent zero-match. The set of valid
node ids is known — the model is the authority — so this is checkable, and the alias/
convention distinction that misled the engineer should be visible at the point of use.
