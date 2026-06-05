---
slice: 003
slug: play-again
co-authored-by: product + solution-architect
created: 2026-06-05
---

# Acceptance criteria — Slice 003: Play-again loop + session score

Each criterion is observable and automatable (pytest). The session loop is
exercised through `run_session(players=..., out=..., again=...)`, with `players`
stubbed to drive games to a known result, `out` captured, and `again` injected
to script the play-again answers — no subprocess required. Criteria trace to the
slice success measures (SM-n).

---

## AC-01: Play-again prompt appears after every result (SM-1)

Given a session where the game is driven to a terminal result (win, draw, or
loss).
When the game ends.
Then a play-again prompt (containing "Play again" and "y"/"n") is emitted on
the output sink **after** the result is announced, and the session does not
return until the play-again answer has been read.

---

## AC-02: "y" replays with a fresh game (SM-2)

Given a session whose `again` supplier yields "y" then "n", and `players` that
drive each game to a terminal result.
When `run_session()` runs.
Then `play_game()` is invoked **twice** (a second game starts in the same
process after "y"), each game starts from X-first / empty board, and the
play-again prompt appears again after the second game before the session exits
on "n".

And "Y" (uppercase) is accepted identically to "y".

---

## AC-03: "n" exits cleanly with code 0 (SM-3)

Given a session whose `again` supplier yields "n" after one game.
When `run_session()` returns (and when driven through `main()` as a process,
it exits status 0).
Then a brief closing message is emitted, `play_game()` is **not** called again,
and no exception or traceback is produced.

And the same clean exit holds for "N".

---

## AC-04: Invalid play-again input re-prompts exactly once (SM-4)

Given `again` yields an invalid answer first (test each of: "", "z", "7",
"maybe", a 500-char string) then a second answer.
When the play-again step runs.
Then the prompt is re-displayed **exactly once** (prompt emitted twice total),
the second answer is honoured, and:
- if the second answer is "y" → a new game starts;
- if the second answer is anything non-"y" → the session exits cleanly.
There is never a third re-prompt (no infinite loop) and never a crash.

And: EOF / KeyboardInterrupt raised by the `again` supplier exits the session
cleanly with no traceback.

---

## AC-05: Board resets between games (SM-5)

Given a first game driven to a terminal result, then "y", then a second game.
When the second game begins.
Then the board rendered at the start of the second game is the **empty** board —
no cell carries a mark from the first game. (Verified via the first render of
the second game equalling `render(new_board())`, since each `play_game()` builds
its own board.)

---

## AC-06: Score increments correctly and displays after each game (SM-6)

Given games whose results are forced via stubbed `players` to a known sequence,
e.g. [O win, draw, O win].
When each game ends.
Then after each game a score line of the form
`Score — O wins: <o>  Draws: <d>  X wins: <x>` is emitted, with counters
reflecting all games so far:
- after game 1 (O win): O wins 1, Draws 0, X wins 0;
- after game 2 (draw): O wins 1, Draws 1, X wins 0;
- after game 3 (O win): O wins 2, Draws 1, X wins 0.

And: an X-win result (forced via a stub, though unreachable vs the real AI)
increments the X-wins counter and no other — the tally is honest, not hard-coded
to zero. The returned score dict from `run_session()` matches the displayed
totals.

And: counters are per-session — a fresh `run_session()` call starts at
O 0 / Draws 0 / X 0 (no persistence across calls or process restarts).

---

## AC-07: Regression — all prior ACs still pass (SM-7)

Given the slice 001 (AC-01..AC-13) and slice 002 (AC-01..AC-09) acceptance
suites and the full existing test set (58 tests).
When run unmodified against the slice-003 code.
Then every prior AC passes and all 58 prior tests stay green — Board, Parser,
Renderer, AI, and the body of `play_game()` are unchanged in behaviour, and
`__main__.py` still runs.

---

## AC-08: Session is driveable programmatically — injectable stdin (SM-8)

Given `run_session(players=<stub>, out=<buffer>, again=<scripted answers>)`.
When called with answers like ["y", "y", "n"] and `players` that end each game.
Then the whole multi-game session runs to completion in-process (no subprocess,
no real terminal), `play_game()` runs once per "y" plus the first game, and the
session returns the final score dict. The default (no `again`) reads from stdin
so the shipped `python -m ox` behaviour is unchanged aside from the added loop.

---

## AC-09: Security — play-again input adds no new surface (security)

Given the play-again input path, per `architecture/security/cli-process.md`
(play-again clause).
When inspected/tested.
Then: the answer is stripped and used length-bounded (first char only); only
"y"/"Y" replays and all else exits; it is never passed to
`eval`/`exec`/`subprocess`, never used as a path, attribute, or format string;
and a pathologically long answer is handled without building an unbounded buffer
or crashing — i.e. no new attack surface beyond the existing move-input surface.

---

## Out-of-scope (not tested in this slice)

- Choosing sides between games (human as O).
- Persistent score tracking (survives process restart).
- Per-side score beyond O wins / draws / X wins; difficulty levels; AI changes.
- New command-line flags or configuration.
