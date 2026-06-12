# DEFECT-015 — Non-atomic drift REPAIR created a transient ready-queue incoherence (detector true-positive)

**Reported:** 2026-06-12 (human, server log: "[stage-flow] coherence mismatch in
ready: items.csv ready-count=0 vs queue_depth=1")
**Status:** CLOSED (self-healed; discipline gap routed — no code fix needed)
**Surface:** registry/queue bookkeeping (no UI/server code defect)
**Lineage:** DEFECT-013 family (non-atomic multi-step bookkeeping act)

## Expected
The three views (items.csv / queue csvs / ledger) never disagree (EXP-037);
any repair of drift restores ALL views in one act.

## Actual
The orchestrator's DEFECT-013 repair of UC-S018-1 flipped items.csv
ready→in-flight but left its ready.csv row → items.csv ready-count=0 vs
queue_depth=1. The DEFECT-004 coherence check correctly logged the mismatch.

## Intent
Operator trusting the board/logs during the live loop.

## Importance
Low-impact transient (minutes), BUT the act class is the recurring root cause
of the whole 004/012/013 family — this instance shows even REPAIRS reproduce
it when not atomic.

## Reproduction / resolution evidence (2026-06-12)
- At report time the mismatch was real (log). At verification: ready.csv
  empty, no state=ready registry rows, live API queue_depth=0,
  coherence_warning false — the UC-S018-1 build engineer's atomic pull
  (first act, per the DEFECT-013 ritual) removed the row and healed it.
- Verdict: detector TRUE-POSITIVE; defective act = the orchestrator's
  half-repair; no code defect (both detectors — DEFECT-004 queue check and
  DEFECT-013 registry check — fired/behaved correctly).

## Fix
No engineering fix. Discipline routed: flow-manager.md reconcile clause
sharpened — a drift repair transitions state AND queue rows AND a ledger note
in one act; partial repairs are themselves drift. (Orchestrator practice
bound by the same clause.)

## Gap-closing
EXP-041 sharpened (not a new experiment — same predicate, same metric): the
atomic-act rule applies to REPAIRS as well as pulls. Scoring unchanged
(applies-to: every pull, every self-recorded row, now every repair).
