---
slice: 005-join-game
maintained-by: product agent
status: decomposed (Gate-2 / Gate-3 approved)
---

# Use-case decomposition — Slice 005 Join game by code

A use case is done when its own acceptance cases pass, independently of the
others. Dependencies listed below are build-order edges only (one UC must be
completable before the next starts). Where no dependency edge exists, UCs are
parallel-buildable.

---

## UC1 — Host registers and waits (WebSocket $connect + register path)

**Actor:** Host (Player A, created the game in s004)

**Infra enablers required:**
- WebSocket API Gateway (new)
- Connections DynamoDB table (new)
- `oxo-ws-fn` Lambda (new) with `$connect` and `register` route handlers
- Games table `hostConnectionId` attribute write path (UpdateItem on Games)

**Interaction:**
- Trigger: Host arrives at the "waiting for opponent" screen (rendered by s004).
- The SPA opens a WebSocket connection to the WSS endpoint (sourced from
  `window.OXO_CONFIG.wsUrl`).
- On `$connect`, `oxo-ws-fn` writes a `Connections` item: `connectionId`,
  `gameId = null` (not yet known), `ttl = now + 2h`.
- The SPA immediately sends `{ action: "register", gameId: "<ID>" }`.
- On `register`, `oxo-ws-fn` updates the `Connections` item to set `gameId` and
  `role = "host"`, and writes `hostConnectionId` into the `Games` record
  (conditional: only if `hostConnectionId` is null).
- Observable outcome: the waiting screen continues to display the game code; a
  "connecting…" indicator (if shown) resolves; the host is now reachable by the
  server when a joiner arrives. The DynamoDB `Games` record gains a non-null
  `hostConnectionId`; the `Connections` table gains the host's entry with a 2h TTL.

**Done condition:**
- Host's `connectionId` exists in `Connections` with `role = "host"`, `gameId`
  set, and `ttl` ~2h ahead.
- `Games` record has `hostConnectionId` non-null, `status` still `waiting`.
- No error or UI disruption on the waiting screen.

**Acceptance cases:** F2 (partial — host connection up), F6 (host side),
UC1-specific cases in acceptance.md.

**Dependencies:** None. UC1 is the root enabler — it must be buildable and
testable in isolation (stub `register` handler + Connections table alone
suffices). It does NOT depend on any other UC.

---

## UC2 — Joiner rejected — unknown code (join screen + 4040 path)

**Actor:** Joiner (Player B)

**Infra enablers required:**
- WebSocket API Gateway (same instance as UC1)
- `oxo-ws-fn` Lambda with `join` route handler (GSI lookup + not-found branch)
- Games GSI `code-index` (new)
- Join screen UI component (new)

**Interaction:**
- Trigger: Player B navigates to the join screen (new UI path from mode selector)
  and enters a code that does not exist in the `Games` table.
- The SPA opens a WebSocket connection and sends `{ action: "join", code: "<BAD-CODE>" }`.
- `oxo-ws-fn` queries the `code-index` GSI; no item is found.
- The server closes the WebSocket with code 4040.
- The SPA intercepts the close event, reads the code 4040, and renders the error
  message: "Game not found. Check the code and try again."
- The join screen remains accessible with the entered code retained in the input.
- Observable outcome: Player B sees a readable error; the `Games` table is
  unchanged; no `Connections` item is created for a failed join.

**Done condition:**
- Entering a non-existent code closes the socket with 4040.
- Join screen shows the not-found message with the code retained.
- `Games` table is unchanged (CLI-verifiable).

**Acceptance cases:** F3, F4 (partial), UC2-specific cases in acceptance.md.

**Dependencies:**
- Depends on UC1 infra being provisioned (WSS endpoint + `oxo-ws-fn` function
  must exist for any WS connection to open), but UC2's own logic (GSI lookup +
  4040 close + UI error) does NOT require UC1's register flow to be complete.
- **Practically parallel with UC1**: the GSI lookup and `join` handler can be
  built and unit-tested independently. Integration testing requires the same WS
  infra, so they share a deploy target, but engineering work is parallel.

---

## UC3 — Join pairs and activates (atomic conditional write + game-ready both sides)

**Actor:** Joiner (Player B) and Host (Player A)

**Infra enablers required:**
- Everything from UC1 (host registered and waiting) — UC3 is only testable
  after the host connection is live.
- `join` route handler — happy path: GSI lookup hits a `waiting` game with
  `guestConnectionId = null`; conditional `UpdateItem` sets
  `guestConnectionId`, `status = active`; `execute-api:ManageConnections`
  sends `game-ready` to both connectionIds.
- Game board UI component with role labels ("You are X" / "You are O") and
  inert squares (moves deferred to s006).
- `window.OXO_CONFIG.wsUrl` runtime config injection in the SPA.

**Interaction:**
- Trigger: Player B is on the join screen and enters a valid code for a
  `waiting` game where the host has already registered (UC1 complete).
- The SPA opens a WebSocket connection and sends `{ action: "join", code: "<VALID>" }`.
- `oxo-ws-fn` queries the GSI — game found, `status = waiting`,
  `guestConnectionId = null`.
- Atomic conditional `UpdateItem`: sets `guestConnectionId`, `status = active`.
- Sends `{ type: "game-ready", role: "host" }` to the host's connectionId via
  `@connections`.
- Sends `{ type: "game-ready", role: "guest" }` to the joiner's connectionId.
- Both SPAs receive the `game-ready` message and transition the screen from
  "waiting" / "connecting…" to the game board.
- Observable outcome: within 3 seconds of join, both players see a 3x3 board
  labelled "You are X" / "You are O". The board squares are rendered but clicking
  does nothing. A status line reads "Game active — moves coming in the next
  update".

**Done condition:**
- Both players see the game board with correct role labels within 3 seconds.
- `Games` record: `status = active`, `hostConnectionId` non-null,
  `guestConnectionId` non-null (CLI-verifiable).
- `Connections` table: both entries present with ~2h TTL.

**Acceptance cases:** F1, F2, F5, UC3-specific cases in acceptance.md.

**Dependencies:**
- UC1 must be buildable first (host registration path required end-to-end).
- UC2's GSI + `join` handler (error branch) is the same code path as the happy
  path — naturally built together, so UC3 engineering follows UC2 in build
  order.
- **UC3 = the payoff UC**: it is the only one that cannot be integration-tested
  without UC1 complete and deployed. UC2 can be partially tested without UC1
  (unit tests on the Lambda handler stub). UC3 requires both sides live.

---

## UC4 — Joiner rejected — game not waiting (4041, no hijack)

**Actor:** Joiner (Player B, second attempt on an already-active game)

**Infra enablers required:**
- Same as UC2 (GSI + `join` handler), plus the conditional write logic from UC3
  that distinguishes `waiting` vs non-`waiting` status.

**Interaction:**
- Trigger: Player B enters a code for a game whose `status` is `active`
  (or `abandoned`/`finished`) — i.e., someone already joined.
- The SPA opens a WebSocket connection and sends `{ action: "join", code: "<CODE>" }`.
- `oxo-ws-fn` queries the GSI; game found but `status != waiting`.
- Server closes the WebSocket with code 4041.
- The SPA shows: "This game is no longer available."
- Observable outcome: join screen remains; the `Games` record is unchanged;
  the conditional write logic means even a race condition (two joiners
  simultaneously) cannot result in double-join — one wins, one gets 4041.

**Done condition:**
- Entering a code for a non-`waiting` game closes with 4041.
- Join screen shows the no-longer-available message.
- `Games.guestConnectionId` and `status` are unchanged (CLI-verifiable).
- A concurrent second join attempt fails (conditional write rejects it).

**Acceptance cases:** F4, F5 (security angle), UC4-specific cases in acceptance.md.

**Dependencies:**
- Depends on the `join` handler existing (same handler as UC2/UC3 — all three
  branches of the same route).
- **Parallel-buildable with UC3** at the unit-test level (they test different
  branches of the same handler); integration test requires a previously-active
  game (so UC3 must be exercised first to produce that state).

---

## UC5 — Boards render with roles; clicks are inert

**Actor:** Both players (after UC3 succeeds)

**Infra enablers required:**
- The game board React component (shared with s002/s003 — to be extended or
  wrapped, not rebuilt).
- `game-ready` message reception in the SPA and state transition to `active` view.
- Role-label rendering ("You are X" / "You are O") and the status line.

**Interaction:**
- Trigger: Both players' SPAs receive the `game-ready` WebSocket message.
- Each SPA renders the 3x3 board with the player's own role label.
- A status line reads "Game active — moves coming in the next update".
- Clicking any square does nothing (no move dispatch, no state change).
- Observable outcome: neither player is confused about why the board doesn't
  respond; the existing local and vs-AI board is unaffected (no regression).

**Done condition:**
- Both players see role labels and the status line post game-ready.
- Clicking squares produces no observable effect (no console error, no state change).
- Local two-player and vs-AI modes still function correctly end-to-end.

**Acceptance cases:** F1 (board render + role labels), F6 (regression), UC5-specific
cases in acceptance.md.

**Dependencies:**
- Depends on UC3 (game-ready message must arrive to trigger the board render).
- Board component work (UI only) is **parallel-buildable** with UC1, UC2, UC3,
  UC4 — the React component can be built and unit-tested in isolation using
  a mock `game-ready` event before any infra exists.

---

## Dependency graph and parallel-buildability summary

```
UC1 (host registers) ──────────┐
                                ├──► UC3 (join pairs, game-ready both sides)
UC2 (join rejected, 4040) ─────┘         │
                                          ├──► UC5 (board renders, clicks inert)
UC4 (join rejected, 4041) ─────────────── (same handler as UC2; parallel at
                                           unit level, sequential at integ test)
```

**Parallel-buildable sets:**

| Set | Use cases | Rationale |
|-----|-----------|-----------|
| A — Backend handler + infra | UC1, UC2, UC4 | All three touch the same Lambda but different branches; infra (WS API, Connections, GSI) is shared. UC1 and UC2 can be unit-tested independently; UC4 shares the join handler with UC2. Engineering can pipeline: UC1 handler → UC2 handler → UC4 handler, with infra provisioned once. |
| B — UI-only | UC5 (board component + role labels) | Pure React work; no infra dependency. Can be built and unit-tested against a mock `game-ready` event from day one of the sprint. |
| C — Happy-path integration | UC3 | Requires both UC1 and UC2 to be deployable end-to-end. This is the last UC to pass its integration test. |

**Build order:**

1. Provision shared infra (WS API, Connections table, GSI, `oxo-ws-fn` scaffold) — enables all.
2. UC1 handler + UC2 handler + UC4 handler + UC5 UI component (parallel).
3. UC3 integration (requires UC1 + UC2 + UC5 ready end-to-end in deploy).

---

## Infra enabler cross-reference

| Enabler | Required by |
|---------|-------------|
| WebSocket API Gateway + prod stage | UC1, UC2, UC3, UC4 |
| `oxo-ws-fn` Lambda | UC1, UC2, UC3, UC4 |
| Connections DynamoDB table | UC1, UC3 |
| Games GSI `code-index` | UC2, UC3, UC4 |
| `@connections` ManageConnections | UC3 |
| Join screen UI (new React component) | UC2, UC3, UC4 |
| Game board + role labels (extended) | UC3, UC5 |
| `window.OXO_CONFIG.wsUrl` config injection | UC1, UC2, UC3, UC4 |
