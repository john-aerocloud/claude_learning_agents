# Architecture delta — s005-h2: $connect authoriser + per-IP rate-limiting

Slice: `s005-h2-connect-auth` · Iteration 8 · Gate-2 standing approval.
Classification: **cloud/hosted** (full Well-Architected; aws-architecture skill loaded).
Region: **all eu-west-2** — no exception needed (confirmed §"Region" below).
Home stack: all new resources live in the existing **`OxoGameProd`** stack
(eu-west-2). No new stack, no new cross-region footprint.

This delta closes the highest-risk open surface (`apigw-websocket.md` OI-2 and
the h1 per-IP residual) before s006 widens the WS write surface with move relay.

---

## 0. New-mechanism flag (process §30) — YES

This slice introduces the **first Lambda REQUEST authorizer on a WebSocket API**
in this system. That is a new platform-integration mechanism (a new trust
relationship + a new APIGW↔Lambda invocation class with platform-specific
response-format and caching semantics).

**Walking-skeleton probe (must run before UC3/UC4 build out on the authorizer):**
One real `wss://` connect through the deployed `$connect` route, two requests:
1. **garbage/no token** → connection **rejected at `$connect`** (HTTP 403 on the
   WS upgrade) with **zero** `oxo-ws-fn` (game-logic) invocations — confirm via
   the authorizer's own CloudWatch Deny log line AND the `oxo-ws-fn`
   `Invocations` metric staying flat.
2. **valid host wsToken** → connection **accepted**, `oxo-ws-fn` `$connect`
   integration is reached.

The probe proves the authorizer is *attached*, *invoked*, returns a
*policy CloudFormation/APIGW accepts*, and that the deny path short-circuits
before game logic — the exact wiring that the UC5/UC6 validation suite then
relies on. The engineer schedules this probe immediately after UC2 deploys,
ahead of UC3/UC4.

**Browser-vs-node note (CSP relevance):** the authorizer itself is invoked by
APIGW (server-side, node) — query-string token on the `wss://` connect is not a
CSP concern. The **SPA change** (host appends `?wsToken=`, guest appends
`?code=`) IS browser-relevant but is a query-string addition to the *existing*
`wss://` connect that `connect-src` already permits in the CSP — no new CSP
directive. The existing browser smoke (UC5–UC7 Playwright pairing) covers the
full browser flow; see the gap list (§5).

---

## 1. Resources added (the delta)

| Resource | Type | Purpose | Notes |
|----------|------|---------|-------|
| `oxo-ws-auth-fn` | `AWS::Lambda::Function` (Node20) | `$connect` REQUEST-type authorizer: verify host `wsToken` HMAC / look up guest `code`; enforce per-IP budget; return Allow/Deny IAM policy | **Separate function** — see §2 decision |
| Authorizer | `AWS::ApiGatewayV2::Authorizer` (`AuthorizerType: REQUEST`) | Attaches `oxo-ws-auth-fn` to the WS API; `IdentitySource` = `route.request.querystring.wsToken` + `route.request.querystring.code` (REQUEST identity sources from the query string) | `AuthorizerResultTtlInSeconds: 0` — see §3 caching decision |
| `$connect` route update | `AWS::ApiGatewayV2::Route` | Set `AuthorizationType: CUSTOM` + `AuthorizerId` on the existing `$connect` route | Existing route, now gated |
| `ConnectAttempts` | `AWS::DynamoDB::Table` | Per-IP rolling connect counter | PK `sourceIp` (S); `count` (N); `ttl` (N, TTL enabled, 5-min); on-demand; SSE |
| WS-token secret | `AWS::SSM::Parameter` (SecureString) **or** CDK `Secret` | Shared HMAC-SHA256 key for mint (`oxo-game-fn`) + verify (`oxo-ws-auth-fn`) | See §4 secret-sharing decision |
| `oxo-game-fn` env | (config change) | Add `WS_TOKEN_SECRET_PARAM` env (SSM param name) so it can mint `wsToken` | Code change is UC1; infra wires the env + grant |

No change to: CloudFront, S3, WAF (the WS path is still not WAF-able — that is
exactly why the per-IP control lives here), HTTP API routes (no new route),
`Connections` table, `oxo-ws-fn` grants.

---

## 2. Decision — SEPARATE authorizer function (`oxo-ws-auth-fn`), not a branch in `oxo-ws-fn`

**Chosen: a separate `oxo-ws-auth-fn`.** Justification (least-privilege is the
deciding factor):

| Need | `oxo-ws-auth-fn` (authorizer) | `oxo-ws-fn` (route handler) |
|------|-------------------------------|------------------------------|
| Read HMAC secret | **yes** (verify) | no |
| Read `Games` `code-index` (guest code path) | **yes** (`GetItem`/`Query`) | already has it |
| Write `ConnectAttempts` (`UpdateItem`/`PutItem`) | **yes** | no |
| `execute-api:ManageConnections` (fan-out) | **NO** | yes |
| Conditional `UpdateItem` on `Games` (join/register) | **NO** | yes |
| `PutItem`/`DeleteItem` on `Connections` | **NO** | yes |

The two functions have **disjoint privilege profiles**. Folding the authorizer
into `oxo-ws-fn` would force the most-privileged principal in the project
(`ManageConnections` + `Games` write + `Connections` write) to ALSO read the
HMAC secret and write `ConnectAttempts` — a strictly larger blast radius on a
principal that is reachable per WS message. A separate authorizer keeps each
role exactly scoped: the authorizer can *gate* but cannot *act on game state*;
the handler can *act* but holds no secret and cannot touch the rate counter.
APIGW also invokes the authorizer on a different lifecycle (`$connect`
pre-handler) than the route handler, so the separation matches the runtime
boundary. Cost of a second function is negligible (scale-to-zero). **Decision:
separate function.**

---

## 3. Decision — authorizer result cache TTL = 0 (caching DISABLED)

`AuthorizerResultTtlInSeconds: 0`. Rationale:
- Per-IP counting is only accurate if the authorizer runs on **every** connect;
  a non-zero TTL caches the Allow/Deny per `(identitySource, routeArn)` and
  skips the `ConnectAttempts` increment, degrading the per-IP control to
  near-useless (the slice's honest-limitation note acknowledged this).
- The host `wsToken` has a 60s expiry and is single-use-ish (one connect right
  after create); caching buys nothing.
- The guest `code` path's correctness (game must be `waiting`/`active`) is a
  *current* state check — a cached Allow could admit a connect after the game
  filled. TTL 0 keeps it current.
- Cost: one authorizer invocation + one DynamoDB `UpdateItem` per connect.
  Connect rate is bounded above by the WS stage throttle (20/40) — negligible.

This makes the per-IP counter **as accurate as the design allows**; the residual
best-effort caveat (a determined attacker cycling source IPs, or the inherent
race in a read-less ADD counter) is documented in
`security/dynamodb-connectattempts.md`, not hidden by caching.

---

## 4. Decision — HMAC secret in SSM SecureString, read at cold start, shared by parameter name

**Chosen: a CDK-generated 32-byte secret stored in an SSM Parameter
(SecureString), both Lambdas read it by parameter name at cold start and cache
in module scope.**

Weighing (thin-but-sound):

| Option | Rotation | Exposure | Cost / latency | Verdict |
|--------|----------|----------|----------------|---------|
| Plaintext Lambda **env var** | redeploy both fns to rotate; value visible in console/`GetFunctionConfiguration` to anyone with that read | secret sits in two function configs | fastest (no fetch) | rejected — secret in plaintext config violates skill §8 Lambda checklist "no secrets in plaintext env" |
| **SSM SecureString**, fetched at cold start, module-cached | rotate by updating one param + forcing cold start; single source of truth | secret in one encrypted store; functions hold it only in memory | one `ssm:GetParameter WithDecryption` per cold start (~10–30ms, amortised across warm invocations) | **chosen** |
| Secrets Manager | built-in rotation lambda | one store | higher cost ($0.40/secret/mo + per-call); rotation tooling we are explicitly NOT building this slice | over-spec for a 32-byte HMAC key on a hobby game |

SSM SecureString is the thin-but-sound middle: it satisfies the
no-plaintext-secret control, gives a single source of truth, and the cold-start
fetch is amortised by module-scope caching. Secrets Manager's rotation tooling
is out of scope (slice §"not in scope: token rotation tooling"); env-var
plaintext fails the security checklist.

**Sharing mechanism (named, §30-pinned below):** one SSM parameter
`/oxo-online/prod/ws-token-secret` (SecureString). The CDK `Secret`/SSM construct
is created **once** in `OxoGameProd`; its parameter **name** is injected as the
env var `WS_TOKEN_SECRET_PARAM` into BOTH `oxo-game-fn` (mint) and
`oxo-ws-auth-fn` (verify). Both execution roles get
`ssm:GetParameter` (+ `kms:Decrypt` on the SSM-managed key) on **that one
parameter ARN only**. Mint and verify therefore provably read the same key
material — the synth contract asserts the single shared source.

> Note on CDK generation: an SSM `SecureString` cannot be auto-generated by a
> plain `StringParameter` (CFN does not generate SecureString values). The
> sound CDK pattern is a **`secretsmanager.Secret`** (which CAN generate a random
> value) OR an SSM SecureString seeded by a custom resource. To keep the
> "thin" promise while still generating the value, the engineer MAY use a
> `secretsmanager.Secret` (generated 32-byte value) and read it via
> `ssm`-style cold-start fetch — the *control that matters* (encrypted at rest,
> single source, read-scoped to two roles, not in plaintext env) holds either
> way. The delta pins the **control**, not the construct class; the engineer
> picks the construct that generates a value without a manual step (keeps §19
> trunk-CD: no manual secret-seeding step). **Flagged for the engineer:** if
> they choose `secretsmanager.Secret`, the two roles get `secretsmanager:
> GetSecretValue` on that one secret ARN instead of `ssm:GetParameter`; the
> single-shared-source contract (SYNTH-CONTRACT-H2-2) still applies.

---

## 5. Authorizer response format — PIN THIS (platform semantic; bitten twice)

**WebSocket API REQUEST authorizers use the REST-style IAM-policy response, NOT
the HTTP-API-v2 "simple" `{ "isAuthorized": true }` response.** This is the
class of platform semantic that has cost this project before — pin it explicitly.

The authorizer MUST return:

```jsonc
{
  "principalId": "<opaque, e.g. gameId or 'anon'>",
  "policyDocument": {
    "Version": "2012-10-17",
    "Statement": [{
      "Action": "execute-api:Invoke",
      "Effect": "Allow",            // or "Deny"
      "Resource": "<methodArn from event.methodArn>"
    }]
  },
  "context": { "gameId": "...", "role": "host" }   // optional, surfaced to $connect
}
```

- **Allow** = `Effect: "Allow"`. **Deny** = `Effect: "Deny"` (APIGW turns this
  into a 403 on the WS upgrade). Returning the v2 simple `{isAuthorized}` shape
  on a WebSocket authorizer is **not honoured** — the connection behaviour is
  undefined/erroring. This is the single most likely wiring mistake.
- This is enforced two ways: (a) the authorizer unit tests assert the returned
  object shape is `{principalId, policyDocument:{Statement:[{Effect}]}}` (AC2.3–
  AC2.9 reference the policy response, not a boolean); (b) the walking-skeleton
  probe (§0) is the live proof that APIGW accepts the shape.

---

## 6. Local / prod gap list (v28 — design for local standability)

| Concern | Stands locally? | Cloud-only? | Covering control |
|---------|-----------------|-------------|------------------|
| HMAC mint logic (`oxo-game-fn`) | **local** — pure function, unit-testable (AC1.1–AC1.4) | no | unit tests |
| HMAC verify + expiry + all four authorizer branches | **local** — pure logic over a faked `event`; DynamoDB via local adapter/mock (AC2.3–AC2.9) | no | unit tests (hexagonal: the DynamoDB calls are behind a port; tests substitute a fake) |
| Per-IP counter increment logic (ADD + conditional TTL set) | **local** — logic unit-testable against a DynamoDB-local / mock | no | unit test + AC6.2 prod check |
| **APIGW authorizer attachment + invocation** | **NO** — APIGW must actually invoke the authorizer on `$connect` | **cloud-only** | **walking-skeleton probe (§0)** + AC2.10 prod validation |
| **Authorizer result-cache semantics** (TTL 0 honoured; Deny not cached) | **NO** — platform behaviour | **cloud-only** | walking-skeleton probe (deny then allow with distinct tokens) + UC6 best-effort validation |
| **Authorizer response-format contract** (WS REST-policy shape accepted) | partial — shape is unit-asserted locally, but *acceptance by APIGW* is platform | **cloud-only for acceptance** | **synth pin + walking-skeleton probe (§0/§5)** — this is the platform-semantic class that bit twice; pinned explicitly |
| SSM/Secret read at cold start | **local** — secret via env/local param in dev; same code path | the *encrypted-at-rest + scoped-read* property is cloud-only | synth contract (role grant scoped to one ARN) + prod IAM check |
| SPA query-string append (`?wsToken=` / `?code=`) | **local** — SPA URL-construction unit test (AC3.1, AC4.1) | no | unit test; existing browser smoke (UC7) covers the deployed flow |

Conclusion: all *logic* stands locally behind ports; the genuinely cloud-only
items are the **authorizer attachment, its caching semantics, and the WS
response-format acceptance** — each covered by the §0 walking-skeleton probe
and prod validation, with the response-format additionally pinned at synth.

---

## 7. §30 contracts (synth-asserted)

- **SYNTH-CONTRACT-H2-1 (authorizer attachment):** the synth template contains an
  `AWS::ApiGatewayV2::Authorizer` with `AuthorizerType: REQUEST` referencing
  `oxo-ws-auth-fn`, AND the `$connect` route has `AuthorizationType: CUSTOM`
  with `AuthorizerId` pointing at it. (Asserts the gate is actually on the route,
  not merely defined.)
- **SYNTH-CONTRACT-H2-2 (single shared secret source):** `oxo-game-fn` and
  `oxo-ws-auth-fn` reference the **same** secret resource (same SSM parameter
  name / same Secret ARN) via their env var, and each role's read grant targets
  that one ARN. (Mint and verify provably use the same key.)
- **SYNTH-CONTRACT-H2-3 (cache disabled):** the authorizer's
  `AuthorizerResultTtlInSeconds` is `0`. (Guards the per-IP-accuracy decision §3
  against silent regression to the 300s default.)
- **Code↔policy pins (narrow grants on the new fn):**
  - CP-H2-A: `oxo-ws-auth-fn` role has `dynamodb:GetItem`/`Query` scoped to the
    `Games` table + `code-index` GSI ARNs only — no `Scan`, no `UpdateItem` on
    `Games`, no `Connections`, no `ManageConnections`.
  - CP-H2-B: `oxo-ws-auth-fn` role has `dynamodb:UpdateItem`+`PutItem` on the
    `ConnectAttempts` table ARN only.
  - CP-H2-C: `oxo-ws-auth-fn` role has secret read (`ssm:GetParameter`
    +`kms:Decrypt`, or `secretsmanager:GetSecretValue`) on the **one** shared
    secret ARN only; `oxo-game-fn` gains the same single-ARN read grant.
  - CP-H2-D: neither secret-reading role gains `iam:*`, `execute-api:*`, or any
    wildcard resource.

---

## 8. Version identity (principles/01)

`oxo-ws-auth-fn` MUST emit its **build SHA** on every structured log line
(field `buildSha`, sourced from a CDK-injected `BUILD_SHA` env var — the same
carrier pattern already used by `oxo-game-fn`/`oxo-ws-fn`). The authorizer is a
new deployable surface; without a readable build identity in its CloudWatch logs
the design is incomplete. The Allow/Deny decision log line (used by SM-1/SM-2
and the §0 probe) therefore also identifies *which build* made the decision.

---

## 9. Deploy-role grants — NONE new required (confirmed)

- `oxo-ws-auth-fn` and `ConnectAttempts` are created by **CDK/CloudFormation via
  the CDK bootstrap execution role** in the infra pipeline (`infra-oxo-online.yml`),
  not by the `oxo-deploy` app-pipeline role. Per `STACK_ORDER.md` "Lambda
  code-deploy ownership (OI-24)", **all Lambda code deploys are owned by CDK
  `fromAsset`** — the app pipeline no longer hot-swaps any function. The
  authorizer's code rides the same CDK asset path; the app pipeline never calls
  `UpdateFunctionCode` on it.
- Therefore: **no new `oxo-deploy` statement** (no `lambda:CreateFunction`,
  no new `UpdateFunctionCode` ARN, no new DynamoDB/SSM grant on the deploy role).
  The slice.md's tentative "`lambda:CreateFunction`…architect to confirm" is
  resolved: **not needed** — function lifecycle is CDK-owned under bootstrap
  trust. The execution-plane IAM (the authorizer's own role + the two secret-read
  grants) is created by the CDK CloudFormation exec role, preserving the
  no-self-escalation property (`oxo-deploy` still has no `iam:*`).
- **Confirmed: DEPLOY_ROLE_EXTENSIONS.md needs no s005-h2 section.**

---

## 10. §19 trunk-CD corollary — prerequisite ordering

- **No manual pre-push step.** The shared secret is **CDK-managed in-stack**
  (`OxoGameProd`), created in the same deploy that wires the two env vars and the
  two read grants — config-follows-resource is satisfied within one stack, one
  deploy. There is no "seed the secret first" manual step (that is exactly why a
  *generated* value is required — see §4 note to the engineer).
- Deploy order is **unchanged**: `OxoOnlineWafUsEast1` → `OxoGameProd` →
  `OxoOnlineProd`. All new resources are inside `OxoGameProd`; no new cross-stack
  import, so `OxoOnlineProd`'s position is untouched.
- Within `OxoGameProd`, CloudFormation orders: secret → (env wiring on both fns
  + read grants) → authorizer → `$connect` route attachment. CDK's dependency
  graph derives this from the references; no manual sequencing.

---

## 11. Region

**All eu-west-2.** No new region, no exception needed. The us-east-1 footprint
remains exactly the `OxoOnlineWafUsEast1` WebACL from h1 (control-plane only).
The authorizer, `ConnectAttempts`, and the secret are all eu-west-2, co-located
with the WS API and `Games` table they act on. Confirmed against the region
policy: single-region default holds; the only standing exception (CLOUDFRONT
WebACL must be us-east-1) is unchanged by this slice.

---

## 12. What this delta does NOT change (anti-build-ahead)

No identity/accounts (C6), no reconnect, no move relay (s006), no `$disconnect`
work, no CloudFront WS proxying, no token rotation tooling, no hard per-IP
guarantee. The guest "code-as-credential before declaring join intent" gap is
deliberately left open (closed by C6) — see the security conclusion.

---

## 13. Reversal conditions

- If authorizer cold-start latency on the secret fetch pushes `$connect` p95 over
  budget, move the secret to a Lambda extension cache or provisioned concurrency
  on the authorizer (still no plaintext env).
- If the best-effort per-IP counter proves insufficient against a real attacker
  (IP-cycling), the reversal is to front the WS path with CloudFront and attach
  the global WebACL (per the h1 reversal log entry) — at which point edge per-IP
  WAF becomes available and the authorizer keeps only the capability check.

(No new entry to the skill reversal log is required — this slice *implements* the
control the h1 reversal-log row already named as the home for per-IP WS control.)
