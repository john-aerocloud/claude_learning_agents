# /process — Agent self-state (PERSISTENT)

This directory is the agents' memory of **how they work**. It is never reset by a
project. Project artifacts live in `/work` and can be wiped at any time; this
directory must survive that.

Hard rule: nothing in `/process` may depend on a specific project existing. It
describes process, not product.

## Layout

| Path | Holds | Written by |
|------|-------|------------|
| `process-current.md` | The current process every agent follows + expected DORA improvement + the change-set queued for the next iteration. | Orchestrator (via `/retro`) |
| `process-history/` | Now holds only its own `README.md`. Superseded process versions are git tags `process-v<NN>` — the old per-version files were replaced by tags at the v82 cutover. | Orchestrator (via `/retro`, as a tag) |
| `machinery/` | The event-sourced work-item substrate. `CONTRACT.md` — the build contract for the `work-items` script and the `linear`/`jira` projection agents (one file per item, state = fold(events), all views DERIVED on read). `state-graphs.json` — the declarative per-item-type state machines (the auditable core; edited only via the retro/version-bump gate). | Orchestrator (via `/retro`) |
| `experiments.md` | The LIVE experiment registry — every routed change as a falsifiable hypothesis (problem/solution/target-metric/measurement), scored at each retro. | Orchestrator (via `/retro`) |
| `experiments-archive.md` | Terse one-line index of experiments that reached a terminal state (integrated / retired / superseded) and were pruned from the registry. | Orchestrator (via `/retro`) |
| `improvement-slices/` | `IMP-NNN` records — self-improvement work items too substantial to be a one-line experiment (tooling, refactors, build work). Status headers track their disposition. | Any agent proposing one |
| `open-items.md` | The §22 carry-forward register — project-agnostic system-learning obligations and queued items that survive every refactor. Referenced by orchestrator + `/defect`. | Retro + any agent adding an obligation |
| `linear-mapping.md` | The id→board-object map + `derived.state → board status` table used by BOTH the `linear` and `jira` projection agents. | Orchestrator (rarely) |
| `principles/` | The default delivery approaches (XP, TDD, slicing, trunk-based, roll-forward, JTBD). The beliefs agents act on. | Orchestrator (rarely; via `/retro`) |
| `principle-failures/` | Logged cases where following a principle harmed DORA metrics, with a reflection on why. The corpus that lets agents reason about *when principles fail*. | Any agent that hits one |
| `dora/ledger/*.csv`, `dora/ledger.csv` | **FROZEN archive** of the retired QueueApproach delivery model. Read-only; NEVER appended to. Live delivery state + all metrics now come from the work items via `wi-project`. | — (frozen) |

**Derived / machine-local (not authored here):** the DORA baseline and the
statusline are *computed* from the work items on read — they are not hand-written
sources of truth. `dora/statusline.json` is machine-local scratch. All live
metrics (the 4 DORA metrics, gross-lead-time-by-owner, quality-by-stage,
recovery/MTTR-by-class) are projected by `wi-project`, not stored.

## How this is used — the event-sourced loop

State lives in one place: each work item is a per-item file whose current state
is `fold(events)` through its type's state graph. There is exactly one write path
and everything else is derived on read.

1. Agents read `process-current.md` + `principles/` to know how to act, and
   `machinery/CONTRACT.md` + `machinery/state-graphs.json` to know the item model.
2. **Act** — the sole state writer is `make wi-append` (an event, edge-checked
   against the state graph; an illegal transition is rejected at write time).
3. **Measure** — `make wi-project` recomputes ALL views from the item set
   (queues, dependency tree, board projections, and every delivery metric).
   `make wi-validate` is the drift gate — it exits non-zero if any invariant is
   violated (e.g. a terminal item in a non-null queue).
4. **Reflect** — when a belief leads to a DORA regression, the agent logs a
   `principle-failures/` entry; at `/retro` the Orchestrator recomputes the
   metrics, reviews failures, scores `experiments.md`, writes a new
   `process-current.md`, and tags the prior version `process-v<NN>`.

Boards are a pure projection: the `linear` and `jira` agents mirror one item onto
its board object per `linear-mapping.md`, never writing back.

The loop: **act (`wi-append`) → measure (`wi-project`) → reflect → revise process → repeat.**
