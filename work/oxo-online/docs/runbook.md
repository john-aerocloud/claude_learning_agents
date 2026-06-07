# oxo-online — Support Runbook

Audience: on-call engineers and support team.
Last updated: slice s005-h2-connect-auth (iteration 8, sha 45b0aa4, validated 2026-06-07).

---

## 1. Build identity — check this first

There is **no version response header** on any surface yet (OI-25, open). To
establish what is actually deployed before diagnosing any behaviour:

### SPA bundle hash

```bash
# Fetch the SPA's index.html and extract the hashed bundle filename.
# The hash in the filename IS the build identity for the frontend.
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
ledger. CodeSize for `oxo-ws-fn` at slice 005 baseline is approximately 6054 bytes.

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
          join       -> oxo-ws-fn
          $disconnect -> oxo-ws-fn (stub; returns 200, no write)
```

### AWS resources

| Resource | Name / ID | Notes |
|----------|-----------|-------|
| CloudFront distribution | d3pf3kcvzpau1x | SPA + /api/* + /config.js |
| HTTP API (API Gateway) | via `OxoGameProd-HttpApiEndpoint` output | POST /api/games -> oxo-game-fn; response now includes wsToken |
| WebSocket API (API Gateway) | ylbzjuo8lf, stage: prod | 4 routes; direct WSS; no CloudFront proxy |
| Lambda — game | oxo-game-fn | Create-game handler; mints wsToken; DynamoDB PutItem on Games |
| Lambda — ws authorizer | oxo-ws-auth-fn | REQUEST authorizer on $connect; verifies wsToken/code; per-IP budget; structured logs with buildSha |
| Lambda — ws | oxo-ws-fn | connect/register/join/$disconnect; DynamoDB r/w Games+Connections; ManageConnections |
| DynamoDB — games | oxo-games | PK: gameId; GSI: code-index (PK: code); 24h TTL; SSE enabled; on-demand |
| DynamoDB — connections | oxo-connections | PK: connectionId; 2h TTL; SSE enabled; on-demand |
| DynamoDB — connect attempts | oxo-connect-attempts | PK: sourceIp; count (N); ttl (~5min TTL); SSE enabled; on-demand; used by authorizer for per-IP budget |
| WAFv2 WebACL — global | oxo-online-cf-global (us-east-1) | CLOUDFRONT scope; associated to d3pf3kcvzpau1x; rate rule 100/300s/IP (Block=429); IP-rep managed group |
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
# Smoke suite (38 tests; runs against live CloudFront URL)
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

The WS handler emits structured JSON on warning and error paths. Normal happy
path emits only Lambda platform `START`/`END`/`REPORT` lines.

| `event` value | Severity | `category` | `subcategory` | Meaning | Whose problem |
|---------------|----------|------------|---------------|---------|---------------|
| `register_rejected` | WARN | `internal` | — | Host tried to register but slot already bound | Our logic / client retry; not a bug if rare |
| `register_failed` | ERROR | `external` | — | DynamoDB call failed after SDK retries; oxo-ws-fn could not write Connections | Dependency (DynamoDB) or IAM; check AWS Health |
| `join_host_gone` | WARN | `external` | `availability` | Guest joined but host WS connection had vanished (GoneException); guest gets 4041 | Host disconnected before join; not our code defect |
| `ws_error_frame_post_failed` | WARN | `external` | — | Could not POST error frame to client (already gone); DELETE still attempted | Connection already closed; benign race |

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

### "Game not found" complaints

Most likely causes (in order):
1. Typographical error in the code. Codes are 6 characters, uppercase
   letters and digits, no O/0/1/I/L. Ask the user to try again.
2. Game TTL expired (24-hour limit). Host must create a new game.
3. Game was already joined by someone else (code reuse is an accepted risk in
   s005 — see OI open items).

Check DynamoDB directly if needed:
```bash
aws dynamodb query \
  --table-name oxo-games \
  --index-name code-index \
  --key-condition-expression "#c = :code" \
  --expression-attribute-names '{"#c":"code"}' \
  --expression-attribute-values '{":code":{"S":"<CODE>"}}'
```

### Stale-page / wrong-bundle behaviour

No version response header exists yet (OI-25). To check whether the browser
has an old bundle:

```bash
# What the CDN currently serves
curl -s https://d3pf3kcvzpau1x.cloudfront.net/ | grep -o 'assets/index-[^"]*\.js'

# Check if CloudFront has a pending invalidation
aws cloudfront list-invalidations \
  --distribution-id d3pf3kcvzpau1x \
  --query 'InvalidationList.Items[0]'
```

If a deploy ran recently and the bundle hash has not changed on CloudFront,
the CF invalidation may still be propagating (the pipeline now waits for
completion, but propagation can take a few minutes globally). Ask the user to
hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).

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
     300-second window per source IP. Block action returns **HTTP 429** (Too
     Many Requests). 429 is NOT in the CF CustomErrorResponses list and passes
     through to the client honestly.
- Default action: Allow (legitimate traffic is never default-denied).
- Build identity: tags `Project=oxo-online, Env=prod, ManagedBy=cdk` on the
  WebACL resource; CDK stack `OxoOnlineWafUsEast1` in us-east-1.

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
| h3 | No server-authoritative move validation | Not yet relevant (moves do not relay until s006) |

Gaps are tracked in the project open-items register. Do not treat open items as
alerts requiring immediate action unless noted otherwise; they are planned
hardening slices, not current defects.
