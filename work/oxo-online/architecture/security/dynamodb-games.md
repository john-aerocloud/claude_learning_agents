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
