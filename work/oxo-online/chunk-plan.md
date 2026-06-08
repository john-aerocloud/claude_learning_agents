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
| C4 | Online two-player match | **complete** | 7 (s004, s005-h1, s005, s005-h2, s006, s007, s008) + s005-h3 (in-planning) | 0 | — |
| C5 | Leaderboard | **in-progress** | 0 | 2 (s009–s010) | s009 arcade-scoreboard |
| C6 | Player identity (lightweight) | **absorbed** | 0 | 0 (absorbed into s009) | — |
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
| s005 — join-by-code | delivered | 2026-06-06 | Guest join screen live; WS connect flow; both players reach game board with roles; Connections table with 2h TTL; 3 error paths handled |
| s005-h1 — WAF / rate-limiting | delivered | 2026-06-07 | CloudFront global WAF WebACL live; rate rule + IP reputation list; per-IP WS protection re-scoped to s005-h2 (platform constraint: WAFv2 cannot associate with API GW v2) |
| s005-h2 — join-token / $connect authorization | delivered | 2026-06-07 | REQUEST authorizer on $connect; HMAC-signed wsToken (host); code-based guest auth; per-IP connect budget via ConnectAttempts table; 17/17 ACs pass |
| s006 — move relay + server-authoritative play | delivered | 2026-06-07 | Server-authoritative move relay live; 16/16 prod ACs; p95 move latency 308ms; zero board divergence; S1a forged-gameId rejected; win/draw detection server-side; full game playable between two browsers |
| s007 — disconnect & timeout handling | delivered | 2026-06-07 | $disconnect Lambda live; 17/17 ACs pass; Games status=abandoned on disconnect; survivor notified within 10s and returned to mode selector without reload; Connections row deleted; IMP-008 WAF runner-IP exclusion delivered |
| s008 — share-link UX | delivered | 2026-06-07 | Deep-link URL (`/join/<code>`) live; Copy-link control on waiting screen; SM-5 (C4 done-condition proof): two players via share link, full game under 5 min |
| s005-h3 — guaranteed code uniqueness | in-planning | — | Closes OI-3; final C4-adjacent hardening residual |

**C4 done condition: MET.** Proven by s008 SM-5 (two players, different browsers, via share link, intent→result under 5 min). All elements in place: game play (s006), disconnect (s007), frictionless share (s008). s005-h3 is the final correctness-hardening residual on the C4 surface — it does not re-open C4's done-condition.

**Remaining forecast:** none — C4 is complete. s005-h3 (in-planning) closes the last integrity risk on the live C4 surface before C5 opens.

### s005 — join-by-code + WebSocket connect [DELIVERED 2026-06-06]
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

**s005-h2 — Join-token / $connect authorization (security risk 2) [DELIVERED 2026-06-07]**
Sequence: after s005-h1, before s006. DELIVERED. REQUEST-type Lambda authorizer
on `$connect`; HMAC-signed `wsToken` for host; 6-char code as guest credential;
per-IP connect budget via `ConnectAttempts` DynamoDB table. 17/17 ACs pass.
See slices/s005-h2-connect-auth/result.md.

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

### s006 — move relay + server-authoritative play [DELIVERED 2026-06-07]
**Scope:** When a player makes a move, the SPA sends it via WebSocket; the Lambda
validates the move (correct player's turn, square not taken, game active, sender
is a player of this game), writes it to the `Games` record, and relays the
updated board state to both connections. The UI updates ONLY on receipt of the
server's broadcast (no optimistic update — server-authoritative is the s004
architecture decision). Win/draw is detected server-side; a `game-over` message
with the result is sent to both players and the result screen is shown. The board
is locked after a result. OI-33 (error-message mismatch on code-not-found) folded
in as a two-line UI fix.

**Killick test:** A full game can be played to completion between two browsers;
neither player can cheat by replaying moves or moving out of turn.

**What is NOT in scope:** disconnect handling, reconnect, leaderboard writes,
share-link UX — all deferred to s007+.

**Success measures:**
1. A move made in browser A appears in browser B within 1 second (p95).
2. The server rejects an out-of-turn move with DynamoDB board state unchanged.
3. A win/draw detected by the server causes both browsers to show the correct result screen simultaneously.
4. No board divergence: at game end, both browsers show identical board state.

See slices/s006-move-relay/slice.md.

### s007 — disconnect and timeout handling [DELIVERED 2026-06-07]
**Scope:** When a WebSocket connection drops (player closes the tab, network
interruption), the `$disconnect` Lambda (currently a stub) is updated to:
look up the disconnecting connectionId, conditionally update the `Games` record
to `abandoned` (if status was `active`), notify the surviving connection with an
`opponent-disconnected` message, and delete the disconnecting player's row from
the `Connections` table. The surviving player's SPA returns to the mode selector
on receipt without a page reload. The existing 2h TTL on `Connections` and 24h
TTL on `Games` are the backstop for crash-without-disconnect edge cases — no new
TTL infrastructure.

**OI-10 decided: reconnect-after-reload is OUT of s007.** The surviving player
gains agency (notified, mode selector returned) without full reconnect. Reconnect
requires re-issuable credentials and rejoin logic bordering C6 scope; it is
unscheduled (candidate post-s013 if C6 ships). OR-S006-b's recovery story is
re-scoped: $disconnect fires → game abandoned → survivor notified (this is the
recovery for a GoneException relay loss, not reconnect-replay).

**Killick test:** A player is not left hanging indefinitely when their opponent
disappears — they can start a new game without a page reload.

**What is NOT in scope:** reconnect-after-reload, idle-timeout keepalive,
waiting-host abandonment UX, leaderboard write on abandonment, game history.

**Success measures:**
1. Closing one browser tab causes the other player's UI to show an "opponent disconnected" message and return to the mode selector within 10 seconds.
2. The `Games` record is updated to `abandoned` on disconnect (conditional — only if status was `active`).
3. The disconnecting player's `Connections` row is deleted after disconnect — no stale connectionIds.
4. A `$disconnect` after a completed game (`won`/`drawn`) does NOT overwrite the Games status to `abandoned`.
5. The surviving player can start a new game from the mode selector without a browser reload.

See slices/s007-disconnect/slice.md.

### s008 — share-link UX + C4 done condition [DELIVERED 2026-06-07 — SEL-S008]

**This was the C4-closing slice.** C4 done-condition proven by SM-5.

**Scope:** The 6-char code is also presented as a copyable deep-link URL
(`https://<domain>/join/<code>`). A "Copy link" control appears on the waiting
screen. Navigating to `/join/<code>` pre-fills the code field on the join screen
and enables one-click join. Invalid code in URL shows a readable error. Pure SPA
routing change via React Router — no backend changes, no new infrastructure.
Arch-lite (client-only). OI-5 decided: CloudFront WS single-origin proxying is
NOT required; path-based deep-link on the existing CloudFront SPA origin
suffices.

**Killick test:** A player can send a single URL to a friend who clicks it and
lands directly on the join flow with no manual code entry — the minimum social
coordination friction for the core job.

**What is NOT in scope:** deep-link authentication, game lobbies, match history,
CloudFront WS single-origin proxying (OI-5 closed).

**Success measures:**
- SM-1: Copy-link control copies a valid `https://<domain>/join/<code>` URL.
- SM-2: Navigating to `/join/<code>` in a fresh browser pre-fills the code and enables one-click join.
- SM-3: An invalid code in the URL shows a readable error (not a crash).
- SM-4: Manual code entry is unaffected (no regression on s005 ACs).
- SM-5 (C4 done-condition proof): Two players in different browsers complete a full game via share link; elapsed time from host creating game to result screen is under 5 minutes.

See slices/s008-share-link/slice.md.

### s005-h3 — guaranteed code uniqueness [IN PLANNING — SEL-S005H3] — closes OI-3

**This is the final C4-adjacent hardening residual.** It closes OI-3 (Gate-3
s005 security review open risk). C4's done-condition is already met (s008 SM-5);
this slice corrects a structural correctness hole on the live C4 surface.

**Scope:** The create-game Lambda must guarantee that the 6-char code it assigns
is unique across all current `waiting` games, enforced at the DynamoDB storage
layer (not in-memory). A collision must trigger a server-side retry with a fresh
code; the client sees no change (`{gameId, code, wsToken}` contract unchanged).

**Product intent:** A conditional write (e.g. conditional `PutItem` on a `Codes`
table keyed by `code`, or a GSI-based uniqueness guard via `ConditionExpression`)
so that two concurrent Lambda invocations cannot race to assign the same code.
Final mechanism: architect decides.

**Success measures:**
- SM-1: Synthetic-duplicate-injection test confirms retry produces a unique code.
- SM-2: N=50 concurrent `POST /api/games` calls yield all-distinct codes; no two
  `waiting` items share a `code` in DynamoDB.
- SM-3: Client contract unchanged — still HTTP 201 `{gameId, code, wsToken}`.
- SM-4: Exhausted-retry path (5+ forced collisions) returns a 5xx (not a silent
  wrong code); covered by unit test.

See slices/s005-h3-code-uniqueness/slice.md.

---

## C5 — Leaderboard

**Job served:**
When I have played one or more games, I want to see how I rank against other
players, so that I feel a reason to come back and improve my record, and I can
show others my standing. (Supporting job — motivation through standing.) **[SECONDARY]**

**Done condition:** The title screen shows a shared leaderboard of win/draw/loss
standings keyed by player-entered name (arcade model: name collisions accepted);
after a completed game the board updates within 10 seconds; it loads within 2
seconds (p95). No account required — players identify by a name they enter
before play.

**Slices:**

| Slice | Status | Delivered | Outcome |
|-------|--------|-----------|---------|
| s009 — arcade-scoreboard | **in-planning** | — | — |
| s010 — latency done-condition proof | forecast | — | — |

**C5 status: in-progress** — s009 revised 2026-06-08 (human redirect: arcade
name-based model). Done condition requires s010 (latency proof).

### s009 — arcade scoreboard [IN PLANNING — SEL-S009-REVISE]

**Killick test: STRONG.** A player enters a name, plays a game, and their result
appears under that name on a shared board readable in another browser. Genuine
arcade outcome — impossible before this slice.

**Human redirect 2026-06-08:** Original s009 (localStorage UUID, backend-only,
weak Killick) withdrawn. Replaced with arcade model: name-as-key, name collision
accepted, board shared and backend-authoritative. See
slices/s009-arcade-scoreboard/slice.md for full rationale.

**Name-as-key model:** Players enter a name (max 10 chars, default "AAA") before
creating/joining a game. The name — not a UUID — is the Leaderboard PK. Two
players can share a name; their tallies accumulate on the same row. This is the
arcade model, not a bug.

**Name-entry UX:** Captured at game creation/join (before play), stored in
`sessionStorage` for in-tab pre-fill. Sent as `playerName` with `POST /api/games`
and WS `join`. Backend writes `hostName`/`guestName` to `Games` item; reads them
at game-over to write the tally. UI-bearing slice (ui-designer runs at structure
time).

**Mechanism direction:** DynamoDB Stream on `Games` → `oxo-board-fn` (preferred,
decoupled from hot path); inline Lambda invoke as fallback. Architect decides.

**Scope:** Name entry UI + `playerName` on wire; `hostName`/`guestName` on Games
item; `Leaderboard` DynamoDB table (PK: playerName); `oxo-board-fn` Lambda writing
tallies on `won`/`drawn`; `GET /api/leaderboard` endpoint; title-screen leaderboard
display. All in one slice — delivering the complete arcade moment.

**Success measures:** SM-1 (name on shared board, cross-browser within 10 s — the
primary customer-visible measure); SM-2 (collision accepted — "AAA" row accumulates
both players' tallies); SM-3 (blank default "AAA"); SM-4 (no double-count on
replay); SM-5 (abandoned games produce no tally); SM-6 (no game-over regression);
SM-7 (board loads within 2 s p95); SM-8 (name pre-fills from sessionStorage).

**Not in scope:** name claiming/auth, cross-device persistence, pagination,
game history, in-game name display to opponent, latency SLA proof (s010),
abandon/forfeit tallies, historical backfill, C6 (absorbed/closed).

### s010 — leaderboard update latency done-condition proof (forecast)
**Scope:** Playwright smoke asserts that after a completed game the title-screen
leaderboard reflects the result within 10 seconds. This is the C5 done-condition
proof. Thin by design — may fold into s009 ACs at the architect's discretion; if
so, s010 is eliminated at that slice-next.

---

## C6 — Player identity (lightweight) — ABSORBED / CLOSED

**Status: absorbed into s009 (human redirect 2026-06-08).**

The arcade name model (name-as-key, entered at game start, displayed on shared
board) delivers the core value of C6 as part of s009. No separate C6 chunk is
needed or forecast.

**What was absorbed:**
- s012 (display-name entry + session persistence) — fully delivered in s009.
- s013 (display name shown to opponent in-game) — deferred to optional future
  slice; no current job demand.

**If ever needed:** Cross-device name claiming or real accounts would be a new
chunk (C8+) driven by an explicit future user need. It is not on the current
roadmap.

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
