# Security controls — API Gateway WebSocket (realtime moves + chat)

Introduced: Chunk 4 (chat reuses it at Chunk 7). NOT built before C4.
Data class: **ephemeral game/chat messages** (no PII beyond optional display
name from C6; no persistence).

## Threat: unauthenticated users / connection abuse
There is no account system. Access is controlled per-game, not per-user.

Checkable controls:
- [ ] WSS only (TLS); no plaintext WS.
- [ ] On `$connect`, the client must present a valid `gameId` + a per-game join
      token (capability token minted by the create/join HTTP call). A connection
      with no/invalid token is rejected at `$connect`.
- [ ] A connection is bound server-side to exactly one `gameId` and one player
      slot (X or O); it cannot act for the other slot.
- [ ] WAF / rate-based rule (via CloudFront) and an API Gateway throttle cap
      messages-per-connection-per-second to blunt flooding.
- [ ] Max two active player connections per game are accepted; additional
      connect attempts to a full game are rejected (no third-party injection).
- [ ] Connection records carry a DynamoDB TTL; stale/orphaned connections expire.

## Threat: move forgery / game-state tampering
- [ ] The server is authoritative: clients send only a proposed move
      `(gameId, cell)`; they never send board state.
- [ ] The Game service rejects a move if: it is not that player's turn, the cell
      is occupied/out of range, or the game is already over.
- [ ] Moves are idempotent on `(gameId, moveSeq)`; a replayed move is a no-op.
- [ ] Win/draw is computed server-side and is the only source of the result
      that reaches the leaderboard.

## Threat: chat scope leakage (C7)
- [ ] Chat messages are fanned out only to the two connections bound to that
      `gameId`; no cross-game delivery.
- [ ] Chat is not persisted; nothing survives game end / TTL expiry.
- [ ] Message size is capped (e.g. <= 500 chars) and output is treated as text
      (client renders escaped — no HTML injection).

---

## s005 subset (join / register only) — built scope

The target controls above describe C4–C7. The slice 005 WebSocket API is built
to a **narrower, explicitly-unauthenticated** scope. These are the checkable
statements that become policy tests for s005:

### Transport & API surface
- [ ] `AWS::ApiGatewayV2::Api` has `ProtocolType: WEBSOCKET` and
      `RouteSelectionExpression: '$request.body.action'`.
- [ ] WSS only (TLS 1.2+ enforced by API Gateway service). No plaintext WS.
- [ ] Exactly four route keys are synthesised: `$connect`, `$disconnect`,
      `register`, `join`. No `$default` catch-all that would accept arbitrary
      unrouted actions.
- [ ] A `prod` stage exists; the SPA connects directly to
      `wss://<api-id>.execute-api.<region>.amazonaws.com/prod` (NOT via
      CloudFront).

### Connection spoofing / replay — register binds connectionId to a game
The host's `register` message carries `{ action: 'register', gameId }`; the join
message carries `{ action: 'join', code }`. With no account system there is no
user identity, so binding is **capability-by-connection**:
- [ ] On `register`, the server writes `hostConnectionId = <the caller's own
      $connect connectionId>` (from `event.requestContext.connectionId`) — it
      MUST NOT trust any connectionId supplied in the message body.
- [ ] `register` only sets `hostConnectionId` on a game whose `hostConnectionId`
      is currently null AND `status='waiting'` (conditional write). A third party
      cannot re-register an already-bound host slot.
- [ ] On `join`, the server writes `guestConnectionId = <the caller's own
      connectionId>` and only if `guestConnectionId` is null and
      `status='waiting'` (conditional write — see no-hijack below).
- [x] **Residual PARTIALLY CLOSED (s005-h2):** the host now presents a per-game
      signed `wsToken` (HMAC, 60s) at `$connect`, so the host slot is gated by a
      capability the create-call minted — the target `apigw-http.md` join-token
      control. The conditional writes (below) remain the integrity backstop. What
      **remains open**: the **guest** still presents the `code` as its
      credential, so a holder of a valid `code` can open a WS before declaring
      intent to join (a `waiting`/`active` game). Bounded by the no-hijack
      conditional write (a code-holder still cannot overwrite a bound slot) and by
      the code's entropy + 24h TTL; **fully closed by identity (C6)**. Carried as
      OR-H2-b (guest code-as-credential pre-join).

### No-hijack conditional write (the core integrity control)
- [ ] The `join` handler's `UpdateItem` on `Games` uses a
      `ConditionExpression` requiring `status = 'waiting'` AND
      `attribute_not_exists(guestConnectionId)` (or `guestConnectionId = null`).
- [ ] On `ConditionalCheckFailedException` the handler does NOT write and closes
      the socket with 4041 ("no longer available") — a second joiner can never
      overwrite an existing `guestConnectionId` or flip an `active` game.
- [ ] `status` transition to `active` happens in the **same** conditional
      `UpdateItem` as the `guestConnectionId` set (atomic — no read-modify-write
      race window).

### Resource exhaustion on an unauthenticated WS endpoint (WAF deferred)
- [ ] `oxo-ws-fn` has `ReservedConcurrentExecutions` set to a small cap (bounds
      message-processing cost/blast radius).
- [ ] The `prod` stage sets default route throttling
      (`ThrottlingRateLimit` / `ThrottlingBurstLimit`) at a low hobby cap to blunt
      connect/message flooding.
- [ ] `Connections` items carry a 2h TTL so orphaned/abandoned connections from a
      flood self-expire (storage cannot grow unboundedly).
- [ ] **WAF NOT attached to the WS stage (platform constraint — GATE-AMEND-H1-A,
      2026-06-06).** A REGIONAL WAFv2 WebACL **cannot** associate with an API
      Gateway **v2** API; the planned WS-stage association was rejected at deploy
      (invalid-ARN at CREATE) and **removed** from s005-h1. The WS
      connection-flood control is therefore the **existing account/stage-level
      throttle** (rate 20 / burst 40) + reserved-concurrency cap + 2h
      `Connections` TTL — see the "Resource exhaustion" block above. This is an
      **interim** measure and is **not per-IP**. See `wafv2.md` and
      `deltas/s005-h1-waf.md` §0.
- [x] **CLOSED (s005-h2):** per-IP WS rate-limiting and the `$connect`
      capability-token check are now built as the `$connect` **REQUEST Lambda
      authorizer** (`oxo-ws-auth-fn`). The interim stage throttle (20/40) +
      reserved concurrency + `Connections` 2h TTL remain as the layered floor;
      the authorizer adds (a) capability gating (host HMAC `wsToken` / guest
      `code` lookup) so unauthenticated/garbage connects are Denied at `$connect`
      before any game-logic Lambda runs, and (b) a best-effort per-IP budget via
      the `ConnectAttempts` table. See `lambda-authorizer.md` and
      `dynamodb-connectattempts.md`. The per-IP control is **best-effort, not a
      hard guarantee** (authorizer cache disabled for accuracy, but the counter
      is read-less and IP-cycling can evade it) — honest limitation carried as
      OR-H2-a.

### Data classification
- [ ] Messages and stored fields contain **no PII**: `connectionId` (an
      AWS-generated opaque handle), `gameId` (UUID), `code` (server-generated
      token), `role` (`host`/`guest`). Display names are C6.
- [ ] `game-ready` payload carries only `{ type, role }` — no other player's
      connection details are disclosed to a client.

### Out of scope for s005 (do NOT assert as built)
- Move forgery / server-authoritative board controls (s006 — now built; see below).
- `$disconnect` cleanup / "opponent disconnected" (s007).
- Chat scope (C7).

---

## s006 subset (move relay + server-authoritative win/draw) — built scope

s006 adds ONE route (`move`) on the existing WS API to the existing `oxo-ws-fn`.
No new public surface, principal, table, API, region, or IAM grant. These
checkable statements become policy tests:

### Transport & route surface
- [ ] Exactly **five** route keys are synthesised: `$connect`, `$disconnect`,
      `register`, `join`, `move`. Still **no `$default`** catch-all — an unrouted
      `action` is dropped by the service, not handled.
- [ ] The `move` route integrates the **existing** `oxo-ws-fn` (AWS_PROXY) — no
      new function, no new authorizer; `move` is post-`$connect` (the connection
      is already authorized) and the `$connect` authorizer does NOT run per
      message.

### Move forgery — sender-is-a-player binding (the core integrity control)
With no account system, the sender's identity is its **own** `connectionId`
(`event.requestContext.connectionId`), set by the platform and unspoofable by the
client. **Identity is never read from the message body.**

The move body is `{ action:'move', gameId, square }` where **`gameId` is a
NON-TRUSTED LOOKUP KEY, not an identity/role claim** (amended 2026-06-07 — see
"Why client-supplied gameId is safe" below). It selects WHICH `Games` item to
read; it grants nothing.

- [ ] A `move` is accepted ONLY when `event.requestContext.connectionId` equals
      the `hostConnectionId` **or** `guestConnectionId` of the `Games` item named
      by the body `gameId`. A move whose REAL connectionId matches **neither**
      bound connection of that game (spectator, stale, wrong/forged `gameId`,
      other player's game) is rejected with **no write**.
- [ ] The sender's role (X=host / O=guest) is derived **server-side** by matching
      the connection's OWN `connectionId` against the stored
      `hostConnectionId`/`guestConnectionId` — **NEVER** from any client-supplied
      `role`/`player`/`connectionId`/`gameId` field. `gameId` only chooses the
      record to authorize against; it cannot elevate the sender into a role it
      does not hold by its connectionId.

**Why client-supplied `gameId` is safe here (the authorization invariant).**
A forged or guessed `gameId` only changes which `Games` item is fetched. The
fetched item still lists the two connectionIds that legitimately bound to it at
register/join. The handler authorizes by asking "is MY real connectionId one of
this game's two bound connections, and is it the one whose turn it is?" — a
question the client cannot influence. Outcomes of supplying a `gameId` the sender
is not part of:
  - non-existent `gameId` → `GetItem` miss → reject, no write;
  - a real game the sender is not in → connectionId matches neither bound slot →
    reject, no write;
  - the sender's OWN game → normal authorization (turn check etc.).
In every branch the **capability stays server-side**: identity is the platform
connectionId; the body never carries a credential. This is the s005 design rule
("never trust a body-supplied connectionId") applied to `gameId` — `gameId` is a
selector, not a credential. It introduces **no new trust boundary**: the trust
edge is still connectionId-vs-stored-binding, exactly as GATE-3-S006 approved.
- [ ] The move is accepted ONLY when the sender's derived role equals
      `currentTurn` (turn-order enforcement). Out-of-turn → `move-rejected` to the
      sender only, `Games` byte-unchanged.
- [ ] The target square must be empty (`board[square] == '-'`) and `square` in
      0..8; otherwise `move-rejected`, no write.

### State-transition integrity — enforced by conditional write, not just code
- [ ] No move is written when `status != 'active'`. This is enforced by the
      `UpdateItem` `ConditionExpression` (`status = 'active'` AND
      `currentTurn = senderRole` AND `version = :expected`) — **a code-side `if`
      is not sufficient on its own; the condition is the backstop**.
- [ ] Reaching a terminal state (`won`/`drawn`, with `winner` on a win) happens
      in the **same atomic `UpdateItem`** that applies the move — there is no
      window in which a move can land after game-over.
- [ ] Concurrent move writes are serialized by the `version` CAS
      (`version = :expected`, `SET version = version + 1`) — two near-simultaneous
      moves on the same free square yield exactly one accepted write and one
      `move-rejected`; no lost move, no double-fill.

### Relay amplification — bounded fan-out
- [ ] An accepted **non-terminal** move triggers **exactly 2** `@connections`
      POSTs (a `board-update` to `hostConnectionId` and `guestConnectionId` only).
- [ ] A **terminal** move triggers at most **4** POSTs (board-update + game-over
      to each), never a broadcast — the targets are the two bound connectionIds
      read from the `Games` item.
- [ ] A **rejected** move triggers **1** POST (`move-rejected` to the sender
      only) and **0** writes.
- [ ] A failed/`410 Gone` post to one connection is logged and does NOT block the
      post to the other; no per-post retry storm (best-effort relay — recovery is
      reconnect-replay in s007). `ManageConnections` is scoped to **this WS API
      ARN only** (unchanged from s005 — assert no widening).

### Data classification (unchanged class)
- [ ] `move`/`board-update`/`game-over` payloads carry **no PII**: `square`
      (0..8), `board` (9-char `X`/`O`/`-`), `currentTurn`/`role` (`X`/`O`),
      `result` (`X-wins`/`O-wins`/`draw`). No connection details of the opponent
      are disclosed to a client.

### No grant widening (assert the negative)
- [ ] `oxo-ws-fn`'s IAM policy is the s005 grant set verbatim — `move` adds zero
      permissions (`GetItem`/conditional `UpdateItem` on `Games` and
      `ManageConnections` on this API ARN were all already granted). No new
      action, no `*`.

### Out of scope for s006 (do NOT assert as built)
- `$disconnect` cleanup / GoneException-driven connection reaping (s007).
- Reconnect-after-reload / state replay (OI-10, s007).
- Leaderboard write on game-over (C5/s009).

---

## s006 security conclusion (gated review)

The move route turns the paired-but-inert board into a live, server-authoritative
game. The decisive controls are all **conditions on an existing write** or
**assertions that an existing grant was not widened** — the blast radius stays
inside the existing `oxo-ws-fn`/`Games` trust boundary.

**Is there new attack surface / data flow / trust boundary? A new DATA FLOW and a
sharpened TRUST RULE — YES; a new public surface, principal, table, API, region,
or IAM grant — NO; therefore this is NOT a §9a auto-accept and the gated
security review applies, but its blast radius is bounded to the existing
`oxo-ws-fn`/`Games` boundary and every new control is a condition on an existing
write or an assertion that an existing grant was not widened.**

**Carried open risks (accepted, named):**
- **OR-S006-a — version CAS reject vs retry:** a legitimate near-simultaneous
  move losing the `version` CAS is rejected (player re-clicks) rather than
  auto-retried beyond one re-read — protects the < 1s p95. Reversal: widen the
  bounded retry if rejects annoy users.
- **OR-S006-b — best-effort relay:** a dropped `@connections` push is not
  re-pushed this slice; the authoritative board in `Games` is always correct;
  recovery is reconnect-replay in s007.
- Inherited: OR-H2-b (guest code-as-credential pre-join, closed by C6),
  OI-10 (no reconnect, s007).

### s006 AMENDMENT 2026-06-07 — move frame carries non-trusted `gameId` (Option B)

The UC3 engineer surfaced (read-before-build) that the move handler must
`GetItem(Games, gameId)` to authorize, but the connectionId→gameId binding lives
only in `Connections`, which the move path is correctly NOT granted to read.
Ruling: the move frame carries `gameId` as a **non-trusted lookup key**
(`{ action:'move', gameId, square }`); authorization is unchanged — the handler
matches the REAL `event.requestContext.connectionId` against the fetched item's
stored host/guestConnectionId; a forged/foreign/non-existent `gameId` → reject,
no write.

**Security conclusion of the amendment (verbatim):** This amendment introduces
NO new attack surface, NO new data flow, and NO new trust boundary beyond what
GATE-3-S006 approved: the client now supplies a lookup KEY within the already-
approved move data flow, the IAM grant set (S5) is byte-for-byte unchanged (no
Connections read added), and the authorization edge is still the server-side
match of the platform-set connectionId against the stored binding — `gameId`
selects the record to authorize against and confers no capability; therefore
§9a-style auto-accept of the amendment applies (the architect re-affirms the
existing GATE-3-S006 acceptance) and no human re-gate is required.

---

## s005-h2 security conclusion (gated review)

The `$connect` Lambda authorizer (`oxo-ws-auth-fn`) is the gatekeeper that turns
the previously **unauthenticated** WebSocket endpoint into a capability-gated one.

**Closed by this slice:**
- **OI-2 (unauthenticated WS endpoint):** garbage / no-credential connects are
  Denied at `$connect` before any game-logic Lambda runs (host HMAC `wsToken`
  or guest `code` required). Verified by the §0 walking-skeleton probe and UC5.
- **h1 per-IP residual:** per-IP connect budget enforced in the authorizer via
  `ConnectAttempts` — the honest home for per-IP control on a v2 API that WAFv2
  cannot associate with.
- **Register slot residual (host half):** host slot now gated by a per-game
  signed token, not just a known `code`.

**New attack surface introduced & its controls:** one new principal
(`oxo-ws-auth-fn`) and one new table (`ConnectAttempts`). Both are scoped
exactly (see `lambda-authorizer.md`, `dynamodb-connectattempts.md`): the
authorizer can gate but cannot act on game state (no `ManageConnections`, no
`Games`/`Connections` write); the secret is encrypted at rest, read-scoped to
two roles, never in plaintext env or logs.

**Enumerated open risks (carried, accepted at Gate-2):**
- **OR-H2-a — best-effort per-IP:** read-less counter + IP-cycling means the
  per-IP budget is a layered deterrent, not a hard guarantee. Layered with the
  stage throttle (20/40) + reserved concurrency. Reversal: CloudFront-front the
  WS path → edge WAF per-IP.
- **OR-H2-b — guest code-as-credential pre-join:** a valid `code` holder can
  open a WS before declaring join intent. Bounded by the no-hijack conditional
  write; closed by identity (C6, future).
- **C6 (no user identity):** capability tokens prove "legitimate game context",
  not "specific user". Unchanged scope decision; not a regression.

**Conclusion:** the design is accepted for build. The two carried risks are
deliberate, bounded, and named (not missed). No new region, no new deploy-role
grant, no manual deploy step.
