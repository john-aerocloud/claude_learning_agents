# Slice 002 — Thin route (TDD plan)

Sequenced red→green→refactor steps for the local two-player game. Each step is
the **thinnest** code that turns its test green — no logic written ahead of a
test that demands it.

Order rationale: the pure logic module comes first because it needs no React,
no DOM, no network — it is the cheapest place to drive design and it directly
satisfies T2 (logic unit-testable in isolation). Win/draw/illegal-move/reset are
all exercised there. Only once the engine is proven do we wire React components
(GameRoot → Board → Cell → Status) over it, mapping each functional acceptance
case to a component/integration test. The security/network policy checks (S1,
S2, T1) come last as assertion tests over the finished UI. T3 (pipeline) is a
deploy-time observable, not a unit test — noted at the end.

## Conventions

- Logic module: `src/game/engine.ts`, tests `src/game/engine.test.ts` (Vitest,
  no React import).
- Components under `src/game/` (`GameRoot.tsx`, `Board.tsx`, `Cell.tsx`,
  `Status.tsx`), each with a co-located `*.test.tsx` using
  `@testing-library/react` + `user-event` (already in devDeps — no new runtime
  dependency, per delta).
- Commit on each red→green→refactor cycle going green. Message states intent
  (which acceptance case advanced), not the diff.

---

## Phase A — Pure game logic module (no React) → satisfies T2

State shape (introduced incrementally by the tests below):
`GameState = { board: Cell[9]; currentPlayer: 'X' | 'O'; winner: 'X' | 'O' | null; status: 'playing' | 'won' | 'draw' }`
where `Cell = 'X' | 'O' | null`.

### A1. `initialState()` returns an empty board, X to move, playing
- **Red:** `engine.test.ts` asserts `initialState()` gives nine `null` cells,
  `currentPlayer === 'X'`, `winner === null`, `status === 'playing'`. No module
  exists → import fails.
- **Green:** Create `engine.ts` exporting `initialState()` returning that literal.

### A2. `applyMove` places the current player's symbol in an empty cell
- **Red:** From `initialState()`, `applyMove(state, 0)` → cell 0 is `'X'`; all
  others `null`. Function absent.
- **Green:** Add `applyMove(state, i)` that returns a new state with `board[i]`
  set to `currentPlayer`. Immutable (returns a copy). No turn switch yet — keep
  it minimal until A3 forces it.

### A3. `applyMove` alternates the current player after a valid move (AC-2)
- **Red:** After `applyMove(initial, 0)`, `currentPlayer === 'O'`; after a second
  move, back to `'X'`. Currently stays `'X'`.
- **Green:** Flip `currentPlayer` in the returned state.

### A4. `applyMove` on a taken cell is a no-op (AC-3, illegal move)
- **Red:** Apply to cell 0, then apply to cell 0 again → state is unchanged
  (same board, same `currentPlayer`). Currently it overwrites / flips turn.
- **Green:** Guard: if `board[i]` is non-null, return the input state unchanged.

### A5. Win detection — each of the 8 lines (AC-4, T2)
- **Red:** Eight cases (3 rows, 3 cols, 2 diagonals): drive a board to a
  completed line for `X` and assert `status === 'won'`, `winner === 'X'`. Add at
  least one `O`-wins case. No win logic yet → status stays `'playing'`.
- **Green:** After placing a symbol, check the eight index-triplets; if any holds
  three equal non-null cells, set `status='won'`, `winner` = that symbol. Keep
  the triplet list as a single `const LINES`.

### A6. No further moves accepted after a win (AC-4, board lock at logic level)
- **Red:** After a winning move, `applyMove` on an empty cell returns the state
  unchanged (status stays `'won'`, board unchanged).
- **Green:** Extend the A4 guard: also no-op when `status !== 'playing'`.

### A7. Draw detection — full board, no line (AC-5)
- **Red:** Drive a full board with no winning line; assert `status === 'draw'`,
  `winner === null`. Currently stays `'playing'`.
- **Green:** After the win check, if no winner and no empty cells remain, set
  `status='draw'`.

### A8. `reset()` returns the start state (AC-6)
- **Red:** `reset()` deep-equals `initialState()` (empty board, X to move,
  playing). Function absent.
- **Green:** Export `reset = () => initialState()` (or alias).

### A9. Refactor
- Extract `LINES`, `isFull`, `findWinner` helpers if the win/draw code is
  duplicated. Confirm engine has zero React/DOM/network imports (this is the
  T2 evidence). Suite stays green.

> At end of Phase A, T2 is fully met: win on each of 8 lines, draw, illegal-move
> rejection, and reset all pass with no React/DOM/network.

---

## Phase B — React components over the engine

### B1. `Cell` renders its value and is a button (AC-1 building block, S1)
- **Red:** `Cell.test.tsx`: rendering `<Cell value="X" .../>` shows "X" via plain
  JSX text; `<Cell value={null}/>` renders an empty/blank clickable button;
  clicking calls the `onSelect` prop with the cell index. Component absent.
- **Green:** `Cell` renders `value` as JSX text content inside a `<button>` that
  calls `onSelect(index)` on click. **No `dangerouslySetInnerHTML`** — value is
  interpolated. Disabled when `value` is non-null or `disabled` prop is set.

### B2. `Board` renders nine cells in a 3×3 grid (AC-1)
- **Red:** `Board.test.tsx`: given a 9-cell array, renders nine buttons; a cell
  with `'X'` shows "X". Clicking cell n calls `onSelect(n)`. Component absent.
- **Green:** `Board` maps the board array to nine `Cell`s, forwarding index and
  `onSelect`, and a `locked` flag down to each `Cell`'s `disabled`.

### B3. `Status` shows the turn indicator (AC-2) and terminal result (AC-4/5)
- **Red:** `Status.test.tsx`: `status='playing', currentPlayer='X'` → text
  "X's turn"; `'O'` → "O's turn". `status='won', winner='X'` → "X wins";
  `winner='O'` → "O wins". `status='draw'` → "Draw". Component absent.
- **Green:** `Status` returns the matching string from the props. Plain text only.

### B4. `GameRoot` integration — click places a symbol (AC-1)
- **Red:** `GameRoot.test.tsx` renders `GameRoot`; clicking the first empty cell
  shows "X" in it. Component absent.
- **Green:** `GameRoot` holds `useState(initialState())`, renders `Status` +
  `Board`, and on cell select calls `applyMove` and stores the result.

### B5. `GameRoot` — turn alternation visible in UI (AC-2)
- **Red:** Initial status reads "X's turn"; after one click reads "O's turn";
  after a second click "X's turn". (Fails only if wiring/derivation is wrong.)
- **Green:** Pass `currentPlayer`/`status` from state into `Status`. (Likely
  already green from B4 wiring — keep the test as a regression pin for AC-2.)

### B6. `GameRoot` — clicking a taken cell does nothing (AC-3)
- **Red:** Click cell 0 (→X, turn O); click cell 0 again; cell 0 still "X" and
  status still "O's turn".
- **Green:** Already enforced by engine A4; test pins the integrated behaviour.
  Ensure the occupied `Cell` is `disabled` so the click can't even fire.

### B7. `GameRoot` — win locks the board and shows the result (AC-4)
- **Red:** Play X into a winning line (e.g. 0,1,2 for X interleaved with O on
  3,4); status shows "X wins"; an unplayed empty cell is disabled / clicking it
  does nothing.
- **Green:** Pass `status==='won'||'draw'` as `locked` into `Board`/`Cell`;
  `Status` renders the winner. Engine A5/A6 already prevent post-win moves.

### B8. `GameRoot` — draw shows "Draw" (AC-5)
- **Red:** Play a sequence filling the board with no line; status shows "Draw".
- **Green:** No new code expected (engine A7 + Status B3 cover it) — pin AC-5.

### B9. `GameRoot` — "Play again" resets (AC-6)
- **Red:** After a finished game, a "Play again" button is present; clicking it
  clears the board to nine empty cells, status returns to "X's turn", and a new
  move can be played. Button absent.
- **Green:** Render a "Play again" button when `status !== 'playing'`; its
  handler sets state to `reset()`.

### B10. Refactor
- Tidy props, extract a `useGame` hook if `GameRoot` grew unwieldy, dedupe test
  helpers (e.g. a `playMoves(indices)` helper). Suite green.

---

## Phase C — Wire into the app shell (replace placeholder)

### C1. Root route renders the game, not the title placeholder
- **Red:** An `App` test asserts the `/` route renders the game board (nine cells
  / "X's turn") rather than the slice-001 title screen. Currently renders
  `TitleScreen`.
- **Green:** Point the `/` route at `GameRoot` in `App.tsx`. (Decide with the
  team whether `TitleScreen` is removed or kept behind a later route; thinnest
  path for this slice is to render `GameRoot` at `/`.) Update/replace the
  existing `TitleScreen` smoke expectations as needed so the suite is green.

---

## Phase D — Security & network policy tests (S1, S2, T1)

### D1. No `dangerouslySetInnerHTML` in the game UI (S1)
- **Red:** A guard test greps the `src/game/` source files and asserts the string
  `dangerouslySetInnerHTML` does not appear. (Static assertion — reads the files
  from disk in the test.) Fails if any sink is present.
- **Green:** Confirmed absent by design (all values are JSX-interpolated). Test
  stays as a standing regression guard.

### D2. Cell value set is closed to {X, O, empty} (S1)
- **Red:** Property/enumeration test over the engine: after any legal sequence,
  every board cell ∈ `{'X','O',null}` — no other value can appear. (Reinforces
  that no user-supplied text is rendered.)
- **Green:** Already guaranteed by the engine types/logic — pin it.

### D3. No outbound network call during gameplay (T1, S2)
- **Red:** In a `GameRoot` integration test, spy on/stub `global.fetch`,
  `XMLHttpRequest`, and `WebSocket`; play a full game (moves → win → reset) and
  assert none were called.
- **Green:** No code change expected (the slice has no I/O) — this is the unit-
  level evidence for T1/S2. The authoritative T1 evidence is the Playwright
  request log; see D4.

### D4. (Handoff to tester) Playwright request-log assertion for T1/S2
- The browser-level "zero fetch/XHR/WebSocket from gameplay" check belongs in the
  smoke/e2e suite against the deployed bundle. Note it in the route and hand the
  in-browser assertion to the tester; do not block the unit cycle on it.

---

## T3 — Pipeline (deploy-time observable, not a unit test)

T3 ("new bundle ships through the existing S3+CloudFront pipeline, same URL, no
IaC/IAM change") is verified by the pipeline run + diff, not a TDD step. After
Phase C lands on main green, the existing build/upload/invalidate path ships the
new bundle. No infra, IAM, or pipeline file should change — confirm the diff is
application-only before merge.

---

## Summary mapping (acceptance case → step)

| Case | Step(s) |
|------|---------|
| Func 1 (click → symbol) | A2, B1, B2, B4 |
| Func 2 (alternation)    | A3, B5 |
| Func 3 (taken no-op)    | A4, B6 |
| Func 4 (win + lock)     | A5, A6, B7 |
| Func 5 (draw)           | A7, B8 |
| Func 6 (play again)     | A8, B9 |
| T1 (no network)         | D3, D4 (e2e) |
| T2 (pure logic unit)    | A1–A9 |
| T3 (pipeline)           | deploy-time, post-Phase C |
| S1 (no dSIH, closed set)| B1, D1, D2 |
| S2 (no outbound)        | D3, D4 (= T1) |
