# IMP-002 — Validation-as-code with run provenance

**Status:** in delivery 2026-06-06
**Owner:** tester (specs + run records) / engineer (framework scaffold) / cicd (allowlist fit)

## Job

The tester's production-validation step improvises checks through ad-hoc bash:
generated test data, one-off curl probes with planted values, interactive CLI
spot-checks. Three frictions, evidenced in the most recent backend slice:

1. **Prompts** — ad-hoc command shapes match no allowlist pattern, so the
   tester step blocks on human approval repeatedly (the slowest pipeline stage
   is made slower by its own tooling).
2. **Throwaway work** — the checks vanish after the session; re-verifying after
   a fix means re-improvising them.
3. **No provenance** — nothing records that a given acceptance case was
   verified at a given iteration against a given sha. The evidence lives in a
   conversation transcript, not in the system.

## DORA target

- **Gross lead time**: tester prompt-pauses → 0 (tester is the named constraint;
  its median is the slowest agent step).
- **MTTR**: recovery validation = re-run a committed suite (one allowlisted
  command) instead of re-improvising checks; recovery evidence is a recorded
  run.
- **CFR (protects)**: pinned validation specs become standing regression checks.

## Done condition (testable)

1. The project has `tests/validation/` runnable via an allowlisted runner; the
   prior slice's ad-hoc checks (item-shape, planted-value override defence,
   policy spot-checks) exist there as committed specs.
2. Each spec file header declares: slice, acceptance cases pinned, relevancy
   (`pinned` | `point-in-time`).
3. Running the suite emits a `validation_run` ledger row per run: project,
   iteration, slice, suite, **sha under test**, result. The question "which ACs
   were verified at iteration N, against which sha?" is answerable from the
   ledger alone.
4. Relevancy review is part of slice-next and retro: specs added/retired with a
   log line; a retired spec is deleted (history keeps it), not commented out.
5. The tester agent definition forbids ad-hoc validation bash and names the
   framework as the only validation entry point.

## Protection (what replaces the prompt)

| Removed ad-hoc action | Protected by |
|---|---|
| curl probes with planted test data | committed spec under `tests/validation/`, run via allowlisted runner; data in code review scope |
| CLI policy spot-checks | committed spec shelling out via allowlisted read-only AWS patterns, asserting on output |
| "trust me, it passed" | `validation_run` ledger rows: iteration + sha + result |

## Score at next slice

- Tester step prompt count (target 0).
- `validation_run` rows present for every validation pass, each carrying the
  sha under test.
- Relevancy review happened (log line at slice-next/retro showing specs
  added/retired or explicitly "no change").
