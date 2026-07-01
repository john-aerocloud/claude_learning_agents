# IMP-013 — Fleet / multi-project orchestration (main thread is not the per-UC worker)

**Owner:** orchestrator → evolves into a fleet-manager role. Builds on IMP-012 (per-project Workflow loop + process-tax).
**Why:** the human needs N projects running concurrently, each like the current single-project loop, switching between them — WITHOUT the single main thread becoming the bottleneck.

## The bottleneck (today)
One main thread = one orchestrator doing all dispatch, decisions, gates, retros, and status for ONE project. Subagents run in the background, but the *thinking/dispatch/gating funnels through one serial conversation with one context window*. Adding projects today = `/project-switch` (swap the single `work/ACTIVE`, reload context) — strictly serial. The per-UC orchestration (the "process tax", IMP-012 W4) is the load that doesn't scale across projects.

## Target architecture — three changes
**1. Each project's loop runs OFF the main thread, as its own background runner.**
- **Per-project Workflow** (IMP-012 W1): the inner loop (pull→build→deploy→validate) is a deterministic background Workflow. The main thread *launches one per project*; they run concurrently; it does NO per-UC dispatch.
- **Per-project session** (stronger): each project gets its own continuous orchestrator SESSION via the Remote/trigger infra (`create_trigger` + `create_new_session_on_fire`, or a `persistent_session_id` per project), each running its own `/loop-run`. True isolation + its OWN context window (no single-context ceiling). The human attaches to whichever.

**2. The main thread becomes a FLEET SUPERVISOR, not a per-project worker.**
A thin fleet-manager that: holds a per-project status registry; launches/monitors the per-project runners; is EVENT-DRIVEN on their completion/gate notifications; and engages a specific project ONLY when there is a human decision (a §F5 gate, a collision, requirement-complete). Its per-project cost drops from "drive every UC" to "launch + route decisions" — O(decisions), not O(UCs × projects).

**3. State + switching.**
- `work/ACTIVE` (single pointer) → a **fleet manifest**: the active project SET, each project's loop-runner handle, status, and a pending-human-decision flag.
- `/project-switch` → "focus" (pick which project's detail to view), not "swap the only active project".
- New `/fleet-status` — queues/gates/constraint across ALL active projects, highlighting which need a human.
- Decisions from N projects QUEUE to the human; each project's loop keeps running in the background while the human is focused elsewhere.

## Why this removes the bottleneck
The expensive per-UC orchestration moves into per-project Workflows/sessions in the background; the main/fleet thread's residual job is routing decisions. Per-project SESSIONS each carry their own context window, so no single context fills. The process-tax metric (IMP-012 W4), computed per-project AND fleet-wide, tells us whether the fleet thread is still a bottleneck.

## Honest constraints
- **The human is still a shared bottleneck** for gates/decisions (one human, N projects) — mitigate by batching/queueing decisions + auto-approving safe gates (§9) to cut gate frequency.
- **Token cost scales with N** (the fleet runs hotter — N× orchestration) — guarded by the process-tax metric; reject fan-out that doesn't pay its DORA way.
- **Resource isolation is already there** (v50: each project is its own git repo; separate AWS stacks/sandboxes), so parallel projects don't contend.

## Sequencing
- **Phase 1 — per-project Workflow loop** (IMP-012 W1). Prerequisite: once a project's loop is a background Workflow, the main thread can run several.
- **Phase 2 — fleet layer:** fleet-manager role + `work/ACTIVE`→manifest + event-driven supervision + `/fleet-status`. Launch a Workflow per active project; route decisions.
- **Phase 3 — per-project sessions** (Remote/trigger infra) for full isolation + independent context windows + human switching; the fleet-manager coordinates across sessions.

## Experiment (register at next retro)
- **EXP-091** — fleet throughput: with N≥2 projects active, total shipped-UC/day rises ~linearly with N while per-project lead time + CFR hold, AND the fleet-thread process-tax stays sub-linear in N. If the main/fleet thread's overhead grows ~linearly with N (it's still doing per-UC work), the layering FAILED. Horizon: first 2-project concurrent run.

## 4. The process-feedback seam (informed, not coupled) — v72 human-directed
The reason the fleet is safe: **project learning improves the shared process
without coupling the process to any project.** Encoded as process §F10.
- Per-project retros tune THAT project's queues off its own ledger shard (local,
  isolated). They stay in `work/<project>/`.
- A lesson only reaches `/process` after being **de-projected**: "in project X,
  Y happened" → "when Y-shaped situation, do Z" (an `EXP-nnn` / rule /
  principle-failure, project-agnostic). A periodic **fleet retro** does this
  roll-up + refreshes the shared DORA baseline.
- Net: `/process` is informed by every project, independent of any — delete a
  project and the process still stands. This is the `/process`-vs-`/work` split
  applied to N projects: N `work/` spaces, ONE `/process`.
- The Linear mirror follows the same shape: one **Initiative per project** (own
  chunk Projects), sharing the team; the board is per-project-isolated by
  initiative while the process/DORA stays in the ledger, not Linear.
