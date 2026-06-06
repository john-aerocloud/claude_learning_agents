# Security controls — DynamoDB Games + Connections tables

Introduced: Chunk 4. Data class: **ephemeral game state + connection map**
(no PII except optional display name from C6).

Checkable controls:
- [ ] Encryption at rest enabled (AWS-owned or KMS key).
- [ ] TTL attribute set on both tables so finished/abandoned games and stale
      connections auto-delete (supports "chat does not persist after game end").
- [ ] Access only via the `oxo-game-fn` role; policy scoped to these table ARNs;
      no public access, no wildcard table ARNs.
- [ ] No internet-exposed endpoint; reached only from Lambda over the AWS
      network.
- [ ] Game item holds the authoritative board; clients have no write path to it
      except validated moves through the Game service.
- [ ] Point-in-time recovery is NOT required (ephemeral data) — documented as a
      deliberate cost choice, not an oversight.

## s004 subset (Games table only)
- [ ] Only the `Games` table is created in s004; `Connections` is deferred (s005).
- [ ] Partition key `gameId` (UUID); items written: `gameId`, `code`, `status`,
      `hostConnectionId`, `createdAt`, `ttl`.
- [ ] `ttl` set ~24h ahead on every created item; TTL enabled on the table.
- [ ] Access is `dynamodb:PutItem` via `oxo-game-fn` only; no `code` GSI yet
      (added in s005 with a collision check when lookup-by-code is introduced).
- [ ] No PII stored (display names are C6).
