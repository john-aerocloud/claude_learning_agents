# IMP-030 — `deploying` is the worst stage in the system (6.7%, 13/195) and nobody has asked why

**Opened:** 2026-08-01 (OAG retro v126). **Owner:** cicd. **Replaces:** EXP-107, killed at
v126 after 20 days unscored at `0/3`.

## Why this is a slice and not another experiment

EXP-107 hypothesised that adding infra checks to the push-on-green condition would catch
infra deploy-failures pre-push. It was never scored, and over its life the metric it targeted
went the wrong way: `views/stats.md` §C shows `deploying`/cicd at a **6.7% failure rate
(13/195)** — the highest of any stage — while `deploying` accounts for **18.16% of gross lead
time**. Thirteen deploy failures reached the deploy stage; the pre-push catch was never
demonstrated once.

Re-registering the same idea a third time is exactly the prose-remedy failure §17c exists to
prevent. **A 6.7% failure rate is not a hypothesis awaiting evidence — it is 13 known
failures awaiting a root-cause pass.** So it is work.

## The work

1. **Enumerate all 13.** Pull every `deploy_failed` event from the item logs with its `ref:`,
   note, and the CI run it came from. This is a fold over real events, not a recollection.
2. **Classify by actual cause**, not by symptom. Candidate classes already visible from this
   cycle's evidence, to be confirmed or refuted rather than assumed:
   - stale bundled artifact vs. source (the DEFECT-OAG-043 class — source-correct,
     artifact-stale, deployed-code-wrong);
   - `infra.yml` depending on no integrity lane, so a deploy proceeds while a gate on the
     same sha is red (recorded as confirmed at v124/v125 and still unfixed);
   - an unapplied commit from another in-flight item riding along on someone else's push
     (the deploy-edge collision, §F7);
   - genuine SST/Pulumi transients.
3. **Fix the dominant class**, and only then decide whether the residue needs anything.
4. **State what share each class accounted for**, so the next retro can tell whether the rate
   fell because of the fix or because of a quiet fortnight.

## Acceptance

Not "the analysis was written". The `deploying` failure rate is re-derived from item events
after the fix and compared against the 6.7% (13/195) baseline recorded here, **and** the
dominant class has a committed gate observed going RED once against a real instance of it
(§17c proof-of-fire). If the rate does not move, say so and report which class was misjudged.

## Note on scope

This is a genuine safety fix as well as a constraint move: `deploying` is 18.16% of gross lead
time and its failures are prod-facing, so it qualifies under the v126 change-gating rule even
though the binding constraint this cycle was the `queue`/`dev-validating` wait (§F8a, EXP-123).
