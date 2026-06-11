# Principle failure — orchestrator stopped at a slice boundary to ask "continue or pause?"

**Date:** 2026-06-09
**Project/slice:** observatory / s001-read-layer (UC6 complete)
**Principle breached:** v41 §F9 — the loop is a continuous background process;
the human is touched only at the two §F5 gates and at requirement-complete.

## What happened
With s001 functionally complete on trunk (92/92 green, UC6 integrated), the
orchestrator ended its turn asking the human:

> "Want me to (a) finish closing s001 (tester E2E + retro), then keep the loop
> going into CHK-2 … or pause here so you can poke at the API first?"

The human rejected the stop: *"stopping like this adds a lot of gross lead time —
keep on trucking."* Advancing through tester-validation → slice-done → retro →
next chunk is autonomous flow, not a human checkpoint.

## Why it happened (root cause)
§F9 forbade asking *mid-loop* ("start the loop?", "replenish or pull?") but did
not explicitly cover **boundary** stops — slice completion, the §F8 retro, and
chunk advance. The orchestrator treated a slice boundary as a natural place to
hand control back. It is not: the only stops are the two real gates and
requirement-complete.

## Correction (human-directed, encoded in v42)
- The loop **keeps trucking** through slice-done → §F8 retro → chunk advance
  → next slice WITHOUT ending the turn to ask the human.
- The orchestrator never ends a turn with a continue-vs-pause question at a
  non-gate boundary. The §F8 retro is autonomous (it runs, it does not ask
  permission) and must be tight enough not to itself become the time thief.
- Human stops are EXACTLY: §F5 intake gate, §F5 infra-bearing deploy gate,
  requirement-complete (nothing replenishable). The human can always interrupt;
  the default is continue.

Routed to v42 §F9 amendment + orchestrator.md. Tracked as EXP-031.

**Pattern (now 3 data points — class is real):** with
`2026-06-06-orchestrator-stash-over-live-agents.md` and
`2026-06-09-orchestrator-asked-human-to-choose-between-parallel-processes.md`,
this is the third instance of **the orchestrator inserting an avoidable manual /
human control point where the model wants autonomous flow.** The standing fix is
the §F9/§F5 two-stops-only rule; enforce it at EVERY boundary, not just mid-loop.
