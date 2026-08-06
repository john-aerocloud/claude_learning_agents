# 2026-08-06 — we schedule by logical dependency and never by resource

**Project:** OagEventSource · **Retro:** owner-requested · **Constraint:** `queue` **49.73%** of GLT,
rising for a fifth consecutive retro (37.02 → 39.36 → 41.78 → 47.18 → 49.73)

## The owner's observation, which is the whole finding

> *"if we have multiple gates that are serialising then we need to think about how to schedule this
> so we are not getting failures. We also need to be mapping bottlenecks etc to flow work around —
> dynamodb scans do not sound like things that should be connected with linting, committing and
> pushing"*

A 6-million-item DynamoDB scan and an `eslint` run have **no logical dependency whatsoever**. They
share no file, no item, no `deps` edge. And yet they serialise — because they compete for one
machine's CPU, disk and network — and that contention manifests as **agent death**, not as slowness.

## Measured

| | |
|---|---|
| `eslint src tests` idle | **8 s** |
| the identical work under concurrent load | **19 s** (2.4×, nothing changed but load) |
| load average during the failures | **14.68** |
| load average once quiet | **8.19** |
| agent deaths this session | **12+** |
| watchdog threshold | **600 s of silence** |

Two agents died at the *identical* step — *"verify the combined trunk state is green"*. I diagnosed
that as gate cost and **registered `DEFECT-OAG-064` on that premise without ever timing the
command**. When finally measured, lint was **8 seconds**. The premise was false; the contention was
real.

## Why-chain — five levels, landing where the owner pointed

1. **Why is `queue` 49.73% of GLT?** Items sit unworked.
2. **Why do they sit?** Work in flight keeps dying and restarting — 12+ deaths today, one item
   resumed **five times** with nothing durable until the instruction changed.
3. **Why do agents die?** The liveness watchdog kills at 600 s of *silence*. Heavy commands emit
   nothing while running, so a slow command and a hung one are **indistinguishable to the watchdog**.
4. **Why are commands slow enough to hit it?** Concurrent heavy work — full-store scans, full test
   suites, type-aware lint — running simultaneously across 4–5 agents on one machine.
5. **Why is that allowed to happen?** **Nothing models the machine as a finite resource.** `wip_limit`
   caps by *queue* — a logical stage. `deps` edges express *logical* ordering. **There is no resource
   dimension anywhere in the flow layer**, so two activities that cannot logically conflict are
   treated as freely parallel while physically contending.

That is a scheduling model with one axis where it needs two.

## Why it recurred despite everything added this week

§17e governs red gates. §17f governs unmeasured numbers. `wip_limit` governs queue depth. **None of
them can express "these two activities compete for the same physical resource."** So every control
was satisfied while the machine thrashed — and the failure surfaced as a watchdog kill, which reads
like an infrastructure flake rather than a scheduling defect.

Worse, it is **self-concealing**: contention makes work slower, slower work trips the silence
watchdog, the kill looks like an API problem, and the diagnosis lands on the wrong layer. I made
exactly that error and then compounded it by asserting a mechanism from plausibility instead of
timing the command — inside an item whose own acceptance demanded before/after wall-clock.

## What this costs, in the constraint's own currency

Every death is **rework at the dispatch layer**: a resumption, re-read context, re-establish state.
The work that survived today survived because it committed incrementally — not because it avoided
contention. So the constraint's dominant waste right now is **not** slow agents; it is **agents
being killed and restarted**, and that is an *exploit* target, not a capacity problem.

## The rule (routed to §F2b)

**Schedule by resource class, not only by logical dependency**, and **never let a long-running
command be silent.** Two limbs, because either alone fails:

- a concurrency cap per *resource class* (full-store scan, full test suite, type-aware lint,
  external API) that is independent of queue membership;
- any command that can exceed a fraction of the watchdog budget either **emits progress** or is
  **backgrounded with a waiter** — so a slow command is never mistaken for a hung one.

## What did NOT go wrong

The incremental-commit rule held completely. Twelve deaths, and every agent that committed as it
went kept its work: the heal-forward landed 2 prod corrections plus full evidence; the 062 engineer
survived three deaths across two dispatches with all five commits intact. The one agent that batched
lost everything four times. That rule is now load-bearing and should not be relaxed.
