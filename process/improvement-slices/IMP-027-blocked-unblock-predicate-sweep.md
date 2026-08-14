# IMP-027 — machine-checkable unblock predicate on `blocked`, swept every cycle

**Opened:** 2026-07-30 (OagEventSource retro, process v123)
**Owner:** work-items machinery + flow-manager
**Founding evidence:** `process/open-items.md` → "OI — `external`-blocked items are never
re-checked" (three independent OAG occurrences in one week)
**Target DORA metric:** gross lead time (a cleared block is noticed within one loop cycle
instead of days) + honest constraint attribution (the `external` GLT share stops being an
artefact that rewards not checking).

## Problem
Nothing in the loop ever re-evaluates whether an `external` condition has cleared; once an
item is `blocked` it is inert until a human volunteers the news.
- **UC-OA2** — `blocked` 2026-07-28T12:09:04Z on the `oagMaintainer` permission set. The
  permission set was created 2026-07-28T16:44Z, **4h35m later**. The item stayed blocked
  until 2026-07-30T17:53:12Z — a **193,448s** span of which **176,952s (91.5%) was our own
  failure to check**, booked as `external`. That one span is **24% of ALL recorded blocked
  time on the project**.
- **UC-XC4** — blocked ~5h on an AdixOut prod bus policy that had already been applied;
  discovered because the orchestrator happened to re-run a CloudWatch query.
- **UC-OB1** — blocked on the `oag/alerts-key` secret, and before that sat **3 days in
  `deploying`** (attributed to **cicd**) while actually awaiting a human-supplied secret.
Consequence: `external` reads **1.80% of GLT**, which is not a health signal — it both
excludes late-marked external waits (misattributed to cicd/queue) and launders our own
polling latency as legitimate external wait.

## Change
1. **Predicate on the event.** `blocked` may carry a declarative unblock predicate —
   `{check: <read-only shell/CLI probe>, expect: <exit-0 | field==value>}` — recorded on the
   event itself so it travels with the item and is reviewable in the file (no side store).
2. **A cheap sweep** — `make wi-sweep-blocked` (or ride `make wi-project`) evaluates every
   in-flight predicate and, on a pass, appends `unblocked` with
   `agent: flow-manager, note: "auto-cleared by predicate <p>"`.
3. **Unpredicatable blocks stay human-reported**, but say so on the event, so
   "no predicate expressible" is a stated property, not an omission.
4. **Report the gap**: add `blocked`→true-clear latency to stats so the hidden wait is
   visible and can be driven toward one loop cycle. Expect the honest `external` share to
   RISE when adopted — that is the correct direction.

Worked examples from the founding cases (all read-only):
- `aws iam get-role --role-name AWSReservedSSO_oagMaintainer_<hash> --profile <p>` exits 0
- `FailedInvocations == 0` sustained for N periods on `oag-aerobus-fanout-adixout`
- `aws secretsmanager describe-secret --secret-id oag/alerts-key --profile dev-datain` exits 0

## Also in this slice (same machinery, cheap while we are here)
Regression tests in `.claude/skills/work-items/scripts/test_work_items.py` pinning the
**state-graph v7** edges added at this retro, which currently rest only on the existing
107-test suite continuing to pass:
- the validate-only route `ready --pulled_for_validation--> validating --validated--> done`
  (and that `built_green` is REJECTED from `validating`);
- the `amended` self-edge is legal from every non-terminal flow state, is time-preserving
  in `walk_segments` (no GLT distortion), and does not change `derived.state`;
- `unblocked` is accepted from `AGENT=orchestrator` as well as `flow-manager`.

## Done when
A `blocked` event can carry a predicate; the sweep runs each cycle and auto-appends
`unblocked` on a pass; the v7 edges are pinned by tests; `make wi-validate` stays clean.
