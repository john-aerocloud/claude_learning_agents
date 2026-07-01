# IMP-011 — split `normaliser-core.ts` into per-event-type handlers (EXP-086 trial)

**Owner:** engineer (pure structural refactor, TDD on trunk).
**Routed by:** v71 retro (2026-06-30). Trial-after-SLC-029 condition now SATISFIED
(SLC-029, the last backend slice on the shared seam, shipped + validated PASS
2026-06-26).
**Experiment:** EXP-086 (moves `planned` → `active`).
**Guard:** the existing corpus regression suite must stay green end-to-end — this
refactor MUST NOT change any normalised output (CFR guard).

## Problem (the evidenced friction)

Every backend OOOI/genesis/change use-case mutates ONE file,
`work/OagEventSource/src/app/src/core/normaliser-core.ts`. RG1/RG2/TO1/DA1 (SLC-026/
027/028) and the SLC-029 carrier/codeshare UCs are BEHAVIOURALLY independent — each
adds a distinct per-event-type genesis/change handler — yet the §F6 shared-file seam
forces them serial. The flow-manager correctly logs `par_eff=0.84` (achievable set
capped to 1 on this seam, EXP-051/053). This is a real, recurring gross-lead-time
time-thief on every backend wave, and a §F7 false-edge candidate (banked
2026-06-26 in the edge-ledger as `NORMALISER-SPLIT`). The seam-serialisation is
correctly REPORTED; this slice tests DISSOLVING it.

## Solution (the intervention under test)

Split the monolith into per-event-type genesis/change handlers behind a dispatch
table — one file per event-type — so behaviourally-independent UCs claim DISJOINT
source files and the flow-manager can dispatch them as a true parallel set (M=3+).

- A thin `normaliser-core.ts` retains the `normalise()` entry + routing; per-type
  logic moves to `src/core/handlers/<event-type>.ts`.
- The `CarrierReferencePort` / `AirportReferencePort` reference seams (delta-029/030)
  stay shared ports — declared as such so a port-contract change still serialises
  (those are genuine edges, not false ones).
- No change to canonical output: the corpus regression suite is the equivalence
  oracle. Pin it green before and after.

## Acceptance / done condition

1. The corpus regression suite is green (byte-identical normalised output) before
   AND after the split — 0 regression.
2. After the split, the next multi-event-type backend pull dispatches ≥3
   behaviourally-independent handler UCs in PARALLEL on disjoint files, and the
   flow-manager reports `par_eff` materially > 0.84.
3. The edge-ledger `NORMALISER-SPLIT` entry is updated to record the dissolved
   false-edge.

## Target metric (EXP-086)

- gross lead time (backend wave wall-clock = slowest chain, not the sum).
- throughput (par_eff rises toward 1.0 on a multi-handler pull).
- guarded by CFR (pure structural refactor — must NOT change normalised output).

## Scoring

Scores on the FIRST multi-event-type backend pull after the split lands. PASS iff
≥3 independent handler UCs dispatch in parallel on disjoint files with par_eff
materially > 0.84 AND 0 corpus-regression breakage. FAILED if the split lands but
the next pull still serialises (residual shared seam) or the corpus suite reds.

## Scheduling note

Per §10 selection rule (1) DORA-helping process improvements first — this is a
parallelism/throughput improvement on the constraint's seam, queued with product
work. It is a pre-build structural enabler: schedule it BEFORE the next
multi-handler backend slice so that slice can be pulled as a true parallel set.
No new attack surface, no new data flow (architect self-certifies: refactor only).
