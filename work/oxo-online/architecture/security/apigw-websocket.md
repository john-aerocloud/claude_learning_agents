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
