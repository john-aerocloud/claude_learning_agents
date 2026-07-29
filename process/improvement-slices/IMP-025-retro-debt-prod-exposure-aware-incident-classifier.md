# IMP-025 — retro-debt: prod-exposure-aware incident classifier

**Status:** QUEUED (owned by the work-items machinery — a change to the `retro-debt` classifier + wi-tests)
**Opened:** 2026-07-29 (ROC, v120 focused retro — promoted from the v119 open-items deferral on its SECOND occurrence)

## Problem (now TWICE-confirmed)
`make retro-debt` scores ANY `defect-resolve` event as an IMMEDIATE incident that trips the §F8
gate at once (never batched). But §F8's incident intent is a **PROD** defect / deploy-failure —
the thing that must never go un-retro'd. This session, TWO consecutive DEV-only defects with
zero prod exposure each tripped an immediate focused retro:
- **DEF-ROC-010** (e2e-battery not batch-runnable — a test-harness defect) → forced the v119 retro.
- **DEF-ROC-011** (stale AC-062-5 cross-UC assertion — a spec-maintenance defect) → forced this
  v120 retro.
Both were dev-caught, test/spec-only, never near prod (ROC has no prod path at all today —
DEF-009 blocks cloud). Each over-trip cost a full focused-retro cycle (~cheap, but real tokens +
context churn) for zero new systemic learning. v119 deferred the fix as "needs a prod-exposure
signal design"; the immediate recurrence (DEF-011) confirms it is not a one-off and is worth
building.

## Proposed change
Refine the `retro-debt` classifier (in the work-items machinery — `work-items.py`'s retro-debt
computation) so a `defect-resolve` counts as an **IMMEDIATE incident** ONLY if the defect was
**prod-exposed**, else it batches as **routine** (like a slice-close):
- Prod-exposure signal, derivable from the item's own event fold: the defect item ever reached a
  `prod-*` state (`prod-deploying`/`prod-validating`) OR its genesis `reported` event carries an
  explicit `prod_exposed: true` / prod-severity marker. A defect that lived entirely in
  dev/local states (reported→…→fixing→validating→done, no prod-* ever) is dev-only → routine.
- `deploy_failure` events stay immediate incidents unconditionally (they ARE a prod/CI signal).
- For a local-only project (ROC — no prod path), every defect-resolve becomes routine; the gate
  then trips only at the routine-batch threshold or a real deploy-failure, matching intent.

## Target DORA metric + measurement
Lead time / token-efficiency (process overhead): the count of retro cycles forced by a dev-only
defect-resolve drops to ~0 (vs 2 this session), with NO loss of the incident-immediacy that
protects CFR/MTTR (a genuine prod defect-resolve still trips immediately). Falsifiable: if after
the fix a PROD-exposed defect-resolve fails to trip the immediate gate, or a dev-only one still
does, FAILED. Score over the next 3 defect-resolves across projects.

## Guardrail
Do NOT weaken the incident gate for real prod incidents — the EXP-030/v68 lesson (the gate must
be non-skippable for genuine incidents) stands. This narrows WHAT counts as an incident to match
§F8's stated intent, it does not make the gate discretionary.
