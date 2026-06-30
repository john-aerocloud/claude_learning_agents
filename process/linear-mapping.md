# Linear mapping — agent-system work-items → Linear (canonical)

**Status:** canonical map (generalises and supersedes the inline mapping in
`process/improvement-slices/IMP-014-linear-plan-progress-board.md`, which mapped
only the single OagEventSource product into one team).

**Purpose.** A **one-way state mirror**, agent-system → Linear, that gives humans
a plan + live-progress board. **No DORA, no estimates, no token cost** — metrics
stay in the ledger as the SSOT for retros (explicit human decision, IMP-014).
Linear has no custom fields anyway.

---

## 1. Teams = projects

One Linear **team per `work/<project>`**. Excluded by decision: `ox` (oxo),
`oxo-online`, `observatory`.

| `work/` project | Linear team | key |
|---|---|---|
| OagEventSource | OagEventSource | `OAG` |
| viggo-fix | Viggo-Fix | `VIG` |
| _(future, via `/project-new`)_ | one new team each | — |
| `IMP-*` process work | **Agent System** | `SYS` |

`_TEMPLATE` is scaffolding — not a team.

## 2. Hierarchy — the work-item tree (`items/items.csv`)

The REQ▸CHK▸SLC▸UC tree maps 1:1 onto Linear's four nesting levels.

| Framework | id prefix | Linear object | Notes |
|---|---|---|---|
| **requirement** | `REQ-` | **Initiative** | 1 per project; portfolio roll-up above the team |
| **chunk** | `CHK-` | **Project** | groups slices; lives in the project's team |
| **slice** | `SLC-` | **Milestone** | the shippable value unit, inside its chunk-Project |
| **use-case** | `UC-` | **Issue** | the atomic deliverable; the unit of pull |

**Titling rule for composite-id chunks.** Some chunks carry a composite id from
JIT replenishment (`CHK-5-SLC-024`, `CHK-9-SLC-026`, …) rather than a clean
`CHK-N`. The sync keys on the raw `id` (so each is still its own Project, no
dupes) but **titles the Project by the chunk's slice outcome, not the raw id** —
e.g. `CHK-5-SLC-024` → "Master-data live adapter", read from `chunks.md` /
`dora_ref`. Clean `CHK-N` ids keep their `CHK-N · <name>` title.

```
Initiative: OagEventSource            (REQ)
  Project:  CHK-3 Normalise           (CHK)
    Milestone: SLC-008                (SLC)
      Issue:   UC-EB5   [In Progress] (UC)
        └─ sub-issue: DEFECT-OAG-010  (defect against UC-EB5)
```

## 2a. Issue content — human title, why, acceptance (REQUIRED)

Every UC Issue MUST carry, **mirrored from the use-case's artifact, never invented
at sync time** (process §12d):

- **Title** — `UC-x · <human title>`, the use-case heading (falls back to
  `UC-x — <job>` only when no artifact title exists).
- **Description** (markdown) — a **Why this matters** section (the use-case's
  observable outcome / value + `Value`/`Job`) followed by an **Acceptance
  criteria** list (the `AC-…` cases it pins).

Source = the project's `slices/<n>/use-cases.md` (per-UC block: heading title,
"Observable outcome", "Acceptance cases" — bullet OR Given/When/Then table) with
`slices/<n>/acceptance.md` as the AC fallback (rows attributed to their UC by
**AC-id stem**, e.g. `AC-28a`→`UC-28`). Parsers are deterministic — see
`scripts/sync-linear.py` (`load_uc_content`). A UC with **no acceptance criteria
anywhere** gets the **`needs-acceptance`** label and an honest "none found" note
— the gap is surfaced, **never fabricated** — and is **not Ready** to build.

Defects carry a defect-as-spec description pointing at their `defects/<id>.md`
(Expected/Actual/Intent), not UC acceptance.

## 3. Non-tree item types → sub-issues / labelled issues

| Framework | id prefix | Lives in | Linear | Rule |
|---|---|---|---|---|
| **defect** | `DEFECT-` | `defects/` | **sub-issue of the UC it is against** | label `defect`. Defect-as-spec: it hangs off its parent UC. |
| **open-item** (UC-scoped) | `OI-` | `open-items.md` | **sub-issue of that UC** | label `open-item` |
| **open-item** (slice/chunk-scoped) | `OI-` | `open-items.md` | **Issue** in the relevant Milestone/Project | label `open-item` |
| **capability** | `CICD-`/`CAP-` | `capabilities.md` | **Issue** under the chunk-Project, Milestone = slice it enables | label `cicd` / `infra` |
| **improvement-slice** | `IMP-` | `/process` | **Issue in the `SYS` (Agent System) team** | kept apart from product boards |

The `defects/` folder uses `DEFECT-OAG-NNN`; the `open-items.md` `OI-NNN` rows
carry a `slice` column — that column decides whether the open-item attaches to a
UC (sub-issue) or to a slice/chunk (issue at that level).

## 4. Workflow states (= the queue model)

The four queues (**Intake → Ready → Deploy → Rework**) plus the derived item
states (`planned / in-flight / done`, from `state.md`) collapse to a single
Linear status set, applied to **Issues** (UCs/defects/etc.):

| Linear status | Source state |
|---|---|
| **Backlog** | in `intake` queue / `planned` |
| **Ready** | in `ready` queue |
| **In Progress** | `in-flight` (engineer building) |
| **In Review** | tester / validate-in-prod |
| **Blocked** | §F5 deploy gate, collision, or `rework` queue |
| **Done** | `item_done` ledger event |

Done bubbles **up** (process §F): a slice's Milestone is done when all its UCs
are done; a chunk's Project when its done-condition is met; the requirement's
Initiative when all chunks are done.

## 5. Labels

**Type/flow:** `defect` · `open-item` · `cicd` / `infra` · `gate:deploy` · `blocked` · `needs-acceptance` (UC with no acceptance criteria in its artifact — not Ready)

**Job-to-be-done:** `job:<Jn>` — every tree item (Initiative/Project/Milestone/
Issue) carries a label for its `job` column from `items.csv` (`job:J0`, `job:J3`,
…) so humans can filter the board by JTBD. The `job` *code* is the only thing
that crosses over; the JTBD prose stays in `project.md`/vision, not Linear.

## 6. Sync mechanics — idempotent one-way reconciler

- **Direction:** agent-system → Linear only. Humans read the board; they do not
  edit state back (preserves the single-writer ledger invariant, STATE-MODEL.md).
- **Trigger:** runs **each inner-dev-loop cycle** (`/loop-run`) so the board
  self-updates as UCs are pulled / built / shipped / gated. Seed once, then auto.
- **Reads:** `items/items.csv` (REQ▸CHK▸SLC▸UC tree) + `state.md` / queues
  (current per-item state).
- **Idempotency:** a per-project cache mapping canonical `id → linear-id`
  (initiative/project/milestone/issue). Re-running reconciles in place — no dupes.
  Canonical id (`UC-…`, `SLC-…`) is also embedded in the Linear title for humans.
- **Script:** `scripts/sync-linear.py` (per IMP-014), generalised to take a
  `--project`/team key and to handle the `SYS` team for `IMP-*`.

## 7. What deliberately does NOT go to Linear

DORA metrics, value/cost/`vc_ratio`, token cost, estimates, queue dwell times.
All of it stays in the append-only ledger; retros read it there. Linear is a
human-facing **plan + progress** view, nothing more.
