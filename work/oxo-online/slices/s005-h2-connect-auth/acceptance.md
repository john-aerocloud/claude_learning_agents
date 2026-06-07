---
slice: s005-h2
slug: connect-auth
gate: GATE-2-H2 (standing approval)
---

# Acceptance — s005-h2: $connect authorisation + per-IP rate-limiting

Two case classes:
- **F-cases (product / customer-observable)** — owned by Product. **TODO: not
  yet authored.** This is a hardening slice with no new user-visible feature;
  the customer-observable conditions are the regression smokes (existing host/
  guest pairing still completes) and "an abusive connect is rejected". Product
  to confirm/expand. Placeholder set below, to be replaced by Product.
- **T-cases (technical / observable)** and **S-cases (security policy)** — owned
  by Solution Architect (this document). They encode the delta's checkable
  conditions and the security notes, tagged to the use cases (UC1–UC7).

The acceptance cases AC1.x–AC7.x already enumerated in `use-cases.md` remain the
functional contract; the T/S cases below are the architecture/security overlay
the tester turns into synth-contract, policy, and prod-validation specs.

---

## Product (F) cases — TODO (Product to author)

- **F1 (TODO):** A host can create a game and reach the waiting screen, then the
  board, exactly as before s005-h2 (no visible change). [tag: UC3, UC7]
- **F2 (TODO):** A guest can join by code and both players see the board within
  3s, exactly as before. [tag: UC4, UC7]
- **F3 (TODO):** Local two-player and vs-AI games are unaffected. [tag: UC7]
- **F4 (TODO):** An attempt to connect to a game without a legitimate
  credential does not disrupt legitimate players. [tag: UC5]

> Product: replace the above with customer-framed cases. The technical
> rejection/observability detail lives in the T/S cases below — F-cases should
> stay customer-observable.

---

## Technical (T) cases — observable / synth / prod-validation

### T1 — Authorizer attached to $connect (SYNTH-CONTRACT-H2-1) [UC2]
CDK synth template contains `AWS::ApiGatewayV2::Authorizer` with
`AuthorizerType: REQUEST` referencing `oxo-ws-auth-fn`, AND the `$connect` route
has `AuthorizationType: CUSTOM` with that `AuthorizerId`. (Asserts the gate is on
the route, not merely defined.) Prod: `aws apigatewayv2 get-authorizers` lists
it (AC2.10).

### T2 — Authorizer cache disabled (SYNTH-CONTRACT-H2-3) [UC2]
The authorizer's `AuthorizerResultTtlInSeconds` is `0` in synth. Guards the
per-IP-accuracy decision against silent regression to the 300s default.

### T3 — Single shared secret source (SYNTH-CONTRACT-H2-2) [UC1, UC2]
`oxo-game-fn` and `oxo-ws-auth-fn` reference the **same** secret resource (same
SSM parameter name / same Secret ARN) via their env var; each role's read grant
targets that one ARN. Mint and verify provably use the same key. (Synth test.)

### T4 — Authorizer response format is the WS IAM-policy shape [UC2]
Authorizer unit tests assert the returned object is
`{ principalId, policyDocument: { Version, Statement: [{ Action:
"execute-api:Invoke", Effect: "Allow"|"Deny", Resource: <methodArn> }] } }` —
**NOT** the HTTP-v2 simple `{ isAuthorized }` shape. (This is the
platform-semantic pin from delta §5.)

### T5 — ConnectAttempts table shape [UC2]
Synth: `AWS::DynamoDB::Table` `ConnectAttempts` with PK `sourceIp` (S), no sort
key, `PAY_PER_REQUEST`, SSE present, `TimeToLiveSpecification` enabled on `ttl`.
Prod: `aws dynamodb describe-table` shows TTL enabled (AC2.11).

### T6 — Walking-skeleton probe (new-mechanism §30) [UC2 → before UC3/UC4]
One real `wss://` connect with garbage/no token → rejected at `$connect` (HTTP
403 upgrade), `oxo-ws-fn` `Invocations` flat, authorizer Deny log line present.
One with a valid host `wsToken` → accepted, `oxo-ws-fn` `$connect` reached.
Runs **before** UC3/UC4 build out on the authorizer. (Proves attachment +
invocation + accepted response shape + deny short-circuit.)

### T7 — wsToken mint contract [UC1]
`POST /api/games` response includes `wsToken` = `<b64url(payload)>.<b64url(sig)>`
where payload decodes to `{ gameId, role:"host", exp }`, `exp` within 60s of
request, signature verifies with the shared secret; `gameId`/`code` unchanged
(AC1.1–AC1.6).

### T8 — SPA query-string construction [UC3, UC4]
Host SPA builds `wss://…/prod?wsToken=<token>` (AC3.1); guest SPA builds
`wss://…/prod?code=<CODE>` (AC4.1). Unit/component tests. No new CSP directive
(query-string add to the already-permitted `connect-src` wss origin).

### T9 — Build-identity carrier (principles/01) [UC2]
`oxo-ws-auth-fn` structured log lines carry a `buildSha` field (from CDK-injected
`BUILD_SHA` env). The Allow/Deny decision log line is build-identifiable.
Verifiable in CloudWatch (prod validation).

### T10 — No new deploy-role grant; no manual deploy step [UC2, UC7]
Synth/IaC review: `oxo-ws-auth-fn` + `ConnectAttempts` + the secret are
CDK/CFN-managed in `OxoGameProd` (bootstrap-trust exec role); `oxo-deploy` gains
no new statement; the secret value is generated in-stack (no manual seed).
Pipeline deploys end-to-end with no manual step (AC7.5, AC7.6, SM-7).

---

## Security-policy (S) cases — least-privilege / encryption / exposure

### S1 — Authorizer role: disjoint, gate-only [UC2] (CP-H2-A/B/C/D)
`oxo-ws-auth-fn` role has ONLY: `dynamodb:GetItem`/`Query` on `Games` table +
`code-index` GSI ARNs; `dynamodb:UpdateItem`/`PutItem` on `ConnectAttempts` ARN;
secret read on the one shared secret ARN; own log group. It has **NO**
`execute-api:ManageConnections`, **NO** `Games` write, **NO** `Connections`
access, **NO** `dynamodb:*`/`iam:*`/wildcard. (Policy test on the synthesised
role.)

### S2 — oxo-game-fn gains only the one secret-read grant [UC1]
`oxo-game-fn` role gains secret read on the **one** shared secret ARN only;
retains `dynamodb:PutItem` on `Games`; no other new permission. (Policy test.)

### S3 — Secret is encrypted at rest, never in plaintext env/logs [UC1, UC2]
The WS-token secret is an SSM SecureString / Secrets Manager Secret (encrypted at
rest); it is NOT present as a plaintext Lambda env var on either function; the
authorizer never logs the secret or returns it in `context`. (Synth + code
review + log-content check.)

### S4 — ConnectAttempts table controls [UC2]
On-demand, SSE enabled, TTL on `ttl` (~5-min items), no resource policy with
`Principal:'*'`, PITR off (deliberate). Access granted to `oxo-ws-auth-fn` only
(`UpdateItem`/`PutItem`); `oxo-ws-fn` and `oxo-game-fn` have NO access. (Policy
test.)

### S5 — Unauthenticated / bad-token connect is Denied before game logic [UC5]
A `$connect` with no credential, a tampered `wsToken`, an expired `wsToken`, or a
non-existent `code` returns Deny (HTTP 403 upgrade) and yields **zero**
`oxo-ws-fn` invocations (CloudWatch `Invocations` flat). (AC5.1–AC5.5;
authoritative closure of OI-2.)

### S6 — sourceIp is server-derived [UC2, UC6]
The per-IP key is `event.requestContext.identity.sourceIp` — never a
client-supplied header/param. (Code review + unit test.)

### S7 — Per-IP budget Denies over threshold (best-effort) [UC6]
With distinct tokens (cache TTL 0), N>threshold rapid connects from one IP yield
Deny on the over-threshold attempts; `ConnectAttempts[sourceIp].count` >=
threshold (AC6.1–AC6.2). Tester records the best-effort caveat (OR-H2-a) in
output (AC6.4). Counter expires after the 5-min TTL (AC6.3, optional).

### S8 — Open-risk register (carried, accepted at Gate-2) [UC2]
- **OR-H2-a:** per-IP budget is best-effort (read-less counter + IP-cycling);
  layered with stage throttle 20/40 + reserved concurrency. Reversal:
  CloudFront-front WS → edge WAF.
- **OR-H2-b:** guest code-as-credential allows a valid-code holder to open a WS
  pre-join; bounded by the `oxo-ws-fn` no-hijack conditional write; closed by C6.
These are deliberate and bounded, not missed risks. (Documented; no test action
beyond ensuring they remain documented — guards against silent scope creep.)

---

## Coverage map (T/S cases → use cases)

| UC | T-cases | S-cases |
|----|---------|---------|
| UC1 (wsToken mint) | T3, T7, T8 | S2, S3 |
| UC2 (authorizer + table infra) | T1, T2, T3, T4, T5, T6, T9, T10 | S1, S3, S4, S6, S8 |
| UC3 (host flow) | T8 | — |
| UC4 (guest flow) | T8 | — |
| UC5 (reject bad connect) | — | S5 |
| UC6 (per-IP burst) | — | S6, S7 |
| UC7 (regression + pipeline) | T10 | — |

Counts: **10 T-cases, 8 S-cases** (+ 4 placeholder F-cases for Product to author).
