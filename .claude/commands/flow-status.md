---
description: Show the pull-system flow state (v40) — queue lengths vs their buffers, time thieves, parallelism efficiency, and the work-item tree. Read-only.
argument-hint: <project-name>
allowed-tools: Read, Bash
---

_Project resolution: if no project is named, use `work/ACTIVE`. If stale, stop and suggest `/project-list`._

Act as the **orchestrator**/**flow-manager** (read-only). For project **$1**:

1. Refresh the view: `make flow-status PROJECT=$1` (runs `dora.py flow` and prints
   queue depths + `work/$1/dora/flow.md`).
2. Read `work/$1/queues/policy.csv` and report each queue's **length, throughput,
   dwell, and rework rate against its two buffer knobs** (`min_items` floor +
   `wip_limit` cap) — flag any breach (length < min_items = starving; length ≥
   wip_limit = over-WIP/ageing).
3. Summarise the **time thieves** (largest contributor to gross lead time first),
   **parallelism efficiency** (achieved ÷ max independent set), and open
   **collisions / edge trials** from `architecture/dependencies/edge-ledger.md`.
4. Show the top of `work/$1/items/items-tree.md` (where work sits in the tree).

Report tightly: depths-vs-buffers, the current flow constraint, and what the loop
will do next (pull / replenish / starved). Make NO changes.
