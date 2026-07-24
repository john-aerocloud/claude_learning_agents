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

## Note
Queued as process/CI work. The workflow edits push to the shared repo's CI (infra
maintenance, distinct from the local-only feature-push hold). Until the readiness poll
lands, a red main `Test` should be RE-RUN once to confirm flake before classifying it a
regression.
