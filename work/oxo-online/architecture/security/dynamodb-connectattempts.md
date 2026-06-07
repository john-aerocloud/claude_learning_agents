# Security controls — DynamoDB `ConnectAttempts` table

Introduced: slice s005-h2 (Chunk 4). Data class: **transient per-IP connect
counter** (no PII beyond a source IP held for ≤ 5 min). Backs the `$connect`
authorizer's best-effort per-IP budget — the per-IP control that WAFv2 cannot
provide for an API Gateway v2 (WebSocket) API.

## Why a separate note from `Games` / `Connections`
Distinct resource, distinct lifecycle (per-IP, 5-min TTL), distinct write
principal (`oxo-ws-auth-fn` only — NOT `oxo-ws-fn`, NOT `oxo-game-fn`). Its
single purpose is rate accounting; it never holds game state. Own checkable
controls.

## Checkable controls (s005-h2 — become policy tests)
- [ ] `AWS::DynamoDB::Table` with partition key `sourceIp` (String), **no sort
      key**.
- [ ] On-demand billing (`PAY_PER_REQUEST`).
- [ ] SSE enabled (`SSESpecification` present / AWS-owned key at minimum).
- [ ] TTL enabled on attribute `ttl`; the first write per IP sets `ttl` ~5 min
      ahead (epoch seconds) via a conditional set, giving a rolling window.
      Counters self-expire — storage cannot grow unboundedly.
- [ ] No resource policy granting `Principal: '*'` — no public/anonymous access.
      Reachable only from Lambda over the AWS network (DynamoDB is private by
      design; documented for completeness).
- [ ] Access is granted to the **`oxo-ws-auth-fn` execution role only**, scoped
      to this table's ARN: `dynamodb:UpdateItem` and `dynamodb:PutItem`. No
      `Scan`, no `GetItem` beyond what the increment needs, no `*` action, no
      second table on this statement.
- [ ] `oxo-ws-fn` and `oxo-game-fn` have **NO** access to this table.
- [ ] PITR is OFF — transient rate-accounting data; deliberate cost choice, not
      an oversight.

## Counter semantics & honest limitation
- [ ] The increment is `UpdateItem` with `ADD count :one` (atomic at the item
      level) plus a `ConditionExpression`/`if_not_exists` that sets the 5-min
      `ttl` only on first write in the window.
- [ ] The authorizer Denies when `count` exceeds the threshold (≈20/5-min).
- [ ] **Best-effort, not a hard guarantee (documented honestly):** (a) the ADD is
      read-less so there is an inherent race at the threshold boundary; (b) a
      determined attacker can rotate `sourceIp` to spread across keys. The
      control is a layered deterrent on top of the WS stage throttle (rate 20 /
      burst 40, account/stage-level) + `oxo-ws-fn`/authorizer reserved
      concurrency + `Connections` 2h TTL. It meaningfully raises the cost of a
      single-IP flood; it does not promise to stop a distributed one.

## Data classification
- [ ] Items hold only: `sourceIp` (transient, ≤5-min TTL), `count` (N), `ttl`
      (N). A source IP is weakly identifying but held briefly and solely for rate
      accounting; **no other PII**, no game linkage, no accounts.

## Open risks (carried)
- **OR-H2-a:** see `lambda-authorizer.md` — IP-cycling evasion; layered floor.

## Out of scope (do NOT assert as built)
- Distributed/global rate-limiting, IP reputation, or geo-blocking (the global
  CloudFront WebACL handles edge reputation for `/api/*`; the WS path is not
  fronted by CloudFront in this slice).
