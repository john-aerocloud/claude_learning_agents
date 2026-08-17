# 2026-08-14 — 15 days of batched integration, and two projects allocating the same experiment IDs

**Class:** recurring root cause (process §0a Rule 4 violated continuously, undetected).
**Logged from:** ROC retro, triggered by `REQ-ROC-006` close + `DEF-ROC-029` resolve.

## What was measured

| Fact | Value |
|---|---|
| Oldest unmerged `instance/ROC` commit | **2026-07-30** — 15 days |
| ROC process commits not on `main` | **19** |
| `main` commits not on `instance/ROC` | **67** |
| ROC's working process version | **v118** |
| `main`'s process version | **v140** |
| Experiment-ID high-water mark on `main` | **EXP-135** |
| Experiment IDs ROC allocated | **EXP-119 … EXP-124** — all six already taken on `main` |

§0a Rule 4 says reconcile continuously, never batch, because reconcile latency is a
gross-lead-time cost. We batched for fifteen days in both directions at once.

## Why this was expensive, not merely late

Being behind is survivable. **Being behind while still authoring process changes is not**, and that
is what happened:

1. ROC spent two weeks operating on a process **22 versions stale**, so every judgement it made
   about "what the process says" was made against a superseded document.
2. ROC allocated experiment IDs from a **stale high-water mark**, so `EXP-119`–`EXP-124` now name
   *different experiments in different repos*. The registry is the substrate the whole
   self-improvement system reads. Two experiments sharing an ID does not merge — it corrupts.
3. Anything `main` had already learned, ROC could re-derive from scratch and pay for twice. (Here
   we got lucky: `main` had *not* fixed the transition-allowlist problem and did *not* carry the
   atomic-pathspec rule, so ROC's work was genuinely novel. That is luck, not a property of the
   design.)

## Root-cause why-chain

1. **Why is reconcile latency 15 days?** No fold-back landed after any ROC process commit since
   2026-07-30.
2. **Why not?** Fold-back is specified as the *retro's close step*. Retros did run (markers exist
   for v119 and v120) — so either the helper returned DEFERRED (integration tree dirty) and nobody
   chased the owed command, or the close step was skipped. Either way the failure was **silent**.
3. **Why did nobody notice for two weeks?** Because **the only thing that measures reconcile
   latency is step 1 of the retro itself.** A metric observed exclusively at retro time cannot
   alarm between retros — it can only report, afterwards, how long it was already broken.
4. **Why did it compound instead of staying flat?** Because nothing forces fold-*forward* on
   resume either. Both directions drifted independently, so the divergence grew in two dimensions
   and the ID space silently overlapped.

**The generalisation:** a latency whose only observer is the ceremony that follows it will always be
discovered late. It needs an observer that runs on the *loop's* cadence, not the retro's.

## This is a REPEAT

The identical failure is already on record for **OagEventSource**: fold-back conflicted with `main`
at v96, and the recorded lesson was *"fold-forward FIRST on resume before bumping versions."* That
lesson was written down and then not enforced anywhere — so ROC reproduced it exactly, including
the version-bump-against-stale-base part.

A lesson recorded as prose, with no gate, is a lesson we will pay for again. That is the same shape
as three other findings from this same day: `uc006`'s fresh-stack precondition (prose, unenforced →
`DEF-ROC-027`), delta 002's partition key (asserted in four artefacts, implemented in none →
`DEF-ROC-026`), and `EventHubsLogConsumer` swallowing `ReceiverDisconnectedError` (caught, never
surfaced → `DEF-ROC-031`). **Four instances, one day, one shape: a stated invariant with nothing
asserting it.**

## Corrective actions

1. **Fold forward, then renumber, then fold back** — in that order, per the OAG lesson. ROC's
   experiments must be re-allocated above `main`'s high-water mark (from **EXP-136**).
2. **A reconcile-latency gate on the loop's cadence**, not the retro's — so the number is visible
   while it is still small.
3. **Central ID allocation** for experiments, so no instance can mint an ID another already used.

## How the diagnosis could be wrong

If `main`'s `EXP-119`–`124` were themselves ROC rows that folded back in an earlier cycle and were
then retired, there is no collision — only a format divergence (`main` uses a table, ROC uses `##`
headings). **Verify each ID's subject before renumbering.** The corrective action is cheap either
way; the claim of corruption is what needs the check.
