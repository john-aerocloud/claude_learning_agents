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

## Out of scope for s005 (do NOT assert as built)
- `$disconnect` read/cleanup path and any `GetItem` on this table (s007).
