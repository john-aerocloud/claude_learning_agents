# Ways of working

**What this file is for:** so someone picking the project up continues it the way it was
built, and can tell a *hard gate* from a *default*.

Terms in full on first use: **TDD** = test-driven development; **JTBD** =
jobs-to-be-done; **AC** = acceptance criterion; **DORA** = the four delivery metrics
(deployment frequency, lead time for changes, change failure rate, time to restore);
**CI/CD** = continuous integration / continuous delivery; **WIP** = work in progress.

---

## 1. Hard gates versus defaults — read this first

A **hard gate** is enforced by tooling and blocks progress. A **default** is how we work
unless there is a stated reason not to, and a deviation is recorded rather than argued.

| | Rule | Kind |
|---|---|---|
| 1 | Requirements and defects enter through a single intake step with a human decision | **hard gate** |
| 2 | A defect is **reproduced before it is fixed** | **hard gate** |
| 3 | Tests come first (red → green → refactor) | **default**, near-absolute |
| 4 | Work lands on **trunk**; no feature branches | **default**, near-absolute |
| 5 | Dev first, then production. **Never straight to production** | **hard gate** |
| 6 | An irreversible production **data** operation needs explicit human sign-off | **hard gate** |
| 7 | Work in progress is capped per stage | **hard gate** |
| 8 | A retrospective is owed after incidents / a batch of closes, and blocks new work | **hard gate** |
| 9 | Slice to the smallest increment that delivers real customer value | **default** |
| 10 | Roll forward; keep rollback reversible | **default** |

**If you deviate from a default, record it** — where the project records decisions
(`decision-log.md`), with the reason. The deviations are how the method improves; unrecorded
ones just look like sloppiness later.

## 2. The flow

```
intake → (elaborate) → slice → build (TDD on trunk) → deploy to dev
       → validate in dev → promote → confirm in production → done
```

Nothing is pushed forward by a schedule. Work is **pulled** when there is capacity, and only
items whose dependencies are already done can be pulled together.

**Why pull, not push:** pushing work into a busy stage makes everything take longer without
anything finishing sooner. The measured cost of queueing in this system has consistently
dwarfed the cost of doing the work.

## 3. Slicing — the part most often got wrong

A slice is **not** a layer, a component, or a sprint's worth of effort. It is the smallest
change that lets **a named person do a named job they could not do before**.

Good test of a slice: can you name who is better off, and what they can now do? If the answer
is "the database has a table for it", it is not a slice.

Prefer **one or two personas** per slice. Sequence slices so cost does not spike.

## 4. Test-driven, and what "a good test" means here

Write the failing test first. Then the smallest change that passes it. Then refactor.

**The rule that matters most:** a test exists to validate a **requirement**. Coverage for
its own sake is waste. So:

- a test case should name the acceptance criterion it validates;
- a test with no criterion behind it is either **waste** (delete it) or has found an
  **acceptance criterion nobody wrote down** (register it — and ask why it was missed);
- **do not** satisfy this by mass-relabelling tests. That produces the same theatre the rule
  exists to reject.

**Build test preconditions from real data, not by editing a real record.** Taking a genuine
captured record and deleting or overriding a field to manufacture the case you want means
you are asserting a fact about a population you invented. Fold the prior state from real
events, or harvest a real example.

**A pass is not evidence unless something would have made it fail.** Before trusting a new
check, make it go red on purpose, then revert. Checks that could never fail have shipped here
and read as safety while providing none.

## 5. Defects are specifications

A defect is captured as four things, in this order:

1. **Expected** — what should happen.
2. **Actual** — what does happen.
3. **Intent** — what the person was trying to achieve.
4. **Importance** — who is hurt, and how much.

Then: **reproduce it** (a defect you cannot reproduce is not yet understood), write the test
that fails because of it, fix it, and keep the test.

Defects **pre-empt** new feature work.

## 6. Dev first — and what production is for

Prove the change in dev. Production **confirms**; it does not validate. A fix that has only
ever been seen working in production has skipped the step that makes it repeatable.

Corollary that has bitten before: **shipping code is not the same as running code.** Check
what is actually deployed — a build identifier from the running system — rather than assuming
the commit you made is what is live.

## 7. Documentation is part of done

A change is not finished when it passes. It is finished when the people who need it can use
it and support it. That means, per change that alters behaviour:

- the user-facing docs match what shipped (never what was planned);
- there is a runbook entry for how it fails, not only how it works;
- the delivery record says what landed.

## 8. Retrospectives

Held on a cadence and after incidents, and they **block new work** until done. A retro looks
at where time actually went, finds the single biggest constraint, and changes one or two
things to attack it — each with a named metric and an expected effect, so the next retro can
score whether it worked and revert it if it did not.

**The habit worth keeping:** distinguish what you **measured** from what you **inferred**.
Most bad conclusions in this project came from an inference passed along as an observation.
