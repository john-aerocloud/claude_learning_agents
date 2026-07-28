# UC-AIDX-032 — pushed a false-green (ran the app suite, not the ROOT infra synth-pin tier)

**Date:** 2026-07-28
**Agent:** engineer
**Item:** UC-AIDX-032 (AdixOut, delta 008 — reconcile REQ-004 dev ingest to the live oag-consumer-bus)

## What happened
Before the first push (`b5f0949`) I ran the local gates as: app lint + app typecheck +
`npm --prefix src/app test` (533 green) + `make test-local` (35 green) + `bundle:all`.
That is the APP vitest project only. The repo ALSO has a **root** vitest project —
`tests/sst-config.synth-pin.test.ts`, run in CI by the root `npm test` — which is the
CANONICAL home for every sst.config synth-pin. It still asserted the retired C12/C13-on-C12
resources as PRESENT, so it went red in CI on the "Lint / typecheck / test / audit" job
(the deploy jobs were skipped). I had put my new synth-pins in the app suite
(`src/app/tests/unit/oagConsumerBusIngest.test.ts`) and never ran the root suite, so my
local run was green while the full CI test graph was red.

## Principle violated
"A TEST YOU DID NOT RUN IS A TEST FAILED" / "green includes the FULL BUILD/TEST GRAPH,
not just one project." A repo with more than one vitest project must have ALL projects run
locally before push. The app suite passing is not "green" when a second, CI-run suite exists.

## Cost
One extra red CI cycle + a fix-forward commit (`c38b9bf`) that moved the pins into the root
synth-pin file (their canonical home) and updated the retired-C12/new-C13' assertions.
No deploy failure (the deploy jobs never ran — pre-deploy test red, not a CFR).

## Fix / prevention
- Fixed forward: `c38b9bf` — the root `tests/sst-config.synth-pin.test.ts` now carries the
  delta-008 pins (C12/grant ABSENT; C13' on oag-consumer-bus present); removed the redundant
  app-suite duplicate. Root `npm test` = 150 green; CI green end-to-end (dev deploy succeeded).
- Prevention (for cicd / the standing pre-push gate): the local pre-push gate must run BOTH
  vitest projects — `npm --prefix src/app test` AND the root `npm test` — not just the app
  suite. A single `make test-all` target that runs every test project (app unit + app local +
  root synth-pin) would make the full graph one command and stop this recurring. This is the
  same class as DEF-ROC-002/006 (fast runner / one-project green ≠ full-graph green).
