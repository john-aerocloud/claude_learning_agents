---
description: Intake gate (v82) — the single upstream human gate. A new requirement OR a defect enters here, is JTBD-framed (why it matters), valued and costed, written to the event-sourced work-item registry, and thereby made queue-eligible. Defects pre-empt.
argument-hint: "<requirement or defect, free text>"  | --defect "<expected> | <actual> | <intent> | <importance>"
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: if no project is named, use the machine-local `work/ACTIVE` pointer (per-instance — never fall back to another machine's project). If it is missing or stale, stop and suggest `/project-switch <name>`._

Act as the **orchestrator**. This is the ONE upstream human gate (§F5) — the single
surface for BOTH a new requirement AND a defect. You own the flow; product frames
value; flow-manager registers. State is event-sourced (`process/machinery/CONTRACT.md`):
the item file is the sole source of truth and queue membership is DERIVED — there is
no manual enqueue and no ledger row.

1. **Frame the job (JTBD).** Dispatch `product`: express the requirement/defect as
   a job — "When [situation], a [user] wants to [motivation], so they can
   [outcome]" — with success measures. **Establish WHY it matters** (jobs-to-be-
   done); a vague item is sent back for clarification (use AskUserQuestion), not
   guessed.
   - **For a defect,** capture all four fields — **expected / actual / intent /
     importance** — into the item body, and **reproduce to confirm** through the
     most public surface (browser for web, API for backend) against the live
     system the user saw, driving the exact Intent path. No phantom fixes:
     *Confirmed* → capture the observed Actual as evidence and proceed; *cannot
     reproduce* → record `unconfirmed` with what was tried, STOP and report (do
     not fix what you cannot see); *reproduced but different* → the real behaviour
     is now the defect. Classify ownership (our bug / caller data / dependency).
   → **HUMAN GATE: the human accepts the framed item + its importance.** Log to
   `decision-log.md`.
2. **Value & cost.** Product estimates `value` and `cost` (time) for the item.
3. **Register (event-sourced write path).** Dispatch `flow-manager`: create the
   item file `work/<project>/items/active/<ID>.md` (frontmatter: `id`, `type`
   `requirement`/`defect`, `title`, `job`, `value`, `cost`, `parents`, `deps`) with
   the JTBD/acceptance definition in the body, then append the birth event —
   `make wi-append PROJECT=<p> ID=<ID> EVENT=registered AGENT=flow-manager` for a
   **requirement**, or `EVENT=reported AGENT=flow-manager` for a **defect**. That is
   the whole registration: **queue membership is DERIVED** (`queue_map[state]`,
   rendered by `make wi-project`) — do NOT hand-enqueue and do NOT write any ledger
   row. A requirement folds into the Intake queue (decomposed later by
   just-in-time replenishment, §F3); a defect folds to the head of Ready and
   pre-empts (a defect on delivered value is a failure in something of higher value
   than anything queued, §F5). Run `make wi-project PROJECT=<p>` to regenerate the
   views, then mirror the new item with the `linear`/`jira` projection agent.
4. **First-chunk capabilities (new requirement only).** Dispatch `cicd` to define
   what the first chunk needs to operate — nothing ahead of need.

End by reporting the registered item id, its value/cost, and its derived queue
(from `views/queues.md`), and offer to run `/loop-run $1`.
