# Board mapping — work-item → Linear / Jira (canonical)

**Status:** canonical map, live-referenced by the `linear` **and** `jira`
projection agents. The same id→object tree and derived-state→status table serves
both boards; each agent is a pure, idempotent, one-way projection of the item
file (the SSOT), reading the item and upserting its one board object — never
writing state back.

The **Linear** projection is performed by the shared, v82-native, single-item
tool `.claude/skills/board-projection/scripts/board-project`
(`board-project --project <p> --item <ID>` with `--dry-run` default / `--live`).
It parses the per-item file, maps `derived.state` → the status table below, and
upserts exactly ONE issue idempotently via `.linear-map.json` (no whole-board
re-read). Jira parity is a fast-follow (not yet built).

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

**Flow items (use-case)** — covers every v82 use-case state in
`state-graphs.json` (the deploy/validate granularity added in v82):

| `derived.state` | Board status |
|---|---|
| `registered` | Backlog |
| `ready` | Ready |
| `building` | In Progress |
| `deploying` | In Progress |
| `prod-deploying` | In Progress |
| `reworking` | In Progress |
| `dev-validating` | In Review |
| `validating` | In Review |
| `prod-validating` | In Review |
| `blocked` | Blocked |
| `done` | Done |
| `cancelled` | Cancelled |

**Defect items:**

| `derived.state` | Board status |
|---|---|
| `reported` | Backlog |
| `reproducing` | In Progress |
| `fixing` | In Progress |
| `validating` | In Review |
| `blocked` | Blocked |
| `resolved` | Done |
| `wontfix` | Cancelled |
| `cancelled` | Cancelled |

**Open-items:**

| `derived.state` | Board status |
|---|---|
| `open` | Backlog |
| `scheduled` | Ready |
| `done` | Done |
| `wontfix` | Cancelled |
| `cancelled` | Cancelled |

**Aggregates (slice/chunk/requirement)** — state is DERIVED from children per
the graph's `bubble` rule; the same status column applies:

| `derived.state` | Board status |
|---|---|
| `planned` | Backlog |
| `in_progress` | In Progress |
| `done` | Done |
| `cancelled` | Cancelled |

A blocked item shows *why* on its board object: mirror the `blocked` event's note
into a banner/comment while blocked, and post an unblocked note when it clears.
A UC with no acceptance criteria in its definition gets a `needs-acceptance`
label (surfaced, never fabricated).

## 3. Labels

- **Type/flow:** `defect` · `open-item` · `blocked` · `needs-acceptance`
- **Job-to-be-done:** `job:<Jn>` from the item's `job` field, so a human can
  filter the board by JTBD. The job *code* is the only thing that crosses over;
  the JTBD prose stays in the item definition, not the board.

## 4. What deliberately does NOT go to the board

DORA metrics, value/cost, token cost, estimates, queue dwell times. All delivery
metrics are DERIVED by `wi-project` from the item event logs; the board is a
human-facing **plan + progress** view, nothing more.
