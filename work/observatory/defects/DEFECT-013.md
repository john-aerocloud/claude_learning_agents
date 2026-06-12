# DEFECT-013 — In-flight work is item-invisible: pulled items stay `planned` until the next sweep

**Reported:** 2026-06-12 (human, live loop observation)
**Status:** CONFIRMED → fix NOW
**Surface:** items registry / queue lane / WIP attribution
**Lineage:** DEFECT-004 (three views disagree) + DEFECT-012 (handoff invisible); EXP-037/EXP-040 family

## Expected
Work in flight appears somewhere truthful at ITEM level: it leaves the queue
when pulled, the registry says in-flight, and the WIP/open views show it under
its work-item id.

## Actual
With UC-S013-3 building and UC-S014-4/UC-S015-3 validating in prod:
- all queues 0 (correct — rows removed at pull),
- items.csv state for ALL THREE = `planned` (registry drift: transitions occur
  only at flow-manager sweeps; pulls happen between sweeps),
- stage WIP shows agent activity but one validate entry is keyed
  `s014-steer-prompt-handoff` (slice slug) because the tester self-recorded its
  stage_enter against the slice, not the item.

## Intent
Operator watching where every piece of work is (core observe job, J1).

## Importance
Data-trust on the core job: between pull and the next sweep — exactly when the
operator most wants to see it — the item-level state is wrong on every surface.

## Reproduction evidence (2026-06-12 16:2x)
- `grep` items.csv: UC-S013-3 / UC-S014-4 / UC-S015-3 all `planned`.
- ready.csv/staging.csv header-only; live `/stage-flow`: engineer wip=1,
  validate wip=2 with open ids `UC-S015-3` + `s014-steer-prompt-handoff`.

## Root cause
The PULL is not atomic. The dequeue convention covered the queue file + ledger
row but not the items.csv state transition; item_id discipline on self-recorded
rows (EXP-040) wasn't pinned to "the work-item id, never the slice slug".

## Fix (three axes)
1. **Process (narrowest owners):** the pull ritual = ONE atomic act by whoever
   executes the pull: remove queue row + items.csv state→in-flight + ledger
   dequeue/stage_enter rows keyed by the WORK-ITEM id. → engineer.md, tester.md
   (validation rows carry the UC id), flow-manager.md (sweep RECONCILES, never
   originates, these transitions).
2. **Board self-surfacing (engineer, pinned test):** extend the stage-flow
   coherence check (DEFECT-004 mechanism): a recent open in-event whose item is
   `planned`/absent in items.csv ⇒ `coherence_warning` on that stage, so this
   class of drift is visible on the board instead of silent.
3. **Immediate state repair:** flow-manager reconciles the three items to
   in-flight now.

## Gap-closing experiment
EXP-041 — atomic pull + registry-coherence warning. Applies-to: every pull /
every self-recorded ledger row. Target: CFR (data-integrity), 0 planned-while-
in-flight windows; coherence_warning fires on any future drift.
