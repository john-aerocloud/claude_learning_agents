# IMP-014 — Linear plan/progress board (state mirror, NOT metrics)

> **Canonical mapping now lives in `process/linear-mapping.md`** — it generalises
> the single-team mapping below to **one team per project** (excluding ox /
> oxo-online / observatory), defects/UC-open-items as **sub-issues of their UC**,
> and a dedicated **`SYS` (Agent System) team** for `IMP-*`. The §"Mapping" block
> below is the original OagEventSource-only sketch; defer to `linear-mapping.md`.

**Owner:** orchestrator → engineer build. **Decision:** human — "I want a board that shows the plan + progress, easy for humans to interact with. DORA metrics stay HERE (ledger) for process improvement; do NOT put them in Linear."

## Scope
A one-way **state** sync, agent-system → Linear, that mirrors the work-item plan and its live progress onto a human-facing board. **No DORA numbers** (Linear has no custom fields anyway; metrics live in the ledger for retros).

## Mapping (verified against the OagEventFeed workspace)
- Workspace `OagEventFeed`, team `OAG` (id `98b29531-52ec-4fb8-9e38-4f00a12b036b`). No custom fields — state only.
- **Initiative** = product (OagEventSource) · **Project** = chunk (CHK) · **Milestone** = slice (SLC) · **Issue** = use-case (UC)
- **Statuses** = the queue states: Backlog → Ready → In Progress → In Review → Blocked (§F5 gate / collision) → Done
- **Labels** = `defect`, `gate:deploy`, `blocked`, `open-item`
- Canonical id (`UC-…`/`SLC-…`) embedded in the issue title for humans; idempotency via a local `id → linear-issue-id` map cache.

## Build = idempotent reconciler
`scripts/sync-linear.py` reads `items/items.csv` (REQ→CHK→SLC→UC tree) + `state.md`/queues (current per-item state), and upserts the Linear structure + statuses. Re-running reconciles (no dupes). Seed once → then the inner-dev-loop calls it each cycle so the board self-updates as UCs are pulled/built/shipped/gated.

## Out of scope (deliberately)
DORA fields/estimates/token cost — none of it goes to Linear. The ledger remains the metrics SSOT for retros/process improvement.
