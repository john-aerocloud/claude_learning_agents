# Delta 005 — Join game by code (WebSocket connect + game-ready)

## Decision: FULL delta (arch-lite §21 does NOT apply)
This slice introduces, for the first time: long-lived client connections, a new
**API Gateway WebSocket API**, a new **Connections** DynamoDB table, a new
**Lambda principal** (`oxo-ws-fn`) holding write access to *two* tables plus
`execute-api:ManageConnections`, and a new GSI on `Games.code`. That is new
attack surface, a new data flow, and a new trust boundary. The security review
below is gated and mandatory.

Scope discipline: still no move relay, no server-authoritative board, no
`$disconnect` handling, no reconnect, no WAF. We build exactly the pairing path
the slice authorises and nothing from later chunks.

---

## What changes (new resources)

### CDK — WebSocket API lives in the EXISTING `OxoGameProd` stack (decided)
The WebSocket API, its `prod` stage, `oxo-ws-fn`, the `Connections` table, and
the `Games.code` GSI are all added to the **existing `OxoGameProd` stack** — not
a new stack. Justification:

- **Cohesion / single ownership of game state.** `oxo-ws-fn` reads and writes the
  same `Games` table that `OxoGameProd` already owns, and the new `Connections`
  table is part of the same ephemeral-game-state bounded context. Splitting the
  WS API into its own stack would force a cross-stack grant of `Games` (table ARN
  + GSI ARN) and a cross-stack `Connections` reference, multiplying the
  string-passed boundaries §30 must then cover — for no blast-radius benefit. The
  game backend is one deployable unit.
- **Blast radius is already correct.** The SPA/edge stack (`OxoOnlineProd`) stays
  separate from the backend; that is the boundary that matters. Adding WS to
  `OxoGameProd` keeps "all game backend" in one stack and "all edge/SPA" in the
  other — the same split s004 established.
- **No new cross-stack import is created for the data plane.** Because the SPA
  connects **directly** to the WSS endpoint (slice decision — not via CloudFront),
  `OxoOnlineProd` does **not** need to import the WS endpoint as a CloudFront
  origin. There is therefore **no new CloudFront↔API boundary** like s004's
  `/api/*`. The only handoff is the wss URL into the SPA build (see §30 below),
  which is a build-time config injection, not a CloudFormation import.

Stack count stays at three (`OxoOnlineOidcStack`, `OxoGameProd`, `OxoOnlineProd`).
Deploy order is unchanged: `OxoGameProd` then `OxoOnlineProd`.

### API Gateway WebSocket API + `prod` stage
- New `AWS::ApiGatewayV2::Api` with `ProtocolType: WEBSOCKET`,
  `RouteSelectionExpression: $request.body.action`.
- Routes: `$connect`, `$disconnect` (stub — no-op handler in this slice),
  `register` (host binds its connection to a game), `join` (guest joins by code).
  All four integrate the single `oxo-ws-fn` Lambda (AWS_PROXY).
- A `prod` stage (`AWS::ApiGatewayV2::Stage`, `StageName: prod`,
  `AutoDeploy: true`). WSS/TLS 1.2+ enforced by the service.
- **Route-level throttling** set on the stage default route settings
  (`ThrottlingBurstLimit` / `ThrottlingRateLimit` at a low hobby cap) — this is
  the in-slice abuse control standing in for WAF (see security; WAF deferred).

### `oxo-ws-fn` Lambda (new function)
- Runtime Node.js 20.x, memory 256–512MB, timeout 5s (WS handler does a GSI
  query + conditional update + up to two `@connections` posts).
- **Reserved concurrency cap** set (small, e.g. 10–20) — bounds cost/abuse on an
  unauthenticated WS endpoint. This is a named in-slice control.
- Fixed `functionName: 'oxo-ws-fn'` so the app pipeline can
  `update-function-code` by stable name (same pattern as `oxo-game-fn`).
- Env vars (none secret): `GAMES_TABLE`, `GAMES_CODE_INDEX` (GSI name),
  `CONNECTIONS_TABLE`, `WS_API_ENDPOINT` (the `@connections` management endpoint
  derived from the API id + stage, injected by CDK).
- No VPC (managed services only — consistent with current.md §Network).

### DynamoDB `Connections` table (new)
- Partition key: `connectionId` (String).
- Attributes: `connectionId`, `gameId` (nullable at `$connect`, set on
  register/join), `role` (`host`|`guest`, set on register/join), `ttl` (epoch
  seconds, **+2h**).
- TTL attribute `ttl`, enabled. On-demand billing. SSE enabled (AWS-owned key).
- PITR OFF — ephemeral connection map; deliberate cost choice.

### `Games.code` GSI (new — deferred from s004 as planned)
- GSI `code-index`: partition key `code` (String). Projection: `KEYS_ONLY` plus
  the attributes the join handler needs to validate and act
  (`status`, `hostConnectionId`, `guestConnectionId`) — i.e. `INCLUDE` those, or
  `ALL` if simpler; keep projection minimal.
- This is the lookup-by-code path the s004 delta explicitly deferred here.
- **Collision note:** s004 left collision handling to s005. For this slice the
  practical control is that `code` is high-entropy enough for hobby volume; a
  hard uniqueness guarantee (conditional-put on a `code`-keyed item or a retry
  loop on the GSI) is recorded as a follow-up but is not load-bearing for the
  pairing flow because a duplicate code only risks a join hitting the wrong
  waiting game — mitigated by the `status=waiting` + `guestConnectionId=null`
  conditional write. Flagged as an open risk for the gate.

### `Games` item — new attributes written by the join/register flow
- `hostConnectionId` (set by `register`), `guestConnectionId` (set by `join`),
  `status` transitions `waiting` → `active` on successful join.
- All writes are **conditional** (see no-hijack control in security).

### SPA — runtime wss URL config injection
- The SPA reads the WebSocket endpoint from a runtime config
  (`window.OXO_CONFIG.wsUrl` or equivalent), **not** a build-time constant baked
  per environment. The deploy step writes the `wss://<api-id>.execute-api.<region>.amazonaws.com/prod`
  value into the config artifact uploaded to S3, sourced from the
  `OxoGameProd` CfnOutput `OxoGameProd-WsApiEndpoint`.

### CfnOutputs (new) — and the s004 export-ordering lesson
- `OxoGameProd` exports `OxoGameProd-WsApiEndpoint` (the wss invoke URL incl.
  `/prod` stage) and `OxoGameProd-WsApiId` (for the deploy/config step).
- **s004 lesson applied:** do NOT remove or rename an existing `exportName` while
  another stack still imports it (CloudFormation refuses to delete an export that
  is in use; this caused friction in s004). New exports are additive only. The
  `/api/*` HTTP export (`OxoGameProd-HttpApiEndpoint`) is untouched and still
  consumed by `OxoOnlineProd`. The new WS exports are **not** imported by
  `OxoOnlineProd` (the SPA gets the URL via deploy-time config injection, not a
  CFN import), so they add zero new CloudFormation import coupling between stacks.

---

## §30 — cross-stack contract test for the wss URL handoff
s004's §30 boundary was CloudFront `/api/*` ↔ HTTP API route key, asserted by
synthesising both templates and matching the forwarded path to the route key.

s005's boundary is **different in kind**: the SPA does not reach the WS API
through CloudFront, so there is no CDN-behaviour↔route-key path to match. The
contract that crosses an ownership boundary here is the **wss URL handoff**:
`OxoGameProd` *produces* the WS endpoint; the *deploy/config-injection step*
(owned by the pipeline / `OxoOnlineProd` SPA artifact) *consumes* it, and the SPA
*connects* with it. The §30 obligation is satisfied by a composed/synth contract
test that asserts:

1. `OxoGameProd` synthesises a `CfnOutput` with exact `exportName`
   `OxoGameProd-WsApiEndpoint`, and its value resolves to the `prod`-stage WSS
   invoke URL of the WebSocket API (id + `/prod`), not a placeholder.
2. The WebSocket API synthesises exactly the four expected route keys
   (`$connect`, `$disconnect`, `register`, `join`) — so the SPA's `action` values
   (`register`, `join`) literally match a synthesised `RouteKey`. (This is the WS
   analogue of "the forwarded path matches a route key" — the
   `$request.body.action` selector value the client sends must equal a route.)
3. The config-injection contract: the deploy step's config key the SPA reads
   (`wsUrl`) is fed from `OxoGameProd-WsApiEndpoint` — pinned as a test/assertion
   over the deploy script or the synthesised output name the script references, so
   a rename on either side fails at synth/CI, not in prod.

Net: the route-key/action match (item 2) is the directly synth-checkable §30
contract and MUST be in the composed test file; items 1 and 3 pin the URL handoff
so the s004 prod-404 defect class cannot recur for the WS surface.

---

## What does NOT change
- **S3 web bucket, OAC, `oxo-cf-oac`:** untouched.
- **CloudFront distribution / `/api/*` behaviour / Route 53 / ACM:** untouched.
  No CloudFront WebSocket proxying is added (slice decision) — the SPA connects
  directly to the WSS endpoint. `OxoOnlineProd` gains **no** new CFN import.
- **HTTP API `POST /games`, `oxo-game-fn`, its `PutItem`-only role:** unchanged.
  Create-game keeps working exactly as in s004.
- **`OxoGameProd-HttpApiEndpoint` export and its `OxoOnlineProd` import:**
  untouched (s004 export-ordering lesson — additive only).
- **Local two-player (s002) and vs-AI (s003) flows:** untouched; client-only.
- **OIDC trust (repo/branch scoping):** unchanged. `oxo-deploy` gains a scoped
  `lambda:UpdateFunctionCode`/`GetFunction` on the `oxo-ws-fn` ARN (same pattern
  as s004 for `oxo-game-fn`); still NO `iam:*` mutation actions.
- **No VPC.** **No Leaderboard table / `oxo-board-fn`** (C5).
- **Deferred (in target diagram, NOT built here):** move relay/fan-out,
  server-authoritative board, win/draw, `$disconnect` handling, reconnect, WAF,
  share-link UX.

---

## Deploy order & rollback posture
- **Deploy order unchanged:** `OxoGameProd` then `OxoOnlineProd`. The WS additions
  are all inside `OxoGameProd`; the SPA in `OxoOnlineProd` only needs the wss URL
  at deploy-time config injection, which reads the `OxoGameProd` output produced
  earlier in the same pipeline run.
- **GSI add is an in-place table update** (no table replacement) — additive,
  backfills automatically. Low risk.
- **Rollback:** all new resources are additive. Rolling back the `OxoGameProd`
  CloudFormation change set removes the WS API, `Connections` table, GSI, and
  `oxo-ws-fn` together; the s004 create-game path (HTTP API + `Games` +
  `oxo-game-fn`) is unaffected because it shares no mutated resource. The SPA
  rollback is a prior-artifact redeploy; if the wss URL config is absent the join
  screen must degrade to a readable error (not white-screen) — same graceful-
  degradation posture as s004's 5xx contract. Lambda code rollback is
  roll-forward (versioning not enabled — s004 default).

---

## Acceptance — technical/observable conditions (for `acceptance.md`, co-authored)
1. With a valid `waiting` game code, both host and guest connections receive a
   `game-ready` message (host role X, guest role O) within 3s of join.
2. After a successful join the `Games` item shows `status='active'`,
   `hostConnectionId` non-null, `guestConnectionId` non-null (CLI-verifiable).
3. Both `connectionId`s exist in `Connections` with `ttl` ~2h ahead.
4. Joining a non-existent code closes the socket with 4040 and the join screen
   shows the not-found message; `Games` is unchanged.
5. Joining an already-`active`/non-`waiting` game closes with 4041 and shows the
   no-longer-available message; the conditional write makes hijack impossible
   (the second joiner does NOT overwrite `guestConnectionId`).
6. `oxo-ws-fn` policy grants only: `GetItem`/`Query` on the `code-index` GSI +
   `UpdateItem` (conditional) on `Games`, `PutItem`/`DeleteItem` on `Connections`,
   `execute-api:ManageConnections` on **this WS API's ARN only** — no `*`.
7. Synth-time composed contract test passes: WS route keys
   (`$connect/$disconnect/register/join`) and the `OxoGameProd-WsApiEndpoint`
   output exist and the SPA `wsUrl` config is sourced from it.
8. Existing modes and create-game unaffected (regression).

---

## Security review — conclusion (GATE 3)

Per-resource security notes written/updated as checkable policy-test statements:
- `architecture/security/apigw-websocket.md` — new **s005 subset** section
  (transport, route surface, register/join connection binding, no-hijack
  conditional write, resource-exhaustion controls with WAF/authorizer deferral,
  data class).
- `architecture/security/dynamodb-connections.md` — **new file** (Connections
  table: PK, on-demand, SSE, 2h TTL, no public access, `oxo-ws-fn`
  Put/Delete-only scope, no PII).
- `architecture/security/dynamodb-games.md` — **s005 additions** section
  (`code-index` GSI, `oxo-ws-fn` Query/UpdateItem scope, no-hijack conditional
  writes for join and register, connectionId-from-context, code-uniqueness
  residual risk).
- `architecture/security/lambda-execution-roles.md` — **s005 `oxo-ws-fn`** role
  scoped exactly (GSI Query, conditional UpdateItem on Games, Put/Delete on
  Connections, ManageConnections on **this WS API ARN only — not `*`**, own log
  group, reserved concurrency, no `iam:*`).

**Is there new attack surface / data flow / trust boundary? YES — all three.**
- **New attack surface:** an unauthenticated, internet-reachable WebSocket
  endpoint (`wss://…/prod`) accepting long-lived connections and `register`/`join`
  actions — the project's first long-lived client connection and first WS API.
- **New data flow:** WS message → `oxo-ws-fn` → GSI query on `Games` →
  conditional `UpdateItem` on `Games` + `Put`/`Delete` on `Connections` →
  `@connections` fan-out of `game-ready` to two clients.
- **New trust boundary / principal:** `oxo-ws-fn` execution role — the most
  privileged principal so far (two tables + `ManageConnections`), scoped to ARNs.

### Enumerated open risks / deferred recommendations for the human gate
1. **No WAF on the WS endpoint.** Resource-exhaustion is bounded only by reserved
   concurrency + stage route throttling + 2h Connections TTL. Residual: an
   attacker can open connections up to account/throttle limits. *Deferred:* WAF
   rate rule before beyond-hobby volume.
2. **No `$connect` capability-token authorizer / no per-game join token.** The WS
   endpoint is fully unauthenticated; binding is capability-by-connection. A party
   who learns a `code` before the host registers could register/join. Bounded by
   high-entropy short-lived code + immediate host register + first-binder-wins
   conditional writes. *Deferred:* mint a per-game join token in create-game
   (already a target control in `apigw-http.md`) and verify it at `$connect`.
3. **Code-uniqueness not hard-guaranteed.** Duplicate `code` across two `waiting`
   games is possible (no conditional-put on code in s004/s005); a join could hit
   the wrong waiting game. Bounded by code entropy + the `status=waiting` +
   `guestConnectionId=null` conditional write. *Deferred:* code-uniqueness
   enforcement (conditional put or retry-on-collision).
4. **`$disconnect` is a stub.** Stale `Connections`/`Games` connection bindings
   are reaped only by TTL, not promptly on disconnect. *Deferred to s007.*

### Security controls ADDED by this slice (summary)
WSS/TLS-only; exactly four WS routes (no `$default` catch-all); connectionId
taken from request context (never client body); atomic no-hijack conditional
writes on `join` and `register`; `oxo-ws-fn` least-privilege (GSI Query +
conditional UpdateItem on Games + Put/Delete on Connections + ManageConnections
on this API ARN only); reserved concurrency + stage throttling as the in-slice
abuse floor; 2h TTL + SSE on Connections; no PII stored; `oxo-deploy` extension
ARN-scoped with no `iam:*`.
