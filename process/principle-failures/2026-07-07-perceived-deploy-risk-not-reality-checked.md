# Principle failure — a *perceived* deploy risk was escalated to a human gate without a cheap reality-check, parking work as the top time-thief

**Date:** 2026-07-07
**Agent:** orchestrator + cicd (Viggo-fix)
**Principle:** Theory-of-Constraints / gross-lead-time minimisation + evidence-over-inference.
Before escalating a *perceived* risk (deploy, irreversible op, "first-ever X") to a blocking
human gate, do the cheap analysis that establishes whether the risk is **real and actually
happens**. A gate on a risk that does not exist is pure queue-wait — the most expensive kind
of gross lead time — and it is invisible because it reads as "responsible caution."

## What happened
The SLC-002 PP-127 fix cohort (UC1-002…UC5-002 + VF-023) was built green and pushed to
`origin/FlightGrid_Performance`, then **parked in `deploying` awaiting a human CD sign-off**.
The cicd CD-assessment (`SLC-002-PUSH-AND-CD-ASSESS`) wrote a detailed risk narrative — "no
staging/prod environment, no artifact/rollback mechanism, first-ever prod deploy, UKBF work
would ride along" — and STOPPED, surfacing it as a human decision. It sat there long enough
to become **~90% of gross lead time (concentrated in the `registered`/`deploying` wait)** —
the single largest time-thief in the whole system, gating a large downstream fan-out.

The actual analysis that resolves the risk took ~5 minutes: **read the GitHub Action**
(`work/Viggo-fix/eDCS/.github/workflows/build-edcs-server.yml`). Line 5: *"Deploy stage is
deferred pending customer topology decisions."* The workflow is **build/Gate-only** — no
deploy/publish/ssh/msdeploy step exists. "Deploying" is a phantom state: nothing is deployed
anywhere. The real, remaining risk is narrow and different — **running production-DB
changes** — which is separately forbidden (§0b) and was never in play here (code push +
default-OFF flag change nothing).

## Why it's wrong
- The gate guarded a risk (a prod code deploy) that **cannot occur** — the pipeline has no
  deploy step. The cicd assessment reasoned about a hypothetical deploy topology instead of
  reading the one artifact (the workflow file) that says no deploy happens.
- It conflated two very different risks: (a) "deploy code to prod" (does not happen — no
  step) and (b) "change the prod DB" (real, forbidden, not in play). Bundling them made a
  non-existent risk inherit the seriousness of a real one.
- The cost was invisible and large: the parked cohort became the binding constraint and
  starved the downstream. "Being cautious" *felt* free but was the most expensive thing in
  the flow.

## Impact
High — gross-lead-time. No data/safety harm (correctly nothing was deployed), but the
mainline PP-127 value stream was stalled behind a phantom gate that a cheap read would have
dissolved. Cleared 2026-07-07: cohort advanced down the **dev path**
(`deployed`→dev-validating→`validated`→done) on the existing local-clone `flag-regression.sh`
evidence; WIP dropped 7→1; no prod-DB change made (§0b intact).

## Correction / rule going forward
- **Reality-check a perceived risk before gating on it.** When about to escalate a
  deploy / irreversible / "first-ever" action to a human gate, first spend the cheap effort
  to confirm the risk is real and *actually happens*: read the pipeline/workflow/script that
  would perform it. If the mechanism does not exist, there is no risk to gate — proceed.
- **Name the specific irreversible operation, not the category.** "Deploy" is not a risk;
  "a prod-DB write" or "an outward-facing publish that actually executes" is. Gate the
  concrete operation that is both real and irreversible, and let everything else flow.
- **Treat a long-parked item as a defect in the flow, not a virtue.** An item sitting in a
  pre-terminal state dominating gross lead time is a signal to re-examine *why* it is
  parked — often the gate is guarding nothing.
- This is a retro input (constraint = phantom deploy gate); the flow-manager should not model
  a build-only pipeline as having a `deploy`→human-sign-off edge.
