# CORE slice false-done + delivery-model inversion (2026-07-11)

**Project:** OagEventSource. **Class:** escaped requirement-level defect (quality) +
framing drift. **Metrics blind to it:** CFR read **0.0%** and rework **0.0%** across the
whole cycle while both failures below were live.

## What happened
1. **False-done of a CORE job.** `SLC-030` ("EVENTBRIDGE-CONSUMER-PUSH", `job: J0` CORE —
   "live event delivery to consumers") was marked **`done`** having built the event bus
   **same-account only** (`oag-event-bus`): no cross-account resource policy, no wired
   consumer subscription. The CORE job — cross-account consumers *subscribing* to the live
   feed — is the reason the system exists, and it was **not delivered**.
2. **Silent backlog loss.** When SLC-030 closed for the same-account slice alone, the
   undelivered cross-account remainder was **registered nowhere**. `items/active/` was
   empty and the board read "all queues empty, CORE-DELIVERED" — a truthful-looking but
   false completion signal.
3. **Delivery-model inversion propagated.** With nothing anchoring "primary path" to the
   authoritative model, the product-framing docs (`project.md`, `README.md`, `chunks.md`)
   and then the **consumer skill** inverted the model — framing the pull HTTP feed as the
   authoritative/primary consumption path and the push/subscribe feed as an "advisory
   nudge." The requirements layer (`00-jobs-to-be-done.md:66-73`) and `decision-log.md:53`
   said the opposite. Because the skill is consumer-facing, every downstream integrator
   would have inherited the wrong belief.

## Root-cause why-chain (≥3)
- WHY did consumers get the pull-primary model? The docs/skill said so.
- WHY did the docs/skill say so? Derived docs copied a corrupted middle framing layer
  instead of tracing the "primary consumption path" claim to the authoritative source
  (requirements + decision-log).
- WHY did nothing catch it? "Done" for an aggregate is defined **structurally** (all
  children done) with **no linkage to the job's success measure or persona**. A slice can
  be `done` while its CORE job is undelivered, and there is no rule forcing the undelivered
  remainder onto the backlog.
- WHY did that matter here? The CORE consumer persona is **cross-account**; SLC-030's
  use-cases were scoped **same-account**, so structural-done was reached while persona-value
  was zero — and CFR, computed from item events, never saw a defect.

## Pattern (not a single data point)
Same class as `2026-06-23-render-gate-checked-presence-not-correctness`,
`2026-06-23-false-green-fixtures-mirrored-wrong-shape`, and
`2026-06-25-actual-docs-incoherent-after-change`: a gate/metric checked a *structural
proxy* (presence, child-completion, green) instead of the *invariant that matters*
(correctness, job-delivery, coherence with the source of truth). Here it recurs at the
requirement/aggregate level.

## Guard routed (retro v84)
- **process-current.md §12d — CORE-job done-gate + no-silent-partial.** A CORE-`job`
  aggregate is done-in-fact only when acceptance is validated against that job's success
  measure for the named persona(s); a deliberately-partial CORE slice MUST register its
  undelivered remainder as a tracked item before it closes. (Targets CFR + MTTR.)
- **documenter agent** — consumer-facing docs/skills must state their "primary path"
  claims by tracing to the authoritative delivery model, never to a peer/derived doc.

## Corrected + re-tracked
Delivery model restored across ~22 docs + the skill; `REQ-XACCT-PUSH` registered
(personas P1–P7, jobs J0/J11–J13, dossier signed off); empty `REQ-OAGEVENTSOURCE` vision
stub filled. See commit `c2db5ce`.
