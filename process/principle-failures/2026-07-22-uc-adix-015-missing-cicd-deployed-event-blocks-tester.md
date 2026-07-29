# Principle failure: UC-ADIX-015's real dev-shared deploy completed but the
work item's event log never got cicd's `deployed` event — blocked the tester's
`validated` append even though live evidence proved the deploy real and green

**Date:** 2026-07-22
**Project:** AdixOut
**Agent:** tester (hit it), cicd (owns the omission)
**Principle:** "State lives ONLY in the item file; state = fold(events)" (v82) —
the `deployed` event is the sole legal precursor to `dev-validating`, and only
`cicd` may append it (`process/machinery/state-graphs.json`).

## What happened
Dispatched to validate UC-ADIX-015 live on dev-shared with the brief stating
"UC-015 deployed to dev-shared via CI (run green) at GitCommit `516b2aa`."
Independently confirmed this was TRUE against the live system:
- `aws lambda get-function-configuration --function-name AdixOut-Catchup` /
  `AdixOut-CatchupAuthorizer` both report `GIT_SHA=516b2aa0bac...` (matching
  HEAD of `work/AdixOut`, `516b2aa`).
- The live probe (`make -C work/AdixOut probe-catchup`) ran ALL GREEN against
  that exact commit, `X-AdixOut-Version` header confirming identity.

But `work/AdixOut/items/active/UC-ADIX-015.md`'s event log stops at
`built_green` (agent: engineer, ref: 516b2aa) — there is NO `deployed` event
(agent: cicd), so the item's DERIVED state is `deploying`, not
`dev-validating`. `make wi-append ... EVENT=validated` correctly REJECTED:

    append REJECTED: UC-ADIX-015 is in state 'deploying'.
      event 'validated' is not a legal transition from 'deploying'.
      legal events from here: deployed (agents: cicd), deploy_failed (agents: cicd/engineer)

The real production system had already moved past this state (the deploy
genuinely happened and is genuinely green); the ITEM'S event log had not
caught up. This is the same class of gap as the UC-014 "deployed sha moved
under the item without a matching event" note, but here the FIRST `deployed`
event for this UC is simply missing altogether, not superseded.

## What the tester did (and did NOT do)
Did NOT spoof `AGENT=cicd` to force the transition through — the `--agent`
field is an attribution of WHO performed the action, and the tester is not
cicd; fabricating that would corrupt the audit trail even though the tool has
no stronger identity check than the flag value. Flag-don't-fix applies here
(cicd-owned event), per the tester's own operating contract.

Instead: completed the FULL live validation (all evidence captured, PASS),
and is surfacing this as a blocking finding for the orchestrator/cicd to
resolve — append `make wi-append PROJECT=AdixOut ID=UC-ADIX-015 EVENT=deployed
AGENT=cicd REF=516b2aa...` (a truthful catch-up reflecting the real, already-
green deploy) so the item reaches `dev-validating`, at which point the
tester's prepared `validated` event (full evidence already written to
`work/AdixOut/validation/UC-ADIX-015.{result,test-plan}.md`) can be appended
immediately with no further validation work needed.

## Standing lesson
A tester dispatched straight to "validate on dev-shared" should not ASSUME
the precursor `deployed` event landed just because the task brief states the
deploy happened — verify the item's actual derived state (`state:` field in
the item file) before doing the validation work, so a missing-precursor-event
gap is caught immediately rather than discovered only after the validation
evidence is already written and the `wi-append` is rejected at the end.
Recommend cicd's deploy pipeline assert its own `wi-append EVENT=deployed`
call succeeded (non-zero exit -> pipeline failure) rather than silently
completing a real deploy with no corresponding event -- this is the second
occurrence of "real system state outran the item's event log" this project
(cf. UC-ADIX-014's superseded-sha note); a third occurrence should probably
become an amendment experiment (EXP-NNN) adding a lightweight post-deploy
event-log assertion to the cicd deploy step.
