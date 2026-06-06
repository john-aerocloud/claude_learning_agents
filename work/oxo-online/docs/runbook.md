# oxo-online — Support Runbook

Audience: on-call engineers and support team.
Last updated: slice 005-join-game (iteration 6, sha ff06b15, validated 2026-06-06T14:57Z).

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
```

Cross-reference `LastModified` against the infra pipeline deploy time in the
ledger. CodeSize for `oxo-ws-fn` at slice 005 baseline is approximately 6054 bytes.

### Stack outputs

```bash
aws cloudformation describe-stacks --stack-name OxoGameProd \
  --query 'Stacks[0].Outputs'
```

Outputs present at slice 005: `HttpApiEndpoint`, `LambdaFunctionName`,
`WsApiEndpoint`, `WsLambdaFunctionName`.

---

## 2. System map

```
Browser
  |
  +-- HTTPS --> CloudFront d3pf3kcvzpau1x
  |               |-- /             --> S3 (SPA bundle, index.html)
  |               |-- /config.js    --> S3 (window.OXO_CONFIG, no-cache)
  |               `-- /api/*        --> HTTP API (CachingDisabled)
  |                                     POST /api/games -> oxo-game-fn
  |
  `-- WSS direct (not via CloudFront)
        wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com/prod
          $connect   -> oxo-ws-fn
          register   -> oxo-ws-fn
          join       -> oxo-ws-fn
          $disconnect -> oxo-ws-fn (stub; returns 200, no write)
```

### AWS resources

| Resource | Name / ID | Notes |
|----------|-----------|-------|
| CloudFront distribution | d3pf3kcvzpau1x | SPA + /api/* + /config.js |
| HTTP API (API Gateway) | via `OxoGameProd-HttpApiEndpoint` output | POST /api/games -> oxo-game-fn |
| WebSocket API (API Gateway) | ylbzjuo8lf, stage: prod | 4 routes; direct WSS; no CloudFront proxy |
| Lambda — game | oxo-game-fn | Create-game handler; DynamoDB PutItem on Games |
| Lambda — ws | oxo-ws-fn | connect/register/join/$disconnect; DynamoDB r/w Games+Connections; ManageConnections |
| DynamoDB — games | oxo-games | PK: gameId; GSI: code-index (PK: code); 24h TTL; SSE enabled; on-demand |
| DynamoDB — connections | oxo-connections | PK: connectionId; 2h TTL; SSE enabled; on-demand |
| CloudFormation stacks | OxoOnlineOidcStack, OxoGameProd, OxoOnlineProd | Deploy order: OxoGameProd then OxoOnlineProd |
| S3 bucket | see `WebBucketName` GH var | Versioning on; SPA + config.js |
| Log group — game fn | /aws/lambda/oxo-game-fn | No structured categories yet (OI-18) |
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

# Validation suite (14 tests; requires AWS credentials + live stack)
make -C work/oxo-online validate

# Lambda reserved concurrency (must be 15 for oxo-ws-fn)
aws lambda get-function-concurrency --function-name oxo-ws-fn

# DynamoDB table details
aws dynamodb describe-table --table-name oxo-games \
  --query 'Table.{BillingMode:BillingModeSummary.BillingMode,SSEStatus:SSEDescription.Status,ItemCount:ItemCount}'

aws dynamodb describe-table --table-name oxo-connections \
  --query 'Table.{BillingMode:BillingModeSummary.BillingMode,SSEStatus:SSEDescription.Status,ItemCount:ItemCount}'
```

Validation run results are recorded in `process/dora/ledger.csv`
(`validation_run` event rows). Check recent rows to confirm the latest suite
was green.

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
| 201 | Game created; body `{gameId, code}` |
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

### WebSocket floods / unexpected cost spike

oxo-ws-fn has `ReservedConcurrentExecutions: 15` and the API Gateway throttle
is 20 requests/second burst 40. These are the only rate controls in place.
**WAF is not enabled** (deferred hardening slice h1).

If a cost spike is observed:
1. Check oxo-ws-fn CloudWatch metrics (`ConcurrentExecutions`, `Invocations`)
   for volume anomalies.
2. If the concurrency ceiling is being hit, Lambda will throttle (return 429
   to API Gateway). This presents as connection failures in the client.
3. Mitigation today: increase reserved concurrency temporarily via the console
   (or push a CDK change). WAF rate-based rules are the permanent fix (h1).

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

## 8. Known gaps (honest)

| ID | Gap | Impact |
|----|-----|--------|
| OI-18 | No CloudWatch metrics, no alarms, no categorised logging in `oxo-game-fn` | Cannot set alert thresholds on error rate; game-fn faults require manual log scanning |
| OI-25 | No version header on any HTTP/WS response | Cannot determine deployed version from a request; must compare bundle hash by hand (see §1) |
| OI-6 | No Lambda versioning or aliases | No instant Lambda rollback; roll-forward only |
| h1 | No WAF on the WebSocket API | No IP-based rate limiting; concurrency cap is the only cost floor |
| h2 | No WAF on CloudFront / HTTP API | Same gap for POST /api/games |
| h3 | No server-authoritative move validation | Not yet relevant (moves do not relay until s006) |

Gaps are tracked in the project open-items register. Do not treat h1/h2 as
alerts requiring immediate action; they are planned hardening slices, not
current defects.
