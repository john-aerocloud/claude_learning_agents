# Acceptance — Slice 003: Single-player vs AI

Co-authored: Product (functional) + Solution Architect (technical / security-observable).
All conditions observable by a person or automated browser/unit test; no internal
state access required.

## Functional (maps Product's 6 success measures)

| # | Condition | How verified |
|---|-----------|--------------|
| F1 | A "vs Computer" option is visible on the game screen before the first move; selecting it starts a single-player game with the human as X | Click mode selector; board resets; turn indicator shows "X's turn" |
| F2 | After the human (X) moves, the computer (O) places its symbol with no further user interaction | Play one X move; an O symbol appears in a previously empty square without a second click |
| F3 | The computer's move appears within 200ms of the human's move being registered | Measure human-click-to-O-render in a browser test with `performance.now()` (or equivalent); assert < 200ms |
| F4 | The human cannot win — every completed vs-Computer game ends in a draw or computer win; no X-victory path exists | Game-tree exhaustion test over all reachable states; assert no terminal state has X as winner |
| F5 | The board locks and the result screen appears on game end, showing the correct outcome | Play to completion; board rejects further clicks; result reads "Draw" or "O wins" |
| F6 | "Play again" resets the board and stays in "vs Computer" mode | Click "Play again"; board clears; turn shows "X's turn"; computer responds to the next human move |

## Technical (Solution Architect)

| # | Condition | How verified |
|---|-----------|--------------|
| T1 | The AI module is **pure** — no I/O, no DOM, no network, no globals; deterministic for a given board | Unit tests call the AI with fixed boards outside React; same input yields same move |
| T2 | The AI is **unit-testable in isolation** from React and the UI | AI tests import only the engine + AI module; no component or DOM dependency |
| T3 | **Game-tree exhaustion**: across all reachable states with the AI playing O optimally, no terminal state has X as winner | Enumerate the playable game tree (human X plays every legal move against optimal O); assert zero X-wins terminal nodes |
| T4 | **AI response time < 200ms** | Time the AI move computation (and render) per move; assert each under 200ms |
| T5 | **No network calls during AI play** | Browser network panel / Playwright request log shows zero outbound fetch/XHR/WebSocket during a full vs-Computer game beyond initial static-asset load |
| T6 | The bundle ships through the **existing** pipeline to the **same** production URL — no infra or IAM change | Deploy job is unchanged; live URL unchanged |
| T7 | Two-player mode (slice 002) behaviour is unchanged when "vs Computer" is not selected | Slice 002 game tests still pass; default mode path untouched |

## Security-observable (Solution Architect)

| # | Condition | How verified |
|---|-----------|--------------|
| S1 | Rendered cell value set is closed to **{X, O, null}**; no user-supplied text is rendered | Inspect rendered output; mode selector is a fixed control, not free input |
| S2 | **`dangerouslySetInnerHTML` is absent** from the game/AI UI | Source/grep check; rendering uses default JSX text interpolation |
| S3 | **No outbound network** during gameplay (board interaction, AI move, win, draw, reset) other than initial static-asset load | Browser network panel / request log — zero gameplay-originated requests |
