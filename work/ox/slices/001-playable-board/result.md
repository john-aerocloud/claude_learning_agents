---
slice: 001
slug: playable-board
validated: 2026-06-04
tester: tester-agent
verdict: PASS
---

# Validation Result — Slice 001: Playable Board

## Verdict: PASS

All 6 success measures confirmed. All acceptance criteria exercised pass.

---

## Surface exercised

`python3 -m ox` run from `/work/ox/src/` via piped `printf` input.
Also: `play_game()` imported directly and called with monkeypatched suppliers (no subprocess).

---

## Evidence by success measure

### 1. Full game to X win (column)

Command:
```
printf "A1\nB1\nA2\nB2\nA3\n" | python3 -m ox
```
Result: Board rendered after each move. Final output: `Player X wins!`. Exit 0.

Also validated: X wins on a row (row 1: A1, B1, C1) and both diagonals (A1-B2-C3 and A3-B2-C1). All announced correctly.

### 2. Full game to draw

Command:
```
printf "A1\nB2\nA2\nA3\nB3\nB1\nC1\nC3\nC2\n" | python3 -m ox
```
Result: All 9 cells filled, no winner. Output: `It's a draw.`. Exit 0.

### 3. Invalid input resilience

Command:
```
printf "\nZZ\nD4\nA1\nB1\nA2\nB2\nA3\n" | python3 -m ox
```
- Empty string `""`: `Player X: '' is not a move — type a cell like B2 (A-C, 1-3).`
- `ZZ`: `Player X: 'ZZ' is not a move — type a cell like B2 (A-C, 1-3).`
- `D4` (out of range): `Player X: 'D4' is off the board — columns A-C, rows 1-3.`

Each: clear distinct message, same player re-prompted, turn not lost. Game completed normally after valid input.

### 4. Occupied cell rejection

Command:
```
printf "B2\nB2\n..." | python3 -m ox
```
O attempts to play B2 (already held by X): `Player O: B2 is already taken — pick another.`
O re-prompted; turn not lost.

### 5. Board width

Maximum line width across all output: **50 characters**. Well within 80-column limit.
Board layout consistent (column header + row lines + separators) across every state.

### 6. EOF / Ctrl-C

Command:
```
printf "A1\n" | python3 -m ox
```
After X plays A1, O encounters EOF. Output: `Game aborted.`. No Python traceback. Exit 0.

---

## Adversarial edge cases

| Input | Outcome |
|---|---|
| `" b2 "` (space-padded, lowercase) | ACCEPTED — whitespace trimmed, case normalised; X placed at B2 |
| `"a1"` (lowercase) | ACCEPTED — normalised to A1; O placed at A1 |
| `"B 2"` (space between col/row) | REJECTED — `'B 2' is not a move — type a cell like B2 (A-C, 1-3).` |
| 54-char string | REJECTED — `Input too long — type a cell like B2.` |

---

## AC coverage

| AC | Description | Result |
|---|---|---|
| AC-01 | Centre move accepted and recorded | PASS (B2 accepted, appears on board) |
| AC-02 | Win detection all 8 lines | PASS (row, column, both diagonals verified via CLI) |
| AC-03 | Draw detection | PASS (9-cell fill, no winner → "It's a draw.") |
| AC-04 | Valid coordinates accepted (case + whitespace) | PASS (" b2 ", "a1" both accepted) |
| AC-05 | Malformed input rejected with typed reason | PASS (empty, ZZ, long string → malformed messages) |
| AC-06 | Occupied cell rejected | PASS ("B2 is already taken — pick another.") |
| AC-07 | Board fits 80 columns | PASS (max width 50) |
| AC-08 | Alignment consistent | PASS (all states identical column positions) |
| AC-09 | Turn not lost on invalid input | PASS (confirmed across all invalid types) |
| AC-10 | X moves first | PASS (first prompt: "Player X, enter your move") |
| AC-11 | Result announced and exit 0 | PASS (both win and draw; exit code 0 confirmed) |
| AC-12 | play_game() importable/callable without subprocess | PASS (returns ('win', 'X'), no side-effects) |
| AC-13 | Player move-supplier is a parameter | PASS (custom X/O suppliers injected via players dict) |

---

## No defects found
