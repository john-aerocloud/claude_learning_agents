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
- [ ] **Residual risk (accepted/deferred):** because there is no per-game
      capability token in s005, anyone who learns a code before the host has
      registered could in principle register/join that game. This is bounded by:
      the code is high-entropy and short-lived (24h TTL), the host opens its WS
      and registers immediately on the waiting screen, and the conditional writes
      make the *first* binder win with no overwrite. A per-game join token minted
      by create-game (the target `apigw-http.md` control) is **deferred** and is
      an open risk for the gate.

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
- [x] **WAF rate rule attached (s005-h1-waf — risk partially closing).** A
      REGIONAL WAFv2 WebACL (rate-based rule 20/5-min/IP +
      `AWSManagedRulesAmazonIpReputationList`) is associated with the WS API
      `prod` stage, bounding connection volume per IP on top of the
      reserved-concurrency + stage-throttle floor. See
      `architecture/security/wafv2.md`.
- [ ] **Residual (still open for gate):** no `$connect` capability-token
      authorizer (s005-h2). WAF bounds connection *volume* per IP but does not
      *authenticate* — an attacker within the rate budget can still open
      connections. Per-game join-token authorizer remains the open control;
      rate thresholds are pre-launch placeholders. See `deltas/s005-h1-waf.md`
      §9 open risks.

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
