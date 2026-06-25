# 2026-06-25 — e2e/contract specs assert an incidental live-data condition, not the acceptance INVARIANT

**Principle:** an e2e / integration / contract spec asserts the acceptance INVARIANT. Where the validated surface depends on live data, the spec branches on the data state (assert the sanctioned empty-state when legitimately empty) or derives "expected" from per-entity ground truth — never from an incidental condition (a row count, global-feed ordering, request/page count, or presence-when-absence-is-valid) that varies with live data independent of correctness. Generalizes EXP-074 (the render gate) to ALL specs.

**Pattern (3 data points, the SLC-014 validation batch):**
1. **BIDS `bids-board.spec.ts`** — asserted `rows > 0` unconditionally. AC-B2.6 SANCTIONS an empty board ("No flights with baggage on belt") when the 4h window has no arrived-with-carousel TPA flight → false-fail on a correct, legitimately-empty board. (EXP-074 weakness #2.)
2. **oi-020-4 `oi-020-reingest-contract.spec.ts`** — derived each stream's expected state from GLOBAL category-feed position order. Per-stream event order ≠ category-feed position, so a FlightLanded at category-pos N superseded by the stream's own FlightOnBlock at N+50000 (outside the 2000-event scan) looked like "Arrived vs Departed." The fold was CORRECT (proven by per-stream `getFlight` OOOI evidence).
3. **AC-B3.5 `bids-board.spec.ts`** — asserted backward-**request** count `=== 1`. The real invariant is ONE bootstrap SUBSCRIPTION; `backwardScan` legitimately pages until it collects 50 distinct streams, and SLC-013/014's new `FlightScheduleUpdated` events dilute distinct-streams-per-page → one bootstrap pages twice → false "got 2, want 1."

**Cost:** each false-fail LOOKED like a regression/defect — DEFECT-OAG-027 was raised and a full engineer cycle spent before it proved to be a SPEC bug, not a code bug (~3 wasted adjudication cycles). Also inflates CFR with false defects (window CFR hit 25%, partly these false alarms).

**Fix pattern applied:** (1) branch on empty-state (BIDS); (2) derive expected from per-stream `getFlight`/OOOI ground truth (oi-020-4); (3) assert the subscription invariant, robust to a multi-page scan (AC-B3.5).

**Why caught:** orchestrator + tester source-verification (EXP-080) — every "failure" was checked against the actual board/event/metric state before being believed. That's what surfaced "spec bug, not code bug" each time.

Routed: EXP-081 (assert-the-invariant) → tester.md + engineer.md spec-authoring; + cicd a committed `ci-watch` make target (the role contract references one that doesn't exist).
