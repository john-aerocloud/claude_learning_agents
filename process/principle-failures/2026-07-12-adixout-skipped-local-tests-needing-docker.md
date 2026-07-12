---
date: 2026-07-12
project: AdixOut
iteration: 0
principle: TDD / green means ALL tests pass — a test not run is a test failed
dora_metric_harmed: change_failure_rate
---

## Expected
"Green" / `built_green` / `validated` means the WHOLE test suite passed — including
tests whose runtime dependency (Docker / DynamoDB-Local / an emulator) must be
started first. If the dependency is down, you START it (`make local-up` / `docker
compose up`; start Docker itself if needed) and RUN the tests.

## Actual
Engineers repeatedly SKIPPED the local-tier tests (`tests/local/*`, which need
DynamoDB-Local via Docker) with the excuse "requires Docker/DynamoDB-Local, not
executed here" — on UC-ADIX-001, UC-ADIX-003, and again on UC-ADIX-005. As a
direct result a **stale assertion hid for three use-cases**:
`skeleton.local.test.ts` still expected the pre-UC-003 `legKey#1`
`transactionIdentifier`, but UC-003 correctly changed it to the bounded/hashed
form — and because the local test was never run, nothing caught the drift. The
human: "needing docker is not a reason to not do something, if its not running
start it and then run the tests. Not running tests is the same thing as a test
failure."

## Why the principle did not hold
Agents treated a startable local dependency as a valid reason to exclude a test
from the run, and still reported the item green. "I didn't run it" was allowed to
read as neutral rather than as a failure. That converts a whole tier of the suite
into dead weight and lets real drift (a wrong assertion, and potentially a real
bug) survive validation — a change-failure waiting to surface.

## Guidance for next time
- **A test you did not run is a test FAILURE.** You may NOT report `built_green` /
  `validated` / "green" with any test unrun. If a test's runtime dependency is
  down, START it (`make -C <proj> local-up`; start the Docker daemon if it isn't
  running) and run the test. Only if the dependency genuinely CANNOT be started in
  the environment is it a BLOCKER to report explicitly (not a skip) — and that is
  rare and must be justified, not assumed.
- This binds every test-running agent: **engineer, tester, cicd**. Run the FULL
  suite (unit + local/integration tiers). "104/104 unit green" is NOT green if the
  local tier was skipped — report the local tier too, run and green.
- Routed to the engineer + tester + cicd agent files; a recurring pattern
  (3 use-cases) so it also warrants the cross-agent process rule at the next retro.
