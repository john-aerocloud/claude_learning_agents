# Board mapping — work-item → Linear / Jira (canonical)

**Status:** canonical map, live-referenced by the `linear` **and** `jira`
projection agents. The same id→object tree and derived-state→status table serves
both boards; each agent is a pure, idempotent, one-way projection of the item
file (the SSOT), reading the item and upserting its one board object — never
writing state back.

Under the v82 event-sourced model the board is a **derived view**. An item's
current state is `fold(events)` through its type's graph
(`process/machinery/state-graphs.json`); the projection agent reads that folded
`derived.state` and maps it to a board status. No board write ever changes the
item — humans read the board; the item file is the only source of truth.

---

## 1. Hierarchy — the work-item tree

The REQ▸CHK▸SLC▸UC tree maps 1:1 onto the board's four nesting levels.

| Framework | id prefix | Board object | Notes |
|---|---|---|---|
| **requirement** | `REQ-` | **the Team itself** (Linear) / project container (Jira) | 1 requirement per project; the team/container name IS the product. No separate object. |
| **chunk** | `CHK-` | **Project** (Linear) / epic (Jira) | groups slices; lives in the requirement's team |
| **slice** | `SLC-` | **Milestone** (Linear) / version-or-epic (Jira) | the shippable value unit, inside its chunk |
| **use-case** | `UC-` | **Issue** | the atomic deliverable; the unit of pull |
| **defect** | `DEFECT-` | **sub-issue of the UC it is against** | defect-as-spec: it hangs off its parent UC (label `defect`) |
| **open-item** | `OI-` | sub-issue of its UC, or an Issue at slice/chunk level | scope decides the attach level (label `open-item`) |

`IMP-*` process-improvement work is the agent's own self-state (SSOT is
`/process`) and is **NOT mirrored to any board**.

Titles carry the human title from the item's definition body plus the canonical
id (e.g. `UC-C1 · Fold carrier codeshares`) so a human can find the item and the
projection stays idempotent (id → board-object cache, upsert in place, no dupes).

## 2. State → board status

The left column is the `derived.state` values from `state-graphs.json` (the fold
of an item's events). Aggregate states (slice/chunk/requirement) bubble from
their children per the graph's `bubble` rule.

**Flow items (use-case):**

| `derived.state` | Board status |
|---|---|
| `registered` | Backlog |
| `ready` | Ready |
| `building` | In Progress |
| `validating` | In Review |
| `dev-validating` | In Review |
| `prod-deploying` | In Progress |
| `prod-validating` | In Review |
| `reworking` | In Progress (rework) |
| `blocked` | Blocked → else Todo → Backlog (NEVER In Progress) |
| `done` | Done |

(The dev-then-prod validation states `dev-validating`/`prod-deploying`/`prod-validating`
come from the EXP-101/§11b state graph; before v100 they were unmapped and fell back to
Backlog, mislabelling active validation work. Aggregates additionally map `planned` →
Backlog.)

**Defect items:**

| `derived.state` | Board status |
|---|---|
| `reported` | Backlog |
| `reproducing` | In Progress |
| `fixing` | In Progress |
| `validating` | In Review |
| `blocked` | Blocked → else Todo → Backlog (NEVER In Progress) |
| `resolved` | Done |
| `wontfix` | Cancelled |

**Open-items:**

| `derived.state` | Board status |
|---|---|
| `open` | Backlog |
| `scheduled` | Ready |
| `done` | Done |
| `wontfix` | Cancelled |

A blocked item shows *why* on its board object: mirror the `blocked` event's note
into a banner/comment while blocked, and post an unblocked note when it clears.
A `blocked` item is NOT actively-worked, so it never maps to In Progress — it shows
as Blocked (or, absent that workspace state, Todo/Backlog) with the `blocked` label,
keeping the In-Progress lane honest. An AGGREGATE (slice/chunk/requirement) whose
only non-terminal children are all `blocked` itself derives `blocked` (see
`_bubble`), so a parked-on-external tree drops out of In Progress instead of
masquerading as active work.
A UC with no acceptance criteria in its definition gets a `needs-acceptance`
label (surfaced, never fabricated).

## 2a. Ticket DESCRIPTION — rich, plan-connected (v88+)

A board object is not just a title + status: its **description** MUST let a human
see, without opening the repo, what the ticket delivers and how it fits the plan.
The projection composes the description from the item file (the SSOT) — it is a
pure render of data already there, never invented. Every projected issue's
description carries these sections (omit a section only if the item genuinely
lacks it):

- **What this delivers** — the item's one-line value statement (the outcome, in
  plain language — NOT the numeric value/cost, which stays off per §4).
- **Jobs to be done** — the item's `job:` code(s) resolved to the job story /
  root need from `work/<project>/product/jtbd-map.md` (e.g. `J15 — trust that a
  resolved fault closes itself out`). This is the WHY.
- **Personas served** — the item's `personas:` ids resolved to who they are from
  `work/<project>/product/personas.md` (e.g. `P1 — CUPPS/PPSM Support Engineer`).
  This is the WHO.
- **Acceptance criteria** — the testable conditions from the item body (the
  `AC-…` list). This is HOW WE KNOW IT'S DONE / what the tester validates.
- **Part of the plan** — the parent chain resolved: this UC → its **slice**
  (with the slice's value statement) → its **chunk** → the **requirement**, plus
  a one-line **contribution** ("advances the slice's job by …"). This is HOW IT
  FITS.

The projection resolves persona/job ids to their prose by reading
`personas.md` / `jtbd-map.md`, and the parent titles/values by reading the
parent item files. Keep it a faithful render; if the item lacks acceptance or a
persona/job mapping, surface that (a UC with no acceptance gets the
`needs-acceptance` label, §2) rather than fabricating. Re-render on every
projection so the description tracks the item (idempotent).

## 3. Labels

- **Type/flow:** `defect` · `open-item` · `blocked` · `needs-acceptance`
- **Job-to-be-done:** `job:<Jn>` from the item's `job` field, so a human can
  filter the board by JTBD. The job *code* is the only thing that crosses over;
  the JTBD prose stays in the item definition, not the board.

## 4. What deliberately does NOT go to the board

DORA metrics, value/cost, token cost, estimates, queue dwell times. All delivery
metrics are DERIVED by `wi-project` from the item event logs; the board is a
human-facing **plan + progress** view, nothing more.
