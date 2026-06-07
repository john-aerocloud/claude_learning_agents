# Security controls — DynamoDB `Connections` table

Introduced: slice 005 (Chunk 4). Data class: **ephemeral connection map**
(no PII). Maps a WebSocket `connectionId` to a `gameId` and player `role`.

## Why a separate note from `Games`
`Connections` is a distinct resource with a distinct lifecycle (per-connection,
2h TTL) and a distinct write principal scope (`PutItem`/`DeleteItem`, no
conditional-integrity requirement). It gets its own checkable policy controls.

Checkable controls (s005 — become policy tests):
- [ ] `AWS::DynamoDB::Table` with partition key `connectionId` (String), no sort
      key.
- [ ] On-demand billing (`PAY_PER_REQUEST`).
- [ ] SSE enabled (`SSESpecification` present / AWS-owned key at minimum).
- [ ] TTL enabled on attribute `ttl`; every written item sets `ttl` ~2h ahead
      (epoch seconds). Orphaned/stale connections self-delete.
- [ ] No resource policy granting `Principal: '*'` — no public/anonymous access.
      The table is reachable only from Lambda over the AWS network (DynamoDB is
      private by design; document for completeness).
- [ ] Access is granted to the `oxo-ws-fn` execution role only, scoped to this
      table's ARN: `dynamodb:PutItem` and `dynamodb:DeleteItem`. (No `GetItem`
      needed in s005 — register/join only write; `$disconnect` lookup/cleanup is
      s007.) No `Scan`, no `*` action, no second table on this statement.
- [ ] PITR is OFF — ephemeral connection data; deliberate cost choice, not an
      oversight.

## Data classification
- [ ] Items hold only: `connectionId` (AWS opaque handle), `gameId` (UUID),
      `role` (`host`/`guest`), `ttl`. **No PII.** No display name (C6).

## s007 additions (`$disconnect` read + cleanup path)
s007 makes the `$disconnect` stub real. It reads this table to resolve the
disconnecting `connectionId → gameId`, then deletes the row. **ONE grant is added.**
New checkable controls (become policy tests):
- [ ] `oxo-ws-fn` gains **exactly** `dynamodb:GetItem` on the **`Connections`
      table ARN only** — added for the `$disconnect` path to resolve
      `connectionId → gameId/role`. **No** `Query`, **no** `Scan`, **no** second
      table, **no** `*`. This is the single permission change in s007.
- [ ] The `GetItem` reads the **disconnecting connection's OWN row** by primary key
      (`event.requestContext.connectionId`, platform-set) — it cannot enumerate or
      read other connections (no `Query`/`Scan`). No force-abandon path.
- [ ] The existing `DeleteItem` (s005) is used to remove the disconnecting row in
      all `$disconnect` branches; the 2h TTL remains the backstop. `DeleteItem`
      grant is **unchanged** (not widened).
- [ ] No new attribute, no new key, no GSI on `Connections` — schema unchanged.

## Out of scope for s005 (do NOT assert as built — now built in s007, see above)
- `$disconnect` read/cleanup path and any `GetItem` on this table (s007 — BUILT).
