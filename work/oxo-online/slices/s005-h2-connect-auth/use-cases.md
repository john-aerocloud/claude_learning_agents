---
slice: s005-h2
slug: connect-auth
process-ref: §37
---

# Use cases — s005-h2: Join-token / $connect authorisation + per-IP rate-limiting

Use cases are separately buildable and separately testable. Dependency edges are
listed only where a genuine build or deploy dependency exists. False edges waste
parallelism and are not added.

---

## Parallel sets

```
SET A (parallel, no cross-dependencies):
  UC1 — wsToken minting (POST /api/games extension)
  UC2 — $connect authorizer Lambda + DynamoDB ConnectAttempts table (infra)

SET B (after SET A deployed):
  UC3 — Host WS flow wired to wsToken (SPA + authorizer combined)
  UC4 — Guest WS flow wired to code credential (SPA + authorizer combined)

SET C (after SET B deployed; validation only):
  UC5 — Reject unauthenticated + bad-token $connect (tester validation)
  UC6 — Per-IP burst limiting exercised (tester validation)
  UC7 — Regression: existing modes + pipeline (tester smoke)
```

UC1 and UC2 share no code but both must be deployed before the end-to-end flow
in UC3 and UC4 can be tested. UC3 and UC4 can be built in parallel (different
SPA paths, different authorizer branches) but both depend on UC1 output
(wsToken field) and UC2 output (deployed authorizer). UC5, UC6, and UC7 are
pure validation; they can run concurrently once UC3 + UC4 are deployed.

---

## UC1 — wsToken minting: extend POST /api/games response

**ID:** UC1
**Actor:** HTTP API Lambda (`oxo-game-fn`)
**Trigger:** Host calls `POST /api/games` and receives a response.

### Trigger → observable outcome

`POST /api/games` returns a JSON body that now includes a `wsToken` field
alongside the existing `gameId` and `code` fields. The `wsToken` is a
short-lived HMAC-SHA256 signed token encoding `{ gameId, role: "host", exp }`
(exp = now + 60 seconds). The HMAC secret is available to the Lambda via
environment variable (or SSM SecureString — architect decides in delta).

Observable outcome: `POST /api/games` response body contains `wsToken`; the
token is parseable and its HMAC signature can be verified using the shared
secret; the `exp` field is within 60 seconds of the request timestamp.

### Done condition

A unit test on the `oxo-game-fn` handler confirms: (1) the response body
contains `wsToken`; (2) the token structure matches `<b64payload>.<b64sig>`;
(3) the signature verifies with the secret. A synth/CDK test confirms the
Lambda's environment includes the `WS_TOKEN_SECRET` variable reference.
An integration smoke confirms `POST /api/games` → 201 with `wsToken` in prod.

### Acceptance cases

- AC1.1: `POST /api/games` response body includes `wsToken` (unit test on handler).
- AC1.2: `wsToken` payload decodes to `{ gameId, role: "host", exp }` with
  correct `gameId` matching the response (unit test).
- AC1.3: `wsToken` HMAC signature verifies with the shared secret (unit test).
- AC1.4: `exp` is within 60 seconds of request time (unit test, no fixed-clock
  dependency — use a window assertion).
- AC1.5: `POST /api/games` in prod returns 201 with a non-empty `wsToken` field
  (tester prod smoke).
- AC1.6: Existing `gameId` and `code` fields are still present and unchanged
  (regression — unit test + prod smoke).

### Dependencies

None within this slice. UC1 is independent of UC2.

---

## UC2 — $connect authorizer Lambda + ConnectAttempts table (infra)

**ID:** UC2
**Actor:** Infrastructure (CDK / CloudFormation), `OxoGameProd` stack
**Trigger:** CDK stack is synthesised and deployed.

### Trigger → observable outcome

A new REQUEST-type Lambda authorizer (`oxo-ws-auth-fn`) is attached to the
`$connect` route of the WebSocket API in `OxoGameProd`. A new DynamoDB table
`ConnectAttempts` (PK: `sourceIp` String; `count` Number; `ttl` Number with
TTL enabled) is provisioned.

The authorizer function:
1. Reads `?wsToken` or `?code` from `event.queryStringParameters`.
2. If `wsToken` present: verifies HMAC-SHA256 signature and expiry. Allow on
   valid; Deny on invalid/expired.
3. If `code` present (and no `wsToken`): performs a DynamoDB GSI GetItem on
   `Games.code` index. Allow if game exists and status is `waiting` or `active`;
   Deny otherwise.
4. If neither present: Deny.
5. Increments `ConnectAttempts[sourceIp].count` (atomic UpdateItem with ADD 1
   and conditional TTL set). If count exceeds threshold (e.g. 20 in 5 min):
   Deny regardless of token validity.

IAM grants on `oxo-ws-auth-fn`:
- `dynamodb:GetItem` on `Games` table (GSI read for code path).
- `dynamodb:UpdateItem` + `dynamodb:PutItem` on `ConnectAttempts`.

Observable outcome: `aws apigatewayv2 get-authorizers --api-id <id>` lists
an authorizer of type `REQUEST` attached to `$connect`; `aws dynamodb
describe-table --table-name ConnectAttempts` shows the table with TTL enabled.

### Done condition

CDK synth produces a template containing: (a) `AWS::Lambda::Function`
`oxo-ws-auth-fn`; (b) `AWS::ApiGatewayV2::Authorizer` of `AuthorizerType:
REQUEST` on `$connect` route; (c) `AWS::DynamoDB::Table` `ConnectAttempts`
with TTL spec. Unit tests cover authorizer logic (all four branches: valid
host token, valid guest code, invalid token, no credential). In prod:
authorizer and table exist; a test `$connect` with no credential receives a
403 at WS upgrade.

### Acceptance cases

- AC2.1: CDK synth template contains `AWS::ApiGatewayV2::Authorizer` with
  `AuthorizerType: REQUEST` referencing `oxo-ws-auth-fn` on `$connect`
  (synth/CDK test).
- AC2.2: `ConnectAttempts` table template has `AttributeDefinitions` with
  `sourceIp` as PK and `TimeToLiveSpecification` enabled (synth/CDK test).
- AC2.3: `oxo-ws-auth-fn` unit test: valid host token (correct HMAC, non-expired)
  → returns Allow policy.
- AC2.4: `oxo-ws-auth-fn` unit test: tampered host token (signature mismatch)
  → returns Deny policy.
- AC2.5: `oxo-ws-auth-fn` unit test: expired host token (exp in the past)
  → returns Deny policy.
- AC2.6: `oxo-ws-auth-fn` unit test: valid guest code path (mock DynamoDB
  returns game with status `waiting`) → returns Allow policy.
- AC2.7: `oxo-ws-auth-fn` unit test: guest code not found (mock DynamoDB
  returns no item) → returns Deny policy.
- AC2.8: `oxo-ws-auth-fn` unit test: no credentials supplied → returns Deny.
- AC2.9: `oxo-ws-auth-fn` unit test: count >= threshold → returns Deny
  regardless of token validity (per-IP budget exhausted).
- AC2.10: In prod, `aws apigatewayv2 get-authorizers` returns the authorizer
  on the WS API (tester prod validation).
- AC2.11: In prod, `aws dynamodb describe-table ConnectAttempts` shows TTL
  enabled on `ttl` attribute (tester prod validation).

### Dependencies

None within this slice. UC2 is independent of UC1.

---

## UC3 — Host WS flow wired to wsToken

**ID:** UC3
**Actor:** SPA (host player) + authorizer (deployed from UC2) + game-fn (UC1)
**Trigger:** Host completes `POST /api/games`, then opens a WebSocket connection.

### Trigger → observable outcome

The host SPA reads `wsToken` from the `POST /api/games` response, constructs
`wss://<endpoint>/prod?wsToken=<token>`, and opens the WebSocket. The
`$connect` authorizer receives the token, validates it, and allows the
connection. The host then sends `{ action: "register", gameId }` as before.
The full waiting-screen → game-board flow completes unchanged.

Observable outcome: the host reaches the waiting screen and subsequently the
game board; the `Games` table shows `hostConnectionId` populated; no
authorizer Deny in CloudWatch for this connection.

### Done condition

All acceptance cases below pass. The create-game → waiting-screen → game-board
end-to-end smoke test passes (host side only, or combined with UC4 for the
full pairing test).

### Acceptance cases

- AC3.1: SPA unit test: after `POST /api/games` response, the constructed
  WebSocket URL includes `?wsToken=<value>` (SPA component test).
- AC3.2: Integration / smoke: a host creates a game, opens WS with the received
  wsToken, and successfully reaches the waiting screen (prod smoke or local
  integration with a real authorizer mock).
- AC3.3: CloudWatch `$connect` authorizer Lambda invocations for the host
  connection show no Deny (tester prod validation).

### Dependencies

- UC1 must be deployed (wsToken field in POST /api/games response).
- UC2 must be deployed (authorizer attached to $connect).

---

## UC4 — Guest WS flow wired to code credential

**ID:** UC4
**Actor:** SPA (guest player) + authorizer (deployed from UC2)
**Trigger:** Guest enters a valid 6-char code and submits the join screen.

### Trigger → observable outcome

The guest SPA constructs `wss://<endpoint>/prod?code=<CODE>` and opens the
WebSocket. The `$connect` authorizer receives the code, performs the GSI
lookup, confirms the game is in `waiting` or `active` status, and allows the
connection. The guest then sends `{ action: "join", code }` as before.
The join → `game-ready` → board flow completes unchanged for both players.

Observable outcome: both players reach the game board within 3 seconds of the
guest submitting the code; `Games` record shows both connectionIds populated
and status `active`; no authorizer Deny for the guest connection.

### Done condition

All acceptance cases below pass. The full pairing smoke (host + guest) passes.

### Acceptance cases

- AC4.1: SPA unit test: when the guest submits a code, the constructed WebSocket
  URL includes `?code=<CODE>` (SPA component test).
- AC4.2: Integration / smoke: guest enters a valid code, opens WS with
  `?code=<CODE>`, and the join + game-ready flow completes; both players see
  the board within 3 seconds (prod smoke).
- AC4.3: CloudWatch `$connect` authorizer Lambda invocations for the guest
  connection show no Deny (tester prod validation).
- AC4.4: `Games` record in DynamoDB shows `status=active`,
  `hostConnectionId` and `guestConnectionId` both populated (tester DynamoDB
  check).

### Dependencies

- UC2 must be deployed (authorizer attached to $connect, GSI lookup path).
- UC1 must be deployed for a full host+guest pairing test (host needs wsToken
  to connect; guest flow is independently testable with a pre-existing waiting
  game).

---

## UC5 — Reject unauthenticated and bad-token $connect attempts

**ID:** UC5
**Actor:** Tester (validation spec)
**Trigger:** Post-deploy validation run.

### Trigger → observable outcome

After UC2, UC3, UC4 are deployed, the tester validates the rejection paths:
1. A raw `wss://` connect with no query parameters is rejected at upgrade (HTTP
   403 before Lambda game-logic is invoked).
2. A connect with a syntactically valid but tampered wsToken (signature modified)
   is rejected.
3. A connect with an expired wsToken (exp in the past) is rejected.
4. A connect with `?code=XXXXXX` where XXXXXX does not exist in `Games` is
   rejected.

In all cases: the `oxo-ws-fn` game-logic Lambda (not the authorizer) receives
ZERO invocations for the rejected connections. Observable via CloudWatch
`Invocations` metric.

### Done condition

All acceptance cases below pass.

### Acceptance cases

- AC5.1: `wss://` connect with no credentials → connection rejected, HTTP 403
  upgrade response (tester manual or scripted).
- AC5.2: `wss://` connect with tampered `wsToken` (flip one byte in signature)
  → rejected; CloudWatch shows 0 game-logic Lambda invocations for this attempt.
- AC5.3: `wss://` connect with expired `wsToken` → rejected.
- AC5.4: `wss://` connect with `?code=ZZZZZZ` (non-existent code) → rejected.
- AC5.5: For all rejection cases above, CloudWatch `oxo-ws-fn` Invocations metric
  shows zero invocations (the authorizer denies before the route handler fires).

### Dependencies

- UC2, UC3, UC4 must be deployed.

---

## UC6 — Per-IP burst limiting exercised (best-effort validation)

**ID:** UC6
**Actor:** Tester (validation spec)
**Trigger:** Post-deploy validation run.

### Trigger → observable outcome

The tester sends N rapid WS connect attempts from a single IP (N exceeds the
per-IP threshold, e.g. N = 25 within 60 seconds). Expects: at least some of
the later attempts are denied by the authorizer; the `ConnectAttempts` DynamoDB
table shows a count >= threshold for the test source IP.

Honest scope: due to Lambda authorizer caching (default 300s TTL per token),
if the test rotates `wsToken` values to avoid cache hits, the counter increments
accurately. If a single token is reused, the authorizer may cache the first
Allow and subsequent attempts bypass the counter increment. The test rotates
tokens (or disables authorizer cache) to exercise the counter honestly. The test
documents the caching caveat in its output.

### Done condition

All acceptance cases below pass or are honestly recorded as best-effort.

### Acceptance cases

- AC6.1: After N (>threshold) rapid WS connect attempts from one IP (with
  distinct tokens to avoid cache), at least some attempts receive Deny from the
  authorizer (tester validation; accepts that cache may affect exact count).
- AC6.2: `ConnectAttempts` table item for the test source IP shows count >=
  threshold after the burst (tester DynamoDB check).
- AC6.3: After the 5-minute TTL window, the `ConnectAttempts` item is expired /
  gone and a fresh connect from the same IP succeeds (tester validation, long
  test — may be deferred to the tester's discretion).
- AC6.4: Best-effort note recorded: the tester's output explicitly documents the
  authorizer cache TTL and its effect on per-IP counting accuracy.

### Dependencies

- UC2 must be deployed.
- AC6.3 is optional / long-running; tester may defer.

---

## UC7 — Regression: existing modes + pipeline clean

**ID:** UC7
**Actor:** Tester (Playwright smoke + pipeline validation)
**Trigger:** Post-deploy validation run.

### Trigger → observable outcome

1. Local two-player game: two players on the same browser complete a full game
   (no backend calls affected by this slice).
2. vs-AI game: a player completes a full game against the AI.
3. Online create-game + join-game: host creates a game (now receives wsToken),
   guest joins by code — full pairing and board visibility achieved, matching
   s005 success measures.
4. Pipeline: GitHub Actions infra + deploy pipelines complete end-to-end green
   with no manual steps.

### Done condition

All acceptance cases below pass.

### Acceptance cases

- AC7.1: Local two-player game completes a full match without regression
  (Playwright smoke).
- AC7.2: vs-AI game completes a full match without regression (Playwright smoke).
- AC7.3: Online create + join: both players see the game board with roles
  labelled within 3 seconds of code entry (Playwright or manual smoke; this is
  the s005 pairing test re-run with the new auth in place).
- AC7.4: `POST /api/games` → 201 with `gameId`, `code`, and `wsToken` fields
  (regression: existing fields unchanged, new field added — prod smoke).
- AC7.5: GitHub Actions infra pipeline deploys `OxoGameProd` (updated stack:
  new authorizer, new table) without manual intervention (CI log green).
- AC7.6: GitHub Actions deploy pipeline deploys SPA (updated WS URL construction)
  without manual intervention (CI log green).

### Dependencies

- UC3, UC4 must be deployed.
- UC5, UC6 can run in parallel with UC7 (no code dependency).

---

## Dependency summary

```
UC1 (wsToken minting)              — no build dependencies (independent)
UC2 ($connect authorizer + table)  — no build dependencies (independent)
UC3 (host flow)                    — requires UC1 + UC2 deployed
UC4 (guest flow)                   — requires UC2 deployed; UC1 for full pairing
UC5 (reject bad $connect)          — requires UC2 + UC3 + UC4 deployed
UC6 (per-IP burst)                 — requires UC2 deployed
UC7 (regression + pipeline)        — requires UC3 + UC4 deployed
```

Parallel sets:
- **Set A (build in parallel):** UC1, UC2
- **Set B (after Set A deployed; build in parallel):** UC3, UC4
- **Set C (after Set B deployed; run in parallel):** UC5, UC6, UC7

---

## Infra enabler notes (co-decide with solution-architect)

1. **Authorizer cache TTL:** the architect must decide whether to set
   `AuthorizerResultTtlInSeconds = 0` (disable cache, accurate per-IP counting,
   one DynamoDB read per connect) or retain the default 300s cache (faster, but
   per-IP counting degrades). Named here for the gate decision; not a product
   choice.

2. **HMAC secret storage:** Lambda env var (fast, simpler) vs SSM SecureString
   (better rotation hygiene, ~10ms cold-start penalty per invocation). Architect
   decides. Named here as a constraint that must be resolved before UC2 can be
   built.

3. **ConnectAttempts counter atomicity:** the UpdateItem ADD expression is
   atomic at the item level. A `ConditionExpression` can set TTL only if not
   already present (first-write sets the 5-min TTL window). This is the
   standard per-IP rolling window pattern; architect may substitute an
   alternative.

4. **Deploy-role grants:** the new authorizer Lambda and `ConnectAttempts` table
   need standard Lambda + DynamoDB CDK deploy grants. Likely covered by existing
   `OxoGameProd` role grants. Architect confirms in delta; no new broad
   permissions expected.

5. **Walking-skeleton probe (process §30):** this slice introduces the first
   Lambda REQUEST authorizer on a WebSocket API in this system. Before the full
   UC5 validation suite, a skeleton probe should confirm: one real `$connect`
   with a valid token is allowed; one with no token is denied. This de-risks the
   authorizer wiring before investing in the full suite.
