---
description: Report a defect — the single gate for defects (v83). Capture the four fields, reproduce-to-confirm (no phantom fixes), prioritise (defects pre-empt), register the event-sourced item, then run the mandatory gap-closing retro once fixed. Self-contained since /intake retired; requirements enter via /requirement.
argument-hint: "<expected> | <actual> | <what you were trying to do> | <why it mattered>"
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: if no project is named, use the machine-local `work/ACTIVE` pointer (per-instance — never another machine's). If missing or stale, stop and suggest `/project-switch <name>`._

Act as the **orchestrator**. A defect is normal work (defect-as-spec) and enters HERE,
not via `/requirement` (that gate is for new value). State is event-sourced
(`process/machinery/CONTRACT.md`): the item file is the sole source of truth and queue
membership is DERIVED — no manual enqueue, no ledger row.

1. **Capture + reproduce + prioritise + register (the intake half — self-contained).**
   Dispatch `product` to frame the defect as a job and capture all four fields —
   **expected / actual / intent / importance** — into the item body. Then
   **reproduce-to-confirm** through the most public surface (browser for web, API for
   backend) against the live system the user saw, driving the exact Intent path. No
   phantom fixes: *Confirmed* → capture the observed Actual as evidence and proceed;
   *cannot reproduce* → record `unconfirmed` with what was tried, STOP and report (do not
   fix what you cannot see); *reproduced but different* → the real behaviour is now the
   defect. Classify ownership (our bug / caller data / dependency).
   → **HUMAN GATE: the human accepts the framed defect + its importance.** Log to
   `decision-log.md`. Then dispatch `flow-manager` to register: create
   `work/<project>/items/active/<ID>.md` (frontmatter: `id`, `type: defect`, `title`,
   `job`, `value`, `cost`, `parents`, `deps`), append the birth event
   `make wi-append PROJECT=<p> ID=<ID> EVENT=reported AGENT=flow-manager`, run
   `make wi-project PROJECT=<p>`, and mirror with the `linear`/`jira` agent. Queue
   membership is DERIVED: a defect folds to the head of Ready and **pre-empts** (a defect
   on delivered value is a failure in something of higher value than anything merely
   queued, §F5); the displacement is logged as a time thief. The fix then flows through
   `/loop-run` like any pulled item: write the expected behaviour as a failing pinned
   test, make it pass, deploy, and re-run the reproduction in prod to confirm the symptom
   is gone. MTTR runs from the confirmed report to the validated fix.

2. **Gap-closing retro (MANDATORY once fixed — the unique value of this command).**
   Run a focused retro whose SOLE goal is: *what in the process let this defect through,
   and what experiment could close that gap?* Name the step/agent that should have caught
   it and WHY it didn't (the latent root cause, not just the code fix); route the fix for
   that gap to its narrowest owner (§25/§36); propose ONE experiment (register in
   `/process/experiments.md`) with a named target DORA metric, anticipated effect,
   scoring horizon, and its **applies-to** predicate (§25a). A defect that reveals a gap
   with no proposed experiment is an incomplete retro. Score per §26; version-bump the
   process only if a cross-agent rule changed.
