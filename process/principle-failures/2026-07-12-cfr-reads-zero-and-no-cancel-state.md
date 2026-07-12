# CFR reads 0% (false) + work items have no cancel state (2026-07-12)

**Project:** OagEventSource (surfaced across SLC-041). **Class:** measurement blind spot +
state-model gap. Both flagged by the human at the /retro gate.

## Defect 1 — CFR = 0% is false
`stats.md` reported **Change failure rate 0.0%** while the same run had a real
deploy-pipeline failure (UC-XA2: push `ec56025` turned the infra CI **red**, fixed forward
to `76a7e58`) and a defect against "done" work (DEF-XA1: the shipped UC-XA2 grant authorized
no one). Root cause: `_dora()` computes `CFR = rejected / (validated + rejected)` — it counts
**only tester `rejected` events**. A deploy failure that is fixed-forward leaves **no event
the metric reads** (recorded under `built_green`), and there was no `deploy_failed` event in
the vocabulary at all. So genuine change-failures were invisible and CFR read a
falsely-perfect 0%. (Foreseen but not fixed in the v86 principle-failure — "a fix-forward
deploy-failure should still leave a trace the counter can read." This retro fixes it.)

## Defect 2 — no cancel/supersede state
The `use-case` (and `defect`/`open-item`) flow graphs had **only `done`** as a success
terminal and **no cancel path**. When delta-042 obsoleted UC-XA3's mechanism, there was no
legal event to retire it — the re-decomposition had to **repurpose items in place** and rely
on a git commit + in-body note as the audit record, because `wi-append` (correctly) rejects
any transition not in the graph. A work-item model with no way to say "this is no longer
wanted" forces either illegal-transition hacks or silent repurposing.

## Fixes routed (retro v87)
- **Machinery (state-graphs.json v5 + work-items.py + test_work_items.py + CONTRACT):**
  add a `cancelled` terminal + `cancelled` event across the flow types (and to aggregates,
  with cancelled children non-blocking in the bubble); add a `deploy_failed` event
  (deploying/prod-deploying → reworking); make CFR count `rejected` + `deploy_failed`; add
  `deploy_failed` to MTTR + rework + quality-by-stage. Test-gated (green before fold).
- **Recording discipline (cicd.md + engineer.md + process §14):** a deploy/CI failure —
  even fixed-forward — MUST be recorded as `deploy_failed`, so CFR reflects reality. This is
  the concrete form of the v86 note.

## Pattern
Same "the metric/gate measures a proxy, not the truth" family as v84 (§12d: `done` ≠ job
delivered), the 2026-06-23/25 presence-not-correctness failures, and DEF-XA1 (the grant
shape-test asserted a condition was *present*, not that it *authorizes*). Recurring class:
**a green/zero reading that reflects un-recorded reality, not verified success.**
