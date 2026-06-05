# Delta 004 — Create game and receive shareable code (Chunk 4)

## Decision: first stateful backend — full delta path, security-gated
This is the project's **first** Lambda + DynamoDB + API Gateway. It introduces a
new internet-reachable endpoint and a new compute principal, so the lite path
does NOT apply. The architecture in `current.md` already reflects this at the C4
container level; this delta provisions the **minimum subset** of that target
needed for the host-side create-game step only.

Scope discipline: the WebSocket API, the `Connections` table, second-player
join, and move relay are all in the target diagram but are **deferred to s005+**.
We build exactly the create-game path.

---

## What changes (new resources)

### CDK — new stack `OxoGameStack` (`OxoGameProd`)
A **new** stack, deployed by GitHub Actions alongside `OxoOnlineProd`. Rationale:
- Keeps the static-hosting/edge stack (`OxoOnlineProd`: S3 + CloudFront + Route 53)
  separate from the application backend. Blast radius of a backend change does not
  touch the SPA distribution; the two iterate independently.
- The CloudFront distribution lives in `OxoOnlineProd`. To add the `/api/*`
  behaviour, the HTTP API's invoke domain is passed from `OxoGameStack` into the
  distribution. To avoid a hard cross-stack ordering cycle, the HTTP API uses a
  **stable custom domain** OR the distribution origin is wired via a CfnOutput /
  SSM parameter that `OxoOnlineProd` reads. **Recommended:** create the HTTP API
  in `OxoGameStack`, export its `apiId`/endpoint, and have `OxoOnlineProd` consume
  it as the `/api/*` origin (CDK cross-stack reference within one app — deploy
  order: `OxoGameProd` then `OxoOnlineProd`).

### DynamoDB `Games` table
- Partition key: `gameId` (String) — a UUID generated in the Lambda.
- No sort key (single-item-per-game document model).
- Attributes written at create: `gameId`, `code` (6-char), `status="waiting"`,
  `hostConnectionId=null`, `createdAt` (ISO), `ttl` (epoch seconds, +24h).
- **TTL attribute:** `ttl`, enabled. Abandoned `waiting` games self-delete.
- **Billing:** on-demand. **Encryption:** AWS-owned key (SSE default).
- **PITR:** OFF — deliberate cost choice; data is ephemeral (see security note).
- **Game `code` — generation strategy (decided):** generate a random 6-char
  code in the Lambda from an **unambiguous alphabet** (Crockford-style: exclude
  `0/O/1/I/L`), and **do NOT add a `code` GSI in this slice**. The code is not
  queried in s004 — nothing looks a game up by code until the join slice (s005).
  Collision handling is therefore deferred to s005 where the lookup is introduced;
  s005 will add the `code` GSI and a conditional-put collision check at that point.
  For s004 the `gameId` (a UUID) is the only key written, so there is **no
  uniqueness requirement yet** and no collision risk on persistence. Documented as
  an explicit deferral, not an oversight.

### Lambda `oxo-game-fn` (Game service — create only for s004)
- Runtime: **Node.js 20.x**. Memory 512MB. Timeout **3s**.
- Reserved concurrency: a small cap (e.g. 10) to bound cost/abuse blast radius
  while the endpoint is unauthenticated (see security — DDoS).
- Handler: HTTP API proxy integration. For s004 a single route handler that, on
  `POST /api/games`, generates `gameId` + `code`, `PutItem` to `Games`, returns
  `201 { gameId, code }`. Structured (JSON) CloudWatch logs.
- Env var: `TABLE_NAME` (the `Games` table name, injected by CDK at deploy).
- No secrets in env. No VPC attachment (managed services only — avoids ENI
  cold-start penalty).

### API Gateway HTTP API
- One route: `POST /games` (the SPA calls `/api/games`; CloudFront strips/maps
  the `/api` prefix via the origin path — see below). Lambda proxy integration.
- Default stage; built-in throttling left at account defaults for s004, with WAF
  deferred (see security). TLS 1.2+ enforced by the service.
- CORS: not required for the SPA path because CloudFront makes it **same-origin**.
  If any direct (non-CloudFront) access is configured it must restrict the origin
  to the production domain only — but the default is no direct access.

### CloudFront `/api/*` behaviour (added to `OxoOnlineProd` distribution)
- New cache behaviour, path pattern `**/api/***`, ahead of the default SPA behaviour.
- **Origin:** the HTTP API invoke domain (custom origin, HTTPS-only to origin).
- **Origin path:** maps `/api/*` to the API's `$default` (or named) stage so the
  Lambda sees `/games`. (e.g. origin path = the stage path; viewer `/api/games`
  → origin `/<stage>/games`.)
- **Caching: OFF** — use the AWS managed `CachingDisabled` policy. Responses are
  per-request and must never be cached.
- **Origin request policy:** forward all viewer headers needed by the API
  (use `AllViewerExceptHostHeader`), the request body, and the method. POST must
  be in the allowed methods list for the behaviour.
- **Viewer protocol:** redirect-to-HTTPS (inherited).

### IAM delta
- **`oxo-game-fn` (new execution role, Lambda-assumed):**
  `dynamodb:PutItem` on the `Games` table ARN **only** (s004 writes; no read/query
  needed yet). `logs:CreateLogGroup/CreateLogStream/PutLogEvents` on its own log
  group. No wildcard resource. (Broader RW + `execute-api:ManageConnections` from
  the target table in `current.md` is added in s005 when join/relay arrive.)
- **`oxo-deploy` (extend):** add `lambda:UpdateFunctionCode` scoped to the
  `oxo-game-fn` function ARN, and the minimal CloudFormation/CDK-bootstrap
  permissions needed to deploy `OxoGameStack` (assume the CDK
  `cdk-<qualifier>-deploy-role` via the bootstrap trust, OR grant the
  CFN/STS actions the CDK deploy uses). Deploy role still must NOT gain
  `iam:CreateRole`/`AttachRolePolicy`/`PutRolePolicy` for privilege-escalation
  safety — role creation is performed by the CDK CloudFormation execution role
  under the bootstrap trust, not by `oxo-deploy` directly.

---

## What does NOT change
- **S3 web bucket, OAC, `oxo-cf-oac` role:** untouched.
- **CloudFront default (SPA) behaviour, Route 53, ACM:** untouched; only a new
  `/api/*` behaviour is prepended.
- **Two-player (s002) and vs-AI (s003) flows:** untouched. They remain fully
  client-side; backend failure must not regress them (graceful degradation).
- **OIDC trust (repo/branch scoping):** unchanged.
- **Deferred to s005+ (in target diagram, NOT built here):** WebSocket API,
  `oxo-ws-authorizer` role, DynamoDB `Connections` table, `code` GSI, join
  lookup, move relay/fan-out, server win/draw detection.
- **Deferred to C5+:** `Leaderboard` table, `oxo-board-fn`.
- **No VPC** introduced (managed services only — consistent with current.md §Network).

---

## Acceptance — technical/observable conditions (for `acceptance.md`)
1. `POST /api/games` over the production CloudFront origin returns `201` with a
   JSON body containing `gameId` and a 6-char alphanumeric `code` within 3s.
2. A `Games` item exists with that `gameId`, `status="waiting"`, and a `ttl`
   ~86400s in the future (verifiable via CLI immediately after).
3. The `/api/*` behaviour is `CachingDisabled` (no caching of API responses).
4. Forcing a 5xx from the endpoint produces a user-readable error in the SPA and
   does NOT white-screen; the mode selector and s002/s003 modes stay usable.
5. `oxo-game-fn` policy grants only `PutItem` on the `Games` table ARN — no
   wildcard resource, no read/query, no other table.

---

## Security review

**New attack surface?** Yes. For the first time an anonymous internet user can
reach application compute: `POST /api/games` via CloudFront → HTTP API → Lambda.
Previously the only public surface was CloudFront serving static S3 content.

**New data flow?** A new write path: anonymous request → Lambda → `Games` table.
No new path for data *leaving* the system beyond the `{gameId, code}` response,
which contains no stored user data and no PII — it is server-generated identifiers.

**New trust boundary / principal?** Yes. The `oxo-game-fn` Lambda execution role
is a new principal with write access to the `Games` table. The `oxo-deploy` role
gains a narrow new capability (`UpdateFunctionCode` + CDK deploy of the game
stack). Both are ARN-scoped and least-privilege.

**Input validation:** The endpoint takes **no required input** — create-game has
no body fields the client controls that get persisted. The Lambda must:
- ignore/over-write any client-supplied `gameId`, `code`, `status`, or `ttl`
  (all are server-generated; never trust the body for these);
- reject non-POST methods and oversized bodies (API GW payload limit + reject
  bodies it does not expect);
- generate `gameId`/`code`/`ttl` server-side only.

**DDoS / abuse:** `POST /api/games` is unauthenticated, so each call writes a
DynamoDB item — an abuser could create unbounded `waiting` games. Controls in
**this slice**: (a) **Lambda reserved concurrency cap** bounds the write rate and
cost blast radius; (b) **24h TTL** auto-purges spam games so storage cannot grow
unboundedly; (c) on-demand DynamoDB absorbs spikes without availability loss.
**WAF is DEFERRED** to later in C4/C5 per `current.md` — rationale: WAF rate
rules should be tuned against real observed traffic, and the concurrency cap +
TTL give an adequate cost/availability floor for a hobby-volume launch. **Open
recommendation:** attach a WAF rate-based rule to the CloudFront distribution (and
the HTTP API) before promoting beyond hobby volume — tracked as a C4/C5 control.

**IAM minimality:** `oxo-game-fn` = `PutItem` on the single `Games` table ARN +
its own log group. No wildcard resources, no read/query, no second table.
`oxo-deploy` extension is function-ARN scoped and explicitly excludes
`iam:CreateRole`/`AttachRolePolicy`/`PutRolePolicy`.

**Data classification:** `Games` items hold `gameId`, `code`, `status`,
`createdAt`, `ttl`, `hostConnectionId(null)`. **No PII** — display names are C6.
The `code` is a low-value shareable token (it merely lets a friend join later);
it is server-generated from an unambiguous alphabet but is **not a secret** in
s004 because nothing can be done with it yet (join is s005). When join arrives,
s005 must treat the code/join as a capability with adequate entropy or pair it
with a per-game join token.

### Security conclusion
**New attack surface, new data flow, and a new trust boundary are introduced.**
Controls that address them:
- HTTPS-only edge and origin; TLS 1.2+ (CloudFront + API GW).
- `/api/*` behaviour is `CachingDisabled`; no caching of per-request responses.
- Server generates all persisted fields; client body is not trusted for
  `gameId`/`code`/`status`/`ttl`.
- `oxo-game-fn` least-privilege: `PutItem` on the `Games` table ARN only; no
  wildcard, no extra table, no read.
- `oxo-deploy` extension ARN-scoped to the function; no IAM-mutation actions.
- Cost/abuse floor: Lambda reserved concurrency cap + 24h DynamoDB TTL +
  on-demand billing.
- DynamoDB encrypted at rest; no public endpoint; reached only via the role.
- **Deferred control (open risk):** WAF rate-limiting on CloudFront + HTTP API,
  to be added later in C4/C5 against observed traffic.

Per-infra security notes updated: `dynamodb-games.md`, `apigw-http.md`,
`lambda-execution-roles.md`, `iam-deploy-role.md` (all narrowed to the s004
subset). No new files needed (target notes already exist from project setup).
