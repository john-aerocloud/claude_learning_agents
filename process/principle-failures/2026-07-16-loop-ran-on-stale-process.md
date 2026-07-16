# Principle failure (RECURRING root cause): the dev loop started on a stale process layer

**Date:** 2026-07-16
**Project:** OperationalFlowSimulator
**Agent:** orchestrator (started the loop), tester (paid the cost)
**Principle:** §0a (reconcile continuously — freshness is a precondition, not an afterthought) / §5b (a recurring root cause is a system failure to smooth it)
**Prior entries:** 2026-07-11-impacted-tests-recurred-4x-under-worktree-topology.md; 2026-07-13-impacted-tests-recurred-5x-uc-adix-010.md; 2026-06-24-impacted-tests-blind-to-project-subrepo-dep-model.md

## What happened
The session started the loop via "start the loops" (`/loop-run`) directly, not via
`/project-switch`. The worktree was **66 commits / 8 process-versions behind `main`**
(instance on v83, main on v91). `/loop-run` has no fold-forward step, so the whole
session ran on the stale process layer — including the stale `.claude/tools/impacted-tests.js`.

Consequence: the tester ran the **pre-EXP-104** impacted-tests tool and re-hit the
already-fixed nested-repo `fatal: bad revision` bug on **UC-A9, UC-A10, and UC-A11** —
three manual change-map fallbacks in one session. The fix (`resolveDiffRoot`, EXP-104)
was already on `main` and, once folded forward mid-session, the tool worked first try
(`make impacted-tests SINCE=7969f62 PROJECT=OperationalFlowSimulator` → EXIT 0).

This is the SAME impacted-tests failure logged on 2026-06-24, 2026-07-11 (×4 on OFS),
and 2026-07-13 (×5 on AdixOut) — now ~8 recurrences. But the deeper, more general root
cause this time is not the tool: **the fix existed and simply had not reached the running
instance.** Any already-fixed tool/agent defect will recur on any instance that starts stale.

## Root cause (≥3-level)
1. The tester re-hit a defect that was already fixed on `main`.
2. Because the loop ran the stale (v83) tool — the worktree had not folded main forward.
3. Because `/loop-run` does not fold-forward before its first pull; only `/project-switch`
   does (on resume), and this session entered the loop directly.
4. Root: **process-layer freshness was never a precondition of the loop.** Reconcile
   latency (main→instance) at loop start was unbounded, so an instance could run
   arbitrarily stale tools/agents for a whole session and re-pay for solved problems.

## Remediation (routed this retro)
- **EXP-113** — `/loop-run` STEP 0 = `make project-update PROJECT=$1` before the first
  pull (narrowest owner: `.claude/commands/loop-run.md`), handling exit 0/3/4 per §0a.
  Recorded as a STAGE-F note in `process-current.md` v92.
- The impacted-tests tool itself needs no further change — EXP-104's `resolveDiffRoot`
  is correct and now verified working post-fold-forward on OFS.

## Standing lesson
Fold-back (EXIT side) without fold-forward (ENTRY side) leaves half the reconcile loop
open: improvements land on `main` but never reach the instances still running the old
copy. A loop that can start stale will re-incur every already-solved defect whose
predicate matches. Freshness at loop start is a precondition, checked mechanically, not
a habit that depends on choosing `/project-switch` over "start the loops."
Target: tester lead time + CFR (no rework re-incurring fixed defects) + reconcile latency.
