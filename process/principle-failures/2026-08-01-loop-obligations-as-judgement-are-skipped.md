# 2026-08-01 — A loop obligation written as judgement is not performed; the one written as an exit code is

**Class:** recurring root cause (2nd consecutive retro on the same constraint, with the
previous retro's prescribed remedy implemented and ineffective).
**Project:** OagEventSource (v126). **Owner of the failure:** orchestrator — me.
**Opened under:** process §5b — *"a RECURRING root cause opens a `principle-failures/`
entry even when nothing 'failed'"*.

## What happened

Within a single cycle, four loop preconditions came due. Exactly one was honoured.

| Obligation | How it is expressed | Outcome |
|---|---|---|
| Run a retro when debt is due (§F8) | **`make retro-debt`, exit code 2** | **HONOURED** — fired, forced this retro |
| Dispatch the tester once a fix is green and live | prose, STAGE F step 4 | SKIPPED — DEFECT-OAG-045 dwelt **127,636s (35.5h)**, DEFECT-OAG-048 **98,224s** |
| Replenish when Ready < `min_items` (§F3) | prose, STAGE F step 1 | SKIPPED — Ready sat at 1 against a floor of 3, actioned only when I happened to read the queue view |
| Never exceed a queue's `wip_limit` (§F2) | prose, STAGE F step 1 | SKIPPED — intake OVER its limit of 10 — enforced nowhere in the machinery. I quoted **14** from `views/queues.md`; the gate, folding live item events, read **22** and then 23. The view was 8 minutes stale |

The distinguishing property is not importance, difficulty, or how recently the rule was
written. It is whether a command returns non-zero.

## Why-chain

1. **Why is `queue` the top GLT contributor at 37.02%?** Items sit in `registered`/`ready`
   without being pulled, while `dev-validating` holds another 21.15% — together ~58% of
   gross lead time.
2. **Why do they sit?** Intake is over its cap and Ready is under its floor
   *simultaneously*: arrivals are cheap (any agent appends `registered`) while the
   decomposition and dispatch steps that drain them require an orchestrator to notice.
3. **Why does noticing fail?** Those steps are documented as judgement exercised each
   cycle. Nothing makes their omission observable, so omission is indistinguishable from
   a cycle where the check passed.
4. **Why has this survived two retros?** Because v124 misdiagnosed the mechanism as
   over-gating — the orchestrator *holding* pushes — and prescribed "push on green". That
   prescription was followed. All three fix commits (`5095849`, `78bfd55`, `265bea2`) are
   ancestors of `origin/main` and were pushed the same day. The dwell happened anyway,
   because the missing act was the **dispatch after** the push, not the push. The metrics
   record the failure to move: `dev-validating` 22.17% → 21.15%, `tester` 22.60% → 22.28%,
   `queue` 36.78% → **37.02%, worse**.

**Root cause:** an obligation with no mechanism is not an obligation. `retro-debt` is
obeyed *because* it exits 2, and it is the only loop precondition that does.

## Two compounding errors of my own, recorded unsoftened

**1. I diagnosed the constraint from prose and got it confidently wrong.** I asserted, with
a precise figure, that DEFECT-OAG-045 had been held unpushed for 35.5 hours, because its
event note said `"NOT pushed — push is the prod apply and is sequenced by the orchestrator"`.
That note was ~35 hours stale, written during the worktree incident and never corrected
after the work was re-dispatched and pushed. Worse, its *reasoning* was wrong even when
written: `infra.yml`'s path trigger explicitly EXCLUDES `src/fids-app/**` (FIDS is a manual
`make deploy-fids` gate, documented in the workflow header under DEFECT-OAG-028), so for
those paths the push was never the apply and there was never anything to sequence. I had
generalised a correct rule about `sst.config.ts`/`src/app/**`/`infra/**` into a blanket
habit and then reasoned from the habit instead of from `git diff --name-only`.
**This is the v125 §17c Layer-2 failure exactly: the load-bearing claim lived in prose,
where it could not be false.** It is also the third consecutive day on which I have
asserted a governing fact without establishing it.

**2. I reported UC-HF041 as verified on the strength of one flight.** I stated the
cancellation heal-forward was complete, citing 1,003 events applied and DL379 recovered.
DL379 *is* recovered. But the tester, correctly declining to trust my numbers, ran the
full-window check: `cancelledAtSource=645 recovered=362 missing=9 noStream=274
duplicates=0`, exit 2, reproducible across two runs. Nine codeshare siblings of one
physical RSW→JFK flight on 2026-07-05 remain uncancelled — in scope, in retention, streams
already present, and OAG REST currently reporting them `Cancelled`. The item is back in
rework. I generalised from the single case the human happened to report to the population,
which is the same shape of error as (1): a claim that felt established because nothing had
contradicted it.

## Remedy

Mechanised, not written down — the entire point of the finding. **`make loop-gate
PROJECT=<p>`** in `retro-debt`'s proven shape (exit 0 may pull / exit 2 blocked, every
violation reported with ids and remedy), checking stalled validation, Ready floor, queue
caps, and retro debt. Push/deploy state is derived from the structured `ref:` and
`git merge-base --is-ancestor`, **never from note prose**. Registered as **EXP-123** and
deliberately falsifiable: if the two dominant GLT shares do not fall over three cycles,
then "documented obligations are skipped, mechanised ones are honoured" is not the root
cause and must be abandoned rather than prescribed a third time.

Related: `2026-07-31-orchestrator-overgated-then-pushed-a-meaningless-green.md` (the
misdiagnosed predecessor), `2026-07-30-orchestrator-asserted-authorised-and-pushed-without-establishing-the-governing-fact.md`
(same class, three days running), `2026-07-31-green-test-process-proved-nothing-about-real-data.md`
(§17c Layer 2, of which error 1 above is an instance).
