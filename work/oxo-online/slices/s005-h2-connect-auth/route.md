---
slice: s005-h2
slug: connect-auth
iteration: 8
agent: engineer
process-ref: §37 (use-case routing), §30 (skeleton probe + synth contracts + code↔policy pins), §41 (hexagonal-born), v28 (local stand-up gap-list honesty)
status: planned
---

# TDD route — s005-h2: $connect authorisation + per-IP rate-limiting

Strict TDD throughout: each step is a failing test (red) → minimum code (green) →
refactor → commit-when-green on trunk. Production code only after a failing test.
Explicit-pathspec commits; `git pull --rebase` before push (cicd runs
concurrently on workflows/capabilities — no file collision with these paths).

This is a HARDENING slice. The route is grouped by use case under four phases.
A use case is done when its own acceptance cases (AC*) + tagged T/S cases pass
independently. Counts to satisfy: 10 T-cases, 8 S-cases, AC1.x–AC7.x, success
measures SM1–7. F-cases are TODO (Product) — route is against T/S + SM, per brief.

---

## Hexagonal-born layout (this slice ADDS new lambda code — §41, OI-17)

OI-17 schedules the *existing*-code hexagonal refactor for s006. New code born
here is structured hexagonal from line one (the refactor then only moves old
code, not this):

```
src/lambda/
  token/                         # DOMAIN — pure, zero SDK/transport imports
    token.ts                     #   mint(payload, secret) / verify(token, secret, now) → Result
    rate-limit.ts                #   decideRateLimit(count, threshold) → Allow|Deny  (pure)
    ports.ts                     #   SecretSource, ConnectCounterPort, GameLookupPort (domain terms)
  games/                         # UC1 — existing handler; consumes token.mint via a SecretSource port
    handler.ts                   #   (extended) injects wsToken into 201 body
  ws-auth/                       # UC2 — NEW authorizer; adapters/tech folder for this fn
    authorizer.ts                #   orchestrates domain (verify | lookup | rate decision) — no policy shape
    adapters/
      apigw-authorizer.ts        #   ADAPTER: APIGW REQUEST event → domain input;
                                 #            domain decision → WS REST IAM-policy response (the PINNED shape lives ONLY here)
      ddb-connect-counter.ts     #   ADAPTER: ConnectCounterPort over DynamoDB UpdateItem(ADD)+conditional TTL
      ddb-game-lookup.ts         #   ADAPTER: GameLookupPort over Games code-index GSI Query
      ssm-secret-source.ts       #   ADAPTER: SecretSource over SSM GetParameter (WithDecryption) / SecretsManager
```

Dependency direction: adapters import domain; domain imports nothing concrete.
Domain is unit-tested with port FAKES. Each adapter has its own focused test.
**The WS REST-policy response shape (delta §5) lives in `apigw-authorizer.ts`
ONLY** — domain never sees `policyDocument`/`methodArn`. Pinned by an adapter
unit test (T4) AND the synth contract (T1).

Failure taxonomy (§41): adapter calls categorise failures — DDB/SSM 5xx/timeout
after retry = EXTERNAL DEPENDENCY FAILURE; 4xx from the service = INTERNAL
FAILURE (our bad request); validation of inbound token/code = 4xx-class. Each
authorizer failure path emits the category as a structured log field, and the
LOGGING IS TESTED (assert category/field per branch). `buildSha` (T9) on every
line.

---

# PHASE 1 — SET A (parallel, no cross-dependencies)

Two engineers may claim Set A. Claim boundaries below are file-disjoint except
the named secret-wiring seam (order pinned in §"Secret-wiring order").

## Claim A1 = UC1 — wsToken mint  (owns: src/lambda/token/*, src/lambda/games/*)
Tagged: T3, T7, T8(host-share→deferred to Phase 3), S2, S3 · AC1.1–AC1.6

- **S-A1.1 (domain, red→green)** [T7] `src/lambda/token/token.test.ts`: `mint({gameId,role:'host'}, secret, now)` returns `<b64url(payload)>.<b64url(sig)>`; payload decodes to `{gameId, role:'host', exp}`; `exp == now+60`. Pure, fixed clock injected. → `token/token.ts` mint.
- **S-A1.2 (domain, red→green)** [T7] verify round-trip: `verify(mint(...), secret, now)` → valid; wrong secret → invalid; tampered sig byte → invalid; `now>exp` → expired. (verify is built here, CONSUMED by UC2 — domain module is the shared seam, not a cross-UC file edit.) → `token/token.ts` verify.
- **S-A1.3 (port, red→green)** [S3] `token/ports.ts` defines `SecretSource { get(): Promise<string> }`. games handler depends on the port, NOT on SSM. Domain has no SDK import (assert by a lint/import test or review note).
- **S-A1.4 (handler, red→green)** [T7,AC1.1–AC1.4] `games/handler.test.ts`: 201 body now includes `wsToken`; decodes to correct `{gameId(matches body), role:'host', exp within 60s}`; signature verifies with the test secret (window assertion, no fixed-clock coupling to wall clock). Handler reads secret via a `SecretSource` fake. → extend `games/handler.ts` to mint + inject.
- **S-A1.5 (regression, red→green)** [T7,AC1.6,S2-code-side] existing `gameId`/`code`/`status`/201/clean-5xx assertions still pass; no field removed. (Pin the existing contract.)
- **S-A1.6 (adapter, red→green)** [S3] `ws-auth/adapters/ssm-secret-source.test.ts` is shared infra — BUT the SsmSecretSource adapter is consumed by BOTH fns. Build it under a shared path `src/lambda/token/adapters/ssm-secret-source.ts` (domain-adjacent, both fns import it). Adapter test: maps `SsmGetParameter(WithDecryption)` → string; module-caches; on SSM 5xx after retry emits `EXTERNAL_DEPENDENCY` category log + throws; on 4xx emits `INTERNAL`. **Logging asserted.**
- COMMIT (A1 green): "Mint short-lived host wsToken in POST /api/games via SecretSource port (UC1, T7, S2, S3)".

## Claim A2 = UC2 — authorizer + ConnectAttempts + secret infra
(owns: src/lambda/token/rate-limit.ts, src/lambda/ws-auth/* incl adapters, src/infra/lib/game-stack.ts, src/infra/test/*)
Tagged: T1, T2, T3, T4, T5, T6(probe→Phase 2), T9, T10 · S1, S3, S4, S6, S8 · AC2.1–AC2.11

### Domain + adapters (local-standable; gap-list §6 all "local" rows)
- **S-A2.1 (domain, red→green)** [S6] `token/rate-limit.test.ts`: `decideRateLimit(count, threshold)` → Deny when `count >= threshold`, Allow below. Pure. → `rate-limit.ts`.
- **S-A2.2 (port, red→green)** `token/ports.ts` adds `ConnectCounterPort { increment(sourceIp): Promise<number> }`, `GameLookupPort { findByCode(code): Promise<{status}|null> }`. Domain terms only.
- **S-A2.3 (authorizer orchestration, red→green)** [AC2.3–AC2.9,T4-input-side] `ws-auth/authorizer.test.ts` against port fakes — returns a domain DECISION (`{effect:'Allow'|'Deny', principalId, context?}`), NOT a policy doc:
  - AC2.3 valid host token → Allow
  - AC2.4 tampered token → Deny
  - AC2.5 expired token → Deny
  - AC2.6 valid guest code (fake lookup status `waiting`) → Allow; also `active` → Allow
  - AC2.7 code not found → Deny
  - AC2.8 no credential → Deny
  - AC2.9 count >= threshold → Deny **regardless of token validity** (rate check wins)
  - [S6] per-IP key is the server-derived sourceIp passed in by the adapter (domain receives it; never reads a header).
  - **Logging tested:** each Deny reason emits a structured category field; buildSha present.
- **S-A2.4 (adapter — THE PINNED SHAPE, red→green)** [T4] `ws-auth/adapters/apigw-authorizer.test.ts`: maps a REQUEST event (`event.queryStringParameters.wsToken`/`.code`, `event.requestContext.identity.sourceIp`, `event.methodArn`) → domain input; maps domain decision → **WS REST IAM-policy** `{principalId, policyDocument:{Version, Statement:[{Action:'execute-api:Invoke', Effect, Resource:methodArn}]}}` — assert it is NOT the v2 `{isAuthorized}` shape. [S6] asserts sourceIp comes from `requestContext.identity.sourceIp` only.
- **S-A2.5 (adapter, red→green)** [S4,CP-H2-B] `ddb-connect-counter.test.ts`: `increment` issues UpdateItem ADD `count` 1 + conditional first-write TTL set (now+300); returns new count; **code↔policy pin negative**: assert the adapter issues ONLY UpdateItem/PutItem against ConnectAttempts (no GetItem/Scan/Delete) — pins to the granted action set. Failure taxonomy + logging asserted.
- **S-A2.6 (adapter, red→green)** [CP-H2-A] `ddb-game-lookup.test.ts`: `findByCode` issues a Query on `code-index` GSI only (assert no Scan, no write command); maps item→`{status}`/null. Logging asserted.

### Infra synth (cloud-only gap-list rows — pinned at synth)
- **S-A2.7 (synth, red→green)** [T5,AC2.2,S4] `infra/test/game-stack.test.ts`: template has `ConnectAttempts` `AWS::DynamoDB::Table` — PK `sourceIp` (S), no sort key, `PAY_PER_REQUEST`, SSE present, `TimeToLiveSpecification` on `ttl` enabled, PITR off, no resource policy `Principal:'*'`. → game-stack.ts table.
- **S-A2.8 (synth, red→green)** [T1,AC2.1,SYNTH-CONTRACT-H2-1] template has `AWS::ApiGatewayV2::Authorizer` `AuthorizerType: REQUEST` referencing `oxo-ws-auth-fn`, `IdentitySource` = querystring wsToken + code; AND `$connect` route `AuthorizationType: CUSTOM` with that `AuthorizerId`. (Gate is ON the route.)
- **S-A2.9 (synth, red→green)** [T2,SYNTH-CONTRACT-H2-3] authorizer `AuthorizerResultTtlInSeconds: 0`.
- **S-A2.10 (synth secret + single-source, red→green)** [T3,SYNTH-CONTRACT-H2-2,S3] one generated 32-byte secret resource (secretsmanager.Secret OR SSM SecureString via generating construct — engineer picks the value-generating construct, no manual seed; control pinned not construct). Assert: BOTH `oxo-game-fn` and `oxo-ws-auth-fn` env carry the SAME secret name/ARN reference (single shared source); secret value NOT a plaintext env var on either fn.
- **S-A2.11 (policy, code↔policy pins, red→green)** [S1,CP-H2-A/B/C/D] policy test on synthesised `oxo-ws-auth-fn` role — ONLY: `dynamodb:GetItem`/`Query` on Games table + code-index GSI ARNs; `UpdateItem`+`PutItem` on ConnectAttempts ARN; secret read on the ONE shared ARN; own log group. **Negative assertions:** NO `execute-api:ManageConnections`, NO Games write, NO Connections access, NO `dynamodb:*`/`iam:*`/wildcard resource.
- **S-A2.12 (policy, red→green)** [S2,S4,CP-H2-C] `oxo-game-fn` role gains ONLY the one shared-secret read grant (retains Games PutItem; no other new perm). `oxo-ws-fn` and `oxo-game-fn` have NO ConnectAttempts access (negative assert on ConnectAttempts ARN).
- **S-A2.13 (synth, red→green)** [T9] `oxo-ws-auth-fn` has CDK-injected `BUILD_SHA` env (sha from pipeline, never hardcoded); authorizer log lines read it.
- **S-A2.14 (synth/IaC, red→green)** [T10,§9] assert no NEW `oxo-deploy` statement (fn + table + secret are CDK-exec-role-managed); review-pin DEPLOY_ROLE_EXTENSIONS.md unchanged. (Prereq §19: confirm none manual — secret generated in-stack.)
- **S-A2.15 (cross-stack contract, if applicable)** authorizer + WS API are in ONE stack (`OxoGameProd`); no cross-stack import added — assert deploy order unchanged (WafUsEast1 → OxoGameProd → OxoOnlineProd). Single-file synth where the $connect route + authorizer compose (path/route-key consistency of the gated route).
- COMMIT (A2 green, may be several green commits — one per coherent group): e.g. "Add oxo-ws-auth-fn REQUEST authorizer behind ports; WS REST-policy adapter (UC2, T1/T2/T4)", "Provision ConnectAttempts table + shared ws-token secret, single-source wired to both fns (UC2, T3/T5, S3/S4)", "Scope oxo-ws-auth-fn role to gate-only actions; negative least-privilege pins (UC2, S1, CP-H2-A/B/C/D)".

### §19 prerequisite confirmation (before first push)
None manual: secret is CDK-generated in-stack (delta §10); no seed step. The
**build-coverage of the new `src/lambda/ws-auth/` dir** (tsconfig include / jest
roots / bundling) is **cicd's concurrent capability task** — reference it; flag
to orchestrator if the new dir is not picked up by `make test-*`/synth bundling
(capability gap, not an engineer workaround).

---

## Secret-wiring order (the cross-UC seam — names which UC lands what, in order)

The shared secret + "both functions read it" wiring crosses UC1 and UC2. Order:

1. **UC2 (A2) lands the secret resource** in game-stack.ts (S-A2.10) AND the
   `oxo-game-fn` env var `WS_TOKEN_SECRET_PARAM` + the games-fn single-ARN read
   grant (S-A2.12). UC2 owns game-stack.ts entirely — UC1 does NOT touch infra.
2. **UC1 (A1) consumes the env** at runtime via the `SecretSource` port + the
   shared `ssm-secret-source` adapter. UC1's handler code reads
   `process.env.WS_TOKEN_SECRET_PARAM`; until A2 lands the env, UC1's unit tests
   inject a `SecretSource` FAKE (no infra dependency) so A1 is independently
   green. Prod minting only works once A2's deploy wires the env — that
   composition is proven by T3 (synth single-source) + the Phase-2 probe.
3. The `token/` domain module (mint in A1, verify in A2) is a **shared library
   seam, not a contested file**: A1 authors mint, A2 authors verify in the same
   module — sequence so mint lands first (verify's round-trip test imports it).
   If both engineers are live, A1 lands `token.ts` mint+verify together
   (S-A1.1+S-A1.2) and A2 imports it; A2 does not re-author token.ts.

**Independence statement:** A1 and A2 share ZERO contested files. game-stack.ts
is A2-only; games/handler.ts + token.ts are A1-only; ws-auth/* is A2-only.
The only coupling is the env-var NAME string (`WS_TOKEN_SECRET_PARAM`) and the
`token.ts` module — both pinned above. No hidden coupling.

---

# PHASE 2 — WALKING-SKELETON PROBE  (after Set A deploys; BEFORE Set B)

Tagged: T6 · SM-1, SM-2 · delta §0. Runs after the infra pipeline deploys
`OxoGameProd` (authorizer attached, table + secret live). This is the
new-mechanism probe (first WS REQUEST authorizer in the system).

- **S-P.1 (committed skeleton spec, red→green)** `tests/skeleton/ws-connect-auth.skeleton.spec.ts`:
  - **Real-client note:** the authorizer is invoked by APIGW server-side; the
    `wss://` connect is below the browser CSP layer (delta §0 browser-vs-node).
    Per delta §0 this probe MAY be driven through a real WS client at the
    transport level — BUT to honour the v28 "real browser for browser-delivered
    mechanism" rule, the probe is driven from a **real browser page**
    (Playwright) opening the `wss://` with a query-string token, so transport +
    config-injection ordering are exercised as the SPA will exercise them.
  - Drive ONE real `$connect` with **no/garbage token** → rejected at upgrade
    (403); assert authorizer Deny CloudWatch log line present AND `oxo-ws-fn`
    `Invocations` metric flat (zero game-logic invocations) [SM-1, SM-2, T6].
  - Drive ONE real `$connect` with a **valid host wsToken** (minted via a live
    `POST /api/games`) → accepted; `oxo-ws-fn` `$connect` reached [T6].
  - This proves: attachment, invocation, APIGW accepts the WS REST-policy shape,
    deny short-circuits before game logic, TTL-0 (deny-then-allow distinct
    tokens) — the exact wiring UC5/UC6 rely on.
- **Discovery→regression:** use the live drive (Playwright MCP browser for
  exploratory discovery, then the committed spec) to surface unknowns (config
  injection ordering, blocked connect) and convert each finding into a standing
  assertion in the committed spec.
- DEPLOY: infra pipeline only (no hot-swap; CDK fromAsset owns the fn code).
- COMMIT: "Walking-skeleton probe: garbage token denied at $connect with zero game-logic invocations, valid token accepted (T6, SM-1/SM-2)".

**GATE:** Set B does not start until the probe is green.

---

# PHASE 3 — SET B (after probe green; parallel build)

Both touch the SPA socket/GameRoot seam. File boundary defined to keep parallel.
**No local WS stand-up exists yet (OI-28 → s006):** SPA logic is covered by
jsdom/unit + existing prod browser smoke (extended in UC7). Stated honestly per
the gap-list — no Playwright-against-local-WS spec is authored here because the
local WS stand-up is not a deliverable until s006.

## Claim B1 = UC3 — host WS flow wired to wsToken
(owns: src/app/src/game/socket.ts WS-URL builder + GameRoot host branch tests)
Tagged: T8(host) · AC3.1–AC3.3

- **S-B1.1 (unit, red→green)** [T8,AC3.1] `socket.test.ts`/new `ws-url.test.ts`: a pure `buildWsUrl(base, {wsToken})` appends `?wsToken=<value>` (URL-encoded); host SPA after `POST /api/games` passes the response `wsToken` into the URL builder. No new CSP directive (query-string add to already-permitted wss `connect-src` — assert no CSP change needed; reference policy.test).
- **S-B1.2 (component, red→green)** [AC3.1] `GameRoot.test.tsx`: host create path constructs the WS URL with `?wsToken=` from the create response (mock factory asserts the URL it received).
- COMMIT: "Host SPA appends ?wsToken to wss connect URL (UC3, T8, AC3.1)".

## Claim B2 = UC4 — guest WS flow wired to code credential
(owns: guest branch of buildWsUrl + JoinScreen/GameRoot guest branch tests)
Tagged: T8(guest) · AC4.1–AC4.4

- **S-B2.1 (unit, red→green)** [T8,AC4.1] `buildWsUrl(base, {code})` appends `?code=<CODE>`; guest submit path passes the entered code. No new CSP directive.
- **S-B2.2 (component, red→green)** [AC4.1] guest join path constructs WS URL with `?code=`.
- COMMIT: "Guest SPA appends ?code to wss connect URL (UC4, T8, AC4.1)".

**Set B independence:** if both engineers are live, `buildWsUrl` is authored by
ONE (B1, with the `{wsToken}` branch) and extended by the other (B2, `{code}`
branch) — OR B1 lands the full `buildWsUrl(base, {wsToken?, code?})` signature
first and B2 only adds the guest call-site + test. **One-lands-first:** B1 lands
the builder; B2 consumes it. Component test files are disjoint (host branch vs
guest branch assertions). Flag a shared-file collision to the orchestrator
rather than stash-choreographing.

**Smoke-test discipline (surface-change done condition):** Set B changes the WS
connect URL construction on a smoke-tested screen. Done condition includes
verifying `tests/smoke/` stable selectors still isolate the correct elements
after the change (selectors unchanged here — no control added/renamed — but
confirm, do not assume).

- DEPLOY: deploy pipeline (SPA) after Set B green.

---

# PHASE 4 — SET C (after Set B deployed; VALIDATION — handed to tester)

Engineer hands these to the tester (validation specs, prod). Listed so the route
is complete; engineer rolls forward on any in-prod failure and hands failing
in-prod behaviour to the tester with failure/recovery ledger rows.

## UC5 — reject unauthenticated + bad-token $connect  [S5] · AC5.1–AC5.5, SM-1/SM-2
- No-credential connect → 403 upgrade (AC5.1).
- Tampered wsToken (flip sig byte) → rejected; `oxo-ws-fn` Invocations zero (AC5.2, AC5.5).
- Expired wsToken → rejected (AC5.3).
- `?code=ZZZZZZ` (non-existent) → rejected (AC5.4).
- **Honest assertable strategy:** assert the 403 at upgrade AND the CloudWatch
  `oxo-ws-fn Invocations` metric stays flat across the rejected attempts (the
  authoritative OI-2 closure proof) — not the upgrade alone.

## UC6 — per-IP burst (best-effort)  [S6, S7] · AC6.1–AC6.4, SM-5
- N>threshold rapid connects from one IP **with DISTINCT tokens** (cache TTL 0
  makes counting accurate) → over-threshold attempts get Deny (AC6.1).
- `ConnectAttempts[sourceIp].count` >= threshold after burst (AC6.2).
- **Honest assertable strategy (define what IS assertable):** assert the
  DynamoDB counter reaches >= threshold (deterministic, AC6.2) as the PRIMARY
  signal; assert "at least some later attempts Deny" as best-effort (AC6.1) —
  the test must NOT assert an exact deny count (authorizer/connection timing
  makes exact counts non-deterministic). Tester records the OR-H2-a best-effort
  caveat + cache-TTL note in output (AC6.4). AC6.3 (5-min TTL expiry → fresh
  connect succeeds) is long-running, OPTIONAL — tester's discretion.

## UC7 — regression + pipeline clean  [T10] · AC7.1–AC7.6, SM-3/SM-4/SM-6/SM-7
- Local two-player full game, vs-AI full game — no regression (AC7.1, AC7.2, SM-6).
- Online create+join: both players see board within 3s with new auth in place
  (AC7.3, SM-3, SM-4) — the s005 pairing smoke re-run.
- `POST /api/games` → 201 with `gameId`, `code`, AND `wsToken` (AC7.4).
- GitHub Actions infra pipeline deploys updated `OxoGameProd` (new authorizer,
  table, secret) with no manual step (AC7.5, SM-7).
- Deploy pipeline ships SPA (new WS URL construction) no manual step (AC7.6).
- **Version-identity log-field check (T9):** confirm `oxo-ws-auth-fn` CloudWatch
  Allow/Deny lines carry `buildSha`.

UC5, UC6, UC7 run concurrently (no code dependency).

---

# Step count

- Phase 1 Set A: A1 = 6 steps (S-A1.1–S-A1.6); A2 = 15 steps (S-A2.1–S-A2.15) → **21**
- Phase 2 probe: 1 step (S-P.1) → **1**
- Phase 3 Set B: B1 = 2 (S-B1.1–S-B1.2); B2 = 2 (S-B2.1–S-B2.2) → **4**
- Phase 4 Set C (tester validation, listed not engineer-built): UC5 + UC6 + UC7 → **3 validation work-items**

**Engineer build steps: 26 (21 + 1 + 4). Plus 3 Set-C validation hand-offs.**

---

# Independence notes (summary)

- **Set A:** A1 (UC1) ∥ A2 (UC2) — zero contested files. Coupling = the
  `WS_TOKEN_SECRET_PARAM` env-NAME string + the `token.ts` shared module; both
  pinned, secret-wiring order above (UC2 lands secret+env+grants; UC1 consumes
  via port + fake until deploy). game-stack.ts is UC2-only; POST /games response
  contract is UC1-only.
- **Set B:** B1 (UC3) ∥ B2 (UC4) — `buildWsUrl` is one-lands-first (B1), B2
  consumes; component test files disjoint by host/guest branch.
- **cicd concurrent:** workflows + capabilities (new lambda dir build coverage,
  any allowlist additions). No file collision with the engineer's
  src/lambda/**, src/app/**, src/infra/** paths. Build-coverage of
  `src/lambda/ws-auth/` is cicd's task — flag if the new dir is not picked up.
- **No long-lived branches; trunk-based; commit-when-green; explicit-pathspec;
  pull --rebase before each push.**
- **Deploy phases:** Set A → infra pipeline (CDK, no hot-swap) → probe → Set B →
  deploy pipeline (SPA) → Set C validation. No manual prerequisite (secret
  generated in-stack).
