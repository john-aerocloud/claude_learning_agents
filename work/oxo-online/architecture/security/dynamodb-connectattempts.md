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
- [ ] Access is granted to the **`oxo-ws-auth-fn` execution role**, scoped to
      this table's ARN: `dynamodb:UpdateItem`, `dynamodb:PutItem`, **and (s007a)
      `dynamodb:GetItem`** — the GetItem is ONLY the exemption check (see Runner
      exemption below), no `Scan`/`Query`, no `*` action, no second table on this
      statement. (s005-h2 read "no GetItem beyond what the increment needs"; that
      pin is AMENDED by s007a / DEFECT-S007-001 to permit exactly one GetItem
      against THIS table for the per-IP runner exemption — and nothing more.)
- [ ] **(s007a) Exemption write — deploy/runner role only.** The `oxo-deploy`
      OIDC role gains `ConnectExemptionWrite`: `dynamodb:PutItem` +
      `dynamodb:DeleteItem` on THIS table ARN, conditioned
      `dynamodb:LeadingKeys = ["EXEMPT#*"]` (writes ONLY the exemption namespace,
      never a counter item). No `UpdateItem`, no read, no `*`, no second table.
      `oxo-ws-fn`/`oxo-game-fn`/any human still have NO access to this table.
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

## Runner exemption (s007a — DEFECT-S007-001, become policy tests)
The IMP-008 human-directed runner exemption is continued one layer deeper, from
the WAF rate rule into THIS per-IP authorizer budget, using the same
transient-by-protocol self-cleaning pattern.
- [ ] **Item shape:** PK `sourceIp = "EXEMPT#<runnerIp>"` (reserved namespace,
      distinct from the counter key `<runnerIp>`); attribute `ttl = now + 3600`
      (1h, epoch seconds); **no `count`**. TTL-enabled on the shared `ttl` attr.
- [ ] **Writer = deploy/runner only.** Written by `oxo-deploy` via
      `scripts/waf-runner-ip.js` add (`PutItem`), removed by the `if:always()`
      remove step (`DeleteItem`) — the SAME principal/tool that mutates the WAF
      `oxo-test-runner-ips` set. Idempotent both ways. No human, no app principal.
- [ ] **Lazy-delete defence (DEFECT-H2-003 lesson — MUST hold):** the authorizer
      treats an item as exempt ONLY when `ttl > now`. An expired-but-unreaped
      exemption (`ttl <= now`, lazy deletion lingers ≤~48h) is NOT an exemption.
- [ ] **Post-threshold check (zero happy-path reads):** the exemption `GetItem`
      fires ONLY when the per-IP count has already reached the threshold (the
      would-be RATE_LIMIT Deny path). Under-budget connects (all prod traffic)
      incur NO extra read.
- [ ] **Never bypasses validation:** an exempt IP with a bad token/unknown code
      still Denies VALIDATION. Exemption only waives the RATE_LIMIT Deny.
- [ ] **Negative (THE control invariant — AC3.1-equivalent for this layer):** a
      **non-exempt** IP at/over threshold STILL Denies RATE_LIMIT (the exemption
      GetItem returns no live item → Deny stands). Attacker/prod behaviour at
      threshold is byte-for-byte unchanged. Fail-closed: a GetItem error → no
      exemption → Deny stands.
- [ ] **TTL backstop:** a runner crash that skips the remove step leaks the
      exemption for ≤1h (TTL); bounded to that one server-derived runner IP; the
      control is unaffected for every other IP.

## Open risks (carried)
- **OR-H2-a:** see `lambda-authorizer.md` — IP-cycling evasion; layered floor.
  UNCHANGED by s007a (the exemption parameterises one known IP; non-exempt IPs
  see identical behaviour).
- **OR-S007a-a:** exemption co-located in the counter table; write-isolation by
  `EXEMPT#*` LeadingKeys condition + distinct key shape, not a separate ARN.
- **OR-S007a-b:** ≤1h leaked exemption on a trap-skipping runner crash (TTL-bounded).

## Out of scope (do NOT assert as built)
- Distributed/global rate-limiting, IP reputation, or geo-blocking (the global
  CloudFront WebACL handles edge reputation for `/api/*`; the WS path is not
  fronted by CloudFront in this slice).
