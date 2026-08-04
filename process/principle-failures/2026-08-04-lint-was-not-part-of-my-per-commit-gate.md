# A per-commit gate that ran `tsc` and the suite but NOT `eslint` — and on a shared trunk the commit is the push

**Date** 2026-08-04 · **Agent** engineer · **Item** `UC-BPC1` (delta-058 rework) ·
**Cost** one red CI run on trunk (`30925094459`), which briefly blocked the `DEFECT-OAG-053`
fix queued behind it · **Fixed forward at** `96fd973`, green at `fe3b569`

## What happened

I built the rework in five red→green increments and ran a verification before each commit —
but my verification was **`tsc --noEmit` + the vitest suite only**. I ran `eslint` once, at
the end. Two spec helpers in `uc-bpc1-census-emit-contract.test.ts` and
`uc-bpc1-order-invariance.test.ts` had inferred return types, which
`@typescript-eslint/explicit-function-return-type` rejects. So commit `29ce794` was
**lint-red from the moment it existed**, and I did not find out until three commits later.

It reached `origin/main` before I found it, because another agent's `git commit` swept the
shared index and pushed. Trunk went red on the Lint step and the rest of the job never ran.

## Why the existing rule did not save me

v89/DEF-ROC-002 says a green suite is not green — the **type-check** is part of the bar,
because fast runners transpile without checking types. I had internalised that one and built
a whole isolated-tree harness for it. But the rule I generalised from DEF-ROC-002 was
*"vitest does not type-check, so also run `tsc`"*, and I stopped there. The actual
generalisation is one step wider and CI already states it plainly:

> **Every gate CI runs is part of "green". Lint is one of them, and neither vitest nor `tsc`
> is a proxy for it.**

Lint is not a style nicety here — it is a CI job step that **short-circuits the whole job**,
so a lint error hides the test and build results behind it. A trunk that is lint-red is a
trunk nobody can read a test result from.

## The second, sharper half: I treated "commit" and "push" as separable when they are not

I deliberately committed at each green sub-step (v95) and intended to run the full gate set
once before pushing. That plan is only sound in a tree I own alone. In this worktree
**several agents share one git index and one branch**, so any agent's `git commit` can carry
my commits, and any agent's `git push` can publish them. The coordinator has logged their own
half of this (a bare `git commit` after a path-scoped `git add`). Mine is the corollary:

> **On a shared trunk, the moment a commit exists it may be applied. So the pre-PUSH gate set
> and the pre-COMMIT gate set are the SAME set.** "I will run lint before I push" is not a
> plan — it is a bet that no one else pushes first, and `deploy-shared` runs unconditionally.

I even wrote a harness (`verify-mine.sh`) that reconstructed *exactly* the tree my commit
would produce, precisely because I knew the shared tree could not be trusted — and then did
not put lint in it. The gap was not the mechanism; it was the gate list.

## What changes

1. **The per-commit gate list is `lint` + `build` (`tsc --noEmit`) + `test` — all three, every
   commit, no exceptions.** Not "before push". Before each commit.
2. **When co-owning a tree, verify against the tree your commit will PRODUCE, not the working
   tree.** `git archive HEAD` + your own paths, then run the full gate list there. The working
   tree contains other agents' in-flight work, so a red there is ambiguous and a green there is
   not a claim about your commit. (This part worked well and is worth keeping — it correctly
   caught a `CensusReport` type error and an untagged `it.each` title that the shared tree's
   noise would have masked. It just needed lint in it.)
3. **Derive the gate list FROM the pipeline, not from memory.** The authoritative list is the
   CI job's steps. If a step exists in `.github/workflows` that is not in the local gate list,
   that is the defect — not the run that discovered it.

## The generalisable rule

> **"Green" means every gate the pipeline runs, and the list is read off the pipeline — not
> recalled.** A local gate set assembled from remembered lessons will always be a subset of
> the pipeline's, and the missing member is discovered by a red trunk. And on a shared trunk
> there is no such thing as a "local-only" commit: pre-commit and pre-push are one gate.

Sibling of DEF-ROC-002 (a green suite hid a `tsc` error) and DEF-ROC-006 (a spec passing its
runner broke the build graph). Same family, one layer further out: a passing suite AND a clean
type-check hid a lint error.
