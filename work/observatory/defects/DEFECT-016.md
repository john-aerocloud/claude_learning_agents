# DEFECT-016 — Validate (tester) card showed nothing in progress while 2 validations ran

**Reported:** 2026-06-12 ~15:56–16:00 (human, live board)
**Status:** UNCONFIRMED — cannot reproduce; most probable cause is the
dispatch→stage_enter lag window (see below). Re-open with a screenshot/time if
it persists.

## Expected
With 2 tester validations running, the Validate (tester) stage card shows
"● 2 in-flight".

## Actual (reported)
The tester stage showed nothing in progress.

## Reproduction attempt (2026-06-12 ~16:0x, live :5173, Playwright)
`[data-testid="stage-validate"]` renders: `Throughput 2 items/day | Dwell 5m |
● 2 in-flight | Rework 1` — figures present and visible (bbox 308×275 at
y=859), in-flight badge correct, plus the DEF-013 coherence warning for one
slug-keyed tester row. The symptom is NOT present.

## Most probable cause (timing, not a render defect)
The two testers were dispatched ~15:56; their self-recorded `stage_enter`
rows landed 15:57:17/15:57:19. Until a worker records its open row, the board
truthfully shows 0 in-flight — a ~1-minute dispatch→first-row window. A
report made in that window sees exactly what was described. EXP-040
(self-record at actual start) already minimises this to agent-startup time.

## Also observed while reproducing (real, small, already-detected)
One of the two open rows was keyed `s013-defects-view` (slice slug) — the
tester swapped its CLI args (`item_id=UC-S013-3` ended up in the note column).
The DEF-013 coherence warning correctly flagged it on the card. WIP count was
unaffected (still 2). This is the EXP-041 watch item, not a new defect; the
row self-closes at that tester's stage_exit.

## Disposition
No fix dispatched (nothing reproducible to fix). If the human confirms the
symptom OUTSIDE the lag window (or on a different surface — e.g. the In-flight
WIP panel, where fresh items sort BELOW long-stale ones and may be off-screen),
re-open with that detail; the WIP-panel sort/fold behaviour would then be the
suspect to rule on.
