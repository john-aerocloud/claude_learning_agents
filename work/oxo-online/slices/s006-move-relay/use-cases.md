---
slice: s006
slug: move-relay
process-ref: §37
---

# Use cases — s006: Move relay + server-authoritative play

Use cases are separately buildable and separately testable. Dependency edges are
listed only where a genuine build or deploy dependency exists. False edges waste
parallelism and are not added.

The ws-fn move route handler is a shared seam: UC3 is the only thing in flight
that writes to it. UC2 and UC4 can build in parallel with UC3 because they touch
different layers (domain-pure functions and SPA respectively). Nothing else in
this slice is simultaneously modifying the ws-fn handler, so no serialisation
is needed among UC1/UC2/UC4.

---

## Parallel sets

```
SET A (parallel — no cross-dependencies at build time):
  UC1 — move domain core (pure functions; zero infra)
  UC2 — Games store adapter (conditional UpdateItem + join-time board init)
  UC4 — SPA move-send + render-on-broadcast (pure client, no cloud needed)
  UC5 — local stand-up (OI-28): committed run-local entry + local adapters

SET B (after UC1 + UC2 are unit-tested; UC3 needs the ports they implement):
  UC3 — ws-fn move route handling (parse, identity bind, domain call, relay)

SET C (after UC3 deployed; validation in prod):
  UC6 — validation: out-of-turn/forgery rejection + p95 latency + zero divergence
```

UC1 is pure logic; it has no infra dependency and unblocks UC3. UC2 adds the
Games store port and the join-time board init to the existing s005 join write;
the s005 join write is already deployed, so UC2's DynamoDB adapter is built and
unit-tested locally, deployed as part of the ws-fn code push with UC3. UC4 is
SPA-only and can build against a stub relay port from the start. UC5 produces the
local stand-up harness that the engineer uses during BUILD for UC1–UC4 browser
testing without cloud. UC6 is tester-owned validation that only runs after UC3
is in prod.

---

## UC1 — Move domain core: validate + apply move, win/draw detection

**ID:** UC1
**Actor:** Engineer (pure function authoring) / domain module
**Trigger:** A move event arrives at the domain boundary: `(board, currentTurn,
square, senderRole)`.

### Trigger -> observable outcome

A pure function `applyMove(board, currentTurn, square, senderRole)` returns
`{ accepted: boolean, newBoard?, nextTurn?, terminal: boolean, winner? }`.
Accepted moves update the board string and flip the turn. A winning line sets
`terminal=true` and `winner`. Nine filled squares with no line sets
`terminal=true, winner=undefined` (draw). Rejected moves return
`{ accepted: false }` with no board mutation.

Observable outcome: the function is unit-testable with zero AWS dependencies and
all eight win-line patterns, the draw-by-fill path, out-of-turn rejection, square
already-taken rejection, and post-terminal rejection produce the correct outputs.

### Done condition

Unit tests cover: all eight win-line patterns (rows, cols, diagonals) for both
X and O; draw-by-fill (9 squares, no line); out-of-turn rejection (senderRole
does not match currentTurn); square-taken rejection; post-terminal rejection
(status already terminal — function receives terminal flag and early-rejects).
Zero infra calls in any test path. All tests green in CI.

### Acceptance cases

- AC1.1: Eight win-line patterns each recognised correctly (X-wins, O-wins) for
  all three row, three column, and two diagonal cases (unit test, pure function).
- AC1.2: Board with nine filled squares and no win line returns `terminal=true,
  winner=undefined` (draw) (unit test).
- AC1.3: Move where `senderRole !== currentTurn` returns `{ accepted: false }`
  without mutating board (unit test — out-of-turn).
- AC1.4: Move to a square whose position in the board string is not `'-'`
  returns `{ accepted: false }` without mutating board (unit test — square taken).
- AC1.5: Move called with `terminal=true` (caller passes current terminal flag)
  returns `{ accepted: false }` (unit test — post-terminal guard).
- AC1.6: Accepted non-terminal move returns `{ accepted: true, newBoard,
  nextTurn, terminal: false }` where `newBoard[square] = senderRole` and
  `nextTurn` is the opposite role (unit test — happy path).

### Dependencies

None. UC1 is a pure function; it has no build dependency on any other UC in this
slice.

---

## UC2 — Games store adapter: atomic conditional UpdateItem + join-time board init

**ID:** UC2
**Actor:** Engineer (store-port implementation) / `oxo-ws-fn` Games adapter
**Trigger:** (a) Move accepted by UC1 domain — adapter called to write the new
board state; (b) Guest joins — the s005 join conditional write is extended to
initialise board fields.

### Trigger -> observable outcome

Two things change under this UC:

**Move write:** `applyMove(gameId, expectedVersion, patch)` executes a single
atomic `UpdateItem` with `ConditionExpression: status = :active AND currentTurn =
:senderRole AND version = :expectedVersion`. On success, `board`, `currentTurn`,
`version+1`, and `moveCount+1` (plus optional `status`/`winner` on terminal) are
written atomically. On `ConditionalCheckFailedException`, the adapter surfaces a
typed rejection (no partial write occurred).

**Join-time init:** the existing s005 join conditional write gains three
additional SET clauses: `board = :empty, currentTurn = :X, version = :zero,
moveCount = :zero` (written only when the condition passes, i.e. game is
`waiting` and host slot is filled). After a successful join `GetItem` shows
`board="---------"`, `currentTurn="X"`, `version=0`, `moveCount=0`.

Observable outcome (local adapter): the in-memory / DynamoDB-Local adapter
reproduces the version-CAS branch — a second write with `expectedVersion=0`
after the first write (which bumps to version=1) is rejected. This proves the
optimistic-lock branch is exercised locally before any cloud touch.

### Done condition

Unit/integration tests (local adapter or DynamoDB-Local) cover: accepted move
write bumps `version` by 1 and writes correct board/turn; concurrent write with
stale `expectedVersion` is rejected (`ConditionalCheckFailedException` surfaces
as typed reject); terminal move write sets `status=won|drawn` and `winner` in the
same atomic operation; join-time init fields are present with correct values after
a join (GetItem check). A synth-contract test asserts the `ConditionExpression`
attribute is present on the `UpdateItem` call (code-policy pin — ensures the
atomic gate cannot be silently removed). All tests green in CI.

### Acceptance cases

- AC2.1: Accepted non-terminal move write: `GetItem` after write shows
  `board` updated at the correct square, `currentTurn` flipped, `version`
  incremented by 1, `moveCount` incremented by 1 (local adapter test).
- AC2.2: Second write with `expectedVersion = 0` after a version-1 write is
  rejected (ConditionalCheckFailedException surfaces as typed reject, no board
  mutation) (local adapter test — optimistic-lock branch).
- AC2.3: Terminal move write: in the same atomic `UpdateItem` that writes the
  winning board, `status` transitions to `won` and `winner` is set; a subsequent
  write attempt with `status=active` condition fails (local adapter test — state
  transition lock).
- AC2.4: Draw write: when `moveCount+1 = 9` with no win line, `status=drawn` and
  no `winner` are written atomically (local adapter test).
- AC2.5: Join-time init: after a successful guest join, `GetItem` returns
  `board="---------"`, `currentTurn="X"`, `version=0`, `moveCount=0` (integration
  test against local adapter or DynamoDB-Local — see T6 for prod verification).
- AC2.6: Synth-contract / code-policy test: the `UpdateItem` call for the move
  write carries a `ConditionExpression` that includes `status = :active`,
  `currentTurn = :senderRole`, and `version = :expectedVersion` (asserted in test
  against the synthesised/compiled call — code-policy pin).

### Dependencies

None in isolation (runs against local adapter). UC3 depends on UC2 being unit-
tested and its port interface defined; UC3 wires UC2's adapter into the Lambda
handler.

---

## UC3 — ws-fn move route handling: parse action=move, identity bind, call domain, relay

**ID:** UC3
**Actor:** `oxo-ws-fn` Lambda (the shared seam — only UC in flight writing to
this handler)
**Trigger:** WS message `{ action: 'move', square: <0..8> }` arrives on the
`move` route of the WebSocket API (routed by `$request.body.action`).

### Trigger -> observable outcome

The handler:
1. Parses `square` from the event body; rejects malformed input with
   `move-rejected` to the sender (1 POST, 0 writes).
2. Reads `connectionId` from `event.requestContext.connectionId` (server-derived;
   never from a client field).
3. Looks up `Games` record by `gameId` (from `Connections` item for this
   connectionId); derives `senderRole` from connectionId == `hostConnectionId`
   (role X) or `guestConnectionId` (role O). If connectionId matches neither,
   rejects (S1).
4. Calls UC1 domain function `applyMove`; on rejection returns `move-rejected`
   to sender only (1 POST, 0 writes).
5. Calls UC2 store adapter `applyMoveWrite`; on `ConditionalCheckFailedException`
   (version race — single re-read allowed then reject) returns `move-rejected` to
   sender (1 POST, 0 writes).
6. On successful write: posts `board-update` to BOTH connections (2 POSTs on
   non-terminal; +2 `game-over` POSTs on terminal — ceiling 4 POSTs).
7. A GoneException on a relay POST is logged; the other post still proceeds.
8. Lambda emits `buildSha` as a structured log field on every invocation.

A new `move` route key is added to the existing WS API (4 → 5 routes). The
`move` route key is asserted present in the synth-contract test (§30 guard:
`action='move'` in the SPA matches a synthesised `RouteKey`).

### Done condition

The following must pass: UC1 and UC2 ports are unit-tested (own done conditions
satisfied) and their interfaces are stable before this handler wires them. Handler
unit tests (with transport-port spy and store-port stub) cover: valid in-turn
move relayed to both connections (exactly 2 POSTs, board-update content correct);
terminal move relays board-update + game-over to both (exactly 4 POSTs); out-of-
turn move → 1 move-rejected POST, 0 writes; wrong-game connectionId → 1 move-
rejected, 0 writes; version-race → re-read path → reject; malformed square → 1
move-rejected POST, 0 writes. Synth-contract test asserts 5th route key `move`
present. Handler deployed in `OxoGameProd` and prod functional smoke (T1) passes.

### Acceptance cases

- AC3.1: Handler unit test: valid in-turn move → transport-port spy records
  exactly 2 `board-update` POSTs (one per connectionId), zero `move-rejected`
  POSTs, and the store-port stub records exactly 1 `UpdateItem` call (UC3 core
  relay path).
- AC3.2: Handler unit test: winning move → spy records exactly 2 `board-update`
  POSTs + exactly 2 `game-over` POSTs (4 total), 0 `move-rejected` (terminal
  relay path — T3).
- AC3.3: Handler unit test: out-of-turn move → spy records exactly 1
  `move-rejected` POST to sender only; store-port stub records 0 `UpdateItem`
  calls (S2, T4 pre-condition).
- AC3.4: Handler unit test: `connectionId` matches neither `hostConnectionId`
  nor `guestConnectionId` → exactly 1 `move-rejected` POST to that connection,
  0 writes (S1 — wrong-game/spectator rejection).
- AC3.5: Handler unit test: version-race ConditionalCheckFailedException on
  initial write, re-read shows move now illegal → exactly 1 `move-rejected`
  POST, 0 net writes committed (S6 version-CAS path).
- AC3.6: Synth-contract test: WS API template contains exactly 5 route keys
  including `move` (§30 guard — action-matches-route, same guard class as the
  s004 prod-404 catch).
- AC3.7: Handler unit test: GoneException on post to one connection → logged,
  the other connection still receives its POST (relay best-effort posture — S4).
- AC3.8: Handler structured log includes `buildSha` field on every invocation
  (verifiable in CloudWatch in prod — principles/01 version-identifiability).

### Dependencies

- UC1 port interface must be defined and unit-tested (done condition of UC1
  satisfied) — the handler imports the domain function.
- UC2 port interface must be defined and unit-tested (done condition of UC2
  satisfied) — the handler imports the store adapter.
- UC3 is the SHARED SEAM: no other UC in this slice writes to `oxo-ws-fn` handler
  concurrently. Build UC1 and UC2 in parallel, then wire in UC3.

---

## UC4 — SPA: send move on click, render on broadcast, board lock, OI-33 error map

**ID:** UC4
**Actor:** SPA (player browser)
**Trigger:** (a) Player clicks a board square in online mode; (b) SPA receives a
`board-update` or `game-over` WS message; (c) Player tries to click after
game-over; (d) Player joins a non-existent code.

### Trigger -> observable outcome

Four observable behaviours under this UC:

**Move send:** on click in online mode, the SPA sends `{ action: 'move', square:
<index> }` over the open WS. The board display does NOT update optimistically —
it waits for the server `board-update`. (Server-authoritative contract established
at s004 architecture decision.)

**Render on broadcast:** on receipt of a `board-update` message, the SPA
re-renders the board from the server-supplied `board` string and updates the
turn indicator. The local square click event has no rendering side-effect.

**Board lock on game-over:** on receipt of `game-over`, both SPAs render the
result screen. The board is locked — further square clicks are silently ignored
in the UI (no further `move` sends). The result (`X wins`, `O wins`, or `Draw`)
is displayed to both players.

**OI-33 error map:** when the WS error handler receives reason `code-not-found`
from the server, the SPA displays "Game not found. Check the code and try again."
instead of the prior generic "Something went wrong. Please try again."

### Done condition

SPA component tests cover all four behaviours: (a) click fires WS send with
correct action/square, board does not update before server response; (b) received
`board-update` re-renders board correctly; (c) click after `game-over` triggers
no WS send; (d) `code-not-found` reason renders the specified message text. Local
two-player (s002) and vs-AI (s003) modes are unaffected — regression spec green.

### Acceptance cases

- AC4.1: SPA component test: clicking square 4 in online mode sends exactly one
  `{ action: 'move', square: 4 }` WS message; the board display is unchanged
  before any server response is received (no optimistic update).
- AC4.2: SPA component test: receiving `{ type: 'board-update', board: 'X--------',
  currentTurn: 'O' }` renders square 0 as X and updates the turn indicator to O
  without any prior click event (render-on-broadcast).
- AC4.3: SPA component test: after receiving `game-over`, clicking any square
  triggers no WS send (board locked — verifiable via WS spy recording 0 sends
  post-game-over).
- AC4.4: SPA component test: after receiving `game-over` with `result: 'X-wins'`,
  the result screen displays "X wins" (or equivalent winner text); after `result:
  'draw'`, it displays "Draw" (result screen rendering).
- AC4.5: SPA component test: WS error handler with reason `code-not-found`
  renders the text "Game not found. Check the code and try again." (OI-33 fix —
  this is the previously-failing F3/T5 case from s005 that becomes green here).
- AC4.6: Playwright regression: local two-player game plays a full match to win
  without regression (s002 mode unaffected).
- AC4.7: Playwright regression: vs-AI game plays a full match without regression
  (s003 mode unaffected).

### Dependencies

None at build time — UC4 builds against a WS stub; no UC3 or UC2 required to
build and test SPA behaviour. UC4 does need UC3 deployed for the end-to-end smoke
(UC6 validation).

---

## UC5 — Local stand-up (OI-28): committed run-local entry + local adapters

**ID:** UC5
**Actor:** Engineer (local development and BUILD-phase browser testing)
**Trigger:** Engineer runs the local stand-up entry point (a committed script /
Makefile target) during BUILD phase.

### Trigger -> observable outcome

A single entry-point command (e.g. `make -C work/oxo-online/src/app run-local`
or `npm --prefix work/oxo-online/src/app run local`) starts:
- The SPA in dev mode.
- A local WS server backed by the hexagonal port adapters: in-memory Games store
  (reproducing version-CAS semantics), in-process relay stub (recording posts),
  and the UC1 domain functions directly.

Two browsers opened locally can play a complete game to win and draw against
the local server — with the same move-relay flow (send on click, render on
broadcast, game-over lock) that will face the cloud in prod.

The engineer runs Playwright browser tests against this local server in BUILD
phase, covering move relay, out-of-turn rejection, win, and draw — before any
cloud deployment.

### Done condition

A committed `run-local` target exists (not a one-off script). `make -C
work/oxo-online/src/app run-local` (or equivalent allowlist form) starts the
full local stack. Engineer browser tests (Playwright, run locally against the
local server) pass for: move relay (2-browser flow), out-of-turn rejection,
win detection, draw detection. The local adapter reproduces the version-CAS
branch (tested in UC2 unit tests). No cloud credentials required.

### Acceptance cases

- AC5.1: A committed `run-local` target exists in the project's Makefile or
  `package.json`; it starts the local WS server and SPA without cloud credentials
  (verifiable by the engineer in BUILD phase).
- AC5.2: Local Playwright test: two browser instances play a full online game to
  a win against the local server — X wins on a row, O wins on a column, or
  similar (engineer BUILD-phase test, run locally against local stand-up).
- AC5.3: Local Playwright test: draw game (all 9 squares filled, no win line) is
  detected and both browsers show the draw result screen (local stand-up).
- AC5.4: Local Playwright test: out-of-turn click is rejected (browser B receives
  `move-rejected`; board is unchanged; it is now player A's turn as before)
  (local stand-up — OI-28 coverage).
- AC5.5: The local in-memory adapter rejects a second write with a stale
  `expectedVersion` (version-CAS branch exercised — confirmed by UC2 unit test
  which runs against the same adapter code, not a separate code path).

### Dependencies

- UC1 domain functions must exist (the local server calls them).
- UC2 store-port interface must exist (the local in-memory adapter implements it).
- UC5 can be built in parallel with UC3 (different layer — local server scaffolding
  does not touch the Lambda handler).

---

## UC6 — Validation: out-of-turn/forgery rejection, p95 latency, zero divergence

**ID:** UC6
**Actor:** Tester (prod validation spec)
**Trigger:** Post-deploy validation run, after UC3 is deployed to `OxoGameProd`.

### Trigger -> observable outcome

The tester exercises the deployed system:
1. Two browsers play a complete game to win and to draw — both boards show
   identical results; result screens appear to both within 1s of each other.
2. Out-of-turn click: browser B sends a move when it is A's turn — `move-rejected`
   received by B; `GetItem` on `Games` confirms board and `currentTurn` are
   byte-identical to pre-rejection state.
3. Wrong-game connection forgery: a connection not bound to this game sends a
   `move` — `move-rejected`; 0 writes.
4. p95 move latency: ≥10 move events in a single game; p95 measured from WS send
   to WS receipt in browser B < 1s.
5. Board lock after game-over: after `game-over`, a further `move` from either
   connection is rejected and `Games` shows `status ∈ {won, drawn}`.
6. Lambda log line carries `buildSha` field (version-identifiability).
7. OI-33: joining a non-existent code shows "Game not found. Check the code and
   try again." in the browser.

### Done condition

All acceptance cases below pass. Success-measures #1–#4 from slice.md all green.

### Acceptance cases

- AC6.1: Two-browser smoke: both browsers play a complete game to win; both show
  the winner label within 1s of each other (success-measure #3 — simultaneous
  result screens); board square-for-square identical in both browsers
  (success-measure #4 — zero divergence) [F1, T1, T2, T3].
- AC6.2: Two-browser draw smoke: all 9 squares filled with no win line; both
  browsers show "Draw" result within 1s of each other; board identical [F1, T2,
  T3].
- AC6.3: Out-of-turn rejection: browser B sends `move` on A's turn; `move-rejected`
  returned to B; `GetItem` on `Games` shows `board` and `currentTurn` byte-
  identical to pre-rejection state (success-measure #2) [F2, S2].
- AC6.4: Board lock after game-over: after `game-over` received, a further `move`
  from either connection returns `move-rejected`; `GetItem` shows `status ∈
  {won, drawn}` and `board` unchanged [T4, S3].
- AC6.5: p95 move latency < 1s: ≥10 moves measured from WS send (browser A) to
  WS receipt (browser B); p95 of those 10+ measurements < 1000ms
  (success-measure #1) [T1].
- AC6.6: Wrong-game forgery: a connectionId not registered to this game sends a
  `move` message; it receives `move-rejected`; `GetItem` on `Games` shows 0
  writes; no board-update sent to legitimate players [S1].
- AC6.7: Lambda CloudWatch log line for a relayed move carries `buildSha` field
  (principles/01 version-identifiability) [T from arch delta — build-sha log
  carrier].
- AC6.8: OI-33 prod check: joining a non-existent code shows "Game not found.
  Check the code and try again." in the browser UI [F3, T5].

### Dependencies

- UC3 must be deployed (Lambda handler and `move` route live in prod).
- UC4 must be deployed (SPA updated with move-send, render-on-broadcast, OI-33
  map, board lock).
- UC2's join-time init must be deployed (T6 init check feeds into this validation
  via the `GetItem` after join).
- UC1, UC5 are fully validated before cloud deployment by BUILD-phase tests.

---

## Dependency summary

```
UC1 (move domain core)           — no build dependencies (independent, pure functions)
UC2 (Games store adapter)        — no build dependencies (independent; port + local adapter)
UC3 (ws-fn move route handler)   — requires UC1 + UC2 port interfaces stable
UC4 (SPA move/render/OI-33)      — no build dependencies (independent; builds against WS stub)
UC5 (local stand-up, OI-28)      — requires UC1 + UC2 port interfaces exist; parallel with UC3
UC6 (prod validation)            — requires UC3 + UC4 deployed; UC2 join-init deployed
```

Parallel sets:
- **Set A (build in parallel):** UC1, UC2, UC4, UC5
- **Set B (after UC1 + UC2 port interfaces stable):** UC3
- **Set C (after UC3 + UC4 deployed to prod):** UC6

Shared seam note: UC3 is the only UC writing to the `oxo-ws-fn` handler in this
slice. No serialisation is needed among Set A members — they operate on distinct
artefacts (pure functions, adapter module, SPA component, local server scaffold).

---

## Infra enabler notes (co-decided with solution-architect)

1. **move route key:** one `AWS::ApiGatewayV2::Route` with `RouteKey: 'move'` on
   the existing WS API; integrates the existing `oxo-ws-fn`. No new Lambda, no
   new grant. The synth-contract test (AC3.6) asserts this route key is present
   (§30 guard).

2. **Games schema add is schemaless:** `board`, `currentTurn`, `winner`,
   `version`, `moveCount` are attributes added to existing items by the move
   write and the extended join write. No DynamoDB table resource update. No GSI.
   Zero-downtime, additive.

3. **IAM — no widening:** `oxo-ws-fn` already has `GetItem` on `Games` and
   `UpdateItem` on `Games` + `ManageConnections` on this API ARN (s005 grant set).
   `move` needs none of these newly. S5 policy test pins the grant set as
   byte-for-byte unchanged.

4. **Hexagonal ports (OI-17):** UC1 domain function, UC2 Games store port, and
   the relay/transport port are all behind interfaces. The local adapter (UC5)
   implements them; the Lambda handler (UC3) wires the real adapters. This is the
   OI-17 hexagonal refactor commitment attached to this slice.

5. **Build-sha carriers (OI-25, principles/01):** SPA `window.OXO_CONFIG.buildSha`
   injected by deploy step (cicd wires it); `oxo-ws-fn` `BUILD_SHA` env structured
   log field on every invocation. Named here for cicd; no CDK resource change.
