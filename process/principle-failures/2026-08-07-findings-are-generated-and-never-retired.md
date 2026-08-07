# 2026-08-07 — the system generates findings and retires none, and three retros watched it happen

**Class:** chronic constraint the system failed to smooth (process §5b / retro step 1a — a
recurring root cause opens an entry even when nothing "failed" on the day).
**Project:** OagEventSource. **Retro:** v135 (incident, DEFECT-OAG-070's resolve).

## What is true, measured

State `open` is the largest contributor to gross lead time and has been for three consecutive
retros:

| retro | `open` share of measured GLT | median/item | n |
|---|---|---|---|
| v132 (2026-08-06) | 39.73% | 3.07d | 51 |
| v134 (2026-08-07) | 42.09% | — | — |
| **v135 (2026-08-07)** | **42.18%** | **3.8d** | **54** |

`backfill % of state` for `open` is **0.00%** — this is clean measured dwell, not the
interpolation artifact that v132 caught elsewhere. By owner, `queue` is **59.69%** of GLT
(median 240,945s = 2.8d, n=115). Intake holds **65 items, median age 2.2d, oldest 8.0d**.
Defect arrivals are **36 in the trailing 30 days against 38 all-time** — essentially all
discovery is recent, and the discovery rate exceeds the retirement rate structurally.

## Why this is a principle failure and not just a backlog

Every measurement above was **already available** at v132, which named `queue`/`open` correctly
and said so in terms. v133 and v134 then both spent their change budget elsewhere — v133 on
brief-authoring (EXP-129), v134 on stale-blocker shelf-life (EXP-130). Both were real findings
and both were worth fixing. But the constraint was identified, restated, and not attacked, three
times running. **Identifying a constraint and then routing the cycle's budget past it is the
failure**, and process §5b exists precisely to forbid it ("GATE the change-set on the
constraint").

## Root cause, four levels

1. `open` dominates because 54 findings dwell a median 3.8 days unpulled.
2. They dwell because every gate, census, probe and agent-read **manufactures** an open-item,
   while the loop pulls only from `ready` and **nothing ever promotes or retires an OI**.
3. There is no forcing function because loop-gate's intake check is deliberately **ADVISORY**
   (v126) — which is *correct*, since blocking on depth inverts the constraint — but the
   advisory has **no consumer**. It prints depth and age every single cycle and nothing is
   obliged to answer it. The one signal that measures the constraint is the only signal nothing
   must act on.
4. Retiring a finding requires an explicit decline/defer decision, and there was **no cheap
   mechanised path** for one. So every OI is implicitly "someone will do this", and the queue
   can only grow.

**The root cause is a rich finding-GENERATION mechanism with no finding-RETIREMENT mechanism.**

## The pattern this belongs to

This is the **third** recurrence of EXP-123's founding observation: *documented obligations are
skipped; mechanised ones are honoured.* v126 recorded it (four loop preconditions came due and
only the one returning a non-zero exit code was obeyed). v132 recorded it about the retro's own
instrument. It now recurs about the retro's own **constraint discipline**. A rule that lives only
as prose — including a rule about following rules — does not bind.

## What changed (v135, EXP-131)

`make loop-gate` gained a BLOCKING check on **age-without-a-decision**: a backlog item older than
7d with no in-date `defer_until:` blocks the pull. It blocks on the decision, never on the depth,
so v126's ruling stands. The cheapest path to green is a **dated defer, never a close** — that
asymmetry is deliberate, because a gate whose easiest remedy were "close it" would manufacture
pressure to close real findings, which §F8a bans outright.

## The honest risk, stated so the next retro can check it

This gate could become the harm it prevents. If it starts producing closures rather than defers,
or defers that are extended reflexively rather than re-decided, it must be **reverted, not
re-tuned** — and EXP-131's measurement names both audits explicitly. A second risk is narrower:
the SUBORDINATE move (an OI carrying schedule-or-defer **at creation**, capping the generator
instead of filtering downstream) is named and **not built**. If the generator keeps outpacing
retirement, filtering at the gate will only relocate the queue.
