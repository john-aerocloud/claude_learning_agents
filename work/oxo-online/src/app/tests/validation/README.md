# Validation-as-code suite (`tests/validation/`)

Process: v16 §35 · improvement slice **IMP-002**.

These specs replace the tester's ad-hoc production-validation bash (generated
test data, one-off `curl` probes, interactive CLI policy spot-checks). Every
check the tester used to improvise lives here as committed, re-runnable code,
run through allowlisted runners so it is prompt-free, and recorded against an
iteration + sha in the DORA ledger.

This suite is **separate** from `tests/smoke/`:

- `tests/smoke/` — post-deploy browser smoke (config: `playwright.config.ts`).
- `tests/validation/` — acceptance/security contract + infra-policy specs
  (config: `playwright.validation.config.ts`).

## How to run

All commands run from the **project root** with allowlist-shaped forms.

```sh
# Full suite (API contract + live AWS policy). Needs AWS creds for the policy half.
PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net AWS_PROFILE=dev-int \
  npm --prefix work/oxo-online/src/app run test:validation

# API-contract only (no AWS creds): the AWS-policy specs self-skip with a message.
PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net \
  npm --prefix work/oxo-online/src/app run test:validation
```

- `PROD_URL` defaults to the production CloudFront distribution, so a bare run
  works; set it to validate another environment.
- `AWS_PROFILE` defaults to `dev-int`; region is fixed at `eu-west-2`.
- AWS-policy specs run a one-time `aws sts get-caller-identity`. If credentials
  are absent/expired, those tests `test.skip` with a clear remediation message
  (`aws sso login --profile dev-int`) and the API-contract specs still run.
- The AWS calls happen as child processes of the allowlisted `npm --prefix …`
  runner (read-only CLI verbs already on the allowlist), so the run is
  prompt-free.

Do **not** invoke `npx playwright test` for this suite from the project root
directly — Playwright module resolution is relative to cwd, and the local
install lives under the app dir. Use the `npm --prefix … run test:validation`
script (its cwd is the app dir).

## Spec-header convention

Every spec under `tests/validation/` opens with a comment block declaring:

- **Slice** — which slice the spec belongs to (`004-create-game`).
- **Acceptance pinned** — the exact AC / security-case ids the spec verifies
  (e.g. `F2`, `T1`, `T3`, `S1`).
- **Relevancy** — `pinned` or `point-in-time` (see lifecycle below).
- **Retire when** — the concrete condition under which the spec stops earning
  its run time and should be deleted.
- **Surface** / **Skips gracefully** / **Replaces** — what it runs against and
  which ad-hoc check it supersedes.

## Relevancy lifecycle

| Relevancy | Meaning | Lifecycle |
|---|---|---|
| `pinned` | Standing regression — runs every validation pass. | Lives until its "Retire when" condition is met. |
| `point-in-time` | Verified a one-off property for a specific slice/build. | Retired once superseded; deleted, not commented out. |

Relevancy review is part of **slice-next** and **retro** (§35.2): the tester
adds what the new slice needs and **deletes** specs that no longer earn their
run time. Removal is a normal, logged act — a retired spec stays in git history
(with its `validation_run` records); it is never left commented out in the tree.
Each review emits a log line stating specs added/retired, or explicitly
"no change".

Current specs (both `pinned`):

- `slice004-api-contract.spec.ts` — F2, T1 (response), S1, T2 (observable).
- `slice004-aws-policy.spec.ts` — T1 (persisted), S1 (stored), T2, T3, T5.

## Run-record command (provenance)

Every validation pass must emit a `validation_run` ledger row carrying the
project, iteration, slice, suite, **sha under test**, and result. `dora.py
record` accepts an arbitrary `--event`, and `compute` only keys on
`task_start`/`task_end`/`deploy`/`failure`/`recovery`, so a `validation_run`
row is recorded faithfully and is inert for metric computation (verified: the
four-key compute still runs unchanged with these rows present).

```sh
# Record one validation_run row (run from project root). One row per suite.
python3 .claude/skills/dora-ledger/scripts/dora.py record \
  --project oxo-online --iteration <N> --slice 004-create-game \
  --agent tester --event validation_run \
  --ref "<sha-under-test>:<suite>" \
  --outcome success \
  --note "<suite> vs <PROD_URL>: <n passed>/<n total> (AWS policy: live|skipped)"
```

- `--ref` carries the **sha under test** plus the suite name so
  "which ACs were verified at iteration N against which sha?" is answerable
  from `process/dora/ledger.csv` alone.
- `--outcome success` | `fail`.
- Emit one row per suite run (api-contract, aws-policy), or a single combined
  row when both ran together.
