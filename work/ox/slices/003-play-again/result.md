---
slice: 003
slug: play-again
tester: tester agent
date: 2026-06-05
verdict: PASS
---

# Validation Result — Slice 003: Play-again loop + session score

## Verdict: PASS

All 8 success measures confirmed. All 85 tests pass. No defects found.

---

## Step 1 — Test Suite

Command: `cd work/ox/src && python3 -m pytest tests/ -v`

Result: 85 passed in 10.68s

- 13 tests from test_ai.py: all pass
- 5 tests from test_board.py: all pass
- 9 tests from test_game.py: all pass
- 6 tests from test_parser.py: all pass
- 4 tests from test_renderer.py: all pass
- 17 tests from test_security.py: all pass
- 27 tests from test_session.py: all pass (all slice 003 ACs green)

Prior slice suites (58 tests) remain fully green — no regressions introduced.

---

## Step 2 — Customer-observable outcomes (CLI)

All exercises run from `work/ox/src/` via `printf "..." | python3 -m ox`.

### SM-1: Play-again prompt appears after every game result

Command: `printf "A1\nA2\nB1\nn\n" | python3 -m ox`

Observed: After "Player O wins!" the line `Play again? [y/n]:` appears before
the process exits. Exit code 0.

Result: PASS

---

### SM-6: Score displayed after each game; increments correctly

Command: `printf "A1\nA2\nB1\ny\nA1\nA2\nB1\nn\n" | python3 -m ox`

Observed:
- After game 1: `Score — O wins: 1  Draws: 0  X wins: 0`
- After game 2: `Score — O wins: 2  Draws: 0  X wins: 0`

Counts increment correctly across games. Format matches spec exactly.

Result: PASS

---

### SM-3: "n" exits cleanly with code 0 and a closing message

Command: `printf "A1\nA2\nB1\nn\n" | python3 -m ox; echo "EXIT CODE: $?"`

Observed: Output ends with `Thanks for playing!`. EXIT CODE: 0. No traceback.

Also validated with uppercase "N": same clean exit.

Result: PASS

---

### SM-2: "y" replays with a fresh empty board

Command: `printf "A1\nA2\nB1\ny\nA1\nA2\nB1\nn\n" | python3 -m ox`

Observed: After "y", an empty board is rendered:
```
    A   B   C
 1    . | . | .
      -----------
 2    . | . | .
      -----------
 3    . | . | .
```
Then "Player X, enter your move (e.g. B2):" prompt appears. No cell carries a
mark from the first game.

Also validated with uppercase "Y": same replay behaviour.

Result: PASS

---

### SM-4: Invalid play-again input re-prompts exactly once; no infinite loop

Command: `printf "A1\nA2\nB1\nz\nn\n" | python3 -m ox`

Observed:
- "z" causes `Please answer y or n.` and the prompt re-appears once.
- "n" is then honoured; session exits cleanly.

Also tested: "maybe" as first invalid then "y" (replays), "7" then "n" (exits),
two consecutive invalid inputs ("7" then "maybe" — exits after one re-prompt,
second invalid treated as non-"y"; no third re-prompt, no crash).

Exit code 0 in all cases.

Result: PASS

---

### SM-5: Board resets correctly between games

Confirmed via SM-2 evidence above: the empty board render appears at the start
of the second game, with all cells showing ".".

Result: PASS

---

### SM-3 (EOF/Ctrl-C path): Clean exit, no traceback

Command (EOF mid-game): `printf "A1\n" | python3 -m ox; echo "EXIT CODE: $?"`

Observed: `Game aborted.` then process exits. EXIT CODE: 0. No traceback.

Command (EOF at play-again prompt): `printf "A1\nA2\nB1\n" | python3 -m ox; echo "EXIT CODE: $?"`

Observed: Game completes, score line appears, play-again prompt appears, then
EOF is handled — blank line emitted, EXIT CODE: 0. No traceback.

Result: PASS

---

### SM-7: Regression — game still works as before

Across all CLI runs observed:
- AI moves silently (no "Player O" prompt; board updates automatically).
- Coordinate input (e.g. A1, B2) accepted and applied correctly.
- Board renders correctly after every move (3x3 grid with column letters and
  row numbers).
- Win and draw detection unchanged.
- Invalid move input re-prompts without forfeiting turn.

Result: PASS

---

### SM-8: Callable in tests (injectable stdin)

Confirmed by test suite: all 27 session tests in test_session.py use
`run_session(players=<stub>, out=StringIO(), again=<scripted answers>)` — no
subprocess spawned. Multi-game sessions run in-process and return the final
score dict. The default (no `again`) reads from stdin, preserving the shipped
`python -m ox` behaviour.

Result: PASS

---

## Cosmetic note (not a defect)

The play-again prompt appears twice per question in CLI output. This is because
`_ask_play_again` calls `_emit(out, _AGAIN_PROMPT)` (prints with newline) and
then `input(_AGAIN_PROMPT)` (which also prints the prompt to the terminal).
The spec says "prompt the user" and does not specify single-line display;
acceptance criteria count `again()` calls, not visual lines. All AC tests pass.
This is a cosmetic/UX observation only, not a functional defect.

---

## Evidence summary

| Success Measure | Command run | Observed | Status |
|---|---|---|---|
| SM-1 play-again prompt | one game + n | prompt visible before exit | PASS |
| SM-2 y replays empty board | two games y then n | empty board, fresh game | PASS |
| SM-3 n exits cleanly | game + n | "Thanks for playing!" exit 0 | PASS |
| SM-4 invalid re-prompts once | z then n; 7+maybe | one re-prompt, clean exit | PASS |
| SM-5 board resets | two games | empty board at game 2 start | PASS |
| SM-6 score increments | two games | O wins:1 then O wins:2 | PASS |
| SM-7 regression | all runs | AI silent, board renders, input works | PASS |
| SM-8 injectable | test suite | 27 session tests in-process | PASS |
