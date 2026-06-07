# oxo-online — Support Runbook

Audience: on-call engineers and support team.
Last updated: slice s008-share-link (iteration 11, validated 2026-06-07).

---

## 1. Build identity — check this first

**Before any behavioural diagnosis, verify the deployed version of every
surface.** A version mismatch (stale SPA, stale Lambda, stale authorizer)
explains most unexpected behaviours without further investigation.

### SPA build SHA (primary identifier — check this first)

The SPA embeds the commit SHA at build time in `<meta name="build-sha">`.
This is the canonical version identity for the frontend from slice s006 onward.

```bash
# Read the build-sha meta tag from the live SPA index.html
curl -s https://d3pf3kcvzpau1x.cloudfront.net/ | grep -o 'build-sha" content="[^"]*"'
```

Expected output example:
```
build-sha" content="ecd8c37"
```

Compare the SHA against the expected deploy SHA (ledger `deploy` rows for
`oxo-online`, or the `KNOWN_DEPLOYED_SHA` constant in
`tests/smoke/slice006-move-relay.spec.ts`). A mismatch means the deploy has not
propagated — check the GitHub Actions run for the latest push to `main` and
wait for the CloudFront invalidation to complete.

If the content is `%VITE_BUILD_SHA%` (the unreplaced placeholder), the pipeline
did not inject the env var during build — check the `deploy-oxo-online.yml`
"Build SPA" step.

### SPA bundle hash (secondary — legacy form)

```bash
# Fetch the SPA's index.html and extract the hashed bundle filename.
curl -s https://d3pf3kcvzpau1x.cloudfront.net/ | grep -o 'assets/index-[^"]*\.js'
```

Compare the hash against the commit SHA recorded in the ledger
(`process/dora/ledger.csv`, `deploy` rows for `oxo-online`). If they do not
match, the last deploy has not propagated — check the GitHub Actions run for
the latest push to `main`.

### WebSocket URL in config.js

```bash
curl -s https://d3pf3kcvzpau1x.cloudfront.net/config.js
```

Expected output (exact URL depends on region/API ID):

```
window.OXO_CONFIG={"wsUrl":"wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com/prod"};
```

If `wsUrl` is empty or the file is missing, the join/host flows are broken.

### Lambda code state

```bash
# oxo-game-fn (create game)
aws lambda get-function --function-name oxo-game-fn \
  --query 'Configuration.{Runtime:Runtime,LastModified:LastModified,CodeSize:CodeSize}'

# oxo-ws-fn (WebSocket routes)
aws lambda get-function --function-name oxo-ws-fn \
  --query 'Configuration.{Runtime:Runtime,LastModified:LastModified,CodeSize:CodeSize}'

# oxo-ws-auth-fn ($connect authorizer — new in s005-h2)
aws lambda get-function --function-name oxo-ws-auth-fn \
  --query 'Configuration.{Runtime:Runtime,LastModified:LastModified,CodeSize:CodeSize}'
```

Cross-reference `LastModified` against the infra pipeline deploy time in the
ledger. The CodeSize of `oxo-ws-fn` increased in s006 (move handler added). If
the CodeSize is unchanged after a deploy that should include move-handler code,
the infra pipeline did not deploy the Lambda update — check the pipeline run.

### ws-fn build identity (oxo-ws-fn move + disconnect handler)

From s006 onward, `oxo-ws-fn` emits a `buildSha` field on every invocation
(including the move and disconnect routes). Check this before diagnosing any
move-path or disconnect-path issue:

```bash
# Fetch the most recent ws-fn log lines containing buildSha
aws logs filter-log-events \
  --log-group-name /aws/lambda/oxo-ws-fn \
  --filter-pattern '{ $.buildSha = "*" }' \
  --limit 5 \
  --query 'events[*].message'
```

The `buildSha` value must match the expected deploy SHA. If absent, the
deployed `oxo-ws-fn` is a pre-s006 build — the move and disconnect handlers
are not present.

**KNOWN GAP (F1 — open as of s007):** `oxo-ws-fn` logs `buildSha="unknown"`
on the disconnect route. The `BUILD_SHA` environment variable injection is
present on `oxo-game-fn` and `oxo-ws-auth-fn` but was not applied to
`oxo-ws-fn` at the s007 deploy. This means the `buildSha` filter above will
return `"unknown"` for ws-fn invocations — it does not indicate a missing
deploy. Use `LastModified` from `aws lambda get-function` (see §1 "Lambda code
state") and the infra pipeline run time as the version-identity check for
`oxo-ws-fn` until BUILD_SHA injection is added.

### Authorizer build identity (oxo-ws-auth-fn)

The authorizer emits a `buildSha` field on every Allow and Deny log line.
This is the **first** thing to check before any behavioural diagnosis of
connect-rejection issues.

```bash
# Fetch the most recent authorizer log lines containing buildSha
aws logs filter-log-events \
  --log-group-name /aws/lambda/oxo-ws-auth-fn \
  --filter-pattern '{ $.buildSha = "*" }' \
  --limit 5 \
  --query 'events[*].message'
```

The `buildSha` value must match the commit SHA for the expected deploy (see
ledger `deploy` rows for `oxo-online`). If it does not match, the authorizer
Lambda was not updated — check the infra pipeline run for the latest push to
`main`.

### Stack outputs (updated for s005-h2)

```bash
aws cloudformation describe-stacks --stack-name OxoGameProd \
  --query 'Stacks[0].Outputs'
```

Outputs present at slice s005-h2: `HttpApiEndpoint`, `LambdaFunctionName`,
`WsApiEndpoint`, `WsLambdaFunctionName`. The authorizer and ConnectAttempts
table are internal CDK-managed resources; they do not appear as named stack
outputs.

Verify the authorizer is attached to the $connect route:

```bash
aws apigatewayv2 get-authorizers \
  --api-id ylbzjuo8lf \
  --query 'Items[?Name==`oxo-ws-connect-authorizer`].{Type:AuthorizerType,Uri:AuthorizerUri}'
```

Expected: `AuthorizerType=REQUEST`, `AuthorizerUri` containing `oxo-ws-auth-fn/invocations`.

---

## 2. System map

```
Browser
  |
  +-- HTTPS --> WAFv2 ACL oxo-online-cf-global (us-east-1, CLOUDFRONT scope)
  |               | rate rule: 100 req/300s/IP -> HTTP 429
  |               | IP-reputation group       -> 403 (CF masks to 200+SPA; see §8)
  |               v
  |             CloudFront d3pf3kcvzpau1x
  |               |-- /             --> S3 (SPA bundle, index.html)
  |               |-- /config.js    --> S3 (window.OXO_CONFIG, no-cache)
  |               |-- /join/<code>  --> S3 (SPA fallback: CF 403/404→200+index.html)
  |               |                     React Router handles /join/:code client-side;
  |               |                     no new CloudFront behaviour added in s008.
  |               `-- /api/*        --> HTTP API (CachingDisabled)
  |                                     POST /api/games -> oxo-game-fn
  |                                       response: {gameId, code, wsToken}
  |
  `-- WSS direct (not via CloudFront, NO WAF)
        wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com/prod
          Stage throttle: rate=20/s burst=40 (account-level)
          $connect -> oxo-ws-auth-fn (REQUEST authorizer, cache TTL=0)
                        |-- host: verifies ?wsToken= (HMAC-SHA256, exp 60s)
                        |-- guest: verifies ?code= (DynamoDB GSI lookup)
                        |-- per-IP budget: oxo-connect-attempts table (~20/5min)
                        Allow -> oxo-ws-fn $connect handler
                        Deny  -> HTTP 403 upgrade (oxo-ws-fn NOT invoked)
          register   -> oxo-ws-fn
          join       -> oxo-ws-fn (extends Games item: board="---------", currentTurn="X", version=0, moveCount=0)
          move       -> oxo-ws-fn move-handler (server-authoritative; see move flow below)
          $disconnect -> oxo-ws-fn disconnect-handler (real; abandon+notify+clean; see disconnect flow below)
```

### Move flow (s006 — server-authoritative)

```
Browser A (current player)
  | WS frame: { action:'move', gameId, square }
  v
API Gateway route: 'move'
  v
oxo-ws-fn move-handler
  1. Parse square from body; reject malformed (move-rejected → sender, 0 writes)
  2. Read connectionId from event.requestContext (server-derived, never from client)
  3. GetItem(Connections, connectionId) → look up gameId
     GetItem(Games, gameId) → load board/currentTurn/version/status
  4. Derive senderRole: connectionId==hostConnectionId→X, guestConnectionId→O
     If neither: move-rejected → sender, 0 writes (S1 — wrong-game/spectator)
  5. applyMove(board, currentTurn, square, senderRole)
     If rejected (wrong turn, square taken, post-terminal): move-rejected → sender, 0 writes
  6. UpdateItem(Games, ConditionExpression: status=active AND currentTurn=senderRole
     AND version=expectedVersion)
     SET board/currentTurn/version+1/moveCount+1 [+ status/winner if terminal]
     If ConditionalCheckFailedException (version race): ≤1 re-read then move-rejected
  7. On success: PostToConnection(hostConnectionId, board-update) +
                 PostToConnection(guestConnectionId, board-update)  [2 POSTs]
     If terminal: also PostToConnection(host, game-over) +
                       PostToConnection(guest, game-over)           [+2 POSTs = 4 total]
  8. GoneException on any POST: logged (best-effort), other POST proceeds
     (no per-post retry; recovery deferred to s007)

Accepted move: 1 UpdateItem write + 2 POSTs (non-terminal) or 4 POSTs (terminal)
Rejected move: 0 writes + 1 POST (move-rejected to sender only)
```

### Disconnect flow (s007 — abandon + notify + clean)

```
API Gateway fires $disconnect event (tab close / network drop / idle 10-min timeout)
  v
oxo-ws-fn disconnect-handler
  1. GetItem(Connections, event.requestContext.connectionId)
     → resolve gameId + role (host or guest)
     If absent (TTL-reaped or never registered): log + skip to step 5
  2. GetItem(Games, gameId)
     → read status, hostConnectionId, guestConnectionId
     If absent (24h TTL-reaped): log + skip to step 5
  3. Conditional abandon:
     UpdateItem(Games, gameId, ConditionExpression: status = :active)
       SET status = :abandoned
     ConditionalCheckFailedException (status = won/drawn/waiting/abandoned already):
       swallow, no write, skip step 4 (do not notify)
  4. Notify survivor:
     PostToConnection(survivorConnectionId, { type: 'opponent-disconnected' })
     ONLY when step 3 committed (game was active → now abandoned)
     Exactly 1 POST (amplification bound = 1 — never broadcast)
     GoneException on POST: swallow + log (disconnect-notify posted:1 gone:1), 0 retries
  5. DeleteItem(Connections, connectionId)  [best-effort; TTL backstop if it fails]

Structured log emitted on every $disconnect:
  { evt: "disconnect-notify", gameId, posted: 0|1, gone: 0|1, buildSha }
  (posted=1 means opponent-disconnected was sent; gone=1 means GoneException swallowed)

Idle timeout path: APIGW closes a connection idle for ≥10 minutes, firing the
same $disconnect event → identical handler execution, same log shape.
```

<br>

**Exemption mechanism (CI runner — s007a):**

The authorizer per-IP budget (`oxo-connect-attempts` table) can be bypassed for
a known CI runner IP by writing a self-cleaning exemption item. The CI deploy
pipeline writes `PK=EXEMPT#<ip>` with `ttl=now+3600` (1h) into the
`oxo-connect-attempts` table before the test run and removes it on exit (via
`trap`). A 24h drain Lambda also reaps any EXEMPT# items that survive an
abnormal exit.

The exemption:
- Waives ONLY the per-IP rate Deny (count check). It NEVER bypasses token/code
  validation — the authorizer still requires a valid `?wsToken=` or `?code=`.
- Is fail-closed: if the GetItem for the exemption item itself throws, the
  authorizer proceeds as if no exemption exists.
- Is transient and self-cleaning: items expire within 1 hour via TTL; the drain
  Lambda removes them within 24 hours if TTL deletion is delayed.

### AWS resources

| Resource | Name / ID | Notes |
|----------|-----------|-------|
| CloudFront distribution | d3pf3kcvzpau1x | SPA + /api/* + /config.js |
| HTTP API (API Gateway) | via `OxoGameProd-HttpApiEndpoint` output | POST /api/games -> oxo-game-fn; response now includes wsToken |
| WebSocket API (API Gateway) | ylbzjuo8lf, stage: prod | 5 routes ($connect/register/join/move/$disconnect — all real from s007); direct WSS; no CloudFront proxy |
| Lambda — game | oxo-game-fn | Create-game handler; mints wsToken; DynamoDB PutItem on Games |
| Lambda — ws authorizer | oxo-ws-auth-fn | REQUEST authorizer on $connect; verifies wsToken/code; per-IP budget; structured logs with buildSha |
| Lambda — ws | oxo-ws-fn | connect/register/join/move/$disconnect; DynamoDB r/w Games+Connections; ManageConnections; GetItem Connections (disconnect path) |
| DynamoDB — games | oxo-games | PK: gameId; GSI: code-index (PK: code); 24h TTL; SSE enabled; on-demand. Active-game items carry: board (9-char string), currentTurn (X\|O), version (N, CAS), moveCount (N), winner (X\|O, terminal only), status (waiting\|active\|won\|drawn\|abandoned) |
| DynamoDB — connections | oxo-connections | PK: connectionId; 2h TTL; SSE enabled; on-demand |
| DynamoDB — connect attempts | oxo-connect-attempts | PK: sourceIp; count (N); ttl (~5min TTL); SSE enabled; on-demand; used by authorizer for per-IP budget |
| WAFv2 WebACL — global | oxo-online-cf-global (us-east-1) | CLOUDFRONT scope; associated to d3pf3kcvzpau1x; rate rule 100/300s/IP with NOT(oxo-test-runner-ips) scope-down (Block=429); IP-rep managed group |
| WAFv2 IP set — runner | oxo-test-runner-ips (us-east-1) | CLOUDFRONT scope; entries written/removed per CI run (1h TTL + drain Lambda); waives only the rate Deny for runner IP |
| Lambda — exemption drain | (CDK-managed, not a named output) | Periodically reaps any EXEMPT#* items from oxo-connect-attempts that were not cleaned up by the runner trap |
| CloudFormation stacks | OxoOnlineOidcStack, OxoOnlineWafUsEast1, OxoGameProd, OxoOnlineProd | Deploy order: WafUsEast1 -> OxoGameProd -> OxoOnlineProd |
| S3 bucket | see `WebBucketName` GH var | Versioning on; SPA + config.js |
| Log group — game fn | /aws/lambda/oxo-game-fn | No structured categories yet (OI-18) |
| Log group — ws authorizer | /aws/lambda/oxo-ws-auth-fn | Structured JSON; buildSha on every Allow/Deny; see §4a |
| Log group — ws fn | /aws/lambda/oxo-ws-fn | Structured JSON events (see §4) |

### Pipelines

| Pipeline | Triggers on | Deploys |
|----------|-------------|---------|
| infra-oxo-online.yml | `src/infra/**` or `src/lambda/**` push to main | CDK OxoGameProd -> OxoOnlineProd; ALL lambda code via CDK fromAsset; writes config.js |
| deploy-oxo-online.yml | `src/app/**` push to main | SPA to S3; CF invalidation (waits); writes config.js |
| Manual (once) | n/a | `make -C work/oxo-online/src/infra deploy-oidc` deploys OxoOnlineOidcStack |

Lambda code is owned **exclusively** by the infra pipeline (CDK fromAsset).
The deploy pipeline does not touch Lambda code (OI-24 resolved).

---

## 3. Verification commands

```bash
# join-skeleton probe — operator's health check for the share-link deep-link path (s008+)
# Opens /join/<real-code> in a fresh tab; SPA must boot (HTTP 200) with code pre-filled.
# No new infra: relies on the existing CloudFront 403/404→index.html SPA fallback.
make join-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net

# disconnect-skeleton probe — operator's health check for the disconnect path (s007+)
# Closes one browser tab; surviving browser must show "Your opponent disconnected."
# and return to the mode selector. Run this to confirm the $disconnect handler is live.
make disconnect-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net

# move-skeleton probe — operator's health check for the complete game loop (s006+)
# Drives ONE real move through the full deployed path in two real browsers (Playwright).
# Run this FIRST to confirm the move route is live before investigating further.
# Requires SPA deployed with move feature enabled and move route live in OxoGameProd.
make move-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net

# Smoke suite (runs against live CloudFront URL)
make -C work/oxo-online smoke

# Validation suite (18 tests; requires AWS credentials + live stack)
make -C work/oxo-online validate

# WAF ACL — confirm global ACL is present and has expected ARN
aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 \
  --query 'WebACLs[?Name==`oxo-online-cf-global`].{Name:Name,ARN:ARN}'

# WAF ACL — confirm associated to CloudFront distribution
aws cloudfront get-distribution-config --id E519HYABC57ZX \
  --query 'DistributionConfig.WebACLId'

# WAF build identity — tags must show Project=oxo-online, Env=prod, ManagedBy=cdk
aws wafv2 list-tags-for-resource \
  --resource-arn "$(aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 \
    --query 'WebACLs[?Name==`oxo-online-cf-global`].ARN' --output text)" \
  --region us-east-1

# Confirm move route exists on the WS API (s006+ — must be present)
aws apigatewayv2 get-routes \
  --api-id ylbzjuo8lf \
  --query 'Items[?RouteKey==`move`].{RouteKey:RouteKey,RouteId:RouteId}'

# Lambda reserved concurrency (must be 15 for oxo-ws-fn)
aws lambda get-function-concurrency --function-name oxo-ws-fn

# DynamoDB table details
aws dynamodb describe-table --table-name oxo-games \
  --query 'Table.{BillingMode:BillingModeSummary.BillingMode,SSEStatus:SSEDescription.Status,ItemCount:ItemCount}'

aws dynamodb describe-table --table-name oxo-connections \
  --query 'Table.{BillingMode:BillingModeSummary.BillingMode,SSEStatus:SSEDescription.Status,ItemCount:ItemCount}'

# Connect-attempts table (per-IP budget — new in s005-h2)
aws dynamodb describe-table --table-name oxo-connect-attempts \
  --query 'Table.{BillingMode:BillingModeSummary.BillingMode,SSEStatus:SSEDescription.Status,ItemCount:ItemCount}'

# Confirm TTL is enabled on the connect-attempts table
aws dynamodb describe-time-to-live --table-name oxo-connect-attempts \
  --query 'TimeToLiveDescription.{Status:TimeToLiveStatus,Attribute:AttributeName}'

# Check for lingering EXEMPT# items in oxo-connect-attempts (should be absent outside CI runs)
# A present item with ttl in the past is harmless (will be lazily deleted); a present item
# with ttl in the future means a CI run is active or the trap did not clean up.
aws dynamodb query \
  --table-name oxo-connect-attempts \
  --key-condition-expression "begins_with(sourceIp, :exempt)" \
  --expression-attribute-values '{":exempt":{"S":"EXEMPT#"}}' \
  --query 'Items[*].{sourceIp:sourceIp.S,ttl:ttl.N}'

# Confirm $disconnect route exists on the WS API (s007+ — must be present and real, not stub)
aws apigatewayv2 get-routes \
  --api-id ylbzjuo8lf \
  --query 'Items[?RouteKey==`$disconnect`].{RouteKey:RouteKey,RouteId:RouteId,Target:Target}'
```

Validation run results are recorded in `process/dora/ledger.csv`
(`validation_run` event rows). Check recent rows to confirm the latest suite
was green.

---

## 4a. Structured log events — oxo-ws-auth-fn ($connect authorizer)

Log group: `/aws/lambda/oxo-ws-auth-fn`

Every Allow and Deny decision emits a structured JSON log line. **Always check
`buildSha` first** — a version mismatch explains any unexpected authorizer
behaviour before any other diagnosis is attempted.

### Log fields on every decision line

| Field | Example | Notes |
|-------|---------|-------|
| `buildSha` | `40b7767fc7ca1f3212ba583b23451ba703c38076` | Build identity; check this first |
| `effect` | `Allow` or `Deny` | The authorizer decision |
| `category` | `internal` / `external` / `data-validation` | Whose problem |
| `reason` | see table below | Specific deny reason |

### Deny reasons — what they mean and whose problem

| `reason` value | `category` | Whose problem | Meaning | First response |
|----------------|------------|---------------|---------|----------------|
| `no-credential` | `data-validation` | Caller | Connect had no `?wsToken` or `?code` parameter | Caller error; SPA bug or unauthenticated probe. Check SPA code if widespread. |
| `bad-signature` | `data-validation` | Caller | `wsToken` present but HMAC does not verify (tampered, wrong key, or expired differently) | Caller error or token corruption. If wsToken is fresh from POST /api/games, check secret is same between game-fn and auth-fn. |
| `code-not-found` | `data-validation` | Caller | Guest `?code=` did not match any active game in Games GSI | Caller supplied unknown/expired/mistyped code. Check if game TTL expired (24h). |
| `rate-limit-exceeded` | `external` | Per-IP budget (self-heals) | sourceIp exceeded ~20 connects in 5-min window; oxo-connect-attempts count >= threshold | Not a code defect. See §6 "User blocked at WebSocket connect" playbook. Window self-heals after TTL expiry (~5 min). Do NOT manually delete items unless count is corrupt. |

### 5xx in authorizer

If the authorizer itself throws (Lambda error, DynamoDB unavailable, etc.),
API Gateway treats the `$connect` as rejected with HTTP 500, and oxo-ws-fn is
NOT invoked. This is **our code or dependency problem** — raise a defect task.
Check `/aws/lambda/oxo-ws-auth-fn` logs for Node.js stack traces.

### CloudWatch Logs Insights — authorizer denies (last 1 hour)

```
fields @timestamp, buildSha, effect, category, reason
| filter effect = "Deny"
| sort @timestamp desc
| limit 50
```

Run against log group `/aws/lambda/oxo-ws-auth-fn`.

### CloudWatch Logs Insights — authorizer allows (spot-check)

```
fields @timestamp, buildSha, effect
| filter effect = "Allow"
| sort @timestamp desc
| limit 20
```

---

## 4. Structured log events — oxo-ws-fn

Log group: `/aws/lambda/oxo-ws-fn`

The WS handler emits structured JSON on warning and error paths. **Every
invocation emits a `buildSha` field** — check this before any move-path or
disconnect-path diagnosis (see §1). Normal happy paths emit only Lambda platform
`START`/`END`/`REPORT` lines plus the buildSha line.

**NOTE:** As of s007, `oxo-ws-fn` logs `buildSha="unknown"` on all routes
including disconnect. This is a known gap (F1). Use `LastModified` from
`aws lambda get-function` for version-identity checks on this function.

### §5a failure classification (move path)

| Failure category | `category` log value | Whose problem | First response |
|-----------------|---------------------|---------------|----------------|
| Inbound: malformed square / wrong turn / square taken / post-terminal | `data` (4xx-class) | Caller (SPA bug or probe) | Check SPA version (§1). If widespread: SPA defect or replay attack. |
| Wrong-game connection (connectionId not bound to this game) | `data` (4xx-class) | Caller | Probe or SPA sending to wrong game. No state change occurred. |
| Version CAS race (ConditionalCheckFailedException after re-read) | `data` (4xx-class) | Caller — concurrent move; legitimate contention | Player re-clicks; self-healing. If frequent: concurrent move volume. |
| DynamoDB 5xx / throttle (SDK backoff exhausted) | `external-dependency` | AWS dependency | Check AWS Health Dashboard. DynamoDB on-demand; throttle rare at this scale. |
| DynamoDB 4xx on our UpdateItem (bad request) | `internal-service` | Our code defect | Raise defect task. Check the UpdateItem call shape in oxo-ws-fn. |
| Relay GoneException (PostToConnection fails — connection already closed) | `external` / `availability` | Connection dropped (not our defect) | Benign race; the other connection still receives its POST. No action unless frequent. |
| Lambda-level exception (unhandled throw) | `internal` | Our code defect | Check CloudWatch logs for Node.js stack trace; raise defect task. |

### §5b failure classification (disconnect path — s007)

| Failure category | `category` log value | Whose problem | First response |
|-----------------|---------------------|---------------|----------------|
| Connections GetItem: row absent (TTL-reaped or never registered) | (info — no log event, returns early) | Expected; not a defect | No action. 2h TTL is the backstop. |
| Games GetItem: row absent (24h-TTL-reaped) | (info — no log event, returns early) | Expected; not a defect | No action. |
| Conditional abandon: ConditionalCheckFailedException (non-active game) | (info — swallowed; no notify sent) | Expected for terminal/already-abandoned games | No action. F3 (finished games unaffected) is working. |
| Survivor PostToConnection: GoneException (410) | logged as `disconnect-notify` with `gone:1` | Connection already closed; not our defect | Benign. Both players gone. `posted` field confirms 0 retries. |
| DeleteItem(Connections) failure | `external-dependency` | DynamoDB dependency | The 2h TTL will reap the stale row. Check AWS Health. |
| Lambda-level exception (unhandled throw) | `internal` | Our code defect | Check CloudWatch logs for Node.js stack trace; raise defect task. |

### Structured log event table

| `event` value | Severity | `category` | `subcategory` | Meaning | Whose problem |
|---------------|----------|------------|---------------|---------|---------------|
| `register_rejected` | WARN | `internal` | — | Host tried to register but slot already bound | Our logic / client retry; not a bug if rare |
| `register_failed` | ERROR | `external` | — | DynamoDB call failed after SDK retries; oxo-ws-fn could not write Connections | Dependency (DynamoDB) or IAM; check AWS Health |
| `join_host_gone` | WARN | `external` | `availability` | Guest joined but host WS connection had vanished (GoneException); guest gets 4041 | Host disconnected before join; not our code defect |
| `ws_error_frame_post_failed` | WARN | `external` | — | Could not POST error frame to client (already gone); DELETE still attempted | Connection already closed; benign race |
| `move_rejected` | WARN | `data` | — | Move rejected by server (wrong turn / square taken / post-terminal / wrong-game) | Caller (4xx-class — no state change occurred) |
| `move_relay_gone` | WARN | `external` | `availability` | GoneException on a relay PostToConnection; other connection still notified | Connection dropped; best-effort relay; not a defect |
| `move_store_failed` | ERROR | `external-dependency` | — | UpdateItem on Games failed after SDK retries (DDB 5xx/throttle) | Dependency; check AWS Health |
| `disconnect-notify` | INFO | — | — | Structured log emitted on every $disconnect. Fields: `gameId`, `posted` (0 or 1 — whether opponent-disconnected was sent), `gone` (0 or 1 — whether GoneException was swallowed), `buildSha` (currently "unknown" — see §1 F1 caveat). `posted:1 gone:0` = survivor notified clean. `posted:1 gone:1` = both connections gone. `posted:0` = game was not active (terminal/waiting/abandoned). | Expected at info level on every disconnect; not an error |

**oxo-game-fn has no categorised logging yet** (OI-18 open). Its log group
(`/aws/lambda/oxo-game-fn`) contains only Lambda platform lines plus any
unhandled Node.js exceptions. If POST /api/games returns 5xx, check those
logs for unhandled throws; there is no `category` field to filter on.

### CloudWatch Logs Insights query for WS errors (last 1 hour)

```
fields @timestamp, event, category, subcategory, closeCode
| filter ispresent(event)
| sort @timestamp desc
| limit 50
```

Run against log group `/aws/lambda/oxo-ws-fn`.

### CloudWatch Logs Insights query for disconnect events (last 1 hour)

```
fields @timestamp, gameId, posted, gone, buildSha
| filter evt = "disconnect-notify"
| sort @timestamp desc
| limit 50
```

Run against log group `/aws/lambda/oxo-ws-fn`.

To confirm amplification bound (OI-35 S4 pin — exactly 1 notify per active disconnect):
```
fields @timestamp, gameId, posted
| filter evt = "disconnect-notify" and posted = 1
| stats count() as notifyCount by gameId
| filter notifyCount > 1
```

If this query returns any rows, a game received more than one opponent-disconnected
post — raise a defect task immediately.

---

## 5. Error contract (what clients see)

### HTTP (POST /api/games)

| Status | Meaning |
|--------|---------|
| 201 | Game created; body `{gameId, code, wsToken}` (wsToken may be absent if the signing secret is temporarily unavailable — game creation does not fail in this case; the SPA cannot connect as host until wsToken is present) |
| 5xx | Lambda fault; check oxo-game-fn logs |

### WebSocket

Errors are delivered as a **MESSAGE frame** (not a WS close frame — API
Gateway cannot send custom close codes from Lambda responses) followed by a
server-side DELETE of the connection. The frame shape is:

```json
{ "type": "error", "code": 4040|4041|4500, "message": "<human text>" }
```

| `code` | Human message | Trigger |
|--------|---------------|---------|
| 4040 | "Game not found. Check the code and try again." | Unknown join code (GSI miss) |
| 4041 | "This game is no longer available." | Game already active/full (ConditionalCheckFailedException) or host connection gone (GoneException) |
| 4500 | "Something went wrong. Please try again." | Unhandled server error |

---

## 6. First-response playbook per symptom

### Opponent disconnect not shown to survivor (s007+)

A player reports the board froze and they never saw "Your opponent disconnected."

1. **Run the disconnect-skeleton probe** — this is the first-response health
   check for the disconnect path:
   ```bash
   make disconnect-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
   ```
   If the probe fails, the $disconnect handler or SPA is not working correctly.
   Proceed to step 2.

2. **Check ws-fn build identity** (§1 — note `buildSha="unknown"` is expected;
   use `LastModified` to confirm the s007 handler is deployed):
   ```bash
   aws lambda get-function --function-name oxo-ws-fn \
     --query 'Configuration.{LastModified:LastModified,CodeSize:CodeSize}'
   ```
   Compare `LastModified` against the infra pipeline deploy time for s007.

3. **Check for disconnect-notify log events** for the game in question:
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/lambda/oxo-ws-fn \
     --filter-pattern '{ $.evt = "disconnect-notify" }' \
     --limit 20 \
     --query 'events[*].message'
   ```
   - `posted:1 gone:0` — handler ran and notified the survivor. Issue is in
     the SPA (survivor's browser did not render the message). Check SPA build SHA.
   - `posted:1 gone:1` — handler ran, survivor was already gone too. Both
     players lost connection simultaneously. Normal.
   - `posted:0` — game was already in a terminal state at disconnect time
     (won/drawn/abandoned). If the game should have been active, check the
     Games item directly:
     ```bash
     aws dynamodb get-item \
       --table-name oxo-games \
       --key '{"gameId":{"S":"<GAME_ID>"}}'
     ```
   - No log line found — $disconnect event may not have fired (player tab closed
     abruptly without graceful WS close). The 10-minute APIGW idle timeout will
     eventually fire $disconnect. The 2h Connections TTL is the ultimate backstop.

4. **Confirm the $disconnect route is wired** to oxo-ws-fn (not a stub):
   ```bash
   aws apigatewayv2 get-routes \
     --api-id ylbzjuo8lf \
     --query 'Items[?RouteKey==`$disconnect`]'
   ```

### Players cannot pair (both reach board together — F1/SM1 broken)

1. Check `config.js` is served and contains a non-empty `wsUrl`:
   ```bash
   curl -s https://d3pf3kcvzpau1x.cloudfront.net/config.js
   ```
2. Check the CloudFront CSP response header includes `wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com`:
   ```bash
   curl -sI https://d3pf3kcvzpau1x.cloudfront.net/ | grep -i content-security-policy
   ```
   The `connect-src` directive must include the WSS URL. If absent, the
   browser blocks the WebSocket silently.
3. Check `/aws/lambda/oxo-ws-fn` logs for `register_failed` events. If
   present with `category: external`, this is a DynamoDB or IAM issue — check
   AWS Health Dashboard and verify the oxo-ws-fn execution role grants
   `dynamodb:PutItem` on the Connections table.
4. Check `/aws/lambda/oxo-ws-fn` logs for `AccessDenied` class errors. These
   indicate IAM drift — compare the current role policy against the security
   notes in `work/oxo-online/architecture/security/lambda-execution-roles.md`.

### "Game not found" complaints (manual code or share link)

Most likely causes (in order):
1. Stale share link. The game code in the URL path refers to a game that has
   ended or expired. Ask the host to create a new game and share a fresh link.
   The error message in both the share-link and manual-join flows is the same:
   "Game not found. Check the code and try again."
2. Typographical error in a manually entered code. Codes are 6 characters,
   uppercase letters and digits, no O/0/1/I/L. Ask the user to try again.
3. Game TTL expired (24-hour limit). Host must create a new game.
4. Game was already joined by someone else (code reuse is an accepted risk in
   s005 — see OI open items).

**Deep-link SPA boot failure (share link opens blank page / 404):**
The `/join/<code>` URL relies on the CloudFront SPA fallback (CustomErrorResponse
403/404→200+index.html). If this fallback is absent or misconfigured, the deep
link returns a raw S3 404. Verify:
```bash
aws cloudfront get-distribution-config --id E519HYABC57ZX \
  --query 'DistributionConfig.CustomErrorResponses'
```
Expected: two entries mapping `ErrorCode` 403 and 404 to `ResponseCode` 200,
`ResponsePagePath` `/index.html`. If absent, the infra pipeline (`OxoOnlineProd`
CDK) was not deployed. Re-run the infra pipeline; no new resource is needed —
these error responses have been present since initial SPA deploy.

Run the join-skeleton probe to confirm the fallback is live:
```bash
make join-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
```

Check DynamoDB directly if needed:
```bash
aws dynamodb query \
  --table-name oxo-games \
  --index-name code-index \
  --key-condition-expression "#c = :code" \
  --expression-attribute-names '{"#c":"code"}' \
  --expression-attribute-values '{":code":{"S":"<CODE>"}}'
```

### Moves not relaying / board not updating for opponent

Players are paired and see the board, but clicking squares has no effect on
the opponent's board:

1. **Check build identity first (§1).** Read the SPA `<meta name="build-sha">`
   and compare to the expected deploy SHA. A stale SPA (pre-s006) does not send
   `action:'move'` WS frames. Ask the user to hard-refresh if mismatched.

2. **Run the move-skeleton probe.** This drives one real move through the full
   deployed path in two real browsers — it is the operator's health check for
   the complete game loop:
   ```bash
   make move-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
   ```
   If the probe fails but pairing succeeds, the move route or ws-fn is at fault
   (not the $connect/authorizer path).

3. **Check for `move_rejected` or `move_store_failed` in ws-fn logs:**
   ```
   fields @timestamp, buildSha, event, category
   | filter ispresent(event) and (event = "move_rejected" or event = "move_store_failed")
   | sort @timestamp desc
   | limit 50
   ```
   Run against `/aws/lambda/oxo-ws-fn`.
   - `move_rejected` with `category=data` is expected for wrong-turn or
     post-game-over attempts; not a defect.
   - `move_store_failed` with `category=external-dependency` indicates a DynamoDB
     availability problem — check AWS Health Dashboard.

4. **Confirm the `move` route key exists on the WS API:**
   ```bash
   aws apigatewayv2 get-routes \
     --api-id ylbzjuo8lf \
     --query 'Items[?RouteKey==`move`]'
   ```
   If the `move` route is absent, the infra pipeline did not deploy the s006
   CDK change. Re-run the infra pipeline.

5. **Check the Games item schema.** An active game post-join must have
   `board`, `currentTurn`, `version`, `moveCount` fields (set by the join
   conditional write). If these are absent the first move will be rejected:
   ```bash
   aws dynamodb get-item \
     --table-name oxo-games \
     --key '{"gameId":{"S":"<GAME_ID>"}}'
   ```
   Expected fields: `status=active`, `board="---------"` (or updated), `version`
   (N), `moveCount` (N), `currentTurn` (X or O).

### Move rejected unexpectedly (player on correct turn, square free)

1. Check the Games item `currentTurn` and `version` fields directly (see DynamoDB
   query above). A version CAS race is benign — the player re-clicks. If the
   `currentTurn` does not match what both screens show, there may be a relay
   divergence — check `move_relay_gone` log events (relay failure on one side).
2. If `status=won` or `status=drawn` and both clients show an active game,
   the `game-over` message was not received by one browser (relay GoneException
   at game end). The authoritative state is in DynamoDB; the board display is
   stale. The affected player must reload and start a new game (no reconnect until
   s007).

### Stale-page / wrong-bundle behaviour

To check whether the browser has an old bundle, use the primary identity check
from §1:

```bash
# Primary: read build-sha meta tag
curl -s https://d3pf3kcvzpau1x.cloudfront.net/ | grep -o 'build-sha" content="[^"]*"'

# Secondary: hashed bundle filename
curl -s https://d3pf3kcvzpau1x.cloudfront.net/ | grep -o 'assets/index-[^"]*\.js'

# Check if CloudFront has a pending invalidation
aws cloudfront list-invalidations \
  --distribution-id d3pf3kcvzpau1x \
  --query 'InvalidationList.Items[0]'
```

If a deploy ran recently and the build-sha or bundle hash has not changed on
CloudFront, the CF invalidation may still be propagating (the pipeline waits
for completion, but propagation can take a few minutes globally). Ask the user
to hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).

### Client receives HTTP 429 from POST /api/games

The CloudFront WAF rate rule (100 req/300s per source IP) is firing. This is
intentional behaviour, not a defect.

1. The 429 status is returned by WAFv2 — Lambda is NOT invoked. The response
   body is the WAF custom block body, not a JSON API response.
2. The rate window is 300 seconds (5 minutes). After the window expires, the
   client's IP is automatically unblocked. No manual action is needed.
3. If a legitimate client is being blocked (false positive), verify via WAF
   sampled-requests:
   ```bash
   aws wafv2 get-sampled-requests \
     --web-acl-arn "$(aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 \
       --query 'WebACLs[?Name==`oxo-online-cf-global`].ARN' --output text)" \
     --rule-metric-name oxo-cf-rate-limit \
     --scope CLOUDFRONT \
     --time-window StartTime=$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ),EndTime=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
     --max-items 100 \
     --region us-east-1
   ```
4. To raise the threshold temporarily (first response before full rollback):
   push a CDK change to increase the rate rule limit in `waf-us-east-1-stack.ts`
   and redeploy the WAF stack. Full disassociation is the nuclear rollback (see §8).

### SPA HTML returned instead of API JSON

If a POST to `/api/games` (or any `/api/*` path) returns HTTP 200 with an HTML
body instead of a JSON API response, the likely cause is the WAF
IP-reputation managed-rule-group blocking the request. CloudFront's
`CustomErrorResponses` maps 403 to 200+SPA index.html — this masks reputation
blocks at the HTTP level.

1. Check WAF sampled-requests for BLOCK actions from the `AWSManagedRulesAmazonIpReputationList` rule:
   ```bash
   aws wafv2 get-sampled-requests \
     --web-acl-arn "$(aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 \
       --query 'WebACLs[?Name==`oxo-online-cf-global`].ARN' --output text)" \
     --rule-metric-name AWSManagedRulesAmazonIpReputationList \
     --scope CLOUDFRONT \
     --time-window StartTime=$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ),EndTime=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
     --max-items 100 \
     --region us-east-1
   ```
2. Check CloudWatch metric `BlockedRequests` (WebACL=oxo-online-cf-global,
   Rule=AWSManagedRulesAmazonIpReputationList) for recent block count.
3. If the source IP appears legitimate (e.g. an office egress IP mis-classified
   by the managed group), raise an AWS support case to reclassify the IP, or
   add an IP-set override rule (priority 0, allow) to exempt the specific IP.

Note: this is a documented residual. Reputation-group 403 blocks are
CloudWatch-observable only; they are not visible as HTTP 4xx to the client.
Rate-rule blocks are HTTP-observable as 429.

### WebSocket floods / unexpected cost spike

The WS endpoint has NO WAF (WAFv2 cannot associate with API Gateway v2; this
is a platform constraint — see s005-h1-waf architecture/deltas). Controls in
place (as of s005-h2) are:
- API Gateway prod stage: default-route throttle rate=20/s, burst=40
  (account/stage level; NOT per-IP)
- oxo-ws-fn: `ReservedConcurrentExecutions: 15`
- oxo-ws-auth-fn ($connect authorizer): per-IP connect budget (~20/5min via
  oxo-connect-attempts DynamoDB table). Unauthenticated/over-budget connects
  are rejected at authorizer before reaching oxo-ws-fn. Best-effort — see
  caveat OR-H2-a in §9.

If a cost spike is observed:
1. Check oxo-ws-auth-fn CloudWatch metrics (`Invocations`, `Errors`) for
   authorizer volume and error rate.
2. Check oxo-ws-fn CloudWatch metrics (`ConcurrentExecutions`, `Invocations`)
   for volume anomalies. If authorizer is functioning, only authenticated
   connects should reach oxo-ws-fn.
3. If the oxo-ws-fn concurrency ceiling is being hit, Lambda will throttle
   (return 429 to API Gateway). This presents as connection failures in the
   client.
4. Mitigation: increase reserved concurrency temporarily via the console (or
   push a CDK change). For sustained floods bypassing the per-IP budget (e.g.
   IP-cycling), the reversal path is CloudFront-front WS with edge WAF (see
   OR-H2-a).

### User blocked at WebSocket connect (rate-limit-exceeded)

A user reports "something went wrong" when trying to join or host an online
game, and the authorizer logs show `reason=rate-limit-exceeded` for their IP.

1. **Confirm the deny reason.** Check `/aws/lambda/oxo-ws-auth-fn` for the
   source IP:
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/lambda/oxo-ws-auth-fn \
     --filter-pattern '{ $.reason = "rate-limit-exceeded" }' \
     --limit 20 \
     --query 'events[*].message'
   ```

2. **Check the connect-attempts count for the IP.** Confirm the counter is at
   or above threshold (20):
   ```bash
   aws dynamodb get-item \
     --table-name oxo-connect-attempts \
     --key '{"sourceIp":{"S":"<IP-ADDRESS>"}}' \
     --query 'Item.{count:count,ttl:ttl}'
   ```

3. **Confirm window expiry.** The `ttl` field is a Unix epoch timestamp.
   Compare against `date +%s`. If `ttl` is in the past and the block is still
   occurring, DynamoDB has not yet lazily deleted the item — but the authorizer
   code treats an expired item as a fresh window (DEFECT-H2-003 fix, sha
   40b7767). The block will self-clear on the next connect attempt after DynamoDB
   performs lazy deletion, or immediately if the authorizer detects the expired
   ttl first.

4. **Wait for self-heal.** The window self-heals automatically after ~5 minutes
   from item creation. **Do NOT manually delete the item** unless the count is
   corrupt (e.g. it is in the millions). Manual deletion before the window
   expires defeats the purpose of the control and may hide an abuse pattern.

5. **If the user is legitimate and blocked by a shared NAT/office IP:** this is
   caveat OR-H2-a — per-IP budget applies to the egress IP, not the individual
   user. Multiple rapid connection attempts from the same NAT will consume the
   shared budget. In this case, advise the user to wait ~5 minutes and retry.
   No code change is required unless the threshold needs raising (CDK change to
   the authorizer's threshold constant).

6. **If the authorizer itself is returning 5xx** (not a Deny): this is our
   defect. Raise a task, check authorizer logs for exceptions. The WS connect
   will be blocked for all users until the authorizer recovers.

### Checking for lingering EXEMPT# items (runner exemption hygiene — s007a)

Run this to verify no CI runner exemption items are present outside of an active
CI run. A lingering item means the runner `trap` did not fire (abnormal exit) and
the drain Lambda has not yet reaped it.

```bash
aws dynamodb query \
  --table-name oxo-connect-attempts \
  --key-condition-expression "begins_with(sourceIp, :exempt)" \
  --expression-attribute-values '{":exempt":{"S":"EXEMPT#"}}' \
  --query 'Items[*].{sourceIp:sourceIp.S,ttl:ttl.N}'
```

**If a row is present:**
- Check the `ttl` field against `date +%s`. If in the past, the item is
  already logically expired; DynamoDB has not yet lazily deleted it. The
  authorizer treats an expired EXEMPT# item as no exemption (fail-closed).
  No action needed — DynamoDB lazy deletion or the drain Lambda will clean it
  within 24 hours.
- If `ttl` is in the future and no CI run is active, a runner job exited
  abnormally without running its cleanup trap. The item is self-healing (1h TTL
  max). No immediate action required unless the IP in question is a concern.
- **Do NOT manually delete an EXEMPT# item** during an active CI run — doing so
  will cause that run's smoke suite to fail with per-IP rate denies.

### POST /api/games returning 5xx

1. Check `/aws/lambda/oxo-game-fn` logs for unhandled exceptions.
2. Note: there is no structured `category` field in oxo-game-fn logs (OI-18).
   Look for Node.js stack traces directly.
3. If DynamoDB `Games` table shows throttling errors, the on-demand capacity
   may be under-provisioned for a traffic spike (unlikely at current scale).

---

## 7. Rollback posture

**Roll-forward is the default posture.** There is no Lambda versioning (OI-6
open). Push a corrected commit to `main`; the pipeline overwrites the Lambda
code.

**WAF rollback (CloudFront ACL):** if the rate rule is causing false-positive
blocks, the cheapest first response is to raise the threshold in CDK and push.
If the entire WAF must be removed urgently:
1. Remove the `webAclId` property from the CloudFront distribution in
   `OxoOnlineProd` CDK code and push — the distribution stops consulting the ACL.
2. Optionally destroy `OxoOnlineWafUsEast1` to remove the WebACL from us-east-1.

**SPA rollback** (if needed before a fix is ready):
```bash
# List recent index.html versions
aws s3api list-object-versions \
  --bucket <S3_BUCKET_NAME> \
  --prefix index.html \
  --query 'Versions[*].{VersionId:VersionId,LastModified:LastModified}'

# Restore a prior version
aws s3api copy-object \
  --copy-source "<S3_BUCKET_NAME>/index.html?versionId=<PRIOR_VERSION_ID>" \
  --bucket <S3_BUCKET_NAME> \
  --key index.html

# Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id d3pf3kcvzpau1x \
  --paths "/*"
```

**config.js rollback:** Re-run the deploy pipeline; it re-fetches the WS URL
from CloudFormation outputs and overwrites `config.js` automatically.

**Infrastructure rollback (CDK):**
```bash
# Roll back OxoGameProd to the previous change-set
npx cdk deploy OxoGameProd --rollback --require-approval never
```

The `Connections` table uses `RemovalPolicy.DESTROY` (ephemeral data).
The `Games` table uses `RemovalPolicy.RETAIN`.

---

---

## 8. WAF — AWS WAFv2 (s005-h1-waf)

### What is in place

**Global ACL: `oxo-online-cf-global`**
- Scope: CLOUDFRONT; region: us-east-1
- Associated to CloudFront distribution `E519HYABC57ZX`
- Rules (in priority order):
  1. `AWSManagedRulesAmazonIpReputationList` (priority 0) — blocks known
     malicious IPs. Block action returns 403. CloudFront's CustomErrorResponses
     maps 403 → 200+SPA index.html (see residual below).
  2. Rate rule (priority 1, metric: `oxo-cf-rate-limit`) — 100 requests per
     300-second window per source IP, with a `NOT(IPSetReferenceStatement
     oxo-test-runner-ips)` scope-down (IMP-008, s007a). Block action returns
     **HTTP 429** (Too Many Requests). 429 is NOT in the CF CustomErrorResponses
     list and passes through to the client honestly. The scope-down exempts only
     IPs in `oxo-test-runner-ips`; all other IPs are still subject to the 429
     block at the same limit.
- Default action: Allow (legitimate traffic is never default-denied).
- Build identity: tags `Project=oxo-online, Env=prod, ManagedBy=cdk` on the
  WebACL resource; CDK stack `OxoOnlineWafUsEast1` in us-east-1.

**Runner IP set: `oxo-test-runner-ips`**
- Scope: CLOUDFRONT; region: us-east-1
- Entries are transient: written by the CI deploy pipeline at job start (via
  `make waf-runner-ip-add`), removed on exit (via `make waf-runner-ip-remove`
  in `trap`). A drain Lambda reaps any entries not removed within 24 hours.
- This IP set is referenced ONLY in the rate rule scope-down. It does NOT affect
  the IP-reputation managed-rule-group or any other rule.
- Entries should be empty outside of active CI runs. To verify:
  ```bash
  aws wafv2 get-ip-set \
    --name oxo-test-runner-ips \
    --scope CLOUDFRONT \
    --id <ip-set-id-from-list-ip-sets> \
    --region us-east-1 \
    --query 'IPSet.Addresses'
  ```

**WS endpoint: NO WAF**

WAFv2 REGIONAL WebACLs cannot associate with API Gateway v2 (HTTP or
WebSocket) APIs. This is an AWS platform constraint (valid association targets
are REST v1 stages, ALB, AppSync, Cognito user pools, App Runner, and Verified
Access only). The planned regional WS WebACL was rejected at deploy
(GATE-AMEND-H1-A, 2026-06-06). Per-IP WS rate-limiting is deferred to
s005-h2 ($connect authorizer). Interim WS flood control: API Gateway prod
stage default-route throttle (rate=20/s, burst=40, account-level, NOT per-IP).

### Build identity — how to confirm WAF version

The WAF ACL carries no `X-Build-Id` header (it is a control-plane resource, not
a response surface). Confirm the deployed ACL configuration before diagnosing:

```bash
# 1. Confirm ACL exists and get its ARN
aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 \
  --query 'WebACLs[?Name==`oxo-online-cf-global`].{Name:Name,ARN:ARN,Id:Id}'

# 2. Confirm rules, rate limit, and block response code
aws wafv2 get-web-acl \
  --name oxo-online-cf-global \
  --scope CLOUDFRONT \
  --id <id-from-step-1> \
  --region us-east-1 \
  --query 'WebACL.Rules[*].{Name:Name,Priority:Priority,Action:Action}'

# 3. Confirm association to CloudFront distribution
aws cloudfront get-distribution-config --id E519HYABC57ZX \
  --query 'DistributionConfig.WebACLId'

# The WebACLId must match the ARN from step 1.
```

If the WebACLId is empty or absent, the WAF ACL is not associated; rate-rule
protection is absent. Re-deploy `OxoOnlineWafUsEast1` then `OxoOnlineProd`.

### Symptom: client receives HTTP 429

The rate rule fired. The client's source IP exceeded 100 requests in the
current 300-second window. This is expected behaviour.

- The 429 is returned by WAFv2; Lambda is NOT invoked.
- The window drains automatically. No manual action needed unless the client
  is legitimate and being false-positive blocked.
- To observe which IPs are being blocked:
  ```bash
  aws wafv2 get-sampled-requests \
    --web-acl-arn "<ARN from list-web-acls above>" \
    --rule-metric-name oxo-cf-rate-limit \
    --scope CLOUDFRONT \
    --time-window StartTime=<ISO8601-5min-ago>,EndTime=<ISO8601-now> \
    --max-items 100 \
    --region us-east-1
  ```
- CloudWatch metric: `BlockedRequests` (dimensions: `WebACL=oxo-online-cf-global`,
  `Rule=oxo-cf-rate-limit`). Log group for sampled requests is the WAF logging
  configuration if enabled (not configured in this slice; use `get-sampled-requests`).

### Symptom: SPA HTML returned instead of API JSON (for /api/* requests)

CloudFront's CustomErrorResponses maps 403 → 200+SPA index.html. If a WAF
IP-reputation block fires (403 from WAFv2), the client receives HTTP 200 with
HTML — indistinguishable from a normal SPA load at the HTTP level.

This is a **documented residual** (accepted at GATE-AMEND-H1-A / DEFECT-WAF-001
fix). Rate-rule blocks were corrected to use 429 (not affected). Only
reputation-group blocks exhibit this masking behaviour.

To diagnose:
1. Check WAF sampled-requests for BLOCK actions from `AWSManagedRulesAmazonIpReputationList`:
   ```bash
   aws wafv2 get-sampled-requests \
     --web-acl-arn "<ARN from list-web-acls above>" \
     --rule-metric-name AWSManagedRulesAmazonIpReputationList \
     --scope CLOUDFRONT \
     --time-window StartTime=<ISO8601-5min-ago>,EndTime=<ISO8601-now> \
     --max-items 100 \
     --region us-east-1
   ```
2. Check CloudWatch metric `BlockedRequests` (dimensions:
   `WebACL=oxo-online-cf-global`,
   `Rule=AWSManagedRulesAmazonIpReputationList`).
3. Whose problem: if the source IP is a known-bad IP per the managed list, this
   is working as designed. If the IP is a legitimate player IP that AWS has
   mis-classified, raise an AWS support case for IP reclassification, or add
   an IP-set override allow rule at priority 0 in the WebACL.

### Cost

One ACL (`oxo-online-cf-global` in us-east-1). Standing cost: WAFv2 CLOUDFRONT
ACL monthly base charge + per-rule charge + per-request inspection cost. At
hobby volume this is a small but non-zero standing cost on an otherwise
scale-to-zero stack. No regional WebACL was deployed (UC2 retired). Prior to
s005-h1, there were zero ACLs; this slice introduces one.

### Rollback

To remove the WAF ACL:
1. Remove `webAclId` from the CloudFront distribution config in CDK
   (`OxoOnlineProd`) and push — the infra pipeline disassociates the ACL.
2. Optionally `cdk destroy OxoOnlineWafUsEast1` (us-east-1) to remove the
   WebACL resource itself.
3. CloudFront continues to serve all routes; the rate rule and IP-reputation
   checks are simply absent.

---

## 9. Known gaps (honest)

| ID | Gap | Impact |
|----|-----|--------|
| OI-18 | No CloudWatch metrics, no alarms, no categorised logging in `oxo-game-fn` | Cannot set alert thresholds on error rate; game-fn faults require manual log scanning |
| OI-25 | No version header on any HTTP/WS response | Cannot determine deployed version from a request; must compare bundle hash by hand and buildSha from authorizer logs (see §1) |
| OI-6 | No Lambda versioning or aliases | No instant Lambda rollback; roll-forward only |
| h1/RESIDUAL | IP-reputation managed-rule-group 403 blocks are masked by CloudFront CustomErrorResponses to 200+SPA | Reputation blocks are CloudWatch-observable only (not HTTP-status observable). Rate-rule blocks return honest 429. |
| OR-H2-a | Per-IP WS connect budget is best-effort: IP-cycling bypasses counter; layered with stage throttle 20/40 + reserved concurrency 15 | A determined attacker cycling IPs bypasses the per-IP deterrent. Reversal path: CloudFront-front WS with edge WAF. |
| h2-waf/CLOSED | WAF rate-limiting on CloudFront/HTTP API (POST /api/games) | SHIPPED s005-h1-waf: oxo-online-cf-global ACL, 100 req/300s/IP, Block=429 |
| h2-connect-auth/CLOSED | No per-game credential on $connect; no per-IP WS rate-limit | SHIPPED s005-h2: oxo-ws-auth-fn REQUEST authorizer; wsToken for host; code for guest; oxo-connect-attempts per-IP budget |
| OR-S006-a | Near-simultaneous move CAS race → player must re-click (no auto-retry beyond one re-read) | Deliberate; bounded. Latency budget protects p95. |
| OR-S006-b (re-worded s007) | Relay is best-effort: a dropped @connections POST is not re-pushed | Authoritative board is always correct in DynamoDB. Recovery is graceful disconnect — abandon + survivor-notify (s007). Reconnect-replay is unscheduled (candidate C6-adjacent or never; per OI-10). |
| OR-S007-a | Connections:GetItem is a real (if minimal) grant widening — disconnect path reads Connections | Bounded to a single PK read of the disconnecting connection's own row (no Query/Scan). |
| OR-S007-b | Survivor notify is best-effort, single attempt — a survivor on a flaky link who misses the one opponent-disconnected post is not re-notified | Their own $disconnect/2h TTL or a manual reload recovers them. No retry storm (S4). |
| F1 (open s007) | oxo-ws-fn logs buildSha="unknown" — BUILD_SHA injection not applied to ws-fn | Cannot confirm ws-fn version from log buildSha field; use LastModified from aws lambda get-function instead (see §1). |

Gaps are tracked in the project open-items register. Do not treat open items as
alerts requiring immediate action unless noted otherwise; they are planned
hardening slices, not current defects.
