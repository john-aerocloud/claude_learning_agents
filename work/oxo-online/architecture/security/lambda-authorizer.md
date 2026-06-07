# Security controls — `oxo-ws-auth-fn` ($connect REQUEST authorizer)

Introduced: slice s005-h2 (Chunk 4). Data class: **capability gate** — handles a
short-lived HMAC capability token and a guest game code; reads `Games` (no PII),
reads one HMAC secret, writes a per-IP counter. No accounts, no user identity.

This is a **new principal** and the project's first Lambda authorizer. It is the
gatekeeper for the WebSocket API: it decides whether a `$connect` reaches any
game-logic handler at all. Scope it exactly.

## Why a separate note (and a separate function) from `oxo-ws-fn`
The authorizer and the route handler have **disjoint privilege profiles** (see
delta §2). The authorizer can *gate* but must not be able to *act on game state*:
it holds the HMAC secret and the rate counter, but has **no** `ManageConnections`,
**no** `Games` write, **no** `Connections` access. Keeping it a separate function
with its own role is the least-privilege control, not a packaging convenience.

## Checkable controls (s005-h2 — become policy tests)

### Identity & least-privilege
- [ ] `oxo-ws-auth-fn` has its **OWN** execution role (not shared with
      `oxo-game-fn` or `oxo-ws-fn`).
- [ ] `dynamodb:GetItem`/`Query` scoped to the `Games` table ARN **and its
      `code-index` GSI ARN** only — no `Scan`. (Guest code lookup.)
- [ ] `dynamodb:UpdateItem` + `dynamodb:PutItem` scoped to the `ConnectAttempts`
      table ARN **only**. (Per-IP counter.)
- [ ] Secret read scoped to the **one** shared secret ARN only — either
      `ssm:GetParameter` + `kms:Decrypt` on `/oxo-online/prod/ws-token-secret`,
      or `secretsmanager:GetSecretValue` on the one Secret ARN. No wildcard.
- [ ] `logs:CreateLogGroup`/`CreateLogStream`/`PutLogEvents` on its own log
      group only.
- [ ] **NO** `execute-api:ManageConnections` (or any `execute-api:*`).
- [ ] **NO** `dynamodb:UpdateItem`/`PutItem`/`DeleteItem` on `Games`.
- [ ] **NO** access to the `Connections` table.
- [ ] **NO** `dynamodb:*`, **NO** `iam:*`, **NO** `*:*`, no second/unrelated
      resource, no wildcard ARN on any statement.
- [ ] No public function URL; invoked only by API Gateway as the `$connect`
      REQUEST authorizer.

### Authorizer wiring & response contract (platform semantic — pinned)
- [ ] `AWS::ApiGatewayV2::Authorizer` of `AuthorizerType: REQUEST` references
      `oxo-ws-auth-fn`; the `$connect` route has `AuthorizationType: CUSTOM`
      with that `AuthorizerId` (SYNTH-CONTRACT-H2-1).
- [ ] `AuthorizerResultTtlInSeconds: 0` — caching disabled so the per-IP counter
      runs on every connect and Deny is never cached (SYNTH-CONTRACT-H2-3).
- [ ] The authorizer returns the **WebSocket REST-style IAM-policy response**
      (`{ principalId, policyDocument:{ Statement:[{ Effect:"Allow"|"Deny",
      Action:"execute-api:Invoke", Resource:<methodArn> }] } }`) — **NOT** the
      HTTP-API-v2 simple `{ isAuthorized }` shape. Unit tests assert this shape.
- [ ] `IdentitySource` includes `route.request.querystring.wsToken` and
      `route.request.querystring.code`.

### Token / capability handling
- [ ] Host path: HMAC-SHA256 verify of `wsToken` against the shared secret;
      reject on signature mismatch (Deny).
- [ ] Host path: reject on `exp` in the past (Deny) — expiry enforced, not just
      structure.
- [ ] Guest path: GSI `GetItem`/`Query` on `code`; Allow only if a game exists
      and `status ∈ {waiting, active}`; Deny on not-found or other status.
- [ ] Neither `wsToken` nor `code` present → Deny (no anonymous connect).
- [ ] The shared secret is read from the encrypted store at cold start and held
      only in memory (module scope) — **never** logged, never returned in
      `context`, never placed in a plaintext env var.

### Per-IP budget (best-effort, layered)
- [ ] Per invocation, `ConnectAttempts[sourceIp]` is incremented with an atomic
      `UpdateItem ADD count 1` and a conditional first-write TTL set (~5 min).
- [ ] If `count` exceeds the threshold (e.g. 20 / 5-min, matching the stage
      throttle floor) the authorizer returns **Deny regardless of token
      validity**.
- [ ] `sourceIp` is taken from `event.requestContext.identity.sourceIp`
      (REQUEST authorizer) — never from a client-supplied header/param.
- [ ] **Best-effort caveat (documented, not hidden):** with cache TTL 0 the
      counter runs on every connect, but the read-less ADD has an inherent race
      and a determined attacker can rotate source IPs. This is a layered
      deterrent atop the stage throttle (20/40) + reserved concurrency, **not** a
      hard guarantee. See `dynamodb-connectattempts.md`.

### Version identity (principles/01)
- [ ] Every structured log line carries `buildSha` (from a CDK-injected
      `BUILD_SHA` env var). The Allow/Deny decision line identifies which build
      made the call.

## Data classification
- [ ] Handles: `wsToken` (HMAC capability, no PII), `code` (server-generated),
      `gameId` (UUID), `sourceIp` (transient, in a 5-min-TTL counter only),
      `status`. **No PII**, no accounts, no display names (C6).
- [ ] The HMAC secret is the only sensitive material; it is encrypted at rest in
      one store, read-scoped to exactly two roles, and never logged.

## Open risks (carried)
- **OR-H2-a (best-effort per-IP):** IP-cycling can evade the counter; layered
  with stage throttle. Reversal = CloudFront-front + edge WAF (delta §13).
- **OR-H2-b (guest code-as-credential pre-join):** a holder of a valid `code`
  can open a WS before declaring intent to join. Bounded by the no-hijack
  conditional write in `oxo-ws-fn`; closed by identity (C6). Carried from the
  slice's honest trade-off, not a missed risk.

## Out of scope for s005-h2 (do NOT assert as built)
- User identity / account auth (C6). Reconnect token re-issue (s007+).
- Token rotation tooling / scheduled key rotation (operational note only).
- Any move-relay authorisation (s006 — the authorizer gates *connect* only).
