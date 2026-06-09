# DORA Baseline (fixture — e2e deterministic)

_Fixture for s002 UC5 browser specs. Names a QUEUE as the constraint so the live
A11Y-6/A11Y-7/GEO-3 positive path is exercised end-to-end in a real browser.
(The PRODUCTION baseline.md names an AGENT, "tester", which is NOT a queue and
therefore highlights no box — that non-queue path is the parser's null case,
pinned in baseline.test.js + the live no-highlight is its own e2e in the
production-shaped negative spec.)_

## Theory-of-Constraints read

- Constraint (slowest median step): **ready**
