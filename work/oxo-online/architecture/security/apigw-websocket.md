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
- Move forgery / server-authoritative board controls (s006).
- `$disconnect` cleanup / "opponent disconnected" (s007).
- Chat scope (C7).

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
