# IMP-017 — per-UC git-worktree isolation for parallel inner-loop builds

**Status:** proposed (deferred — validate on a cleaner sample)
**Opened:** 2026-07-12 (AdixOut retro, process v84)
**Targets DORA metric:** lead time for changes (reduce the `ready`-state GLT share).

## Problem (evidenced)
AdixOut retro: `queue` is 76.6% of gross lead time (`ready` 48.9% + `registered`
27.7%); items sat Ready waiting to be pulled. Root cause (why-chain):
1. Independent use-cases (UC-ADIX-002/003/004, all `deps:[UC-ADIX-001]`, mutually
   independent per the slice design) built one-at-a-time, not in parallel.
2. The inner dev loop dispatches engineers into the SAME `work/<project>` working
   tree; concurrent subagent processes there would stomp each other's git index +
   files, so pulls must serialise.
3. The loop's "pull the maximal independent set" (§F6) therefore cannot actually
   run in parallel — the parallelism model assumes flag isolation, but flags do
   NOT isolate concurrent filesystem edits by separate agent processes.

(Note: this cycle's absolute `ready` seconds are inflated by a spend-limit outage +
human-steering gaps + deliberate pacing — so the constraint is DIRECTIONAL. Validate
the lever on a cleaner, larger sample before heavy investment.)

## Solution (to build + test)
Have the inner dev loop dispatch each pulled use-case's build in its OWN **git
worktree** (the Agent tool's `isolation: "worktree"`), so the maximal independent
set builds concurrently without index/file contention, then reconcile the green
branches back to trunk (fast-forward or ordered merge) — mirroring the
worktree-per-PROJECT topology (§0a) one level down, at the per-UC grain. Handle:
collision detection when two UCs touch the same seam (already modelled, §19);
push-serialisation to the shared remote; and the reconcile cost (must stay below the
parallelism saving).

## Measurement (falsifiable)
On the NEXT slice with ≥2 independent ready use-cases, compare `ready`-state GLT
share and per-slice wall-clock against this cycle's serial baseline. Success = a
material drop in `ready` share with no rise in CFR (parallel builds must not increase
collisions/rework). Can come back negative: if reconcile/collision cost ≥ the
parallelism saving, or CFR rises, the lever is rejected.

## Why an improvement-slice, not an inline change
Needs building + testing (worktree lifecycle, reconcile, collision handling in the
loop machinery) — routed per process §32/§36, queued with product work, not
hand-assembled mid-loop.
