# IMP-011 — Mechanical CORE-job done-gate (a wi-validate invariant)

**Status:** QUEUED (2026-07-12, ROC retro — third recurrence of the
core-slice-false-done class across OFS/OAG/ROC)
**Owner:** work-item machinery (`wi-validate`); product/flow-manager consume the
signal at slice-close

## Job
`§12d` / EXP-106 already state the rule: a slice/chunk carrying a CORE `job` is
"done in fact" only when its acceptance is validated against that job's success
measure, and a deliberately-partial CORE slice MUST register its undelivered
remainder before it closes. The rule is TEXT, enforced only by an operator
remembering it. It has now been violated on THREE projects (OFS/OAG
`core-slice-false-done`, and ROC `CHK-ROC-001`/`CHK-ROC-003` — a real Jira
ticket was the CORE done-condition and never raised; `SLC-ROC-002` was never
registered). A text-only gate on a CORE invariant is not load-bearing; make it
mechanical.

## DORA target
CFR — an escaped requirement-level defect (a CORE aggregate reading `done`
while its job is undelivered) is caught mechanically at projection/validation
time instead of reading as 0.0% success. Secondary: MTTR — the gap surfaces at
close, not cycles later.

## Done condition
`make wi-validate` gains invariant **I5**: for any aggregate (`slice`/`chunk`/
`requirement`) whose `job` is marked CORE, the aggregate MUST NOT be `done`
unless EITHER
  (a) it (or an item in its subtree) carries a job-success-measure **validation
      event** — a `validated` event whose `ref`/`note` cites the CORE job's
      success measure; OR
  (b) it has a registered, **not-yet-done remainder child** capturing the
      unfulfilled part.
Otherwise `wi-validate` exits nonzero naming the offending aggregate and its
CORE job. Requires a machine-readable CORE marker on the `job:` (e.g.
`job: J1` + a `core: true` field, or a `CORE-` job-id convention) so the
invariant can tell CORE from enabling jobs without prose parsing.

## Protection
A fixture project under the machinery's own tests: (1) a CORE aggregate with a
validation event → passes; (2) a CORE aggregate with an un-done remainder child
→ passes; (3) a CORE aggregate `done` with neither → fails with a clear message.
Runs without credentials, cross-platform via the work-items launcher.

## Score
At the next two retros: count of CORE aggregates that reach `done` without (a)
or (b) — target 0, each one caught by I5 before it is read as success; and
whether the `core-slice-false-done` class recurs a fourth time (it must not).
This is the enforcement half of EXP-106 — score it against EXP-106's row.
</content>
