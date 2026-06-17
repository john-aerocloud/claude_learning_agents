# Version 2 — Worked example: a retro that finds a queue bottleneck and fixes it

A realistic walk-through of one slice-completion retro under the pull system. It
shows the path the brief asks for: **read the flow data → identify a bottleneck
(a time thief) → make a concrete process change → register it as an experiment
with a target metric.** Numbers are illustrative but internally consistent and in
the same units the live ledger already uses (seconds).

Context: project `oxo-online`, slice `SLC-011 spectate-mode` just reached `done`
(its 4 use-cases UC-051…UC-054 validated). The orchestrator (process owner) runs
the retro automatically in-session, focus question = the standing default:
*"What was the largest contributor to gross lead time, and what can be attempted
to reduce it whilst protecting DORA?"*

---

## 1. Recompute — what the data says

`make dora-flow` regenerates `work/oxo-online/dora/flow.md`. The headline:

```
SLC-011  gross lead time (created → last UC done):  14,820 s
  service time (sum of stage work):                  4,180 s   (28%)
  wait time (sum of all thieves):                   10,640 s   (72%)
```

Wait dominates — as the penny-game predicts when the buffer is deep. The
time-thief report ranks *where* the wait went:

| Rank | Thief | Wall-clock | Attributed to |
|---|---|---|---|
| 1 | **Ready-queue wait** | **6,900 s** | buffer depth / batch size |
| 2 | Deploy-queue wait | 1,520 s | pipeline concurrency group |
| 3 | Displacement | 1,150 s | `DEF-009` (a defect pre-empted UC-053) |
| 4 | Seam serialisation | 720 s | UC-052 held `port-game-store` |
| 5 | Session idle | 350 s | one overnight boundary |

Per-item view confirms the pattern: UC-054 was **costed at 600 s** but **sat in
Ready for 3,300 s** before a worker pulled it — it aged 5.5× its own build time
waiting. UC-051…UC-054 were all created in a **single replenishment batch of
4** when the buffer last dipped, then drained one at a time.

Per-stage DORA is healthy — no single agent is slow (engineer median 720 s,
tester median 540 s, all within target). **The constraint is not a stage; it is
the queue.** This is exactly the Theory-of-Constraints trap the system is built
to avoid: optimising a non-constraint stage would be waste.

---

## 2. Diagnose — name the mechanism, not just the metric

The largest thief (Ready-queue wait, 6,900 s = 47% of GLT) traces to one
mechanism: **the replenishment batch is too large for the buffer policy.**

- `queues/policy.csv` Ready row currently: `min_items = 2`, `wip_limit = 8`.
  The flow view shows Ready's metrics: **length** peaked at 8, **dwell median**
  3,300 s, **throughput** 1.1/active-day, **rework rate** 0.0 (no churn — the
  problem is ageing, not quality).
- When length dropped below `min_items = 2`, product replenished a **whole slice's
  worth** (4 use-cases) at once, filling toward the high `wip_limit = 8`.
- With a single dev-loop worker (`N=1` for this slice — UC-052's seam hold forced
  serialisation), the back of the queue aged the whole time the front was built.

This is the penny game in miniature: a deep `wip_limit` lets a large batch sit and
age. The high cap *caused* the dwell; it did not protect against starvation
(`min_items` does that, and length never approached it). Note the **uniform model
pays off**: the fix touches only Ready's `wip_limit` — Deploy and Rework knobs stay
put, and because every queue reports the same four metrics the effect is
attributable to exactly that change.

Secondary, smaller signals (logged, not yet acted on — one data point each, per
the "never change a principle on a single data point" rule):
- Displacement by `DEF-009` (1,150 s) is **working as designed** — a defect on
  delivered value correctly pre-empted; the cost is *visible*, which is the point.
  No change; keep watching whether defect pre-emption becomes a recurring thief.
- Seam serialisation (720 s) on `port-game-store` — note it; if it recurs across
  two more slices, it becomes a parallelism/seam-splitting candidate.

---

## 3. Decide — the change, routed to its narrowest owner

The fix is a **per-queue buffer + batch policy** change — a cross-agent rule of
flow — so it routes to the flow-manager's replenish rule plus the **Ready row of
`queues/policy.csv`**, **not** to any craft agent (narrowest-owner rule, process
§25/§36):

> **Change EXP-040:** Lower Ready's `wip_limit` from 8 to 4 and replenish in
> **small increments** (≤ 2 use-cases per top-up) so the queue cannot accumulate a
> slice-sized backlog. Keep `min_items = 2`. Replenishment fires *more often, less
> each time*. Owner: `flow-manager.md` (replenish-trigger) + `queues/policy.csv`
> (Ready `wip_limit` only — Deploy/Rework untouched).

Why this protects, not just trims: starvation risk is governed by `min_items`
(unchanged) and replenishment *latency*, not by `wip_limit`. Firing replenishment
more often at the same `min_items` keeps the loop fed while cutting the standing
depth that
ages work. Smaller batches also tighten defect responsiveness (less committed WIP
to interrupt) — directly the resilience the brief wants.

---

## 4. Register it as an experiment (process §25a)

Every change is an experiment, scored later or repealed. The row written to
`/process/experiments.md`:

| field | value |
|---|---|
| id | `EXP-040` |
| date | 2026-06-09 |
| artifact(s) | `flow-manager.md` (replenish rule), `work/*/queues/policy.csv` (Ready row) |
| target metric | **gross lead time** (via Ready-queue wait); guard: deployment frequency must not drop |
| anticipated effect | Ready-queue wait ↓ from ~6,900 s to < 2,500 s on a comparable 4-UC slice; GLT ↓ ≥ 25%; **no** new starvation (zero loop-idle-for-empty-Ready events) |
| applies-to | any slice with ≥ 3 use-cases processed at worker capacity `N ≤ 2` |
| scoring horizon | 2 scoring opportunities |
| status | active |

Guard clause (the §25 net-win rule): if shrinking the batch *raises* starvation
or drops deployment frequency (replenishment overhead per cycle outweighs the
wait saved), the experiment is **under-question** at the next retro and either
rewritten (e.g. adaptive batch sized to current `N`) or retirement-trialled.

---

## 5. What the next retro will check

At the next qualifying slice the orchestrator scores EXP-040 against its
anticipated effect from the refreshed `flow.md`:

- Ready-queue wait on a comparable slice — did it fall below 2,500 s?
- GLT — down ≥ 25%?
- Loop-idle-for-empty-Ready events — still zero (no starvation)?
- Deployment frequency — held or improved?

If yes → **validated**, and the rule is *integrated* into `flow-manager.md` as
plain operating practice (experiment scaffolding stripped, per §25a v34). If the
mechanism didn't actually fire or didn't help → under-question, and the retro
sharpens or retires it. Either way the decision is evidence-driven and the agents
get *simpler*, not more accreted — which is the whole point of the system.

---

### Why this example is representative

It exercises every v2 capability the brief asked for: per-item DORA (UC-054's age
vs cost), queue length/wait tracking, **time-thief attribution** (the ranked
table), the buffer/penny-game logic (deep MAX → ageing), defect pre-emption made
visible rather than hidden, Theory-of-Constraints discipline (don't optimise a
fast stage), narrowest-owner routing, and the experiment lifecycle that lets the
system *learn to deliver faster* and prove it did.
