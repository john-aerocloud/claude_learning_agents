# IMP-003 — Parameterised operations: no inline assembly

**Status:** delivered 2026-06-06 (measure at next slice)
**Owner:** orchestrator (routing) / all agents (usage)

## Job

Repeated operations were being hand-assembled inline each time: env-var
prefixes glued onto commands, multi-flag `dora.py record` invocations built
by hand per call, validation runs and their ledger recording done as two
separate manual steps. Inline assembly makes the operation manual — it cannot
be automated, varies per author, and novel shapes fall outside the allowlist.

## DORA target

- **Gross lead time**: repeated operations become single short commands;
  recording can never be "forgotten and back-filled" (a real failure mode —
  ledger rows have been reconstructed after the fact).
- **Quality of measurement (protects all four)**: run + record fused in one
  target means the DORA data the control loop depends on is captured at the
  moment of execution.

## Done condition (testable)

1. A root `Makefile` provides parameterised targets: `dora-record`,
   `dora-compute`, `validate`, `smoke`, `test-app`, `lint-app`, `build-app`,
   `test-infra`. `validate`/`smoke` run the suite AND emit the
   `validation_run` row (sha + result) in one step — success or fail.
2. Defaults live in config (PROD_URL/AWS_PROFILE in spec configs,
   scripts in package.json, PROJECT from `work/ACTIVE`) — agents pass only
   real parameters (ITER, SLICE, EVENT…), never env-var prefixes.
3. The make targets are allowlisted; using them generates zero prompts.
4. Agent definitions point at the targets as the only entry points for these
   operations.

## Protection

The Makefile is committed and reviewed; targets call only already-protected
operations (committed scripts, package.json scripts, read-only computes).
Within this project's confines, permission for such committed automation is
granted by the human (2026-06-06); security remains in IAM scoping, gates,
and tests — not in interactive approval.

## Score at next slice

- Zero hand-assembled dora.py/env-prefix invocations in agent transcripts.
- Every validation/smoke run has its ledger row with matching sha (no
  back-filled rows).
