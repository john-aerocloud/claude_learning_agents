# A recorded diagnosis is re-read as fact, and nothing re-checks it

**Date:** 2026-08-24 (ROC retro, v148)
**Class:** RECURRING root cause — logged as a principle failure even though nothing "broke", per
retro step 1a: a chronic failure mode that recurs across retros is a system failure to smooth it.
**Instances:** 4 in 5 days, all ROC, two of them found only because someone happened to read the
source.

## The principle that failed

"Defect-as-spec" and the whole event-sourced substrate rest on **written-down facts being facts**.
The substrate is scrupulous about this for *state* — `state = fold(events)`, no hand-editing, an
edge-checked sole writer — and completely trusting about *content*. An item's `title` and its
"Actual" section are prose, written once, and afterwards read as established.

## What happened

| item | recorded claim | reality | how long it stood |
|---|---|---|---|
| `DEF-ROC-008` | no real Jira in cloud test | `jiraEgress.configured=keyvault`; ROC-14/15 raised through it | until a probe ran |
| `UC-ROC-023` | blocked on 2 preconditions | both already satisfied | **27.3 days** |
| `DEF-ROC-053` | tier races itself via a shared consumer group on a running `local:read-api` | `local/read-api.ts` has **zero** Event Hubs consumer references | 3 days, and it was *pulled for build* |
| `DEF-ROC-081` | a self-resolve loses its Jira key | all four resolve sites stamp it | 3 days, and it was *pulled for build* |

`OI-ROC-005`/`EXP-143` added a re-run probe to every `blocked` park, which is what caught the first
two — and the constraint moved for it (`external` 40.4% → 35.7% of GLT, `blocked` 39.1% → 33.8%).

**But a probe re-checks a PARK, and nothing re-checks a DIAGNOSIS.** Both of the second pair were
pulled into `fixing` with their prescribed fixes ready to implement. `DEF-ROC-053`'s fix — "give the
live tier its own consumer group" — would have isolated it from a contender that does not exist:
green tests, a closed item, and the real defect still there.

## The aggravating detail, which is the actually instructive part

While triaging `DEF-ROC-053` the orchestrator appended a `confirmed` event stating the mechanism was
"structural and readable in configuration rather than probabilistic". That sentence was derived from
**the item's own write-up**, not from the code. So the process did not merely fail to re-check a
claim — it manufactured a fresh, more confident record of it, in the audit log, under a role whose
job is verification. The next reader would have found a `confirmed` event and stopped looking.

This is `DEF-ROC-008`'s trap in a new costume. That item's first probe counted `az keyvault list`
and reported 0 — which measures whether *our* identity may list vaults, not whether the vault
exists. Both times the mistake was interrogating **our own side of the relationship** instead of the
thing being claimed.

## Why the existing guards did not fire

- `wi-validate` checks *transition legality*, not content. It was clean throughout.
- `loop-gate`'s `blocked-park` probe covers parks; neither item was parked.
- The `reproducing → confirmed` transition is where a claim is supposed to be tested, and it is
  legal for the orchestrator to append `confirmed` with **no evidence requirement at all**. Nothing
  distinguishes "I re-measured it" from "I read the item and agreed".

## Ruling

Recorded as §17ab. Load-bearing parts:

1. Verify a prescribed mechanism against source/system **before** building its fix.
2. Never confirm from the item's prose — ask the code or the host.
3. On disproof, fix the **title** too (it is what boards and queue views publish).
4. Separate what survives (the observations) from what does not (the diagnosis).
5. An acceptance condition written for a failure that does not occur is **void**, not passed.

## The open question this does NOT answer

§17ab is a rule, and rules depend on someone remembering. The `blocked` half got a **mechanism** — a
probe the gate re-runs every cycle, which is why it worked. The honest position is that the
diagnosis half has no equivalent yet, and a candidate is cheap: require a `confirmed` event to carry
a `ref:` to the evidence that established the mechanism, the way §17a already forces the
`validated` event to carry its evidence ref. That would make "I read the item and agreed"
unrepresentable. Not adopted this cycle — it needs a state-graph amendment and belongs in a scored
experiment, not smuggled in as part of a retro's text. Recorded here so the next retro can pick it
up rather than rediscover the gap.
