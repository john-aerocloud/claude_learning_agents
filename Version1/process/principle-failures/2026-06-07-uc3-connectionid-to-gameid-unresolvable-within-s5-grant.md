# Scope/§19 blocker — UC3 cannot resolve connectionId→gameId within the S5 grant

- Date: 2026-06-07
- Slice: oxo-online / s006-move-relay (iteration 9), Wave B / UC3 (ws-fn move route)
- Agent: engineer (solo on ws-fn seam)
- Class: designed-impossible / contradictory acceptance constraints surfaced at
  read-before-build (§12a), STOP-not-workaround (DEFECT-H2-001 class).

## The contradiction

UC3 must, on a `move`, derive the sender's role from the connectionId↔game
binding (S1) by matching `event.requestContext.connectionId` against THIS game's
`hostConnectionId`/`guestConnectionId`. To do that it must first obtain the
`gameId` for the sender's connectionId, then `GetItem` the Games item.

Four committed artefacts conflict on HOW gameId is obtained:

1. **S1 / security doc apigw-websocket.md:154-159** — role derived server-side
   from the connectionId↔game binding; **"The client body carries only
   `{ action:'move', square }`"** (line 159). So gameId is NOT client-supplied.
2. **S5 / security doc line 199-201** — `oxo-ws-fn`'s IAM policy is the s005
   grant set **verbatim**: `GetItem`/`Query` on Games (+ code-index GSI),
   conditional `UpdateItem` on Games, `Put`/`Delete` on Connections,
   `ManageConnections`. **No read on Connections.**
3. **data-flow.mmd:49** — draws the move read as `wsfn → games: GetItem read
   current board (already-granted read)`. It draws **no** `wsfn → conn` read edge
   for the move path.
4. **Reality of the data**: the connectionId→gameId binding lives ONLY in the
   `Connections` table (written server-side at `$connect`/register/join). The
   Games base table is keyed by `gameId`; the only Games index (`code-index`) is
   keyed by `code`. There is **no granted, indexed way** to go connectionId→gameId.

`GetItem(Games, gameId)` needs the key `gameId` — which the handler does not have
and cannot obtain without either reading Connections (NOT granted → S5 widening,
prod AccessDenied) or a new connection-keyed Games GSI (delta says no new GSI).

The only existing `findGameByConnection` impl is the UC5 local stand-up, which
scans a hardcoded `['g-1']` — impossible in cloud (no `Scan` grant, and only one
game in the local map).

## Why I stopped instead of choosing

Both viable resolutions require a decision owned outside my ws-fn seam:

- **Option A — read Connections (GetItem by connectionId → gameId).** Functionally
  correct and matches "connectionId↔game binding". BUT it adds
  `dynamodb:GetItem` on the Connections table ARN → **fails the S5 byte-for-byte
  policy test**, contradicts security-doc line 199-201, and needs a new
  `wsfn -.-> conn` read edge in data-flow.mmd. Owners: architect (S5 amend +
  security doc + model) and infra grant. This is the DEFECT-H2-001 mint-before-
  secret class if built against the unwidened role.

- **Option B — carry gameId in the move frame as a LOOKUP key (not a role key).**
  Handler does `GetItem(Games, gameId)` (already granted) then derives role by
  matching the REAL `event.requestContext.connectionId` against the stored
  host/guestConnectionId — a forged gameId resolves a game where the sender
  matches neither → reject (S1 still holds; AC3.4/AC6.6 satisfied). Needs NO IAM
  change, matches data-flow.mmd:49 exactly. BUT it contradicts security-doc
  line 159 ("client body carries only `{action,square}`"), the SPA `ClientFrame`
  type (socket.ts), and requires the **guest** (who joins by code and may not
  hold gameId client-side) to learn its gameId — a SPA/socket change owned by
  ENG-2. Cross-seam collision.

Choosing either silently would create hidden coupling (engineer.md §4) or a prod
AccessDenied (§30 code↔policy pin). Surfaced for orchestrator/architect ruling.

## Recommendation

Option B with one architect amendment: re-word security-doc line 159 to "the
client body carries `{ action:'move', square, gameId }` where `gameId` is a
non-trusted lookup key; ROLE is still derived server-side by matching the
connection's own id — never a client `role`/`player` field," and have ENG-2
surface gameId to the guest (the `game-ready` frame already fans out to the guest
and can carry gameId, or JoinScreen already learns gameId — confirm). This keeps
S5 byte-for-byte intact and matches the architect's own data-flow.mmd:49 read
edge. If the architect prefers Option A, S5 + security doc + data-flow.mmd + the
infra grant must be amended together in a security re-gate (new attack surface:
a Connections read on the move path).

No code or model was changed by this finding (read-before-build only).
