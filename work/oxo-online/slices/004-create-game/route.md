# Route — Slice 004 create-game

Thinnest ordered TDD sequence to advance through every acceptance case. Each step
is a single red→green cycle that lands independently on trunk. No production code
before a failing test. Steps are ordered so the **deploy constraint holds**: the
Lambda + CDK infra must be deployable before the SPA can talk to a real endpoint,
and `OxoGameProd` must deploy before `OxoOnlineProd`.

Ordering rationale: steps 1–3 build and prove the Lambda in isolation (pure unit,
no AWS). Steps 4–8 build the CDK infra and prove it with `assertions` template
tests + `cdk synth` — every technical/security case that is checkable at synth
time is pinned here, before any deploy. Steps 9–10 build the React flow against a
mocked fetch. Steps 11–13 wire the pipeline and deploy. Steps 14–16 are the
production smoke/verification cases that can only go green against the live stack.

Legend: **AC** = acceptance case advanced. Test files are the red→green driver.

---

## Phase A — Lambda handler in isolation (no AWS, pure unit)

### Step 1 — Game code generator: format rules
- **Build:** `src/lambda/games/code.ts` — `generateCode()` producing the share code.
- **AC:** F2, S1 (server-generated format).
- **Test (red→green):** `src/lambda/games/code.test.ts` asserts the returned code is
  exactly 6 chars, only uppercase A–Z and digits, and excludes `O 0 1 I L`. Run the
  generator many times (e.g. 1000 iterations) to assert the forbidden set never
  appears and length/charset always hold.
- **Done:** all generator assertions green; no other code touched.

### Step 2 — Handler builds the correct DynamoDB item (server owns all fields)
- **Build:** `src/lambda/games/handler.ts` — builds the item `{ gameId (uuid),
  code, status:'waiting', ttl }` and returns `201 { gameId, code }`. DynamoDB
  client injected/mockable (DocumentClient `PutItem` mocked, e.g. `aws-sdk-client-mock`).
- **AC:** T1 (item shape), S1 (client body cannot override).
- **Test (red→green):** `src/lambda/games/handler.test.ts`:
  - On valid invoke, the mocked `PutItemCommand` receives an item whose `gameId`
    is a UUID, `status === 'waiting'`, `ttl` is numeric and ~86400s ahead of now
    (within skew tolerance), and `code` matches the Step 1 format.
  - **S1:** when the request body supplies `gameId`, `code`, `status`, `ttl` with
    planted attacker values, the persisted item and the response use server-generated
    values that do **not** equal the planted ones.
  - Response is `201` with JSON `{ gameId, code }` and only those two keys.
- **Done:** handler unit tests green; uses only the mocked client.

### Step 3 — Handler error path returns a clean 5xx (no leak, drives F5 contract)
- **Build:** error handling in `handler.ts` — on `PutItem` failure, return a `5xx`
  with a small JSON error body, no stack trace / internal detail leaked.
- **AC:** F5 (backend-side half of the contract), T1 (only writes on success).
- **Test (red→green):** `handler.test.ts` — when the mocked client rejects, the
  handler returns a 5xx, the body contains no stack/internal fields, and nothing
  partial is treated as success. Confirms no item is "returned" on failure.
- **Done:** error-path test green.

---

## Phase B — CDK infra, proven at synth time (no deploy yet)

### Step 4 — Infra test harness exists
- **Build:** add a test runner to `src/infra` (vitest + `aws-cdk-lib/assertions`
  `Template`), plus an `"test"` script. This is the one unavoidable setup step;
  it carries its own first assertion so it is not a bare scaffold.
- **AC:** enabling for T1, T2, T3, T5, S2, S3.
- **Test (red→green):** `src/infra/test/game-stack.test.ts` first assertion:
  synthesising `OxoGameProd` produces a `Template` containing exactly one
  `AWS::DynamoDB::Table`.
- **Done:** `npm --prefix src/infra test` runs and that single assertion is green.

### Step 5 — Games table: PK, TTL, SSE, no public access
- **Build:** in `game-stack.ts`, add the `Games` DynamoDB table (PK `gameId`, TTL
  attribute `ttl`, on-demand billing, SSE enabled).
- **AC:** T1 (PK/TTL shape), S3 (encryption at rest; no public access path).
- **Test (red→green):** `game-stack.test.ts`:
  - Table has `KeySchema` HASH = `gameId`, `TimeToLiveSpecification` on `ttl`
    enabled, `SSESpecification` enabled.
  - **S3:** no `AWS::DynamoDB::Table` resource policy granting `Principal:*` (assert
    no public/anonymous resource policy is synthesised).
- **Done:** table assertions green.

### Step 6 — Lambda `oxo-game-fn` + execution role scoped to PutItem-on-Games-only
- **Build:** add `oxo-game-fn` Lambda (Node 20, fixed `functionName: 'oxo-game-fn'`,
  `TABLE_NAME` env, **reserved concurrency** set > 0) and its execution role with an
  inline policy: `dynamodb:PutItem` on the Games table ARN only + its own log-group
  actions.
- **AC:** T3 (PutItem-on-Games-only, no wildcard), T5 (reserved concurrency), S3
  (only this role gets data-plane access).
- **Test (red→green):** `game-stack.test.ts`:
  - Lambda runtime is `nodejs20.x`, `ReservedConcurrentExecutions` > 0.
  - Execution-role policy grants `dynamodb:PutItem` whose `Resource` is the Games
    table ARN (a Ref/GetAtt to the table, **not** `*`), and grants no
    read/query/scan and no second table.
  - Log-group actions are scoped to the function's own log group.
- **Done:** Lambda + role assertions green.

### Step 7 — HTTP API `POST /games` → Lambda; cross-stack outputs exported
- **Build:** add HTTP API Gateway (`POST /games` → Lambda proxy, `$default` stage),
  plus the two `CfnOutput`s from STACK_ORDER.md (`OxoGameProd-HttpApiEndpoint`,
  `OxoGameProd-LambdaFunctionName`).
- **AC:** T4 enabler (cross-stack ordering), F1 enabler (reachable route).
- **Test (red→green):** `game-stack.test.ts`:
  - An `AWS::ApiGatewayV2::Route` exists with `RouteKey === 'POST /games'`
    integrated to the Lambda.
  - Both `CfnOutput`s exist with the exact `exportName`s.
- **Done:** API + outputs assertions green. `npm --prefix src/infra run cdk synth`
  passes for `OxoGameProd`.

### Step 8 — CloudFront `/api/*` behaviour is CachingDisabled (OxoOnlineProd)
- **Build:** in `oxo-online-shell-stack.ts`, import `OxoGameProd-HttpApiEndpoint`
  and add the `/api/*` behaviour (origin = HTTP API domain, `CACHING_DISABLED`,
  ALLOW_ALL methods, redirect-to-HTTPS) per STACK_ORDER.md.
- **AC:** T2 (CachingDisabled), F1 enabler (SPA reaches Lambda via /api/*).
- **Test (red→green):** `src/infra/test/shell-stack.test.ts`: the synthesised
  `OxoOnlineProd` distribution has a `/api/*` cache behaviour whose `CachePolicyId`
  equals the managed CachingDisabled policy id. `cdk synth OxoGameProd OxoOnlineProd`
  succeeds (proves the cross-stack import resolves in correct order).
- **Done:** behaviour assertion green; both stacks synth together.

---

## Phase C — React Play Online flow (mocked fetch)

### Step 9 — "Play Online" button + loading + success view
- **Build:** add a `Play Online` button to `GameRoot.tsx`; on click it `POST`s to
  `/api/games`, shows a loading/spinner indicator for waits > 500ms, then renders a
  "waiting for opponent" view displaying the returned `code` prominently.
- **AC:** F1, F3 (loading indicator), F2 (code rendered as returned).
- **Test (red→green):** `src/app/src/game/GameRoot.test.tsx` (fetch mocked):
  - Clicking `Play Online` issues a `POST /api/games`.
  - A loading indicator appears while the promise is pending.
  - On resolve with `{ gameId, code }`, the waiting view shows and the code stays
    visible without further action.
- **Done:** Play Online success-flow tests green; existing GameRoot tests still green.

### Step 10 — Backend failure degrades gracefully (no white-screen)
- **Build:** error state in `GameRoot.tsx` — on rejected/`5xx` fetch, render a
  short human-readable error and keep the mode selector usable.
- **AC:** F5, F4 (existing modes still reachable).
- **Test (red→green):** `GameRoot.test.tsx` (fetch rejects / returns 500):
  - A readable error message renders; no thrown unhandled error.
  - The mode selector and both existing mode buttons remain in the DOM and
    clickable (proves no white-screen and F4 untouched).
- **Done:** error-path component tests green; full `vitest run` green for the app.

---

## Phase D — Pipeline wiring + deploy (real environment)

### Step 11 — OIDC role gains scoped Lambda deploy permissions
- **Build:** add the `LambdaCodeDeploy` policy statement (UpdateFunctionCode +
  GetFunction, scoped to `oxo-game-fn` ARN, **no** iam:* actions) to
  `oxo-online-oidc-stack.ts` per DEPLOY_ROLE_EXTENSIONS.md.
- **AC:** T4 (pipeline can hot-swap code), S2 (no IAM-mutation actions).
- **Test (red→green):** `src/infra/test/oidc-stack.test.ts`:
  - The `oxo-deploy` role policy includes `lambda:UpdateFunctionCode` and
    `lambda:GetFunction` scoped to the `oxo-game-fn` function ARN (not `*`).
  - **S2:** the role grants none of `iam:CreateRole`, `iam:AttachRolePolicy`,
    `iam:PutRolePolicy` on any resource.
- **Done:** OIDC assertions green. (Manual `make deploy-oidc` is an operational
  step recorded in the deploy ledger, not a code test.)

### Step 12 — Infra pipeline deploys OxoGameProd then OxoOnlineProd
- **Build:** ensure `infra-oxo-online.yml` deploys `OxoGameProd OxoOnlineProd` in
  that order; deploy. Capture `LambdaFunctionName` output → set GH Actions var
  `OXO_ONLINE_LAMBDA_FUNCTION_NAME`.
- **AC:** T4 (infra half), T1/T2/T3/T5/S3 become live-verifiable.
- **Done (green):** the infra workflow run finishes green; `OxoGameProd` and
  `OxoOnlineProd` exist in the console; deploy row emitted to the DORA ledger.

### Step 13 — App pipeline deploys SPA + Lambda code
- **Build:** ensure `deploy-oxo-online.yml` builds/uploads the SPA, runs
  `aws lambda update-function-code` for `oxo-game-fn` when `src/lambda/**` changes,
  and issues a CloudFront invalidation; deploy.
- **AC:** T4 (app half), F1 (live endpoint reachable from SPA).
- **Done (green):** app workflow run finishes green end-to-end (SPA sync + Lambda
  update + invalidation); deploy row emitted.

---

## Phase E — Production verification (live-only acceptance)

### Step 14 — Smoke: Play Online shows a valid code within 3s (live)
- **Build:** `src/app/tests/smoke/slice004-validation.spec.ts` (Playwright vs prod URL).
- **AC:** F1, F2, F3.
- **Test (red→green):** load prod, click `Play Online`, assert a loading indicator
  appears, then a 6-char code (charset/exclusions enforced) is visible within 3s.
- **Done:** smoke spec green against production.

### Step 15 — Smoke: existing modes unaffected (live regression)
- **AC:** F4.
- **Test (red→green):** in the same/adjacent smoke spec, play a Two-Player and a
  vs-Computer game to completion against prod; assert no missing buttons and no
  console JS errors.
- **Done:** regression smoke green.

### Step 16 — Live policy verification: persisted shape + S1 override defence
- **AC:** T1, S1 (and confirm T2/T3/T5/S3 via CLI checks).
- **Test/verify (red→green):** after a live `POST /api/games`, `get-item` on the
  `Games` table confirms `gameId` PK, `status='waiting'`, `ttl` ~24h ahead. Send a
  request body with planted `gameId/code/status/ttl` and confirm the stored +
  returned values are server-generated and differ from the planted ones. Spot-check
  T2 (CachingDisabled), T3 (role policy), T5 (reserved concurrency), S3 (no public
  access) via the AWS CLI commands named in acceptance.md.
- **Done:** all live checks pass; hand any failing in-prod behaviour to tester.

---

## Independence notes
- Steps 1–3 (lambda) and 9–10 (react) are mutually independent and may be claimed
  by separate engineers in parallel.
- Steps 5–7 mutate the same file (`game-stack.ts`) and must be sequential.
- Step 8 and Step 11 touch different files (shell vs oidc stack) and are independent
  of each other, but both depend on the infra test harness (Step 4).
- Steps 12–13 are deploy gates: 13 depends on 12 (OxoGameProd before OxoOnlineProd,
  and the Lambda must exist before its code can be hot-swapped).
- Steps 14–16 depend on a successful 12+13 deploy.
