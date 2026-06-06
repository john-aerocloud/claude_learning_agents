---
slice: 005-join-game
chunk: 4 — Online two-player match
status: proposed
depends-on: s004 ✓
---

# Slice 005 — Join game by code (WebSocket connect + game-ready)

## Job served

**Playing against a real human (partial — both players connected, board visible)**

When I want to join a specific game my friend has started, I want to enter a
6-character code and reach the game board knowing my friend is also there, so
that we are both ready to play against each other.

This is the minimum step that turns a one-sided waiting state into a two-player
session. Without it, no online game can ever begin.

---

## Scope (what is IN this slice)

A second player (the joiner) enters the 6-char code in the UI, both players
open a WebSocket connection to API Gateway, the server joins them into the same
game, and both screens transition to the game board in `active` state.

Concretely:

**UI — join screen**
- A "Join a game" option on the mode selector leads to a join screen with a
  6-character code input and a submit button.
- On submit, the client opens a WebSocket connection to the API Gateway
  WebSocket endpoint, then sends a `{ action: "join", code: "<CODE>" }` message.
- While the connection is being established and the server is processing, a
  "connecting…" indicator is shown.
- Error cases (see below) return the player to the join screen with a readable
  message; the input retains the entered code so they can try again or correct it.

**UI — host waiting screen (already shown from s004)**
- The host waiting screen opens a WebSocket connection on load (so the server
  can reach the host when the joiner arrives).
- When the host receives a `game-ready` event over WebSocket, the waiting screen
  transitions to the game board.

**UI — game board (both players)**
- Both players see a 3x3 board, labelled "You are X" / "You are O".
- The board is rendered but clicking squares does nothing — move relay is not
  implemented yet (s006). A status line reads "Game active — moves coming in the
  next update" so neither player is confused.
- Both players see which player is the host (X) and which is the guest (O).

**WebSocket backend — new CDK stack / Lambda handlers**
- `$connect`: stores `connectionId` in a `Connections` table (keyed by
  connectionId, value: gameId if known — may be null at connect time for the
  host; set on join for the joiner). TTL = 2h.
- `$disconnect`: no-op in this slice (s007).
- `join` route: Lambda looks up the game by code (GSI on `Games.code`), validates:
  - game exists
  - status is `waiting`
  - `guestConnectionId` is null (not already joined)
  Writes `guestConnectionId` and sets `status = active` atomically (conditional
  write). Sends `{ type: "game-ready", role: "host" }` to the host connection and
  `{ type: "game-ready", role: "guest" }` to the joiner connection via
  `@connections` API.
- The host's `$connect` message carries a `{ action: "register", gameId: "<ID>" }`
  message immediately after connect so the server can store `hostConnectionId`
  into the `Games` record and the `Connections` table.

**Error handling (join route)**
- Code not found → WebSocket close with code 4040, UI shows "Game not found.
  Check the code and try again."
- Status is not `waiting` (game full or finished) → WebSocket close with code
  4041, UI shows "This game is no longer available."
- Any server error → WebSocket close with code 4500, UI shows "Something went
  wrong. Please try again."

**CDK delta**
- New API Gateway WebSocket API (stage: `prod`); CloudFront routes `/ws/*` (or
  a dedicated domain alias) to the WebSocket endpoint — OR the SPA connects
  directly to the WebSocket URL (simpler: no CloudFront WebSocket support
  needed; SPA uses `wss://<apigw-id>.execute-api.<region>.amazonaws.com/prod`
  stored in a runtime config value injected at deploy time).
- New `oxo-ws-fn` Lambda for `$connect`, `$disconnect` (stub), `join`, and
  `register` routes.
- IAM: `oxo-ws-fn` gets `dynamodb:GetItem` on Games (GSI), `dynamodb:UpdateItem`
  on Games (conditional), `dynamodb:PutItem`/`DeleteItem` on Connections,
  `execute-api:ManageConnections` to send messages back to clients.
- New `Connections` DynamoDB table (on-demand, SSE, TTL on `ttl` attribute).

---

## Explicitly NOT in scope

- **Move relay** — clicking squares has no effect; board state does not transit
  between browsers (s006).
- **Server-authoritative game state** — no move validation, no win/draw detection
  server-side (s006).
- **Disconnect handling** — `$disconnect` is a stub; no `abandoned` status, no
  "opponent disconnected" UI (s007).
- **Reconnect to same game** — if either player reloads they lose their session;
  they must create/join a new game (out of scope entirely or s007+).
- **Share-link UX** — the code is still copied manually; no `/join/<code>` URL
  pre-fill (s008).
- **WAF / rate limiting** on the WebSocket API (deferred to C4/C5 post-exercise).
- **CloudFront WebSocket proxying** — the SPA connects directly to the APIGW WSS
  endpoint; no CloudFront WebSocket support needed, which avoids non-trivial
  CloudFront upgrade complexity.
- **Leaderboard, player names, chat** (C5–C7).
- **Any change to local or vs-AI game flows.**

---

## Scope decision: WebSocket vs polling for host notification

**Decision: WebSocket, not polling.**

Rationale: Polling would require a new GET endpoint, a polling loop in the SPA,
and then a teardown of that polling loop in a later slice once WebSocket exists.
It adds complexity that is removed, not built upon. The WebSocket API is in the
target architecture (approved at Gate 2); introducing it here is the permanent
path. The incremental complexity over polling is small: one new CDK construct,
two Lambda route handlers, and a `wss://` connection in the SPA. The host must
open a WebSocket on the waiting screen in this slice regardless, so it is not
premature — it is the minimum surface needed for the host to receive `game-ready`.

**Decision: SPA connects directly to WebSocket URL, not via CloudFront.**

CloudFront does not natively proxy WebSocket long-lived connections without
enabling HTTP/2 and specific settings, and the API Gateway WebSocket URL is
already a public HTTPS+WSS endpoint with its own TLS. Adding CloudFront in front
adds no meaningful security benefit at this stage (WAF deferred) and adds
significant routing complexity. The WSS URL is injected into the SPA as a
runtime config at deploy time (same pattern used for API base URL if one exists,
otherwise a `window.OXO_CONFIG` block). This decision is revisited at C4 done
condition (s008) if share-link UX demands it.

---

## Success measures

1. **Joiner reaches the board.** Player B enters a valid 6-char code on the join
   screen; within 3 seconds both Player A (host) and Player B (guest) see the
   game board with their roles labelled ("You are X" / "You are O").

2. **DynamoDB record is active.** After both players connect, the `Games` record
   shows `status = active`, `hostConnectionId` populated (non-null), and
   `guestConnectionId` populated (non-null). Verifiable via AWS Console / CLI.

3. **Invalid code shows a readable error.** Entering a code that does not exist
   shows "Game not found. Check the code and try again." on the join screen,
   which remains accessible. The `Games` table is unchanged.

4. **Already-active game is rejected.** Entering a code for a game already in
   `active` status shows "This game is no longer available." — the joiner cannot
   hijack an in-progress game.

5. **Connections table is populated.** Both `connectionId` entries are present in
   the `Connections` table with a TTL approximately 2 hours from join time.

6. **Existing modes unaffected.** Local two-player and vs-AI modes complete a
   full game without regression.

7. **Pipeline deploys new infra cleanly.** The GitHub Actions pipeline succeeds
   end-to-end (CDK deploy of new WebSocket stack + SPA deploy + CloudFront
   invalidation) with no manual steps.

---

## Killick test

Could a user do something valuable they could not do before?

Yes: a second player can now join a specific game. Before this slice, a host
created a game code and waited indefinitely with no way for anyone to arrive.
After this slice, Player B enters the code and both players see the board
together. The value is real — the online match has begun, both players know
their opponent is present. Move relay (s006) completes the game; this slice
makes the pairing possible.
