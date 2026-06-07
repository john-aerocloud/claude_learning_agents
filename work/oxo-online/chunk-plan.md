---
maintained-by: product agent
update-rule: updated at every slice-next (forecast) and at every delivery (actuals); forecasts are not commitments
---

# Chunk delivery plan — oxo-online

This file connects chunks (value milestones) to slices (thin deliverables). One
section per chunk. The product agent updates this file at every slice-next run
and marks actuals when a slice is delivered.

---

## Summary table

| Chunk | Name | Status | Slices delivered | Forecast remaining | Next slice |
|-------|------|--------|------------------|--------------------|------------|
| C1 | Deployable shell | delivered | 1 (s001) | 0 | — |
| C2 | Local two-player game | delivered | 1 (s002) | 0 | — |
| C3 | Single-player vs AI | delivered | 1 (s003) | 0 | — |
| C4 | Online two-player match | in-progress | 2 (s004, s005-h1) | 6 (s005–s008 + s005-h2/h3) | s005-h2 connect-auth (in planning) |
| C5 | Leaderboard | not started | 0 | 3 (s009–s011) | s009 record-game-result |
| C6 | Player identity (lightweight) | not started | 0 | 2 (s012–s013) | s012 display-name-entry |
| C7 | In-game chat | not started | 0 | 2 (s014–s015) | s014 in-game-message-send |

---

## C1 — Deployable shell

**Job served:**
When my friend and I decide to play, I want the game to just work in a browser with
no install, no sign-up friction, and consistent uptime, so that the barrier to
starting a game is as close to zero as possible. (Ambient job — availability.) **[SECONDARY]**

**Done condition:** A real HTTPS URL returns the React SPA with a valid TLS
certificate; the GitHub Actions pipeline deploys on push to main without manual
steps; no long-lived AWS credentials exist in CI.

**Slices:**

| Slice | Delivered | Outcome |
|-------|-----------|---------|
| s001 — deployable-shell | 2026-06-05 | React shell live at CloudFront URL; S3+OAC+OIDC pipeline green |

**Remaining forecast:** none — chunk delivered.

---

## C2 — Local two-player game

**Job served:**
When I want to play noughts and crosses with someone next to me, I want to open
the URL and take turns clicking squares on the same device, so that we can play a
complete game and find out who won. (Core job — playing against a real human,
functional core.) **[CORE]**

**Done condition:** Two people on one browser can play a complete game of noughts
and crosses — moves alternate, win and draw are detected, result is shown, and
"play again" works — all served from the live HTTPS URL.

**Slices:**

| Slice | Delivered | Outcome |
|-------|-----------|---------|
| s002 — local-game | 2026-06-05 | Playable 3x3 board, win/draw detection, result screen, play-again button live |

**Remaining forecast:** none — chunk delivered.

---

## C3 — Single-player vs AI

**Job served:**
When I want a quick game but no friend is available right now, I want to open the
URL and play immediately against a computer opponent that provides a genuine
challenge, so that I can get the satisfaction of a competitive game on my own
schedule. (Supporting job — solo challenge without friction.) **[SECONDARY]**

**Done condition:** A "vs Computer" mode is available at the live URL; the AI is
unbeatable (minimax, no X-win path exists in the full game tree); AI responds in
< 200ms; result screen and play-again work in solo mode.

**Slices:**

| Slice | Delivered | Outcome |
|-------|-----------|---------|
| s003 — ai-opponent | 2026-06-05 | Client-side minimax AI as O; mode selector; 47ms AI latency; 0 X-win paths confirmed by game-tree exhaustion |

**Remaining forecast:** none — chunk delivered.

---

## C4 — Online two-player match

**Job served:**
When I want to challenge a specific friend to a game, I want to create a game
session, share a code, have my friend join, and play moves in real time between
two browsers, so that we get the genuine satisfaction of competing against each
other remotely. (Core job — playing against a real human, full job.) **[CORE]**

**Done condition:** Two players in separate browsers can complete a full game: host
creates a game and shares a code; joiner enters the code and joins; moves made in
one browser appear in the other within 1 second (p95); win/draw is detected and
shown to both players; disconnection is handled gracefully. No accounts required.

**Slices:**

| Slice | Status | Delivered | Outcome |
|-------|--------|-----------|---------|
| s004 — create-game | delivered | 2026-06-06 | POST /api/games live via CloudFront; Lambda + DynamoDB Games table + HTTP API provisioned; 6-char code shown in UI |
| s005 — join-by-code | in-flight (use-case decomposition done) | — | — |
| s005-h1 — WAF / rate-limiting | delivered | 2026-06-07 | CloudFront global WAF WebACL live; rate rule + IP reputation list; per-IP WS protection re-scoped to s005-h2 (platform constraint: WAFv2 cannot associate with API GW v2) |

**Remaining forecast (s005–s008) — ordered thinnest-first:**

### s005 — join-by-code + WebSocket connect (IN-FLIGHT)
**Scope:** A second player enters the 6-char code on a new join screen; both
players open a WebSocket connection to API Gateway (host on the waiting screen,
joiner on submit). The `join` Lambda route looks up the game by code (GSI on
`Games`), validates status=`waiting` and no existing guest, writes both
`hostConnectionId` and `guestConnectionId` atomically and sets status=`active`,
then sends `game-ready` to both connections. Both screens transition to the game
board showing player roles. Board is visible but moves do nothing (relay is s006).
A new `Connections` DynamoDB table stores connectionId→gameId with a 2h TTL.
`$disconnect` is a stub (no-op). SPA connects directly to the WSS endpoint (no
CloudFront WebSocket proxying). Three error paths handled: code not found, game
already active, server error — each returns a readable message on the join screen.

**Killick test:** A second player can join a specific game and both players see
the board together — something impossible before this slice.

**What is NOT in scope:** move relay, server-authoritative game state, win/draw
detection on the server, disconnect handling (`$disconnect` stub only), reconnect,
share-link UX, CloudFront WebSocket proxying — all deferred to s006+.

**Success measures:**
1. Player B enters a valid code; within 3 seconds both players see the game board with roles labelled.
2. DynamoDB `Games` record shows status=`active`, both connectionIds populated.
3. A code that does not exist returns "Game not found" error; join screen remains.
4. A code for an already-active game returns "no longer available" error; joiner cannot hijack.
5. `Connections` table shows both entries with ~2h TTL.
6. Existing modes (local, vs-AI) are unaffected.
7. Pipeline deploys new WebSocket stack cleanly with no manual steps.

### C4 hardening (security debt, human-directed at Gate-3 s005)

Three risks were explicitly deferred at the s005 Gate-3 security review and
recorded as open risks in `architecture/deltas/005-join-game.md`. They are
sequenced here as thin hardening slices before C5 opens a further public write
surface (s009 leaderboard write) — because each risk becomes cheaper to fix
before more dependent slices are built on top of the unauthenticated WS
endpoint.

Forecasts are revisable; the human gate at each slice governs actual priority.

**s005-h1 — WAF / rate-limiting on CloudFront (security risk 1) [DELIVERED 2026-06-07; GATE-AMEND-H1-A 2026-06-06]**
Sequence: after s005 delivered, before s006. DELIVERED. CloudFront global WAF
WebACL (CLOUDFRONT scope, us-east-1) with IP reputation rule + rate-based rule
(100/5-min/IP) attached to the distribution. REGIONAL WS API WAF removed due
to platform constraint (WAFv2 cannot associate with API GW v2 APIs). Per-IP WS
protection re-scoped to s005-h2. See slices/s005-h1-waf/slice.md + delta §0.

**s005-h2 — Join-token / $connect authorization (security risk 2) [IN PLANNING — iteration 8, GATE-2-H2]**
Sequence: after s005-h1, before s006. Rationale: the unauthenticated WS
endpoint is the project's highest-risk open surface. Scope: `POST /api/games`
response extended with a short-lived HMAC-signed `wsToken` (host); guest uses
the 6-char code as credential at `$connect` (no new HTTP endpoint). A
REQUEST-type Lambda authorizer on `$connect` verifies host tokens (HMAC) and
guest codes (GSI lookup) and enforces per-IP connect budget via a new
`ConnectAttempts` DynamoDB table. Done conditions: (1) `$connect` with no/bad
credential rejected before game-logic Lambda fires; (2) valid host+guest flow
unchanged (pairing <3s); (3) per-IP burst beyond threshold denied (best-effort).
See slices/s005-h2-connect-auth/slice.md + use-cases.md.
**Includes (GATE-AMEND-H1-A):** per-IP WS rate-limiting re-homed here from
s005-h1 — WAFv2 platform constraint means the `$connect` authorizer (keyed on
sourceIp) is the honest home for this control.

**s005-h3 — Guaranteed code uniqueness (security risk 3)**
Sequence: after s005-h2 (or parallel — no code dependency). Rationale: code
collision risk is bounded by entropy at hobby volume but is not hard-guaranteed.
Before the game grows beyond hobby volume (C5+), enforce uniqueness. Scope:
add a conditional-put on a `Codes` table (or a conditional expression on the
GSI sort key) so a duplicate code triggers a retry on the server; the client
sees no change. Done condition: a synthetic duplicate-code injection test
confirms the create-game path retries and produces a unique code; no duplicate-
waiting-game scenario is possible.

**Renumbering note:** the three hardening slices carry identifiers s005-h1,
s005-h2, s005-h3 (suffixed, not displacing s006–s008 ordinals). They sit
logically between s005 and s006 in the delivery queue; if any is promoted to
a full sprint it will receive an ordinal at that time.

---

### s006 — move relay + server-authoritative play
**Scope:** When a player makes a move, the SPA sends it via WebSocket; the Lambda
validates the move (correct player's turn, square not taken), writes it to the
`Games` record, and relays the updated board state to both connections. The UI
updates on receipt of the server's broadcast. Win/draw is detected server-side;
a `game-over` message with the result is sent to both players and the result
screen is shown. The board is locked after a result.

**Killick test:** A full game can be played to completion between two browsers;
neither player can cheat by replaying moves or moving out of turn.

**What is NOT in scope:** disconnect handling, reconnect, leaderboard writes —
all deferred to s007+.

**Success measures:**
1. A move made in browser A appears in browser B within 1 second (p95, measured in smoke test).
2. The server rejects an out-of-turn move (the board state in DynamoDB is unchanged).
3. A win/draw detected by the server causes both browsers to show the correct result screen simultaneously.
4. No board divergence: at game end, both browsers show identical board state.

### s007 — disconnect and timeout handling
**Scope:** When a WebSocket connection drops (player closes the tab, network
interruption), the `$disconnect` Lambda updates the `Games` record to
`abandoned`. The waiting player's UI shows an "opponent disconnected" message
and returns them to the mode selector. A TTL-based sweep (24h from creation, or
a shorter idle TTL per the `hostConnectionId`-less design already in the
`Games` table) ensures no orphaned `active` records accumulate.

**Killick test:** A player is not left hanging indefinitely when their opponent
disappears — they can start a new game without a page reload.

**What is NOT in scope:** reconnect-to-same-game, persistent game history —
deferred or out of scope.

**Success measures:**
1. Closing one browser tab causes the other player's UI to show an "opponent disconnected" message within 10 seconds.
2. The `Games` record is updated to `abandoned` on disconnect.
3. The disconnecting player's `connectionId` is removed from the record — no stale connection IDs.

### s008 — share-link UX + C4 done condition
**Scope:** The 6-char code is also presented as a copyable deep-link URL (e.g.
`https://<domain>/join/<code>`). Navigating to a join URL pre-fills the code
field on the join screen. This is the final usability gap between "has a code"
and "sharing a game is frictionless." No new backend; pure SPA routing change.

**Killick test:** A player can send a single URL to a friend who clicks it and
lands directly on the join flow with no manual code entry — the minimum social
coordination friction for the core job.

**What is NOT in scope:** deep-link authentication, game lobbies, match history.

**Success measures:**
1. Navigating to `/join/<code>` in a fresh browser pre-fills the code and enables one-click join.
2. The game code screen shows a "copy link" control alongside the code text.
3. An invalid code in the URL shows a readable error.
4. C4 done condition is fully met: end-to-end game completed by two players from different browsers using the share link, within 5 minutes of first intent (host creating the game to result screen).

---

## C5 — Leaderboard

**Job served:**
When I have played one or more games, I want to see how I rank against other
players, so that I feel a reason to come back and improve my record, and I can
show others my standing. (Supporting job — motivation through standing.) **[SECONDARY]**

**Done condition:** The title screen shows a leaderboard of win/draw/loss
standings; after a completed game the board updates within 10 seconds; it loads
within 2 seconds (p95). No account required — anonymous players tracked by
session.

**Slices (forecast):**

### s009 — record game result to leaderboard (backend)
**Scope:** When a `game-over` event is written to `Games`, a Lambda (or DynamoDB
Stream handler) writes a win/draw/loss tally to a `Leaderboard` DynamoDB table
keyed by player identifier (initially connection-scoped; anonymous). This is the
data ingestion half only — no UI.

### s010 — leaderboard read endpoint + title-screen display
**Scope:** `GET /api/leaderboard` returns the top-N standings. The title screen
fetches and renders this list on load. Cached at CloudFront with a short TTL (≤10s)
to meet the update SLA without hammering DynamoDB.

### s011 — leaderboard update latency validation
**Scope:** Playwright smoke asserts that after a completed game the leaderboard
reflects the result within 10 seconds. This is the done-condition proof for C5.

---

## C6 — Player identity (lightweight)

**Job served:**
When I have played games, I want my display name to appear on the leaderboard and
in the game, so that the social dimension of standing feels personal rather than
anonymous. (Supporting job — motivation through standing, social dimension.) **[SECONDARY]**

**Done condition:** A player can enter a display name before or at game creation;
the name persists for the session; it appears on the leaderboard and is visible to
the opponent in-game.

**Slices (forecast):**

### s012 — display-name entry + session persistence
**Scope:** A name-entry field appears before game creation (not a mandatory
gate — a default anonymous name is used if skipped). The name is stored in
`sessionStorage` and sent with `POST /api/games` and the WebSocket join message.
No authentication, no passwords, no persistent accounts.

### s013 — display name shown to opponent + on leaderboard
**Scope:** Both players see each other's display name on the game screen (sent
via the `game-ready` WebSocket event). The leaderboard shows display names
instead of anonymous identifiers.

---

## C7 — In-game chat

**Job served:**
When I am playing a game with a friend or stranger, I want to exchange short
messages during the game, so that the match feels like a shared social experience
rather than two people silently clicking. (Supporting job — connection through
banter.) **[SECONDARY]**

**Done condition:** During an active game both players can send and receive short
text messages; messages appear within 1 second (p95); chat is scoped to the game
session and messages do not persist after the game ends.

**Slices (forecast):**

### s014 — in-game message send + relay
**Scope:** A text input and send button appear on the game screen. Sending a
message dispatches it via WebSocket; the Lambda relays it to the other connection;
it appears in a message list on both screens within 1 second. Messages are
in-memory only (not written to DynamoDB) — they vanish when the WebSocket
connections close.

### s015 — chat scope enforcement + done-condition proof
**Scope:** Confirm that messages are visible only to the two players in the game
(no broadcast to other connections); that no messages survive a page reload or
game-over; and that the chat input is disabled after game-over. Playwright smoke
covers the 1-second latency assertion as the C7 done-condition proof.
