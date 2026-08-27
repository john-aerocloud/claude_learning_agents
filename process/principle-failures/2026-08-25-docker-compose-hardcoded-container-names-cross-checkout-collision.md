# Docker Compose hardcoded container_name causes cross-checkout collision (ROC local stack)

**Date:** 2026-08-25
**Found by:** tester, validating DEF-ROC-042

## What happened

While validating DEF-ROC-042 (a docs/gate-script-only defect) I wanted to run the
project's acceptance tier against an isolated `git archive` checkout of the exact
shipped sha (4ecd47a6), to avoid the two other live engineers' uncommitted WIP in
the shared working tree. I ran `npm run local:up` (`docker compose -f
local/docker-compose.yml up -d`) from that scratch checkout.

`work/ROC/src/app/local/docker-compose.yml` sets an explicit `container_name:` for
every service (`roc-local-azurite`, `roc-local-sql-edge`, `roc-local-eventhubs`,
`roc-local-servicebus`). These names are **global to the docker daemon on the
host**, not scoped per checkout/worktree/compose-project-directory. Two of the four
containers (`roc-local-eventhubs`, `roc-local-servicebus`) had been up for 14
minutes already — almost certainly started by one of the two live engineers sharing
the tree — and my `up -d` from a different directory caused Compose to **recreate**
those two containers (fresh, empty state), while leaving the other two alone. A
second, harsher repro (`local:down && local:up`) tore down and recreated **all
four**, including the two that had 14 minutes of accumulated state.

The immediate symptom: 3 acceptance-tier failures in
`tests/acceptance/def027-fresh-read-window.test.ts` (Event Hub read-window
freshness) that were **not present** on a fully fresh, internally-consistent
restart. This is the "false-fail from harness contention is not a product defect"
class (already documented for parallel-file collisions) but the mechanism here is
new: **any two agents anywhere on this host that both run this project's
`local:up`/`local:down` share one set of named containers**, regardless of which
worktree, checkout, or scratch directory they run it from.

## Why it matters

- A tester or engineer validating in an isolated checkout (exactly the practice
  recommended to avoid a dirty/broken shared working tree) can silently destroy
  another live agent's in-progress local-stack state — lost Event Hub/Service Bus
  messages, checkpoints, or seeded fixtures mid-test — with no error, warning, or
  attribution. `docker compose up -d`'s "Recreate" line is easy to miss and gives
  no indication of whose container it just replaced.
- This is the same *class* of hazard as the shared-git-index race (EXP-097) and the
  shared consumer-group race (ROC C3) that motivated per-item files and dedicated
  test tables/consumer-groups — but for the **local Docker Compose stack**, which
  has no such isolation yet.

## Recommendation (not actioned — flagging for cicd/engineer capability work)

- Either drop the hardcoded `container_name:` (let Compose scope by project
  directory/`COMPOSE_PROJECT_NAME`) so different checkouts get different
  containers, or make the project name/container names include a
  session/worktree-derived suffix.
- Until fixed: **never run `local:up`/`local:down` from a scratch/archived
  checkout on a machine where another agent may have the shared stack up.**
  Validate against the real shared working tree's stack (already running), or
  coordinate/confirm no one else is mid-run first.

## Disposition on this validation

Re-ran on a freshly torn-down-and-rebuilt stack (`local:down && local:up`) and got
218 passed / 1 skipped / 0 failed — matching the engineer's reported acceptance
evidence exactly. The 3 failures were harness contention I caused, not a DEF-ROC-042
regression. No further teardown performed (left the stack running, since at least
one other agent depends on it being up).
