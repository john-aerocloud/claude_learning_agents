# Principle failure — the automatic §F8 retro was repeatedly OFFERED to the human instead of FIRING

- **Date:** 2026-06-26
- **Project:** OagEventSource
- **Principle violated:** §F8 (retro fires automatically at the slice-completion /
  threshold cadence) + §F9.4 ("slice completion is not a human checkpoint; run the
  retro, never ask") + the EXP-030 / 2026-06-06 anti-pattern
  (`orchestrator-prompted-instead-of-auto-retro`).

## Expected
After retro v67, the §F8 cadence should have fired a retro automatically at the
next slice completion. The loop should have run: tester-validate → slice-done →
bubble → **retro** → next pull, all in-turn, never surfacing the retro as a human
choice.

## Actual
A LOT shipped with NO retro between v67 and v68: SLC-021 close, SLC-025
(serviceType), the Oag-prefix + OagBagBeltSet contract rename (delta-026), a full
event-store drop + clean-name reset, DEFECT-OAG-028 / 030 / 031, and a
prematurely-closed CC3 (closed on CI-green, never validated live). The measured
retro-debt at v68 was **8 slice/chunk closes** (SLC-013/015/023/021, CHK-6/4 +
the bubbles) since the v67 retro row — far past the threshold of 1.

Root cause: the orchestrator (the running session) **repeatedly OFFERED the retro
to the human** ("shall I run the retro now?") instead of running it. The §F8 /
§F9.4 RULE that forbids this already existed and was still violated — so the
recurrence proves a rule is not sufficient enforcement.

## Why the principle did not hold
"Run the retro automatically" was a behaviour expected of the orchestrator's
**discretion**. Discretion is exactly what fails under the orchestrator-asks-too-
much / EXP-030 pressure: at a boundary the orchestrator defaults to handing
control back. There was no machine-checkable state that made advancing past a due
retro impossible — nothing the loop had to satisfy, only something it was
supposed to choose to do.

## Structural fix (mechanical, not another rule)
A **retro-debt gate** in the loop machinery (v68):
- `dora.py retro-debt --project P` counts retro-triggering events (slice/chunk
  closes, defect resolves, deploy failures) since the last `retro` ledger row and
  **exits non-zero (code 2 = RETRO DUE)** when debt ≥ threshold (default 1). A
  `retro` row resets the counter.
- `make retro-debt PROJECT=P` wraps it on the allowlist.
- `loop-run.md` step 7 makes the gate a **hard loop-state precondition**: a
  non-zero exit means the loop MUST run `/retro` before it may pull next work, and
  may NOT offer the retro to the human. process §F8 + orchestrator.md state the
  same. "The retro fires at the cadence" is now a checkable property of the loop,
  not the orchestrator's choice.

## Narrowed guidance
When a standing behavioural rule is violated AGAIN after being written down, do
not write the rule a third time — make adherence MECHANICAL: a counter/gate/hook
in the loop state that the loop cannot advance past. Discretion that has failed
twice is not a control.
