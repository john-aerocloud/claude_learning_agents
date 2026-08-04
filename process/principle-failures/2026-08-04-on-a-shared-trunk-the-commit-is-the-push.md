# On a shared trunk with concurrent agents, the COMMIT is the push — so an infra-bearing commit must not exist on trunk before its synth/deploy gate has passed

**Date:** 2026-08-04. **Project:** OagEventSource. **Item:** `DEFECT-OAG-054`. **Role:** engineer.
**Principle bypassed:** process §14/§19b + the engineer brief's own gate — *"Infra-bearing change →
the done-condition ALSO includes the synth/deploy gate CI runs: run `sst diff`/synth and see it pass
BEFORE push. Pushing infra green-locally-but-unsynthed = a deploy-failure that turns CI red."*
And the item brief's explicit instruction: *"Before pushing: `sst diff --stage shared` must show the
3 hub-side creates, 0 DELETES, and zero dataout changes. A diff containing deletes means DO NOT PUSH."*

## What happened

I built `DEFECT-OAG-054` in three TDD increments and committed each at green, per the v95
"commit at each green sub-step" rule. The FIRST increment (`506d2be`) was the infra-bearing one: it
added the `ci-probe` entry to `sst.config.ts`'s inline registry, which the CI `deploy-shared` job
synthesises into a real EventBridge rule + IAM role + SQS DLQ on the dev-shared Aerobus hub.

I intended to run the `sst diff --stage shared` gate before pushing, as instructed — and I did not
push. **Six minutes later a concurrent agent pushed trunk** for unrelated work
(`ddcedeb`, "state: UC-BPC1 rejected…"), which carried `506d2be` and `d429074` to `origin/main` as
ancestors. `infra.yml`'s `deploy-shared` runs **unconditionally** on any push, so my un-diffed
infra change was **applied**. By the time I ran the diff, the rule/role/DLQ already existed and the
diff reported them as `Updated` (tag churn) rather than `Created`.

The outcome was correct — the applied shape was exactly what delta-056 §A predicted (3 hub-side
creates, 0 deletes, zero dataout change), the 3-hop probe went green and `SST deploy [prod]`
reached `success`. **The outcome being right is not the point.** The gate that exists to make that
outcome knowable *in advance* did not run, and nothing I did or refrained from doing could have
stopped it.

## Why the rule as written cannot hold here

The rule assumes ONE agent controls the sequence `commit → gate → push`. On a shared trunk with
multiple concurrent agents that sequence does not exist: **any agent's push publishes every
committed change on trunk.** So for infra, the effective apply trigger is the COMMIT, not my push.
Two correct-sounding rules were in direct conflict and I followed the wrong one first:

- v95: *commit at each green sub-step, so a stall costs one increment not the whole UC*;
- §14/§19b: *do not let an infra-bearing change reach the apply un-synthed*.

For a change that is NOT infra-bearing, v95 wins and there is no conflict. For an infra-bearing
change on a shared trunk, v95's benefit (stall insurance) is bought with an un-gated apply.

## The rule I should have followed, stated so it is mechanical

**An infra-bearing change is gated BEFORE it is committed, not before it is pushed.** Concretely,
when a change touches `sst.config.ts` / `infra/` / IaC / deploy-role policy:

1. Get the working tree to green (suite + lint + typecheck) **without committing** the infra hunk.
2. Run the synth/deploy gate (`sst diff --stage <stage>` with the CI environment injected) and read
   it against the architect's predicted create/delete set.
3. **Only then commit** — and commit the infra hunk in the SAME commit as its passing gate evidence.
4. If the increment must be committed before the gate can run (e.g. no credential yet), commit it
   **behind a de-armed flag** so the committed state is a no-op apply — which is precisely the
   `RETIRE_PILOT_FANOUT_LEG` arm-switch pattern this repo already invented for exactly this reason,
   and which I did not reach for.

Point 4 is the real lesson: the arm-switch idiom exists **because** trunk-is-the-apply, and it
generalises to every infra increment, not just cutovers. A registry entry could have landed
de-armed (synthesised only when a committed flag flips) and been armed in the commit that carries
the diff evidence.

## Cost

Zero this time — the applied shape was correct and prod is unblocked. The exposure was real: had
the diff shown a delete (the six-delete `AerobusConsumerFanoutDlq` hazard AC-XE1.9a exists to
catch), the concurrent push would have destroyed a queue holding 6,434 messages with no gate in
between and no one watching.

## Suggested process change (for the retro to rule on)

- §14/§19b: replace "gate before PUSH" with **"gate before COMMIT"** for infra-bearing changes, and
  name the shared-trunk reason. A single-agent tree is the special case, not the general one.
- v95's commit-at-every-green rule gains an explicit exception pointer: an infra-bearing hunk is
  either gated first, or committed de-armed behind a flag.
- cicd: consider making `deploy-shared` diff-gated rather than unconditional, so an un-reviewed
  infra delta cannot be applied by an unrelated agent's push. That is the structural fix; the two
  rule changes above are the behavioural one.
