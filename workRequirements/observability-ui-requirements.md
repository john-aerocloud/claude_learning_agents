# Requirement: Delivery Observatory — observe, interrogate, and steer the agent pipeline

> **Status:** intake-ready · **Type:** REQ (new requirement) · **Target project:** `work/observatory`
> **Feed me in with:** `/project-new observatory "Local UI to observe and steer the delivery-agent pipeline"` then `/intake` each chunk in §9.
> **Format:** JTBD-framed, value/cost-hinted, pre-sliced. The orchestrator/product agent should slice §9 just-in-time; this doc is the vision + data contract, not a fixed plan.

---

## 1. Job to be done (top level)

> **When** I am running the self-improving delivery agents across one or more projects,
> **I want** to see where every piece of work is, how each stage is performing, and to steer slicing and prioritisation without leaving a single surface,
> **so that** I can keep the pull-system flowing, catch constraints early, and feed in new work responsibly — while the agents keep all write authority.

**Success measures**
- Time-to-answer "where is work X and why is it stuck?" drops from "grep the repo" to one click.
- Every queue, stage, and DORA metric is visible at a glance and drillable to source.
- No file is mutated except through a Claude interaction the human previewed and accepted.
- New work can only enter in a JTBD + cost-of-delay shape that makes prioritisation possible.

**Why it matters (jobs ranked).** Observability (knowing flow state) is the higher-value job — the pipeline already runs but is opaque. Steering (input to slicing) is second. Responsible work-generation (CoD intake) is the third, and turns the tool from a viewer into the front door of the system.

---

## 2. Hard constraints (non-negotiable — these shape every slice)

1. **Read via files, write via Claude.** The UI reads repo state directly off disk (read-only). It never writes to `work/`, `process/`, or `.claude/`. Every mutation is performed by Claude running the existing slash commands.
2. **Write path = prompt-handoff to chat.** When the user wants to change something (re-slice, re-prioritise, intake new work), the UI **composes a structured prompt** and hands it to the Claude session. The UI does not shell out or self-apply. The human runs the prompt; Claude executes the command.
3. **Preview-before-accept is mandatory.** Every change-initiating prompt the UI composes must instruct Claude to **first present: (a) a plain-language description of what will change, (b) a diagram or before/after view, (c) a concrete worked example of the result** — and then **wait for explicit human acceptance** before writing. "Describe → show → exemplify → accept → apply" is the contract for all mutations.
4. **Local-first.** Runs entirely on the developer's machine against the repo working copy. No cloud dependency to view or steer.
5. **Context protection.** The UI must reduce, not add to, the orchestration context burden. It reads the *computed/summary* artifacts (e.g. `baseline.md`, `flow.md`, `items.csv`) rather than forcing Claude to crawl raw files; prompts it composes are tight and reference paths, not pasted file bodies.
6. **`/process` vs `/work` separation respected.** The UI must visually and structurally distinguish persistent agent self-state (`/process`) from resettable project output (`/work`), and must never let a steering action leak project specifics into `/process`.

---

## 3. Personas

- **Pipeline operator (primary, = the user).** Watches flow, spots constraints, decides what to steer, accepts changes.
- **Work author (Phase 3).** Brings a raw need and is guided into a well-formed, costed, JTBD-framed item.
- **Reviewer (read-only).** Anyone who wants to understand project state without touching it.

---

## 4. Data contract — what the UI reads (verified against the repo)

The UI is a renderer over these sources. **All paths are read-only.** Columns/locations below are the real ones in the repo as of this writing; treat this as the integration spec.

### 4.1 Project registry & selection
| Source | Meaning |
|---|---|
| `work/ACTIVE` | Single line naming the active project (or `none`). |
| `work/<project>/` | One directory per project; `work/_TEMPLATE/` is the scaffold (exclude from the project list). |
| `work/<project>/project.md`, `capabilities.md`, `chunk-plan.md`, `open-items.md` | Project vision, capabilities, chunk plan, loose ends. |
| `work/<project>/decision-log.md` | The resume mechanism / human-decision audit trail. |

### 4.2 Work-item hierarchy (the "where is work" backbone)
| Source | Meaning |
|---|---|
| `work/<project>/items/items.csv` | Authoritative item registry. Columns: `id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref`. `type ∈ {requirement, chunk, slice, use-case, defect}` (`REQ-/CHK-/SLC-/UC-/DEF-` id prefixes). |
| `work/<project>/items/items-tree.md` | Human-rendered REQ→CHK→SLC→UC tree with per-node state. Regenerated from `items.csv` by flow-manager. |

### 4.3 Queues & buffer policy (the pull-system state)
| Source | Meaning |
|---|---|
| `work/<project>/queues/intake.csv` | Items awaiting decomposition. Columns: `item_id,enqueued_ts,value,cost,vc_ratio,position,reason`. |
| `work/<project>/queues/ready.csv` | Ready use-cases to pull (same columns). |
| `work/<project>/queues/deploy.csv` | Awaiting infra-bearing deploy gate (same columns). |
| `work/<project>/queues/rework.csv` | Failed-validation items in MTTR (same columns). |
| `work/<project>/queues/policy.csv` | Buffer knobs. Columns: `queue,param,value,unit,owner,target_metric,last_tuned,experiment`. `param ∈ {min_items (floor/starve), wip_limit (cap/over-WIP)}`. |

### 4.4 Slice artifacts (the drill-down detail)
Per slice dir `work/<project>/slices/<nnn-slug or sNNN-slug>/`:
`slice.md`, `use-cases.md`, `acceptance.md`, `route.md`, `ui-design.md`, `test-plan.md`, `result.md` (presence varies by slice type — UI slices have `ui-design.md`, non-UI may not).

### 4.5 DORA & flow metrics
| Source | Meaning |
|---|---|
| `process/dora/ledger.csv` | Append-only event log. Columns: `timestamp,project,iteration,slice,agent,event,duration_s,outcome,ref,note,item_id,queue`. `event ∈ {task_start,task_end,deploy,failure,recovery,gate}`; also flow events `parallel_dispatch/dequeue/stage_enter/stage_exit/collision`. |
| `process/dora/baseline.md` | Computed: four key metrics (gross lead time, deploy freq, change-fail rate, MTTR), per-agent task times (modal/median/mean), and named **constraint** (ToC). |
| `work/<project>/dora/flow.md` | Per-project flow view (queue depths, time thieves, parallelism efficiency). Refreshed by `make flow-status PROJECT=<p>` / `dora.py flow`. |
| `work/<project>/dora/per-project.md` | Expected-vs-actual per change with regression reflections. |
| `work/<project>/architecture/dependencies/edge-ledger.md`, `use-case-deps.mmd`, `class-deps.mmd` | Dependency model + collision history (explains serialisation). |

### 4.6 Process self-state (separate space)
`process/process-current.md` (now), `process/process-history/vNN-*.md` (superseded, with anticipated-vs-observed), `process/experiments.md`, `process/improvement-slices/IMP-*.md`, `process/principle-failures/`.

### 4.7 Commands the UI composes prompts against (never calls directly)
`/intake`, `/loop-run`, `/flow-status`, `/slice-next`, `/iteration-run`, `/retro`, `/defect`, `/project-new`, `/project-list`, `/project-switch`, `/project-stop`. Definitions in `.claude/commands/`.

> **Note for product agent:** the parser must tolerate partial/empty CSVs (queues are often header-only) and missing optional artifacts. The data contract is the integration boundary — pin to it and fail soft on anything outside it.

---

## 5. Architecture (target shape — refine in solution-architect gate)

**Local web app.** A static SPA (e.g. Vite + a lightweight component layer) served by a thin local read-only server (or file-watch dev server) rooted at the repo.

- **Read layer.** The server exposes the §4 files (raw + parsed) over a localhost read API, or the SPA reads a periodically-regenerated JSON snapshot. CSVs parsed to typed records; markdown rendered for detail panes; `.mmd` rendered via Mermaid. File-watch → live refresh (no manual reload to see flow move).
- **No write layer.** There is deliberately no mutation endpoint. The only "write" affordance is **prompt composition** (§6).
- **Snapshot cache** keeps Claude's context clean: the UI does its own parsing/aggregation; when it hands a prompt to Claude it references paths + item ids, not file bodies.
- **State the UI owns locally** (e.g. last view, filters, zoom level) lives in browser storage only — never in the repo.

```
repo files ──(read-only)──▶ local server / snapshot ──▶ SPA (render, zoom, drill)
                                                          │
                                          "Steer" action  ▼
                                              composed structured prompt
                                                          │  (handoff)
                                                          ▼
                                                   Claude session
                                          (preview → human accepts → command writes files)
                                                          │
                                          file change ◀───┘  (UI's file-watch re-renders)
```

---

## 6. The steer / write interaction (applies to every mutation in Phases 2–3)

When the user triggers any steering action, the UI **composes a prompt** and hands it to chat. The composed prompt MUST:

1. Name the exact slash command and target (`/intake "..."`, `/slice-next observatory`, `/defect ...`, `/retro`, re-prioritise via flow-manager, etc.) and the item id(s)/paths involved.
2. Instruct Claude to **produce a change-preview first**: (a) prose description of what will change and why, (b) a diagram or before/after of the affected tree/queue, (c) a worked example of the resulting artifact/slice/queue order.
3. Instruct Claude to **stop and request explicit acceptance** before writing anything.
4. Carry enough context by reference (ids, paths, current values) that Claude needn't re-crawl the repo.

The UI presents the composed prompt for the user to send (and may show what the expected preview will contain). It does **not** apply the change itself. On acceptance-and-apply in chat, file-watch surfaces the result back in the UI.

---

## 7. Phased scope

### Phase 1 — Observe (highest value; ship first)
Goal: see all work, all stages, all metrics; zoom in and back out.

- **Multi-project overview.** All `work/*` projects (excluding `_TEMPLATE`), each showing status, active slice, last activity, pending gates, and which is `ACTIVE`. (Mirrors `/project-list`.)
- **Pipeline map (zoomed-out).** The pull system as a flow diagram: the stages/queues (Intake → Ready → inner dev loop → Deploy gate → validate; Rework loop) with **live queue lengths rendered against their buffers** (`min_items` floor, `wip_limit` cap) — visually flag *starving* (len < min) and *over-WIP/ageing* (len ≥ cap).
- **Stage cards.** Per stage/agent: throughput, dwell time, rework rate, and per-agent task times (modal/median/mean) from `baseline.md`. The current **constraint** (ToC) is highlighted on the map.
- **DORA panel.** Four key metrics + windows from `baseline.md`; trend where derivable from `ledger.csv`.
- **Time-thief view.** Largest contributors to gross lead time, from `flow.md`.
- **Work-item tree.** REQ→CHK→SLC→UC with per-node state, value/cost/vc_ratio; colour by state and by `/process` vs `/work`.
- **Zoom/drill model.** Click any node/queue item to open a detail pane (slice artifacts rendered, item history from `ledger.csv` filtered by `item_id`, dependency edges from `.mmd` + `edge-ledger.md`), and a clear path back out to the map. Drill levels: pipeline → queue → item → slice artifact.
- **Live refresh** on file change.

*Phase 1 is strictly read-only. No steer affordances yet.*

### Phase 2 — Interrogate & steer slicing
Goal: navigate work in progress, interrogate it, and give input into how it is sliced — all via §6 prompt-handoff with preview-accept.

- **WIP navigator.** Walk in-flight items; for each, show current stage, claimed paths/seams, blocking edges, and collision history.
- **Interrogate.** From any item, compose a question-prompt to Claude ("explain why SLC-x is serialised behind SLC-y", "what does acceptance.md for X actually assert") — read-style, may still preview if it would compute/write.
- **Slicing input (the core Phase-2 mutation).** From a slice or chunk, the user proposes a re-slice / split / merge / re-order / scope change. The UI composes the `/slice-next` or product-replenishment prompt per §6: Claude returns the proposed new slice/use-case set with diagram + worked example, the user accepts, Claude writes the slice artifacts and re-enqueues.
- **Prioritisation input.** Re-order a queue or change value/cost; composed as a flow-manager re-cost/re-prioritise prompt with a before/after queue-order preview.
- **Defect raise.** Compose `/defect` with the structured expected/actual/intent/importance preview.

### Phase 3 — Cost-of-delay work generation (the front door)
Goal: become a ticket/work-generation system that forces work into a prioritisable shape.

- **Guided JTBD intake.** A wizard that refuses vague work: it elicits "When [situation], a [user] wants to [motivation], so they can [outcome]" + success measures, and will not submit until the WHY is established (mirrors `/intake`'s clarification discipline; uses Claude to challenge vagueness).
- **Cost-of-delay capture.** Capture the inputs the CoD framework needs to prioritise against *changing* needs: value profile/urgency (e.g. CoD shape — linear/step/decay), estimated cost/duration, dependencies, and the customers/outcomes affected. (Align with the `costofdelay-optimiser` skill's `features/customers/dependencies/parameters` model so items can flow into scenario optimisation.)
- **Responsible-prioritisation guard.** Surface CoD/vc_ratio ranking and let the author see how their new item would sit against the current queue *before* it's submitted — then hand off the `/intake` prompt with the standard preview-accept.
- **Round-trip.** Submitted items appear in the Phase-1 map; re-prioritisation as needs change is a Phase-2 steer action.

---

## 8. Non-functional requirements

- **Read-only safety:** UI process has no write capability to the repo by construction (separate from the write contract being procedural).
- **Resilience:** tolerate header-only/empty CSVs, absent optional artifacts, and a `none` ACTIVE; never crash on partial state.
- **Performance:** render the map and trees for a multi-slice project (≥20 slices, ≥100 items) without manual refresh lag; incremental update on file-watch.
- **Fidelity:** numbers shown must match the computed artifacts (`baseline.md`/`flow.md`) — the UI does not invent metrics it can't source.
- **Traceability:** every rendered figure links back to its source file+row.
- **Context hygiene:** composed prompts stay tight (ids/paths, not file dumps).
- **Accessibility:** keyboard-navigable zoom/drill; colour choices that survive colour-blindness (state is never colour-only).
- **Separation of spaces:** `/process` views are clearly partitioned from `/work` and cannot be targeted by project-steer actions.

---

## 9. Intake-ready chunks (slice these just-in-time)

Ordered by value. Each is framed for `/intake`; product should decompose into use-cases at replenishment time. Value/cost are **hints**, not estimates.

### CHK-1 — Read layer & project registry  _(value: high · cost: M)_
> When I open the tool, a pipeline operator wants the repo's project + flow state parsed and served locally read-only, so they can build views on trustworthy data.
- Parse §4 sources to typed records; serve over localhost or as a JSON snapshot; file-watch refresh.
- **Acceptance:** lists all `work/*` projects except `_TEMPLATE`; reads `ACTIVE`; parses each queue CSV (incl. header-only), `items.csv`, `policy.csv`, `baseline.md`, `flow.md`; fails soft on missing optional files; re-emits within Ns of a file change.

### CHK-2 — Pipeline map with queues vs buffers  _(value: high · cost: M)_
> When I want flow state at a glance, I want the pull system drawn with live queue lengths against their buffers and the constraint highlighted, so I see where flow is breaking.
- **Acceptance:** renders Intake/Ready/Deploy/Rework with lengths; flags starving (`len < min_items`) and over-WIP (`len ≥ wip_limit`) from `policy.csv`; marks the ToC constraint from `baseline.md`; updates live.

### CHK-3 — DORA, stage cards & time thieves  _(value: high · cost: S)_
> When I assess performance, I want the four DORA metrics, per-agent task times, and the biggest time thieves, so I can act on the constraint.
- **Acceptance:** four metrics + windows from `baseline.md`; per-agent modal/median/mean; time-thief ranking from `flow.md`; each figure links to source.

### CHK-4 — Work-item tree & zoom/drill  _(value: high · cost: M)_
> When I ask "where is work X", I want to navigate REQ→CHK→SLC→UC, click in for full detail, and zoom back out, so I can move between the whole and the part fluidly.
- **Acceptance:** renders tree from `items.csv`/`items-tree.md` with state + value/cost; drill pipeline→queue→item→slice-artifact (markdown + `.mmd` rendered); item history filtered from `ledger.csv` by `item_id`; explicit zoom-out; `/process` vs `/work` visually distinct.

### CHK-5 — Prompt-handoff steer engine  _(value: high · cost: M)_
> When I want to change something, I want the UI to compose a structured, preview-first prompt and hand it to Claude, so all writes go through the accept-gate and never through the UI.
- **Acceptance:** for a given steer action, emits a prompt naming the command + ids/paths and instructing Claude to present (description + diagram + worked example) and await acceptance before writing; UI performs no file writes; emitted prompt verified to carry context by reference, not file dumps.

### CHK-6 — Interrogate & slicing input  _(value: med-high · cost: M)_  _(Phase 2)_
> When I navigate WIP, I want to interrogate items and propose how they're sliced/prioritised, so I can steer delivery without taking write authority from the agents.
- **Acceptance:** WIP navigator shows stage/claims/blocking edges/collisions; re-slice/split/merge/re-order and value/cost change each route through CHK-5 with a before/after preview; `/defect` raise supported.

### CHK-7 — Guided cost-of-delay intake  _(value: med · cost: L)_  _(Phase 3)_
> When I bring new work, I want to be guided into a JTBD + cost-of-delay shape and shown where it would rank before submitting, so work enters responsibly and stays prioritisable as needs change.
- **Acceptance:** wizard blocks submission until JTBD + WHY + success measures present; captures CoD inputs aligned to the `costofdelay-optimiser` model; previews the item's rank against the current queue; submits via the CHK-5 `/intake` handoff; submitted item appears on the map.

---

## 10. Out of scope (for now)
- UI writing to the repo by any path other than Claude-mediated commands.
- Hosting/multi-user/remote access (local-first only).
- Replacing the slash commands or agent logic — the UI observes and proposes; agents decide and write.
- Editing `/process` content from project context.

---

## 11. Open questions for the intake gate
1. Read transport: localhost read API vs regenerated JSON snapshot — pick at solution-architect gate (affects live-refresh latency).
2. Mermaid vs custom SVG for the pipeline map and dependency graphs.
3. How the composed prompt is delivered to the session (copy-to-clipboard + paste, vs a deeper integration) given "prompt-handoff" — confirm the minimum viable handoff.
4. Phase-3 CoD: adopt the `costofdelay-optimiser` CSV scenario model directly, or a lighter inline capture that exports to it?
