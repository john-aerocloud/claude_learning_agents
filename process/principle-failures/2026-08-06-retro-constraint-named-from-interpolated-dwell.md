# Three retros named the constraint from a number that was 45% interpolation

**Date:** 2026-08-06 · **Project:** OagEventSource · **Found by:** orchestrator, during the
DEFECT-OAG-061 incident retro · **Class:** recurring root cause (§5b requires an entry even though
nothing "failed")

## What happened

The retro's own instrument — `views/stats.md` §B, the time-thief and contribution-to-gross-lead-time
tables — pooled **migration backfill with measured dwell** and presented the total as measurement.

**138 of 282 flow items are backfill.** Their event timestamps were synthesised by spreading a known
span evenly across their transitions, so every state segment came out identical to the second:

```
UC-14  registered 06-17T23:30 → made_ready 06-21T12:10 → pulled 06-25T00:50
       → built_green 06-28T13:30 → deployed 07-02T02:10 → validated 07-05T14:50
       every gap = 304,800.0s exactly, five times running
UC-16  byte-identical timestamps to UC-14
```

Real work does not produce five consecutive segments agreeing to the second. This is linear
interpolation wearing the costume of a measurement.

**It is not evenly distributed, which is what made it dangerous.** Backfill lands only on the states
the migrated items walked, so pooling it inflated exactly the delivery stages and left the queue
states untouched:

| state | reported share | measured share | backfill share of that state |
|---|---|---|---|
| `deploying` | 12.30% | **6.00%** | 73.15% |
| `building` | 10.12% | **2.03%** | 88.96% |
| `ready` | 10.54% | **2.79%** | 85.42% |
| `dev-validating` | 13.96% | **9.02%** | 64.45% |
| `open` / `blocked` / `reported` / `fixing` | unchanged | unchanged | **0%** |

## The consequence, and it is not hypothetical

Three consecutive retros named a **delivery stage** as the constraint and spent their change budget
mechanising it. On measured data every working owner is fast — **cicd median 655s per item, engineer
2,053s, tester 3,723s** — and essentially all elapsed time is inventory standing still: **`queue`
57.80%, median 166,319s (1.9d) per item**, of which `open` alone is 39.73% at a median of 3.07 days
across 51 never-pulled findings.

EXP-123 was opened specifically to reduce `queue` and **scored NEGATIVE** at its first opportunity —
against a share metric that cannot distinguish "work waits longer" from "there is more work".

## Why-chain

1. **Why is `queue` the top measured contributor?** 51 open-items age at a median 3.07d and 57 items
   sit at median 10.9h in `registered`. Inventory, not work.
2. **Why does inventory accumulate?** Intake has no admission control. Every finding a census, gate or
   retro surfaces is registered (depth 64 against an advisory cap of 10) and nothing is ever explicitly
   declined or deferred-with-a-date. The cap is advisory *by correct design* — Little's Law governs WIP,
   not backlog depth — so nothing bounds arrivals.
3. **Why did no retro attack it?** Because the instrument said the delivery stages were the problem, and
   the instrument is the thing used to decide what to fix. A self-confirming measurement: each retro read
   the table, saw an inflated delivery stage on top, and aimed there.
4. **Why did the known fix not land?** v128 diagnosed the confound *exactly* and routed the remedy —
   *"`stats.md` must report median per-item dwell in `registered`/`ready` alongside the share, so
   EXP-123's next scoring is against a count-independent number"* — **as prose in a version comment,
   with no owner, no item and no test.** It never landed.

## The principle that failed

**§17c.3 — a comment is not a control.** The process has this rule, cites it constantly at *code*, and
has never applied it to **the retro's own output**. v128's routed metric fix is the **seventh** recorded
prose-only remedy in this repo (after `make wire-provenance`, the unread corpus markers,
`awaiting_observation`, "push on green" aimed at a misdiagnosis, the never-generalised heal comment, and
`make render-diagrams` red for ~20 days). Six of those were about product code. This one is about the
instrument that chooses where every future retro spends its budget — so it compounds.

A related instance surfaced in the same cycle and is filed separately
(`OI-LOOP-GATE-BLIND-TO-A-DEPLOY-THAT-IS-NOT-OWED`): UC-OB1 sat **4.84 days** in `deploying` for a
deploy that was never owed, against a cicd median of **655s** — a **640× outlier** that nothing flagged.
Note that the pooled table would have made even that look ordinary; it reads as extreme only once the
backfill is removed.

## Fixed, not described

- `_is_interpolated` + `_compute_glt` segregate backfill into its own column and exclude it from every
  measured figure; per-state backfill share printed beside it. **4 new tests, 209 green.**
- Every `by_state`/`by_owner` row carries `median_per_item_s` + `n_items` — v128's owed fix, implemented.
- The `loop-gate` backlog advisory now reports median in-queue **age** and names the oldest item.
- Process **v132 §17f limbs 6–7**: no constraint may be named from a figure without stating its backfill
  share and per-item median; and **a metric fix a retro routes MUST land as code in that same retro.**
- Registered as **EXP-128**, falsifiable, with KILL stated: if fixing the instrument changes neither where
  retros aim nor whether lead time moves, kill the row rather than re-prescribe it — which is precisely
  the mistake made with v128's prose.

---

## POSTSCRIPT — the subordinate move was executed, and the evidence partly FALSIFIES it

v130 routed *decline-or-schedule aged intake* as the exploit for this constraint; v131 re-routed it. This
retro executed it: the product agent gave an explicit disposition to all **56** non-terminal findings in
intake. Result:

| disposition | count |
|---|---|
| SCHEDULE | 45 |
| DEFER with a real date | 5 |
| MERGE into a host item | 3 |
| already correctly dispositioned | 1 |
| **DECLINE** | **0** |

**Intake moved 64 → 61.** Three items, all merges. The constraint is essentially unmoved.

**This is a result, not a failure of the pass.** Product looked hard and declined nothing because there is
nothing to decline: nearly every item is an architect- or engineer-ruled census/audit finding with its
acceptance already specified — not a speculative wishlist. That matches v130's own diagnosis (registration
throughput vastly exceeds delivery; investigation is *generative* — one ground-truthed reproduction
produced 6 items plus 5 corrections).

*Therefore the routed subordinate move cannot fix this constraint.* **You cannot decline your way out of a
backlog that is not junk.** The remedy the `loop-gate` advisory names first — *deliver faster* — is the
only limb that applies here, and two retros spent their subordinate slot on the limb that does not.
The next retro should stop re-routing admission control and put its subordinate move on **throughput**:
the merge class is the only one that removed inventory without losing evidence, and finding merges is
cheap (product found a fourth, `OI-OAG-SCHEDULE-UPDATE-UNREACHABLE` → `OI-OAG-SCHEDULE-STREAM-IDENTITY`,
beyond the three named in its brief).

## POSTSCRIPT 2 — "SCHEDULE" the disposition is not `scheduled` the state (§17f again)

The 45 SCHEDULE dispositions were recorded as `amended` notes and **deliberately NOT executed as state
transitions.** `queue_map` sends `scheduled` → the **`ready` queue**, whose `wip_limit` is **4** and which
was already at **4/4**. Firing them would have taken ready to **49 against a cap of 4** — and `ready` is a
WIP-STAGE queue, so the gate would have gone to exit 2 and **blocked the loop outright.**

Product meant "this is worth doing, keep it in priority order". The state graph means "admitted to WIP,
pullable now". **Same word, two subjects** — the §17f failure one layer up, in the vocabulary shared
between an agent's disposition and the machinery's state name. It nearly converted a correct decision into
a self-inflicted stall, and it would have looked like progress: intake would have fallen 61 → 16 with
nothing delivered.

The decisions live where they belong — as reasoned `amended` events on each item — and only items actually
being pulled next should ever enter `scheduled`.
