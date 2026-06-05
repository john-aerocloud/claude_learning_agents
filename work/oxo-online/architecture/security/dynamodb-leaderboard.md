# Security controls — DynamoDB Leaderboard table

Introduced: Chunk 5. Data class: **durable per-player W/D/L aggregates** +
user-supplied display name (C6). Display name is unverified, user-controlled.

## Threat: leaderboard spam / manipulation
Anonymous play means anyone can generate games; the risk is inflating one's own
record or polluting the board.

Checkable controls:
- [ ] Only the `oxo-board-fn` role can write; clients have no direct write path.
- [ ] A leaderboard update is accepted only from a **server-computed game-end
      event** (authoritative result), never from a client-asserted result.
- [ ] Writes are idempotent per `gameId` (a game can update the board at most
      once) so a result cannot be replayed to inflate counts.
- [ ] A game counts toward the leaderboard only if it had two distinct connected
      players (defends against self-play farming where feasible at this scope;
      documented limitation if not fully enforceable anonymously).
- [ ] Display names are length-capped and stored/rendered as escaped text (no
      HTML/script injection into the leaderboard view).
- [ ] Encryption at rest enabled; access scoped to this table ARN only.
- [ ] Point-in-time recovery enabled (this is the only durable data store).
