---
slice: s006
slug: move-relay
status: in-planning
decision-log-ref: SEL-S006
chunk: C4
created: 2026-06-07
---

# s006 — move relay + server-authoritative play

## Job served

**[CORE] Playing against a real human** — full job payoff.

When I want to challenge a specific friend to a game, I want to create a game
session, share a code, have my friend join, and play moves in real time between
two browsers, so that we get the genuine satisfaction of competing against each
other remotely.

This is the slice where the core job is first fully realised end-to-end: two
real people, two browsers, making real moves against each other, with a winner
declared. Every slice before this was a stepping stone; s006 is the payoff.

---

## Killick test

Could a user do something valuable they could not do before?

YES. Before s006, the board is visible to both players but clicks do nothing.
After s006, two people can sit at separate browsers and play a complete game of
noughts and crosses to a result — win or draw — against each other in real
time. That is the first time the product delivers its core job.

---

## Thin scope

**Move flow (server-authoritative):**

1. The SPA (on the game board screen) sends a `move` message via the open
   WebSocket connection, containing the square index chosen by the player.
2. The move Lambda validates the move against four rules:
   - The connectionId of the sender matches the player whose turn it is (turn
     order enforcement).
   - The target square is not already taken (square-free check).
   - The game status is `active` (no moves accepted after game-over).
   - The connectionId belongs to a player of THIS game (not a spectator or
     stale connection from a different game).
3. If validation passes: the Lambda writes the updated board state to the
   `Games` DynamoDB record (atomic conditional update).
4. The Lambda relays the updated board state to BOTH connections (the mover
   and the opponent) via API Gateway Management API — a single `board-update`
   message.
5. Both SPAs update the board display on receipt of the `board-update`
   message. The UI does NOT update optimistically on move send — it waits for
   the server broadcast. This is the security model established at s004
   architecture decision: server-authoritative, no client-side state
   divergence.
6. Win/draw detection runs server-side after every successful move write. If
   a win or draw is detected, the Lambda sends a `game-over` message (with
   result: `X-wins`, `O-wins`, or `draw`) to BOTH connections.
7. On receipt of `game-over`, both SPAs render the result screen. The board
   is locked (no further moves accepted by either the UI or the server).

**Rejected move flow:**

An out-of-turn, already-taken, or invalid move is rejected by the Lambda with
a `move-rejected` message to the sender only. The `Games` DynamoDB record is
NOT written. The board state on both sides is unchanged.

---

## What is explicitly NOT in scope

- **Disconnect handling:** `$disconnect` remains a stub (no-op). A player
  closing their tab does not update the game state. Handled in s007.
- **Reconnect-after-reload:** See OI-10 decision below. Deferred to s007.
- **Leaderboard writes:** win/draw/loss records are not written anywhere at
  game-over. Deferred to s009 (C5).
- **Share-link UX:** no deep-link URL. Deferred to s008.
- **Code-not-found error message improvement (OI-33):** See OI-33 decision
  below. Folded into s006 as a two-line UI change.
- **Reconnect, game history, persistent scores.**

---

## Success measures

1. **p95 move latency < 1 second:** A move made in browser A appears on
   browser B's board within 1 second, measured from WS send to WS receipt
   (smoke test observable; p95 across 10+ move events in a single game).

2. **Out-of-turn move rejected with DynamoDB unchanged:** Sending a `move`
   message from the connection whose turn it is NOT results in a
   `move-rejected` response to that sender; a DynamoDB `GetItem` on the
   `Games` record immediately after confirms board state and `currentTurn`
   field are identical to pre-rejection state.

3. **Simultaneous result screens:** When the last winning or drawing move is
   relayed, both browser sessions display the result screen (correct winner
   label or "draw") within 1 second of each other (smoke: both screens
   observed in the same browser-automation pass).

4. **Zero board divergence:** At game end, both browsers show identical board
   state — confirmed by asserting that the board rendered in browser A matches
   the board rendered in browser B square-for-square.

---

## OI-10 decision — Reconnect-after-reload (in/out for s006/s007)

**OUT of s006. Deferred to s007.**

Reconnect-after-reload (a player refreshing or returning after a disconnect
re-attaches to the same game in progress) requires a new host WS connection
issued to the returning player, re-pairing logic in the join/connect flow, and
state-replay messaging. That is s007 territory. s006 is the happy-path play
flow; adding reconnect here would widen scope beyond the Killick minimum.
s007's done condition explicitly covers this.

---

## OI-33 decision — Code-not-found error message taxonomy (fold in)

**FOLD INTO s006 as a two-line UI change.**

The join screen shows "Something went wrong. Please try again." when the code
is not found (OI-33). This gives the user no actionable guidance. The fix is a
one-line mapping in the SPA's WS error handler: when the server sends reason
`code-not-found`, show "Game not found. Check the code and try again." No new
Lambda logic, no new API surface. This is already covered by an existing
failing acceptance case (F3/T4 in slice005-validation.spec.ts) that becomes
green as a side-effect. The change is low-risk and makes the spec honest.

---

## Engineering obligations attached

OI-17 (hexagonal refactor), OI-28 (local stand-up), and OI-31 (dependency
model retrofit, including use-case-deps.mmd) are bundled into this slice's
engineering work by the orchestrator. These obligations do not change the
customer-facing scope above.
