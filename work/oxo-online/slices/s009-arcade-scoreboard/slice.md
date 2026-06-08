---
slice: s009
slug: arcade-scoreboard
status: in-planning
decision-log-ref: SEL-S009-REVISE
chunk: C5
created: 2026-06-08
renamed-from: s009-leaderboard-record (human redirect 2026-06-08; see C5/C6 reshape note below)
---

# s009 — arcade scoreboard (name entry + record + shared display)

## Human redirect note

The original s009 proposed a localStorage-UUID identity model with backend-only
ingestion and no user-visible outcome. The human has redirected to an arcade model:
scores attach to a NAME entered by the player (not to a UUID), the board is stored
on the backend and shared between all players, and name collisions are accepted
(two players may both be "AAA" — like an arcade cabinet). This reshape makes the
first slice genuinely Killick-positive. See the C5/C6 reshape section at the end.

---

## Job served

**[SECONDARY] Motivation through standing.**

When I have played one or more games, I want to see how I rank against other
players by name, so that I feel a reason to come back and improve my record, and
I can show others my standing.

This slice delivers the full arcade scoreboard moment: a player enters a name,
plays a game, and the result appears under that name on a shared board readable
in another browser. The job is served end-to-end in this one slice.

---

## Killick test

**STRONG — user-visible outcome, cross-browser verifiable.**

A player who enters a name and completes a game can see their name on a shared
scoreboard in a second browser. That outcome was impossible before this slice.
The board is live, shared, and backend-authoritative — not a local display of
local data.

This is the arcade moment: enter initials, finish game, see your name on the
board. Everything a coin-op cabinet delivers.

---

## Name-as-key model (binding)

- **Names attach to scores, not player IDs.** The entered name is the key on
  the `Leaderboard` table. W/D/L tallies are accumulated against the name string.
- **Name collisions are accepted by design.** Two players can both be "AAA".
  Their tallies accumulate on the same leaderboard row. This is the arcade model,
  not a bug. No deduplication, no uniqueness constraint on names.
- **No authentication.** A player asserts a name; the server accepts it. There
  is no proof of ownership. This is the explicit product decision.
- **No localStorage UUID.** The previous playerId UUID model is withdrawn.
  The name IS the identity for leaderboard purposes.
- **Name persistence within session:** The entered name is stored in
  `sessionStorage` so that if the player creates or joins another game in the
  same browser tab they do not have to re-enter it. This is a convenience, not
  an identity guarantee.

---

## Where the name is entered (UX point)

**At game creation / join — before play begins.**

Rationale: the server must associate the name with the player BEFORE the result
is recorded. The `game-over` event fires when the game concludes; at that point
the backend reads `hostName` / `guestName` from the `Games` item to write the
tally. If the name were entered at game-over, the name would not yet be on the
server when the result fires (or would require a separate post-game API call,
adding a race).

Arcade convention supports both entry points (some cabs ask at start, some at
end), but the server-authoritative architecture already in place makes start-time
capture the clean choice. The flow:

1. A "What's your name?" field appears on the title/mode-selector screen before
   the player creates or joins a game (not a blocking gate — a default of
   "AAA" is used if blank, consistent with arcade UX).
2. The name is sent with `POST /api/games` (host) and with the WS `join` message
   (guest).
3. The backend stores `hostName` / `guestName` on the `Games` item alongside
   the existing `hostConnectionId` / `guestConnectionId`.
4. At game-over, `hostName` / `guestName` are read from the `Games` item and
   used as the Leaderboard keys.

This is a UI-bearing slice. The name-entry surface is a new player-facing
interaction. The ui-designer agent runs at structure time for this slice.

---

## Thin scope

### Name entry (UI + wire change)
- A name-entry field ("Your name") appears on the title/mode-selector screen.
- Max 10 characters (arcade-style), trimmed, defaulting to "AAA" if empty or
  blank.
- The entered name is persisted to `sessionStorage` so it pre-fills on the next
  create/join within the same tab.
- The name is sent as `playerName` with `POST /api/games` and with the WS `join`
  event.
- The backend writes `hostName` / `guestName` on the `Games` DynamoDB item at
  create / join time respectively.

### Backend record (write path)
- When a game reaches `won` or `drawn`, a tally is written to a new `Leaderboard`
  DynamoDB table keyed by the name string (PK: `playerName`).
- For a `won` game: winner name gets `wins` +1; loser name gets `losses` +1.
- For a `drawn` game: both names get `draws` +1.
- Idempotent on replay: processing the same `gameId` twice must not double-count.
  Mechanism: a `processedGames` deduplication set on the Leaderboard item, or a
  separate `ProcessedGames` table — architect decides.
- Abandoned games (`status=abandoned`) produce no tally.
- Trigger mechanism: DynamoDB Stream on `Games` preferred (decoupled from hot
  path); inline Lambda invoke as fallback — architect decides. This is the same
  direction as the prior s009; it remains valid.

### Shared board display (read + UI)
- A `GET /api/leaderboard` endpoint returns the top-N standings (name, W/D/L),
  ordered by wins descending (ties broken by losses ascending, then name
  alphabetically — simple stable sort).
- The title screen fetches and displays the board on load. A short CloudFront
  cache TTL (5-10 s) keeps read pressure off DynamoDB while meeting the ≤10 s
  update SLA.
- The display is minimal: a ranked list showing name | W | D | L. No avatars,
  no graphs, no pagination in this slice.
- The board is the SAME for all players (backend-authoritative, shared).

### New infrastructure in scope
- `Leaderboard` DynamoDB table (PK: `playerName` string; attrs: wins, draws,
  losses, processedGames set or equivalent dedup mechanism; SSE on-demand).
- `oxo-board-fn` Lambda (Node 20) — writes tallies; triggered by DynamoDB Stream
  on `Games` or called inline from `oxo-ws-fn`.
- IAM role for `oxo-board-fn`: `UpdateItem`/`GetItem` on `Leaderboard`; stream
  read permissions if stream trigger; CloudWatch Logs.
- `GET /api/leaderboard` HTTP route on the existing API GW HTTP API; Lambda
  handler returning top-N from `Leaderboard` scan/query.
- CloudFront behaviour for `/api/leaderboard` with short TTL (5-10 s).
- SPA changes: name-entry field; leaderboard panel on title screen; wire
  `playerName` into `POST /api/games` and WS join.
- `Games` table schema addition: `hostName` / `guestName` attrs (schemaless
  add, no table rebuild). The old `hostPlayerId`/`guestPlayerId` UUID attrs
  are NOT added.

---

## Mechanism direction (stream vs inline)

**Direction: DynamoDB Stream, with inline as the fallback option.**

**Stream (preferred):**
- The `Games` table gains a DynamoDB Stream (NEW_AND_OLD_IMAGES). A stream
  record fires when status transitions to `won`/`drawn`.
- `oxo-board-fn` is an event-source mapping consumer: it filters for items
  where `status.S` is `won` or `drawn` and `status.S` differs from the old
  image (transition only, not idempotent re-fires on every status update).
- Advantage: zero change to the hot path (`oxo-ws-fn` move handler is
  unchanged). The game-over write latency is unaffected. The leaderboard
  write is decoupled — a board-fn failure does not fail the game.
- Disadvantage: at-least-once delivery; idempotency is mandatory. A short
  stream processing delay (typically < 1 s for on-demand DynamoDB Streams) is
  acceptable given the ≤10 s update SLA.

**Inline (fallback):**
- `oxo-ws-fn` calls `oxo-board-fn` synchronously (or via `lambda:InvokeAsync`)
  at game-over, inside the move handler, after the `game-over` relay.
- Advantage: simpler trigger; no stream infrastructure.
- Disadvantage: couples the hot path to board-fn.

Architect decides mechanism. Stream is the cleaner design.

---

## Explicitly NOT in scope

- **Name claiming / authentication.** A name is asserted, not owned. Two players
  can use "AAA" simultaneously. No passwords, no tokens, no account system.
- **Cross-device name persistence.** `sessionStorage` is tab-scoped; clearing
  the browser or switching device resets the name. This is accepted.
- **Pagination / full board.** Top-N only (N TBD by architect, likely 10-20).
- **Per-game result history / game log.** Only aggregate W/D/L counts.
- **Leaderboard update latency SLA proof.** The done-condition proof (Playwright
  smoke asserting the board reflects a result within 10 s) is s010 — kept as
  a thin separate slice so s009 ships the value and s010 closes the chunk formally.
- **In-game name display to opponent.** Deferred; no current job demand.
- **Name change mid-session.** The name entered at create/join is fixed for that
  game. A new create/join picks up whatever is currently in `sessionStorage`.
- **Abandon / forfeit tallies.** Only `won`/`drawn` games count.
- **Historical backfill.** Leaderboard starts from zero at launch.
- **C6 (account-based identity).** Absorbed and closed — see C5/C6 reshape note.

---

## Success measures

**SM-1 — Name appears on shared board (customer-visible, cross-browser):**
Player A enters name "ACE", plays a game to completion. In a separate browser
(Player B's view of the title screen), the leaderboard shows "ACE" with the
correct W or D tally within 10 seconds of game-over. This is the primary
customer-visible measure.

**SM-2 — Name collision accepted:**
Two separate players both enter "AAA" and each complete a game (one wins, one
draws). The Leaderboard row for "AAA" shows the combined tally (1W + 1D), not
two separate rows. No error is returned for duplicate name use.

**SM-3 — Default name "AAA" used when blank:**
A player who leaves the name field empty and creates/joins a game has "AAA"
recorded in the `Games` item and their result attributed to "AAA" on the board.

**SM-4 — One tally per completed game (no double-count):**
Replaying the same `gameId` through the trigger path a second time does NOT
increment any tally counter. Leaderboard item after replay is identical to
after first processing.

**SM-5 — Abandoned games produce no tally:**
After a `$disconnect` that sets `status=abandoned`, the Leaderboard table
contains no new entries or incremented counts for the involved names.

**SM-6 — No regression on game-over flow:**
The `game-over` WS message is still delivered to both players within 1 s p95
(s006 SM-3 measure). The name-capture and leaderboard-write path do not regress
this observable.

**SM-7 — Board loads within 2 s (p95) on title screen:**
A fresh page load of the title screen fetches and renders the leaderboard panel
within 2 seconds (p95). Measured in the Playwright smoke.

**SM-8 — Name persists within tab session:**
After entering a name and completing a game, if the player returns to the title
screen and initiates another game, the name field is pre-filled with the
previously entered name (from `sessionStorage`).

---

## C5/C6 reshape note (binding)

**C6 (Player identity / lightweight) is absorbed and closed.**

Under the old model, C6's job was to introduce stable cross-device player
identity and display names on the leaderboard. Under the arcade model:
- Display names are delivered in this slice (s009). C6's primary value is gone.
- Cross-device identity ("claim your name") is a possible future feature but
  has no committed job. No player has asked for it; the arcade model explicitly
  accepts collision and impermanence.
- No account system is planned. If ever wanted, it would be a new chunk (C8+)
  driven by a new user need — not a continuation of the current roadmap.

**Decision: C6 is removed from the chunk plan.** The slices forecast under it
(s012 display-name-entry, s013 display-name-shown-to-opponent) are absorbed:
- s012 (name entry) is in scope in this slice (s009).
- s013 (name shown to opponent in-game) is deferred to an optional future slice
  not currently on the roadmap (no job demand).

**C5 revised slice list:**

| Slice | Scope |
|-------|-------|
| s009 — arcade-scoreboard | Name entry + backend record + shared board display (this slice) |
| s010 — latency done-condition proof | Playwright smoke: board reflects result within 10 s; C5 done-condition proof |

s010 is now purely the done-condition proof slice — kept separate because it uses
a different testing mechanism (automated Playwright smoke vs. functional feature
delivery) and closes the C5 chunk formally. If the smoke is folded into s009's
own AC suite at the architect's discretion, s010 may be eliminated at slice-next.

---

## What follows

- **s010 — leaderboard update latency done-condition proof** (thin: Playwright
  smoke only; may fold into s009 ACs at the architect's discretion).
- **C6** — removed from plan. Not forecast.
- **C7 — In-game chat** — next chunk after C5 complete.
