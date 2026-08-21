# The sequencer-guard analyser was written before its first failing test

**Date:** 2026-08-21
**Principle:** always-TDD (`delivery-principles` — red → green → refactor)
**Item:** `OI-ABANDONED-SEQUENCER-STATE-ARMS-A-56-COMMIT-DESTRUCTION`
**Commits:** `83ecbbf`, `fe52d07` (parent-repo lane)

## What happened

The engineer built `.claude/tools/sequencer-guard.js` **before** writing a failing test for it.
The 15 specs, the 6 python `loop-gate` specs and the four mutation demonstrations were all
authored afterwards. In the engineer's own words: *"the specs and the four mutation
demonstrations were the recovery, not the discipline."*

**It was self-reported, unprompted, in the dispatch report.** Nobody caught it; the engineer
volunteered it under a heading it created for the purpose. That is the behaviour to reinforce —
this record exists because the deviation was declared, not because it was detected.

## Why it is logged rather than waved through

The outcome was good: `229/229` tools tests, `442` work-items tests, six mutants each
demonstrated red and reverted, and `loop-gate` exit 0. So the *artifact* is not in doubt.

What TDD buys that a good outcome does not is **evidence that the test can fail for the right
reason**. Written after the code, a test is authored by someone who already knows the answer, and
the failure mode is that it encodes the implementation's own assumptions. This project has three
measured instances of exactly that, all found on this same day:

1. `DEFECT-OAG-053` — 31 pins green against a guard that **could not fire**.
2. `UC-ML4`'s `AC-ML4.3` — claimed against `InMemoryEventStore`, which satisfies the property
   **by construction** (an array splice), so the assertion asked our own belief.
3. `OI-IMPACTED-TESTS-CANNOT-SEE-190-OF-192-CHANGE-MARKS` — **203 pre-existing tests stayed green
   in both directions**, because every `class` case in the suite was written *with* the trailing
   semicolon the code required. Red→green only ever proved the code agreed with itself.

So the risk this deviation runs is not hypothetical here; it is the single most-repeated defect
class in this repo. The mutation demonstrations are what discharge it in this instance — each
mutant flipped real cases red, which is the property test-first would have established earlier and
more cheaply. **Mutation testing after the fact is an adequate substitute for test-first; asserting
the code works is not.**

## What the deviation did NOT cost, stated so the record is fair

The item's own premise was *corrected* by this work rather than merely implemented: git 2.50.1's
`abort-safety` makes a **bare** `git revert --abort` refuse to rewind a moved HEAD, so the
56-commit loss requires a `--continue` first, which rewrites `abort-safety` and re-arms the
rewind. `git rebase --abort` has **no safety check at all**. Both are now pinned as tests rather
than described in comments. A test-first order would not have found that; running the real thing
did.

## Corrective

No process change proposed. The existing rule is right and was breached knowingly; the mutation
demonstrations closed the gap the breach opened. Recorded per `delivery-principles` so that
deviations accumulate visibly rather than silently, and so the reinforcement — that a
self-declared deviation is cheaper than a detected one — is on the record too.
