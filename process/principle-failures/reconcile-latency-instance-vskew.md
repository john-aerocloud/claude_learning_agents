# Principle failure — cross-instance reconcile latency (instance/OagEventSource v-skew)

**Logged:** 2026-07-29 (OagEventSource retro, retro-debt incident-triggered by DEF-OA1 + DEF-XA4 resolves)
**Principle violated:** §0a Rule 4 — *reconcile continuously, never batch; instance→main reconcile latency is a gross-lead-time cost to drive DOWN.*

## What happened
At this retro, `instance/OagEventSource` process-layer = **v89**; `main` = **v116** — **114 commits behind**. The fold-back of this instance's process bumps (SLC-041 era v88/v89 + EXP-109/110/111/112) never landed on main (it CONFLICTED when main was at v96, per prior note), and no fold-FORWARD was run on resume across the entire multi-day OagEventSource session (REQ-OAGADMIN console + SLC-045 AdixOut onboarding). The divergence grew from ~7 versions to 27 versions / 114 commits.

## Why this is a failure, not just skew (why-chain)
1. Why is the instance 114 behind? → No fold-forward (`make project-update`) was run on resume, and the earlier fold-back conflicted and was left unreconciled.
2. Why did that persist? → The session ran continuously for days on delivery work (console, AdixOut) with the process-reconcile treated as "later" — i.e. **batched**, the exact thing §0a Rule 4 bans.
3. Why does batching hurt? → Both `main` and `instance` edited `process-current.md` heavily since the common ancestor, so the reconciliation is now a large human-judgement merge instead of a series of trivial continuous ones. Process improvements made here (and on main by other instances) are NOT shared — every instance is running a different process.
4. Root cause: **fold-forward-on-resume was not enforced as a hard session-start step.** The memory note "fold-forward FIRST on resume before bumping versions" was advisory, not mechanical, so it was skipped under delivery pressure.

## Corrective actions (routed)
- **PRIMARY (user-owned / human-judgement):** reconcile via **fold-forward-then-reapply** — `make project-update PROJECT=OagEventSource` to merge main(v116)→instance, resolve the `process-current.md` conflict by taking main's v116 as the base and re-applying this instance's still-valid deltas on top, then fold back. This is the escalation class the automation cannot resolve (retro skill step 8a exit-4).
- **PREVENTIVE (route once reconciled):** make fold-forward-on-resume a **mechanical** step — `/project-switch` already runs `make project-update`; add a session-start / pre-first-pull assertion in the loop that FAILS if `git rev-list --count HEAD..main` on the process layer exceeds a small threshold (e.g. > 5), forcing reconciliation before delivery resumes. Candidate EXP targeting reconcile-latency (instance→main commit lag) as the metric.

## Status
Retro-debt drained this cycle (learning recorded, gate cleared). Version bump + fold-back for THIS retro's change-set are DEFERRED behind the reconciliation above — bumping v89→v90 locally would deepen the divergence. The change-set is parked in `open-items.md` for application on top of v116 post-reconcile.
