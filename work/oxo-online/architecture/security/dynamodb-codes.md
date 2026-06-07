# Security controls — DynamoDB `Codes` reservation table

Introduced: s005-h3 (delta 009, OI-3 close). Data class: **ephemeral, non-PII
code-uniqueness reservations** (low-value shareable tokens, same class as the
`code` already on `Games`).

Purpose: a write-time uniqueness GATE only. `code` is the PK so a conditional
`PutItem` `attribute_not_exists(code)` is a true single-item CAS — at most one
live reservation per code across all concurrent `oxo-game-fn` invocations. This
table is NEVER on the join/lookup read path (join resolves via `Games`
`code-index`); it is a single-purpose write-time guard.

Checkable controls (become policy tests):
- [ ] Encryption at rest enabled (AWS-owned key default; SSE).
- [ ] TTL attribute `ttl` enabled, set ~24h ahead on every reservation (matches
      `Games` TTL) — orphaned reservations self-delete (lazy deletion; an expired
      reservation may linger briefly, harmless since nothing reads `Codes`).
- [ ] Partition key is `code` (String); no sort key; no GSI.
- [ ] Access is `dynamodb:PutItem` via the `oxo-game-fn` role on this table ARN
      ONLY. Assert the NEGATIVES: NO `DeleteItem`, NO `GetItem`/`Query`/`Scan`/
      `UpdateItem`, NO GSI ARN, NO wildcard table/resource, no second principal.
- [ ] The reserve write's `ConditionExpression` is exactly
      `attribute_not_exists(code)` (source/synth pin) — uniqueness is enforced by
      the condition, not by code-side checking.
- [ ] No internet-exposed endpoint; reached only from `oxo-game-fn` over the AWS
      network.
- [ ] No PII stored (`code` server-generated token; `gameId` server-generated
      UUID kept for diagnosability only, read by no lookup path).
- [ ] Point-in-time recovery NOT required (ephemeral reservation data) —
      deliberate cost choice, consistent with `Games`, not an oversight.
- [ ] Reservation is NOT the authoritative join pointer — join authority stays on
      `Games`/`code-index`. `Codes` is a uniqueness gate only (single source of
      truth for lookups is preserved).
