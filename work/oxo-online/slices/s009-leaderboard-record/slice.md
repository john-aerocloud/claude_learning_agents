---
slice: s009
slug: leaderboard-record
status: in-planning
decision-log-ref: SEL-S009
chunk: C5
created: 2026-06-08
---

# s009 — leaderboard: record game result

## Job served

**[SECONDARY] Motivation through standing.**

When I have played one or more games, I want to see how I rank against other
players, so that I feel a reason to come back and improve my record, and I can
show others my standing.

This is the data-ingestion half of the C5 chunk. The job is not yet fully
served by this slice alone — no UI, no read endpoint. s010 (read + display)
completes the user-visible payoff.

---

## Killick test (honest assessment)

**WEAK — internal/technical slice. No user-visible outcome.**

A user cannot do anything new after s009 that they could not do before.
The game-over flow is unchanged from their perspective. The tally write
is invisible. The Killick test does not pass in the strict sense.

**Justification for keeping separate from s010:**

s009 introduces a new trigger mechanism (DynamoDB Stream or inline Lambda
write), a new table (Leaderboard), a new Lambda function (oxo-board-fn), and
new IAM grants. s010 adds on top: a new HTTP API route, CloudFront behaviour,
and a UI change. Together these are two independently deployable and testable
units — the write path and the read path. Building the write path first and
validating it in isolation (exactly one tally per completed game, idempotent,
correct winner attribution) de-risks the stream/trigger mechanism before the
UI depends on it. A bug in the write path is cheapest to find when no read
surface yet exists.

This is a legitimate technical slice within a value chunk (C5), not a
standalone value slice. It is honest about its Killick weakness. The chunk as
a whole (C5, done when the title screen shows standings) delivers the job.

**Recommendation: keep s009 separate from s010.** The infra delta is large
enough that a bad trigger mechanism would be harder to isolate if the read
side were also being built simultaneously. The risk of keeping them separate
is that s009 delivers no user value if s010 is never built — acceptable
because C5's done condition and the retro would surface this immediately.

---

## Player identity decision

**Decision: use a client-generated anonymous-but-stable browser ID
(localStorage), sent with create/join. Record game outcomes keyed by this ID.**

### Options evaluated

**(a) Connection-scoped (ephemeral):** The connectionId is the "player".
A player who finishes one game and starts another has a different connectionId
and appears as a different player in the leaderboard. Individual tallies are
meaningless — the leaderboard would be a list of single-game entries, not a
standing. **Rejected.** Near-useless for any motivational purpose.

**(b) Defer player identity to C6 entirely; record game-level outcomes only:**
Store `gameId`, outcome, winner role — no player key at all. The Leaderboard
table becomes a game-result log, not a per-player tally. This is honest (we
have no stable player identity yet) but it means s010 cannot render standings,
only a raw result feed. **Rejected.** It makes the C5 done condition
(per-player standings) unreachable without a backfill migration when C6 ships.

**(c) Thin anonymous-but-stable ID (localStorage):** The SPA generates a
random UUID on first load and stores it in `localStorage` as `oxo_player_id`.
It is sent as a query param or message field at game creation (`POST /api/games`)
and at WebSocket join. The server stores it in the `Games` item alongside the
connectionId. At game-over, the `boardFn` reads `hostPlayerId`/`guestPlayerId`
from the game item and upserts W/D/L tallies keyed by these IDs. **CHOSEN.**

**Why this is good enough for C5:**
- Stable across page reloads in the same browser (localStorage persists).
- Stable across games in the same browser session and across sessions.
- Meaningless across devices (a player on phone ≠ same player on laptop) — but
  C6 (identity) is the right place to address cross-device standing; this is
  explicitly a known limitation.
- Requires a small SPA change (UUID generation + send) and a Games-table schema
  addition (`hostPlayerId`, `guestPlayerId` attrs). The architect decides the
  exact wire shape.
- Does NOT require creating the oxo-board-fn to know about authentication.
  The player ID is just a string key; C6 can layer real identity on top.

**Honest limitation:** A player who clears localStorage or uses a private window
is a new player from the leaderboard's perspective. This is the expected
limitation of pre-auth standing. It is no worse than connection-scoped and
far better for motivational value.

**What this is NOT:** Not a login. Not a session token. Not authentication.
The playerId is client-asserted and used only for display/tally. A user could
fabricate one; that is accepted for a hobby game without accounts.

---

## Thin scope

When a game ends (status transitions to `won` or `drawn`) the following happens:

1. The game-over event (already written atomically to `Games` by `oxo-ws-fn`
   in s006 — one CAS `UpdateItem` setting `status`, `winner`, and broadcasting
   `game-over`) triggers a write to the `Leaderboard` DynamoDB table.

2. For a `won` game: the winner gets a `wins` +1; the loser gets a `losses` +1.
   For a `drawn` game: both players get a `draws` +1.
   Keyed by the `oxo_player_id` value stored in the `Games` item.

3. The tally write is idempotent: if the same `gameId` is processed twice
   (e.g. stream replay), the second write must not double-count. Mechanism:
   a `processedGames` set attribute on the Leaderboard item, or a separate
   `ProcessedGames` table used as a deduplication key — architect decides.

4. No change to the player-visible game flow: game-over message, result
   screen, board lock are all unchanged.

5. No change to the `$disconnect` / `abandoned` path — abandons do NOT
   produce a leaderboard tally (only `won`/`drawn` games count).

**New infrastructure in scope:**
- `Leaderboard` DynamoDB table (PK: `playerId`; attrs: wins, draws, losses,
  updatedAt; SSE on-demand).
- `oxo-board-fn` Lambda (Node 20) — writes tallies; triggered by DynamoDB
  Stream on `Games` table OR called inline from `oxo-ws-fn` (architect
  decides mechanism — see below).
- IAM role `oxo-board-fn`: `UpdateItem`/`GetItem` on `Leaderboard` table;
  (if stream): `dynamodb:GetRecords`/`GetShardIterator`/`DescribeStream`/
  `ListStreams` on `Games` stream ARN; CloudWatch Logs.
- SPA change: generate and persist `oxo_player_id` in `localStorage`;
  send it with `POST /api/games` and with the WS `join` message.
- `Games` table schema addition: `hostPlayerId` and `guestPlayerId` attrs
  written at create/join time (schemaless add, no table rebuild).

---

## Mechanism direction (stream vs inline)

**Direction: DynamoDB Stream, with inline as the fallback option.**

**Stream (preferred):**
- The `Games` table gains a DynamoDB Stream (NEW_AND_OLD_IMAGES). A stream
  record fires when status transitions to `won`/`drawn`.
- `oxo-board-fn` is an event-source mapping consumer: it filters for items
  where `status.S` is `won` or `drawn` and `status.S` differs from the old
  image (transition only, not idempotent re-fires on every status update).
- **Advantage:** zero change to the hot path (`oxo-ws-fn` move handler is
  unchanged). The game-over write latency is unaffected. The leaderboard
  write is decoupled — a board-fn failure does not fail the game.
- **Disadvantage:** at-least-once delivery; idempotency is mandatory. A short
  stream processing delay (typically < 1s for on-demand DynamoDB Streams) is
  acceptable — C5 done-condition allows ≤10s update.
- **New mechanism flag:** DynamoDB Streams event-source mapping is a §30
  probe item for the architect (not yet used in this project).

**Inline (fallback):**
- `oxo-ws-fn` calls `oxo-board-fn` synchronously (or via `lambda:InvokeAsync`)
  at game-over, inside the move handler, after the `game-over` relay.
- **Advantage:** simpler trigger; no stream infrastructure.
- **Disadvantage:** couples the hot path to board-fn; a board-fn error could
  delay or fail the game-over relay if synchronous; async invoke loses the
  error signal; requires adding `lambda:InvokeFunction` to the `oxo-ws-fn`
  role (a new permission on a new Lambda ARN).

**Stream is the cleaner decoupled design.** Architect decides; this is the
direction to start from.

---

## Explicitly NOT in scope

- **Read endpoint** (`GET /api/leaderboard`) — s010.
- **Title-screen leaderboard display** — s010.
- **Latency SLA proof** (board updates within 10s) — s011 (the C5
  done-condition proof slice).
- **Player display names** — C6. The playerId is a UUID, not a human name.
- **Cross-device identity reconciliation** — C6.
- **Abandon / forfeit tallies** — abandoned games produce no leaderboard entry.
  (This is a product choice: only completed games count toward standing.)
- **Historical backfill** of completed games before s009 ships — the
  leaderboard starts from zero at launch; no migration of earlier game records.
- **Per-game result history / game log** — only aggregate W/D/L counts.
- **Any UI change beyond** the localStorage UUID generation and sending it
  with create/join messages.

---

## Success measures

All observable via integration/smoke tests (no UI dependency):

**SM-1 — One tally per completed game:**
After a game reaches `won` or `drawn`, exactly one Leaderboard tally write
occurs for each involved player (two writes total for a `won` game: winner
+1 win, loser +1 loss; two writes for `drawn`: both +1 draw).

**SM-2 — Correct outcome attribution:**
For a `won` game, the player whose `playerId` matches `winner` (from the
`Games` item) receives the `wins` increment; the other receives `losses`.
Verified by reading both Leaderboard items after game-over.

**SM-3 — Idempotency (no double-count):**
Replaying the same `gameId` through the trigger path a second time does NOT
increment any tally counter. Leaderboard item after second replay is
identical to after first.

**SM-4 — No change to game-over flow:**
The `game-over` WS message is still delivered to both players within 1s p95
(the s006 SM-3 measure). Adding the Leaderboard write path does not
regress this observable — measured in the existing smoke test suite.

**SM-5 — Abandoned games produce no tally:**
After a `$disconnect` that sets `status=abandoned`, the Leaderboard table
contains no new items or incremented counts (verified by reading Leaderboard
before and after the disconnect trigger).

**SM-6 — playerId stored in Games:**
After `POST /api/games` and a successful WS join, the `Games` DynamoDB item
contains both `hostPlayerId` and `guestPlayerId` attrs with UUID-shaped values.

---

## Opens C5; what follows

- **s010 — leaderboard read endpoint + title-screen display** (UI-designer per
  OI-41): `GET /api/leaderboard` returns top-N standings; title screen fetches
  and renders on load. This is the first user-visible payoff of C5.
- **s011 — leaderboard update latency validation**: Playwright smoke asserts
  that after a completed game the title-screen leaderboard reflects the result
  within 10 seconds. This is the C5 done-condition proof.
