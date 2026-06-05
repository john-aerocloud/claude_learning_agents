---
slice: 003-ai-opponent
artifact: route
author: engineer
created: 2026-06-05
status: proposed
---

# Route — Slice 003: Single-player vs AI

A thin, strictly-ordered TDD sequence through the acceptance cases. Each step is
red → green → (refactor) → **commit on green**. Steps are sequenced so the suite
is green at every commit and each change lands independently on trunk.

## Grounding (read before starting)

- `GameState` (from `engine.ts`): `{ board: Cell[]; currentPlayer: Player;
  winner: Player | null; status: Status }`, `Cell = 'X'|'O'|null`,
  `Player = 'X'|'O'`, `Status = 'playing'|'won'|'draw'`. AI consumes this type
  verbatim — no new game-state shape.
- `applyMove(state, index)` already enforces legality, win/draw detection, and
  turn flipping. The AI reuses it for tree search; do **not** re-implement win
  logic in `ai.ts`.
- `GameRoot.tsx` owns `useState(initialState)`, exposes `onSelect`, derives
  `locked = state.status !== 'playing'`, and renders Status + Board + Play again.
- Existing selectors to reuse in component tests: cells via
  `getByLabelText('cell N')`; status via `role="status"` (messages `"X's turn"`,
  `"O wins"`, `"Draw"`); reset via `getByRole('button', { name: /play again/i })`.
- Existing policy tests live in `policy.test.tsx` (D1 dangerouslySetInnerHTML,
  D2 closed value set, D3 no network). **Constraint:** D3 currently plays a
  two-player X-win (cells 0,3,1,4,2) then resets. Two-player must remain the
  **default** mode so that test stays valid without modification — design the
  mode selector to default to two-player.

## Sequencing principle

Phase A is fully independent (pure module, no React). Phases B and C touch
`GameRoot.tsx` and are sequentially dependent on each other (B introduces mode
state that C consumes), so a single engineer takes B→C in order. Phase D depends
on C being wired. A is parallelisable against nothing else it conflicts with and
should land first because C imports it.

---

## Phase A — Pure AI module (`src/game/ai.ts` + `ai.test.ts`)

No React, no DOM. Tests import only `engine.ts` and `ai.ts` (satisfies T1, T2).
Proposed signature: `export function bestMove(state: GameState): number` —
returns the board index O should play. Assumes `state.currentPlayer === 'O'` and
`state.status === 'playing'`; behaviour outside that is out of scope for the
slice (caller in C only invokes it then).

- **A1 — valid move on empty board.**
  Red: `bestMove` on a board where it is O's turn with all-but-one cells open
  returns an index `i` with `board[i] === null`. Start with an empty-ish board
  (e.g. X has played one cell, O to move). Assert returned index is in range
  `0..8` and currently empty.
  Green: minimal minimax (or even first-empty) that returns a legal empty index.

- **A2 — takes an immediate win.**
  Red: board where O has two in a line and the completing cell is empty (and X
  has no higher-priority threat); assert `bestMove` returns the winning index,
  and `applyMove(state, bestMove(state)).status === 'won'` with `winner === 'O'`.
  Green: extend search to score terminal O-wins highest (full minimax begins
  here).

- **A3 — blocks an immediate X threat.**
  Red: board where X has two in a line with the third cell empty and O has no
  immediate win of its own; assert `bestMove` returns the blocking index.
  Green: minimax that evaluates opponent replies (negamax/min layer) — blocking
  falls out of "avoid the worst opponent outcome".

- **A4 — never loses (game-tree exhaustion, = T3 / F4).**
  Red: drive a full game tree where **X plays every legal move** at each X turn
  and **O plays `bestMove`** at each O turn, starting from the initial state with
  X to move first. Recurse to every terminal state. Assert **no** terminal state
  has `winner === 'X'` (every leaf is `draw` or O-win). This is the load-bearing
  correctness test for the slice.
  Green: A2/A3 minimax should already pass A4; if any X-win leaf appears, the
  search depth/scoring is wrong — fix `ai.ts` only.
  Note: search both X-moves-first (X is human/first player) here. Keep runtime
  well under the suite budget; perfect 3×3 minimax over ~9! ≈ 362k orderings is
  fine but prefer alpha-beta or memoisation if the test is slow.

- **A5 — refactor.** Tidy `ai.ts` (extract `score`/`minimax` helpers, name the
  O/X maximiser clearly) with the A1–A4 tests green. No behaviour change.
  Commit: "AI plays O optimally — pure minimax, never loses (A1–A4 / T1–T3, F4)".

---

## Phase B — Mode selector UI (`GameRoot.tsx` + test)

Introduce mode state without yet calling the AI. Default = two-player so the
slice-002 path and the existing D3 network test are untouched.

- **B1 — selector renders, two-player is default.**
  Red: render `GameRoot`; assert a mode control exists offering "vs Computer"
  (e.g. `getByRole('button'/'radio', { name: /vs computer/i })`) and that the
  initial status is still `"X's turn"` with the board empty (default unchanged).
  Green: add `mode` state (`'two-player' | 'vs-computer'`, default
  `'two-player'`) and render a fixed control to set it. Control is a fixed button
  set, not free text input (satisfies S1: closed value set, no user-supplied
  text).

- **B2 — selecting "vs Computer" starts a game with human as X (F1).**
  Red: click "vs Computer"; assert status reads `"X's turn"` and board is empty.
  Green: clicking sets `mode = 'vs-computer'` and resets state to `initialState()`
  (human is X by engine default).

- **B3 — switching mode resets the board.**
  Red: play one move in two-player default, then switch to "vs Computer"; assert
  the board is cleared and status is `"X's turn"`.
  Green: mode-change handler calls `setState(reset())`. (Avoid AI invocation here
  — C wires that.)
  Commit: "Add vs-Computer mode selector; two-player stays default (B1–B3 / F1, S1)".

---

## Phase C — GameRoot wired to AI (depends on A + B)

- **C1 — AI plays O automatically after human X (F2).**
  Red: select "vs Computer"; click an empty cell as X; assert that after the
  click a second symbol (`O`) appears in a previously empty cell with no further
  interaction, and that exactly one O is present. Use the same `getByLabelText`
  cell selectors; assert via rendered cell text/aria.
  Green: in `onSelect`, after applying the human move, if `mode === 'vs-computer'`
  and the resulting `status === 'playing'` and `currentPlayer === 'O'`, compute
  `bestMove(next)` and `applyMove` it before committing state. Drive the AI move
  inside a `useEffect` keyed on `(mode, state)` (so render reflects X first, then
  O) **or** apply both moves in the handler — pick the approach that keeps the
  render observable and the 200ms budget (C2). Prefer the effect so the human's X
  paints, matching F2/F3 "after the human move".

- **C2 — AI move renders within 200ms (F3 / T4).**
  Red: in `vs-computer` mode, mark `performance.now()` immediately before the
  human click resolves, wait for the O symbol to appear (`findByLabelText` /
  `waitFor`), then assert elapsed `< 200ms`. No artificial delay anywhere.
  Green: should already pass (synchronous minimax is sub-millisecond). If the
  effect adds latency, ensure no timers/`setTimeout` are introduced.

- **C3 — "Play again" stays in vs-Computer mode (F6).**
  Red: in `vs-computer` mode, play to a terminal state (draw or O-win), click
  "Play again"; assert board clears, status is `"X's turn"`, **and** a subsequent
  human X click triggers an automatic O response (proving mode persisted).
  Green: `Play again` resets `state` only, never `mode`. Confirm reset handler
  does not touch `mode`.

- **C4 — two-player mode unaffected (F5 regression / T7).**
  Red: re-assert a full two-player game in default mode: alternating X/O via
  clicks, win locks the board, result text correct, no auto-O move occurs. (This
  is largely covered by existing slice-002 tests; add an explicit assertion that
  in default mode a human click does **not** produce a second symbol.)
  Green: AI branch is gated strictly on `mode === 'vs-computer'`; slice-002
  tests stay green unmodified.
  Commit: "Wire AI as O in vs-Computer mode; two-player untouched (C1–C4 / F2,F3,F5,F6,T4,T7)".

---

## Phase D — Policy / security tests

Extend `policy.test.tsx` (do not weaken existing D1/D2/D3).

- **D1 — no network during a full vs-Computer game (T5 / S3).**
  Red: add a test mirroring the existing network-spy harness (stub `fetch`,
  `XMLHttpRequest`, `WebSocket`) but driving a **vs-Computer** game: select
  "vs Computer", play several human X moves (AI responds each time) through to a
  terminal state, click "Play again", play one more move. Assert zero
  fetch/XHR/WebSocket invocations across human moves, AI moves, terminal, and
  reset.
  Green: AI is pure and synchronous — no production change expected; this pins
  the control.

- **D2 — closed value set holds with AI moves (S1).**
  Red: extend/duplicate the existing exhaustive-value test so that O moves are
  produced by `bestMove` (i.e. walk the same game tree as A4 and assert every
  cell of every visited state is in `{'X','O',null}`). Confirms the AI never
  introduces a value outside the closed set.
  Green: no production change expected; pins the control.
  Commit: "Pin no-network and closed-value controls for AI play (D1–D2 / T5,S1,S3)".

---

## Out of route (already satisfied / not driven by new tests)

- **T6** (same pipeline / same URL, no infra or IAM change): no code in this
  slice touches CI/CD or IaC. Nothing to add; verified by the deploy job and live
  URL being unchanged at merge. Engineer must not edit pipeline or IAM.
- **S2** (`dangerouslySetInnerHTML` absent): already enforced by the existing D1
  policy test, which globs **all** non-test `src/game/*.{ts,tsx}` files — so
  `ai.ts` and any new selector markup are covered automatically the moment they
  exist. No new test needed.

## Definition of done for the slice

All of A1–A4, B1–B3, C1–C4, D1–D2 green; existing slice-002 tests and existing
policy D1/D2/D3 green and unmodified; `ai.ts` imports nothing from React/DOM;
two-player remains the default mode. Acceptance F1–F6, T1–T5, T7, S1–S3 covered;
T6 unchanged by construction.
