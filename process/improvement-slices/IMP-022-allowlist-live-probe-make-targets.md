# IMP-022 — allowlist the AdixOut live-probe `make` targets so validation is reproducible

**Status:** QUEUED (re-decided v159 retro, ROC 2026-08-29) — AdixOut-origin, not ROC's to schedule. Noted that ROC hit the identical gap this cycle and fixed its own instance (`pps-event-aggregation.aas.aegis.mobi` added to the committed allowlist), which is corroborating evidence that the class is real across projects.

**Opened:** 2026-07-24 (AdixOut v105 retro)
**Owner:** cicd / config (`.claude/settings.json` allowlist + project Makefile)
**Target metric:** CFR + tester lead time (live validation runs reproducibly in a
headless/CI context instead of relying on an unenforced prompt-bypass)

## Problem
REQ-005 introduced a family of AdixOut live-probe `make` targets the tester runs to
validate deployed behaviour on dev-shared — `onboard-auth-probe`,
`entitlement-adjust-probe`, `probe-router-fanout`, `probe-delivery-isolation`,
`probe-reactivation`, `probe-webhook-push`, `probe-subscription`, `probe-catchup*`, and
siblings. Only the generic `probe-live` target is in the committed
`.claude/settings.json` allowlist; the specific probe targets are NOT. So every tester
run of those probes relies on an unenforced prompt-bypass (an interactive allow), which
means the validation step is not reproducible in a CI / headless / autonomous-loop
context — the exact gap that lets a validation silently not run.

## Proposed change
Add an allow rule for the live-probe targets to the **committed** project/settings
allowlist — either a wildcard `make -C work/<project> probe-*` (plus the non-`probe-`
prefixed `onboard-auth-probe` / `entitlement-adjust-probe`, or rename those to the
`probe-` prefix so one glob covers them) or the explicit target list. Owned by
cicd/config so the tester's validation surface is reproducible without an interactive
grant.

## Sibling tooling fix (bundle here or track alongside IMP-021)
The `impacted-tests` `@alias` vocabulary on AdixOut (`ROUTER`, `G_DELIV_EXT`) uses
domain-tag NAMES that were never adopted in source — the specs tag `@covers UC0NN`
(the UC-number convention), so the alias map false-flags covered nodes as UNCOVERED.
Realign the AdixOut alias vocabulary to the `@covers UC0NN` convention actually used in
the specs (a cheap tooling fix). This is the AdixOut instance of the same
impacted-tests coverage-vocabulary fragility IMP-021 addresses generically.

## Done condition
On AdixOut, a headless/CI tester run can invoke every live-probe target without an
interactive permission prompt (the targets are in the committed allowlist), and the
impacted-tests alias vocabulary matches the `@covers UC0NN` tags the specs actually
carry (no false-UNCOVERED for a really-covered node).

## Note
Queued with process/config work (§32). Until it lands, tester probe runs depend on the
prompt-bypass and the AdixOut `@alias` map keeps mis-reporting coverage.
