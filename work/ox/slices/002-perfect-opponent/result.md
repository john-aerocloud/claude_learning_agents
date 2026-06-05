---
slice: 002
slug: perfect-opponent
validated: 2026-06-05
verdict: PASS
agent: tester
---

# Validation Result — Slice 002: Perfect computer opponent

## Verdict: PASS

All 6 success measures confirmed. All 9 acceptance criteria green.

---

## Surface exercised

- `python3 -m ox` (CLI, piped stdin) from `/work/ox/src/`
- `python3 -m pytest tests/ -v` (full test suite, 58 tests)
- Direct Python imports (`from ox.ai import ai_move`, `from ox.game import play_game`)

---

## Evidence by success measure

### SM-1: Computer never loses

Full game-tree enumeration (all legal X-move sequences, AI plays O):
- Zero terminal states with `win("X")` found across entire search tree.
- Command: `python3 -c` with recursive `enumerate_games(new_board(), 'X')` exploring every branch.
- Result: `Full game tree: AI NEVER LOSES - PASS`

Adversarial sequences tested (all ended O win, no X win):
- Opposite corners fork attempt (A1, C3, A3, C1) → O wins
- Centre-first + all corners (B2, A1, C3, A3, C1) → O wins
- All-edges strategy (A2, B1, C2, B3) → O wins

### SM-2: Computer plays without human input

After every valid X move, O's move was applied and board re-rendered without any prompt for O. Confirmed across multiple piped-input runs.

### SM-3: One-player UX

- Only "Player X, enter your move (e.g. B2):" prompts appeared on stdout.
- "Player O" never appeared as an input prompt; "Player O wins!" is the end-game result announcement, not a prompt — correct behaviour per AC-04.
- Result announced at game end; exit status 0 on every complete or aborted game.

Draw sequence through CLI (X moves: A1, A2, C1, B3, C3):
```
Player X, enter your move ...
[O auto-moves after each X move]
...
It's a draw.
EXIT:0
```

O win sequences confirmed across: corner-first, edge-first, centre-first strategies.

### SM-4: Existing slice 001 tests still pass

```
pytest tests/ -v
58 passed in 9.59s
```
All 39 original tests plus 19 new AI tests green. No regressions.

### SM-5: Response time acceptable

AI move on empty board (worst case): 0.647s — well under 1-second budget.

### SM-6: Callable in tests

- `from ox.ai import ai_move` imports cleanly; returns coordinate string `A1..C3`.
- `play_game(players={"X": stub_x, "O": ai_move})` completes full game programmatically, returns `('win', 'O')`.

---

## Acceptance criteria checklist

| AC | Description | Result |
|----|-------------|--------|
| AC-01 | AI never loses — full tree + symmetric AI-vs-AI | PASS |
| AC-02 | Takes immediate win; blocks opponent threat | PASS (test suite) |
| AC-03 | No O prompt, no stdin read for O's turn | PASS |
| AC-04 | One-player UX end to end, exits 0 | PASS |
| AC-05 | Regression — all slice 001 ACs pass | PASS (58/58) |
| AC-06 | AI move under 1 second (0.647s on empty board) | PASS |
| AC-07 | Importable and callable without subprocess | PASS |
| AC-08 | Deterministic, no mutation, no I/O | PASS |
| AC-09 | No untrusted input surface introduced | PASS (test suite) |

---

## Adversarial checks

1. **Corner-fork strategy** (X: A1, C3, A3, C1) — O wins; fork never completes.
2. **Centre + corner saturation** (X: B2, A1, C3, A3, C1) — O wins.
3. **Edge-first** (X: A2, B1, C2, B3) — O wins.
4. **Invalid input mid-game** (ZZ9, notavalidmove, !@#, occupied cell) — re-prompts X each time, no crash, O auto-moves correctly after X recovers. Exit 0.
5. **EOF after one move** — clean "Game aborted." message, no traceback, exit 0.
6. **Immediate EOF** — clean "Game aborted." message, no traceback, exit 0.
7. **Known draw path** (X: A1, A2, C1, B3, C3) — "It's a draw." confirmed.

---

## No defects found
