# IMP-010 — Coherence-family post-mortem: one root cause behind 10 of 16 defects

**Status:** evaluation complete 2026-06-17 — recommendation: **adopt a forward
design principle (EXP-047); do NOT refactor the delivered observatory now.**
**Owner:** orchestrator (post-mortem) / solution-architect + engineer (future application)
**Trigger:** retro-effectiveness analysis (2026-06-17) flagged a 10/16 defect concentration.

## The finding

**10 of observatory's 16 defects are one family** — the dashboard truthfully
reflecting *"what work is happening right now"*:

| Defect | The disagreement |
|---|---|
| DEFECT-001 | UI shows 0 while work is happening |
| DEFECT-002 | phantom WIP from abandoned open events |
| DEFECT-004 | UI inconsistent with itself; queued WIP invisible |
| DEFECT-009 | product's in-flight work invisible |
| DEFECT-010 | recent work on terminal items excluded |
| DEFECT-011 | WIP recency horizon too short |
| DEFECT-012 | decomposed work invisible between product and triage |
| DEFECT-013 | pulled items stay `planned` until the next sweep |
| DEFECT-015 | non-atomic repair created transient queue incoherence |
| DEFECT-016 | validate card empty during the dispatch-lag window |

## Root cause — three sources of truth for one fact

The state of a work item *right now* is recorded in **three independent stores**:
1. the **DORA ledger** (`process/dora/ledger.csv`) — an event log,
2. the **work-item registry** (`items.csv`) — a `state` field per item,
3. the **queues** (`queues/*.csv`) — membership.

Every defect in the family is a **disagreement among these three**, or a derived
"now" metric trusting one over the others. They are independent *writers* of the
same fact, so they drift by construction — and the whole patch sequence
(EXP-035 recency-only WIP, EXP-037 keep-registry-current, EXP-041 atomic-pull,
the EXP-following coherence detector) is **reconciliation machinery layered on a
design that requires reconciliation.**

## What the patch sequence cost vs. achieved

- **Achieved:** convergence. The coherence detector built for DEFECT-004/013 now
  *auto-catches* drift (it caught DEFECT-013/015 recurrences). The bleed is
  contained.
- **Cost:** ~7 defects + ~4 experiments + a **standing tax** — every pull, every
  agent, forever, must perform the atomic-pull ritual (EXP-041) and self-record
  item-keyed rows, precisely because the three stores can disagree.

## Single-source-of-truth evaluation

The structural fix: make two of the three stores **projections** of the third so
they *cannot* disagree.
- **Option A — ledger-derived state.** `items.csv` state and queue depth are
  computed from the event ledger, not independently written. Eliminates the
  disagreement class entirely (you can't have items.csv say `ready` while the
  ledger says `in-flight` if state is derived from the ledger). Cost: M/L —
  refactor the stage-flow aggregator + every items.csv/queue writer + reader.
- **Option B — single atomic writer.** Keep three stores but one owner
  (flow-manager) writes all three in one transaction. This is partially what
  EXP-041 already legislated by *discipline* — but discipline is not structure;
  DEFECT-015 was a non-atomic *repair* slipping the discipline.

## Recommendation (the actual decision)

**Do NOT refactor the existing observatory.** REQ-OBSERVATORY is delivered
(requirement-complete), and the coherence detector already contains the bleed —
the marginal value of an M/L data-layer refactor on a *finished* project is low.
A refactor pays back only if observatory work resumes or the three-store pattern
is reused.

**Instead, capture the lesson as a forward design principle (EXP-047):** *a
derived "now"-state metric must have a single source of truth; when the same fact
lives in N stores, N−1 of them must be projections of the first, never
independent writers.* This is the cheap, high-leverage move — it prevents the
entire family from recurring in the **next** project without paying to refactor a
done one. The solution-architect applies it at design time; the engineer applies
it when building any aggregation of "current" state.

## Done condition (this evaluation)

1. ✅ Post-mortem written; root cause named (three independent writers).
2. ✅ SSOT options costed; refactor-vs-principle decision made and justified.
3. ✅ Forward principle registered as **EXP-047** and routed to
   solution-architect.md + engineer.md (applies-to: any derived now-state metric
   or multi-store state).
4. ⏸ Observatory data-layer refactor: **deferred** — reopen only if observatory
   resumes or the pattern is reused (would be its own requirement, not a slice).
