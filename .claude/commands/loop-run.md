---
description: Run the continuous pull-based inner dev loop (v40). Pulls the maximal independent set of ready use-cases, builds each TDD-on-trunk, deploys per-UC, validates in prod, replenishes the Ready queue just-in-time, and retros at the §F8 cadence. Runs until the queues drain and the requirement is done.
argument-hint: <project-name> [--max-cycles N]
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: if no project is named, use `work/ACTIVE`. If stale, stop and suggest `/project-list`._

Act as the **orchestrator** for project **$1**, driving the v40/v41 pull loop
(process STAGE F). You hold dispatch authority; the **flow-manager** owns queue
state and flow decisions. Bracket every dispatch with ledger rows (record
`item_id` and `queue` on flow events).

**This is a CONTINUOUS BACKGROUND process (§F9).** It runs while there is ANY
work to do — any queue non-empty OR anything replenishable — and EXITS only when
**all queues are empty AND nothing is replenishable** (requirement complete →
ask the human for more work). It is NOT started on demand by the human: an
**enqueue-to-empty** (`loop_wake`, e.g. intake adding the first ready item)
restarts it without being asked. **Never** ask the human "start the loop?" or
"replenish or pull?" — those are autonomous (§F9). The human is touched only at
the §F5 two gates and at requirement-complete.

Each cycle:

1. **Check the buffers.** Dispatch `flow-manager`: read `queues/policy.csv`; if
   `length(Ready or Intake) < min_items`, **kick off replenishment (step 2) as a
   PARALLEL track** (do not block the pull on it); if `length(Rework) >
   rework.min_items` (any rework present), drain Rework first; never exceed any
   queue's `wip_limit`.
2. **Replenish just-in-time — CONCURRENTLY (§F3/§F9).** Dispatch `product` to run
   ALONGSIDE the build of already-pulled UCs, not before it: more use-cases from
   the current slice → next slice → next chunk → (requirement done) ask the human
   for more work. Product values+costs each new item; flow-manager enqueues,
   re-costs (`vc_ratio`), re-prioritises (defects pre-empt). Replenishment and
   pulling/building never block each other.
3. **Pull the independent set.** Dispatch `flow-manager` to return the maximal set
   of mutually-independent ready use-cases (≤ capacity `N`) from
   `use-case-deps.mmd ∪ class-deps.mmd` + the claimed-path registry. Emit
   `parallel_dispatch` (`achieved=K max=M`) and `dequeue` rows.
4. **Run the inner dev loop for each pulled UC, concurrently** (isolated by §40
   flags, never branches): `cicd` (if capability needed) → `ui-designer`
   structure (if UI) → `engineer` (TDD red→green→refactor on trunk) →
   `ui-designer` validate (if UI) → deploy (per-UC; **GATE 2 only if
   infra-bearing**, §9a/§F5) → `tester` (validate in prod). Emit
   `stage_enter`/`stage_exit` per stage.
   - **Collision** (a UC needs a seam/path another in-flight UC claimed, or a
     flag-compose failure): flow-manager emits `collision`, STOP the pair, add the
     missing edge to the model + `edge-ledger.md`, re-serialise (§19); the rework
     is a time thief.
   - tester fail → UC to **Rework**; MTTR clock; re-loop step 4 for it.
   - **Blocked-reason (§F7a):** whenever a UC is blocked (gate hold, collision
     stop, rework), append/update its row in `items/blocks.csv`
     (`item,reason`); REMOVE the row when it clears. The step-5b sync mirrors the
     why to the board (banner + comment) and posts an unblocked comment on clear.
   - **Per-item board push (near-real-time):** as an agent CREATES, STARTS,
     FINISHES or BLOCKS an item, it pushes just that item —
     `python3 work/$1/scripts/sync-linear.py --item <id> --live` (cheap, uses
     cached ancestors; no whole-tree pass). Step-5b's full reconcile stays the
     backstop that also handles structure/prune. A blocks.csv row is
     authoritative: an item with a reason shows Blocked on the board even if its
     queue state is otherwise (e.g. gate-held while Ready).
5. **Done & bubble up.** Mark the UC done; flow-manager releases its claims and
   bubbles slice→chunk→requirement state.
5b. **Mirror to the human board (parallel, non-blocking).** If the project has a
   board reconciler (`work/$1/scripts/sync-linear.py` + its `secrets/`), run
   `python3 work/$1/scripts/sync-linear.py --live` after the state change so the
   Linear plan/progress board self-updates (process §12d, mapping in
   `process/linear-mapping.md`). State-only mirror — **no DORA** (ledger remains
   the metrics SSOT). Skip silently if absent. Never block the loop on it; a sync
   failure is logged, not fatal.
6. **Document (parallel, non-blocking).** Dispatch `documenter` in the background.
7. **RETRO-DEBT GATE — mechanical, not discretionary (§F8, v68).** Before pulling
   the NEXT work after any slice/chunk close or defect resolve, run
   `make retro-debt PROJECT=$1`. This is a **hard loop-state precondition, not a
   judgement call**: a **non-zero exit (code 2 = RETRO DUE)** means the loop MUST
   run `/retro $1` to drain the debt BEFORE it may advance — the orchestrator may
   NOT pull next work, and may NOT offer the retro to the human as a choice, while
   debt is outstanding. **Cadence (v69, EXP-085):** routine slice/chunk closes
   BATCH up to `--threshold` (default 3) before the gate trips; INCIDENT events
   (prod defect resolve / deploy failure) are never batched and trip the gate
   immediately. So a clean run of small closes won't force a per-slice retro, but
   a real incident always does. The retro itself records a `retro` ledger row, which
   resets the counter to zero (re-run `make retro-debt` after the retro to confirm
   `ok` before resuming pulls). This makes "the retro fires automatically at the
   §F8 cadence" a checkable property of the loop machinery rather than a rule the
   orchestrator can skip by offering it to the human (the EXP-030 / v68 recurrence
   the gate exists to prevent). The retro tunes the per-queue buffers and `N` from
   the flow evidence; each tune is a scored experiment. Then continue the loop in
   the same turn (§F9.4 — do not end the turn at the retro boundary).

End each cycle by refreshing `make dora-flow PROJECT=$1` and report: the pull set,
queue depths vs buffers, the current constraint (largest time thief), any
collision + edge added, and any human decision needed (intake / infra deploy).
