# Default delivery approaches (the agents' beliefs)

These are the defaults every agent acts on. They are beliefs, not laws: an agent
may deviate when a specific problem demands it, but **every deviation must be
logged in `/process/principle-failures/`** with what was expected, what
happened, and why the principle did not hold. That corpus is how the team learns
where principles fail.

1. **XP.** Short feedback loops, simple design, refactor continuously, pair via
   agent collaboration, customer (Product agent) on hand to define value.

2. **Always TDD.** No production code without a failing test first. Red → green
   → refactor. Acceptance tests define the slice; unit tests drive the design.

3. **Slice value.** Deliver the smallest increment that gives a real user a real
   outcome (Neil Killick style). Each slice ties back to a Job to Be Done. Never
   build infrastructure ahead of the slice that needs it.

4. **Trunk-based development.** Keep work-in-progress sequentially independent so
   it can land on main continuously. No long-lived branches.

5. **Continuous deployment.** Pushing to main runs a pipeline that validates and
   deploys to production. The pipeline is the gate, not a person (except the
   defined human checkpoints).

6. **Roll forward, but keep rollback possible.** Prefer fixing forward on
   failure. All rollback scripts must be maintained; anything irreversible
   (e.g. DB migrations) must be written immutable and reversible.

7. **Defect = a normal piece of work.** Define expected behaviour, capture
   current behaviour, write tests that pin the correct behaviour, then make them
   pass.

8. **Jobs to Be Done.** Everything traces back to customer value and a better
   user experience. If a task can't be tied to a JTBD outcome, question it.

9. **No merge without a passing build (and no test regressions).** Never merge a
   branch unless the merge result **at least builds**. Any unit tests that pass on
   **both** branches before the merge **must still pass after** it. Any tests
   **failing before** the merge must be **resolved** (fixed, or the merge reworked)
   — a merge must neither carry nor create red. A textually clean merge
   (`git merge-tree`/no conflict markers) is **not** a verified merge: build it, and
   run the tests, **before** pushing to a shared/integration branch. The build must
   cover the real deployable surface — the eDCS front-end and the web services and
   every project that connects to them — not a convenient subset.

10. **Analyse code with the compiler/AST, not grep.** When reasoning about a
    codebase's structure or behaviour (what a symbol is, which method encloses a
    line, real write-sites vs. comments/strings, how two versions differ), the
    **sensible default is the language's own compiler/AST tools** — e.g. Roslyn
    (`Microsoft.CodeAnalysis`) for .NET. `grep`/text search is a **backup**, for
    trivial literal-string checks only, not for structural or semantic conclusions.

11. **Diagnose regressions from a known-good baseline, then bisect.** When a build
    or test fails after a change, first re-establish that the pre-change baseline
    is green; if it is, **binary-chop** the intervening commits to pin exactly where
    it broke. Never assume the cause — prove it. A failure in code the change never
    touched is pre-existing until a baseline build shows otherwise.

## Environments (CICD belief)

Default to deploying straight to production. Introduce an environment only to
satisfy a non-functional need:
- a **test environment** when there is a customer to protect;
- **per-user feature flags** when releasing a change to some-but-not-all users;
- additional environments only for performance testing, UAT, or research.

Never add an environment before the need is real — it adds lead time.
