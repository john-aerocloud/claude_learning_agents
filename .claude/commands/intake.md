---
description: Intake gate (v40) — the single upstream human gate. A new requirement OR a defect enters here, is JTBD-framed (why it matters), valued and costed, written to the work-item registry, and enqueued. Defects pre-empt.
argument-hint: "<requirement or defect, free text>"  | --defect "<expected> | <actual> | <intent> | <importance>"
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: if no project is named, use `work/ACTIVE`. If stale, stop and suggest `/project-list`._

Act as the **orchestrator**. This is GATE 1 (§F5) — the one upstream human gate.
You own the flow; product frames value; flow-manager registers and enqueues.

1. **Frame the job (JTBD).** Dispatch `product`: express the requirement/defect as
   a job — "When [situation], a [user] wants to [motivation], so they can
   [outcome]" — with success measures. **Establish WHY it matters** (jobs-to-be-
   done); a vague item is sent back for clarification (use AskUserQuestion), not
   guessed. For a defect, capture expected / actual / intent / importance and
   **reproduce to confirm** (no phantom fixes) per the `/defect` discipline.
   → **GATE 1: human accepts the framed item + its importance.** Log to
   `decision-log.md`.
2. **Value & cost.** Product estimates `value` and `cost` (time) for the item.
3. **Register.** Dispatch `flow-manager`: write the item to `items/items.csv`
   (type `REQ-`/`DEF-`, parent set, children rebuilt), then enqueue —
   **a requirement** to Intake (decomposed later by replenishment, §F3);
   **a defect** to the HEAD of Ready (pre-empts — a defect on delivered value is a
   failure in something of higher value than anything queued, §F5). Re-cost and
   re-prioritise the queue; log the displacement as a time thief.
4. **First-chunk capabilities (new requirement only).** Dispatch `cicd` to define
   what the first chunk needs to operate — nothing ahead of need.

Bracket dispatches with ledger rows (record `item_id`, and `queue` on enqueue).
End by reporting the registered item id, its value/cost and queue position, and
offer to run `/loop-run $1`.
