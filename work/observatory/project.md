---
project: observatory
status: active        # active | stopped
owner: john.nicholas@aerocloudsystems.com
created: 2026-06-09
stopped: 
---

# observatory

_Problem statement (seed): Local UI to observe and steer the delivery-agent pipeline._

## User

**Solo pipeline operator** — the human (likely a team of one, at least initially) who
drives the delivery-agent system: seeding projects, triaging intake, signing off gates,
and acting on flow constraints. This person has full write access to the working tree and
runs slash commands to advance the pipeline.

---

## Job(s) to Be Done (product vision)

> Full top-level JTBD, §1 of `workRequirements/observability-ui-requirements.md`:
> "When I am running the self-improving delivery agents across one or more projects,
> I want to see where every piece of work is, how each stage is performing, and to steer
> slicing and prioritisation without leaving a single surface, so that I can keep the
> pull-system flowing, catch constraints early, and feed in new work responsibly — while
> the agents keep all write authority."

Data contract for all read sources: see §4 of the requirements doc (verified against the
repo; treat as the integration spec). Hard constraints (read-only, write-via-Claude,
preview-before-accept, local-first): §2 of the requirements doc.

### RE-VISION NOTE (2026-06-09, human-directed)

The CHK-2 thin queue map was superseded. Showing four buffer-queue depths told the
operator nothing about where work actually sits — pulled items disappeared from view.
The CORE observe job is now the **full per-item delivery value-stream map**: every stage
labelled in sequence with throughput, dwell, in-flight WIP, and rework — all traceable
to ledger rows. The buffer queues are stages within the value stream, not the map
itself. CHK-2 delivered (s002 done) is subsumed into the broader CHK-2 done-condition
restated below. CHK-3 is rescoped to add the ledger-aggregation endpoint and the
value-stream render; the DORA panel from the original CHK-3 is absorbed into it.

### CORE jobs (the reason this product exists)

**J1 — See the full delivery value-stream live (the primary job)**
When the operator wants to know whether the pipeline is healthy and where work sits,
they want to see the WHOLE process value-stream — every stage labelled
(Intake → Decompose → Ready → [Capabilities / UI-Design / Build-TDD / UI-Validate]
→ Deploy → Validate → Done, + Rework loop, + gates) with per-stage throughput, dwell,
in-flight WIP count, and rework count — so they can see at a glance where work is
flowing, where it is stuck, and what has already moved through.

_Functional:_ every stage shows four numbers sourced from `process/dora/ledger.csv`;
in-flight WIP is never invisible (pulled items stay visible in the stage they are in);
each figure is traceable to its source ledger rows.
_Emotional:_ remove the low-grade anxiety of "something moved and I have no idea
where it went or how long it sat there."

**J2 — Navigate and interrogate the flow (the companion core job)**
When the operator asks "where is work X and why is it stuck?", they want to traverse the
REQ→CHK→SLC→UC tree, drill into any item for full artifact + history + dependency detail,
and navigate back to the pipeline map — so they can move between the whole picture and
the part in one click rather than opening multiple files.

_Functional:_ replace multi-file navigation with a zoom/drill model; answer provenance
questions instantly.
_Emotional:_ feel oriented, not lost, inside a multi-slice, multi-agent flow.

_These two jobs together define the CORE value of Observatory. They are served by
CHK-1 (read layer + ledger aggregation), CHK-2/CHK-3 (now merged: value-stream map
with per-stage metrics, subsuming the thin queue map and the original DORA panel), and
CHK-4 (work-item tree + drill). Delivering CHK-1 through CHK-4 is the primary mission._

---

### SECONDARY jobs (supporting / valuable, but not the reason this product exists)

**J3 — Steer the pipeline without hand-editing files**
When the operator sees something that needs action — a re-slice, a queue re-order, a
defect raise — they want to compose and hand off a structured, preview-first prompt to
Claude so that all writes go through the accept-gate and never through the UI.

Served by CHK-5 (prompt-handoff steer engine) and CHK-6 (interrogate + slicing input).

**J4 — Bring new work in responsibly**
When the operator has a raw need, they want to be guided into a JTBD + cost-of-delay
shape and see where it would rank before submitting, so work enters prioritisable and
stays so as needs change.

Served by CHK-7 (guided CoD intake).

---

## Chunk ranking (derived from the human's priority signal)

| Chunk | Title | Job | Classification | Status |
|-------|-------|-----|----------------|--------|
| CHK-1 | Read layer & project registry | J1/J2 enabler | **CORE** | DONE (s001) |
| CHK-2 | Value-stream map (full pipeline) | J1 — see the whole process live | **CORE** | RE-SCOPED (absorbs original CHK-2 + CHK-3; s004 is next) |
| CHK-4 | Work-item tree & zoom/drill | J2 — navigate and interrogate | **CORE** | BACKLOG |
| CHK-5 | Prompt-handoff steer engine | J3 — steer without file edits | SECONDARY | PLANNED |
| CHK-6 | Interrogate & slicing input | J3 — deeper steer + WIP navigation | SECONDARY | PLANNED |
| CHK-7 | Guided cost-of-delay intake | J4 — responsible work generation | SECONDARY | PLANNED |

**CHK-2 re-scope note:** the original CHK-2 (thin 4-box queue map, s002 delivered) and
original CHK-3 (DORA panel + stage cards, s003 not yet started) are merged into a
single new CHK-2 done-condition: the full per-item delivery value-stream map with
per-stage metrics sourced from the ledger. s002 and s003 are superseded; s004 is the
new next slice for CHK-2.

Core chunks (CHK-1, CHK-2, CHK-4) constitute Phase 1 (Observe) from the requirements
doc. Secondary chunks (CHK-5..CHK-7) constitute Phases 2–3 (Steer + CoD intake).

---

## Success measures

Observable signals that the CORE jobs are being done better. Acceptance tests for each
slice will trace to the SM(s) they advance.

| # | Measure | Target (v1 baseline) |
|---|---------|----------------------|
| SM1 | Time-to-answer "where is work X and why is it stuck?" | < 1 click from the pipeline map; currently "grep the repo" (estimated > 5 minutes) |
| SM2 | Every DORA metric + queue depth visible at a glance | All four metrics + queue state rendered on open; zero file navigation needed |
| SM3 | Every rendered figure links to its source file + row | 100 % traceability; no invented numbers |
| SM4 | Live refresh on file change | UI re-renders within a configurable N seconds of any §4 source change; no manual reload |
| SM5 | Resilience to partial state | Never crashes on header-only CSV, missing optional artifact, or ACTIVE = none |
| SM6 (secondary) | All pipeline mutations go through Claude's preview-accept gate | 100 % of steer actions emit a structured prompt; UI writes zero bytes to the repo |

---

## Out of scope for v1

- Multi-user / access-control: single local operator only.
- Remote / hosted deployment: local filesystem access is a hard constraint.
- Agent log streaming / real-time event tailing (beyond file-watch polling).
- Inline editing of slice or architecture artefacts.
- Mobile / responsive layout optimisation.
- Replacing the slash commands or agent logic — the UI observes and proposes; agents decide and write.
- Editing `/process` content from project context.
