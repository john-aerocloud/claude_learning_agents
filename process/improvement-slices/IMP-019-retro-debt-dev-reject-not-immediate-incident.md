# IMP-019 — A resolved dev-validation `rejected` batches ROUTINE, not immediate-incident

**AdixOut v102 retro (2026-07-23) — VALIDATED (working).** REQ-005 Chunk B's UC-019/020
dev-rejects were classified ROUTINE and the retro BATCHED cleanly at the chunk boundary
instead of thrashing an immediate full retro per dev-catch (the pre-IMP-019 behaviour). No
prod defect appeared after a batched dev-reject (the CFR falsification guard held). The
change is doing exactly what it was implemented for. Continue watching across the next
retros that no prod escape follows a batched dev-reject.

**Status:** IMPLEMENTED at v101 (2026-07-23, AdixOut retro — REQ-005 Chunk B close).
Landed in `.claude/skills/work-items/scripts/work-items.py` `compute_retro_debt`: the
use-case `rejected`/`build_failed` branch now appends to **routine** (detail label
`uc-rework`) instead of `incidents`, so a dev-validation reject batches to the retro
threshold rather than tripping an immediate retro; the `defect`-resolve branch stays an
immediate incident. Module cadence comment updated. Machinery self-tests extended and GREEN
(`test_uc_rejection_is_routine_not_immediate_incident`,
`test_uc_reject_then_validated_is_routine`, `test_uc_rework_batches_to_threshold`,
`test_uc_build_failed_is_routine_not_immediate_incident`; `test_incident_defect_fires_immediately`
still asserts the defect immediate-incident). NOTE: the shipped change is the SIMPLE
reclassification (ALL use-case rejects → routine); it does not implement the finer
"unresolved / repeated reject still trips" distinction sketched in the original Done
condition below — that was deliberately NOT re-decided this retro. Score at the next two
retros per §Score.

Original proposal (QUEUED 2026-07-22, AdixOut v99 retro — REQ-005 Chunk A close; retro-cadence thrash):
**Owner:** work-item machinery (the §F8 retro-debt gate in `work-items.py`); orchestrator consumes the classification

## Job
The §F8 retro-debt gate currently treats ANY `rejected` event as an
immediate-trip incident, so a dev-validation reject that is FIXED and
RE-VALIDATED green within the SAME slice still forces an immediate full retro
(plus its cross-instance reconciliation overhead). This session ran **3 retros in
one AdixOut drain**, largely triggered by dev-catches — a WAF false-positive
(UC-ADIX-017) caught in dev and fixed in rework, which is the process WORKING
(XP/TDD/dev-first catching a defect before prod), not an incident. Treating a
contained-and-recovered dev reject as an immediate incident makes the retro
cadence thrash and inflates gross lead time per delivered UC for no added
learning safety (the learning is still captured at the batched retro). This is
the highest-leverage fix for the observed thrash, but it is a MACHINERY change
with self-tests and must NOT be done inline under time pressure — hence queued.

## DORA target
Gross lead time — reduced retro-trigger frequency / reconciliation overhead per
delivered UC, WITHOUT letting a real regression escape. Guarded by CFR: a PROD
defect appearing after a batched dev-reject would FALSIFY this change (it would
mean a real regression escaped because the immediate retro was deferred).

## Done condition
In the retro-debt incident classification (the §F8 gate in `work-items.py`), a
`rejected` event that is **followed by a `validated` (or `dev_validated`) on the
SAME item before the debt check runs** is classified as ROUTINE — it accrues to
the next BATCHED retro (learning still captured there), it does NOT trip an
immediate full retro. Only these still trip IMMEDIATELY:
  - a `deploy_failed` event; and
  - a PROD-scope defect (`DEF-…`) `resolved` event.
An **unresolved** `rejected` (no subsequent `validated` on the item at
debt-check time) and a **repeated** reject on the same item (reject → validated →
reject again) still COUNT toward the debt and still trip per the existing rule —
only the single contained-and-recovered dev reject is reclassified as routine.

## Protection
The machinery has self-tests; add fixtures asserting: (1) a `rejected` followed
by a `validated` on the same item before the check → ROUTINE (no immediate trip);
(2) a `rejected` with NO subsequent `validated` → still trips (unresolved);
(3) a `rejected` → `validated` → `rejected` again → still trips (repeated);
(4) a `deploy_failed` → still trips immediately; (5) a PROD `DEF-` resolve →
still trips immediately. Runs without credentials, cross-platform via the
work-items launcher.

## Score
At the next two retros: retro-trigger frequency (retros per delivered UC / per
drain) should FALL versus this session's 3-in-one-drain, AND 0 prod defects
appear that a deferred immediate retro would have prevented (a prod defect after
a batched dev-reject falsifies). Note: this is the highest-leverage fix for the
observed retro thrash but is deliberately DEFERRED to a tested machinery change,
not applied under time pressure.
