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

## s005 additions (code GSI + join/register write path)
The `Games` table itself already exists from s004. s005 adds a GSI and a second
write principal (`oxo-ws-fn`). New checkable controls (become policy tests):
- [ ] A GSI `code-index` exists with partition key `code` (String); projection is
      minimal (KEYS_ONLY + the join-needed attrs `status`, `hostConnectionId`,
      `guestConnectionId`, or ALL — not wider than needed).
- [ ] `oxo-ws-fn` has, on the `Games` table/GSI ARNs ONLY:
      `dynamodb:Query`/`GetItem` scoped to include the `code-index` ARN, and
      `dynamodb:UpdateItem` on the table. No `Scan`, no `PutItem`, no
      `DeleteItem`, no `*` action.
- [ ] **No-hijack:** the join `UpdateItem` carries a `ConditionExpression`
      requiring `status = 'waiting'` AND `attribute_not_exists(guestConnectionId)`
      (or `= null`); the `status → active` flip is in the same atomic update.
- [ ] **No-hijack (register):** the register `UpdateItem` only sets
      `hostConnectionId` when it is currently null and `status='waiting'`
      (conditional). A bound host slot cannot be re-bound by a third party.
- [ ] The connectionId persisted for host/guest is taken from
      `event.requestContext.connectionId` (the caller's own connection), never
      from a client-supplied body field.
- [ ] Code-uniqueness: duplicate `code` across two `waiting` games is an
      **accepted, conditional-write-bounded** residual risk in s005 (a hard
      uniqueness guarantee is deferred). Documented, not an oversight — open risk
      for the gate.
