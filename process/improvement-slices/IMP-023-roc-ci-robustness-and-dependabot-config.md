# IMP-023 — ROC CI: emulator-readiness poll + Dependabot-CI config

**Opened:** 2026-07-24 (ROC v104 retro, incident-triggered by a red GitHub CI)
**Owner:** cicd (workflow `work/ROC/.github/workflows/deploy-ROC.yml`) + one HUMAN action
**Target metric:** CFR / deploy frequency (a flaky readiness gate turns green code red and
blocks the aas-test deploy; dependabot CI is structurally red so bumps can't be merged)

## Problem (diagnosed 2026-07-24, cicd)
Two distinct, both-red CI conditions on `AeroCloudSystems/PpsEventAggregation` (ROC):

1. **main `Test` workflow flaky → deploy blocked.** `Function App / lint,test,build` fails
   at `npm run test:acceptance` with `ECONNRESET` opening a Service Bus emulator sender
   (`uc006`), because the workflow waits for the local emulator stack with a **blind
   `sleep 20`** (no readiness poll). Unit (362) + lint pass; the immediately-preceding
   identical run was green and the merge didn't touch that test → transient flake, but it
   SKIPS `deploy-test` (aas-test not redeployed). Same emulator-readiness/state class as the
   local acceptance fragility folded to tester.md (v103).

2. **Every Dependabot PR's `Web App` job is red** at `scripts/vendor-design-system.sh`
   (`gh: GH_TOKEN not set`). Root cause: the step reads `GH_TOKEN: ${{
   secrets.DESIGN_SYSTEM_TOKEN }}`, but `DESIGN_SYSTEM_TOKEN` is only a repo **Actions**
   secret, not a **Dependabot** secret — GitHub does not pass Actions secrets to Dependabot
   `pull_request` runs. Blocks the dependabot-drain cadence (cicd.md v104): 3 of 5 open PRs
   are red purely on this; 2 more (`src/tools/replay-injector/*`) get NO CI because the
   workflow path filters (`src/app/**`, `src/dashboard/**`, the workflow file) don't cover
   that path.

## Proposed changes
- **(cicd, workflow)** Replace the `sleep 20` "wait for emulators" step with a real
  readiness poll — loop until the Service Bus emulator accepts an AMQP connection (and the
  other emulators are healthy), bounded by a timeout, before `test:acceptance`. Kills the
  flake class.

### Update (2026-07-24, cicd — DONE) — engineer's follow-on diagnosis + fix
The engineer traced the `ECONNRESET` more precisely than "readiness": with a WARM stack
and the readiness poll in place, `uc006-c1-thin-thread.test.ts` still failed under
vitest's default file-parallel execution — the acceptance tier's suite files share the
SAME SB/EH emulator containers (one topic/hub per stack, not per file), and concurrent
worker processes overwhelm the emulators' AMQP listeners
(`MessagingError: ECONNRESET` / `ServiceBusTelemetrySource receive error: Failed to
connect`). Serialised against a warmed stack it is 100% green. Both fixes landed together:
1. `vitest.acceptance.config.ts`: `fileParallelism: false` — serialises the emulator-backed
   acceptance tier only. The unit tier (`vitest.config.ts`) is untouched and stays
   parallel/fast (454 tests, ~3s wall, confirmed unaffected).
2. `.github/workflows/deploy-ROC.yml`: the blind `sleep 20` step is replaced with a real
   readiness poll that sources `scenarios/lib.sh` (the SAME `wait_for_port`/`wait_for_log`
   helpers `demo.sh` already gates on against the `"Emulator Service is Successfully Up!"`
   log marker) — CI and local now share one proven readiness mechanism instead of two that
   could drift.
Verified locally: two consecutive fresh-stack (`local:down && local:up`) runs of the full
acceptance tier (`npm run test:acceptance`) both green — 46 passed, 1 skipped
(`uc017-live-real-jira`, no real Jira credential locally), 0 failures, including the
previously-flaky `uc006-c1-thin-thread.test.ts`. Unit tier (`npm run test`) unaffected: 454
passed, parallel (401% CPU), ~3s. `actionlint` clean on the new step (pre-existing shellcheck
warnings elsewhere in the file are unrelated, unchanged).
- **(cicd, workflow)** Extend the `deploy-ROC.yml` path filters (or add a matrix leg) to
  cover `src/tools/replay-injector/**` so its dependabot bumps actually get gated.
- **(cicd, workflow — optional hardening)** Make the `Web App` design-system vendor step
  resilient on dependabot runs (skip/soft-fail the private-tarball fetch when `GH_TOKEN` is
  empty, since the dependency-relevant `Function App` job already gates the bump) — so a
  dependabot PR isn't blocked by an auth step unrelated to its bump.
- **(HUMAN — Claude cannot set a secret value)** Add `DESIGN_SYSTEM_TOKEN` as a **Dependabot**
  secret on the repo (Settings → Secrets and variables → Dependabot), mirroring the existing
  Actions secret, so Dependabot PR runs can vendor the private design-system.

## Done condition
main `Test` is reliably green (readiness poll, no ECONNRESET flake) and `deploy-test`
runs; open Dependabot PRs get a full green CI (Function App + Web App) once the Dependabot
secret is added + path filters cover replay-injector; the dependabot-drain cadence
(cicd.md) can then actually merge green bumps.

**Status (2026-07-24):** the readiness-poll + acceptance-tier serialisation half of this
slice is DONE and verified green locally (see Update above) — `Function App` should no
longer flake on `test:acceptance`. Still open: the Dependabot-secret (human action) and the
replay-injector path-filter extension, both outstanding below.

## Note
Queued as process/CI work. The workflow edits push to the shared repo's CI (infra
maintenance, distinct from the local-only feature-push hold). Until the readiness poll
lands, a red main `Test` should be RE-RUN once to confirm flake before classifying it a
regression.
