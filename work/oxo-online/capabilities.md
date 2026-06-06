# Functional capabilities — oxo-online

Owned by the CICD agent. Lists what is available to the engineer for the
current slice. Revised each slice.

---

## Slice 001 — deployable shell (current)

### Environments in play

**Production only.** Single AWS account. No staging, no dev environment.
Rationale: no customers exist yet; introducing pre-prod now only adds lead time.
Reversal condition: introduce a TEST environment once a real customer requires
protection from regressions (a failed deploy has a human to disappoint).

### Deploy path

```
push to main
  → GitHub Actions: build job (install → lint → unit tests → build SPA)
  → deploy job (OIDC assume role → CDK deploy OxoOnlineProd → S3 sync → CF invalidation)
  → smoke test (Playwright against live HTTPS URL)
  → DORA deploy event recorded
```

Pull requests run the build job only (install → lint → test → build). No deploy
on PRs.

### Infrastructure as code

CDK TypeScript v2. All AWS resources defined under `src/infra/`:

| File | Purpose |
|------|---------|
| `src/infra/bin/app.ts` | CDK app entry point; reads config from env/context |
| `src/infra/lib/oxo-online-shell-stack.ts` | App stack: S3 bucket, OAC, CloudFront, Route 53 A record |
| `src/infra/lib/oxo-online-oidc-stack.ts` | OIDC stack: GitHub OIDC provider + `oxo-deploy` role |

Pipeline file: `src/.github/workflows/deploy.yml`

The OIDC stack is deployed ONCE manually before the first automated deploy.
It must never be included in the automated pipeline (it is an account-level
singleton; re-deploying it would fail).

### Auth: OIDC — no static AWS keys

The `oxo-deploy` IAM role is assumed via GitHub OIDC web-identity federation.
Trust is scoped to the exact GitHub repo + `main` branch. No `AWS_ACCESS_KEY_ID`
or `AWS_SECRET_ACCESS_KEY` exist anywhere in the repo or CI secrets.

### Test approach

| Layer | Tool | When |
|-------|------|------|
| Unit | Jest (React component smoke test) | Every push, every PR |
| Lint | ESLint | Every push, every PR |
| Build gate | `npm run build` succeeds | Every push, every PR |
| In-prod smoke | Playwright — HTTPS URL loads shell, TLS valid, HTTP redirects, S3 direct = 403, deep-link refresh = SPA | After every deploy to prod |

No backend tests in slice 001 (no backend exists).

### Rollback assets

S3 bucket versioning is enabled. Rollback procedure (forward-fix preferred;
rollback when forward-fix is not safe):

```bash
# 1. Find the previous version ID of the object(s) you want to restore:
aws s3api list-object-versions \
  --bucket $S3_BUCKET_NAME \
  --prefix index.html \
  --profile SND

# 2. Re-copy the previous version over the current (example for index.html):
aws s3api copy-object \
  --copy-source "${S3_BUCKET_NAME}/index.html?versionId=<PREVIOUS_VERSION_ID>" \
  --bucket $S3_BUCKET_NAME \
  --key index.html \
  --profile SND

# 3. For a full build rollback, re-sync the entire prior build directory
#    (requires keeping a local copy or a versioned S3 path per build):
aws s3 sync s3://${S3_BUCKET_NAME}/__builds/<PREVIOUS_BUILD_SHA>/ \
  s3://${S3_BUCKET_NAME}/ \
  --profile SND

# 4. Invalidate CloudFront to make the rollback effective immediately:
aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
  --paths "/*" \
  --profile SND
```

IaC state is stored in CloudFormation (managed by CDK). Infra rollback:
`cdk deploy OxoOnlineProd --rollback --profile SND`

### Pre-requisites for first deploy (human must provide)

These values must exist before running `cdk deploy OxoOnlineOidcStack`:

| What | Where to put it | Note |
|------|----------------|------|
| **ACM certificate ARN** (in us-east-1) | GitHub secret `ACM_CERT_ARN` + CDK context/env | Create in AWS Console → Certificate Manager → us-east-1 region. Validate via DNS. Must cover `DOMAIN_NAME`. |
| **Route 53 hosted zone ID** | GitHub secret `HOSTED_ZONE_ID` + CDK context/env | The hosted zone for your domain. |
| **Domain name** | GitHub Actions variable `DOMAIN_NAME` | e.g. `oxo.example.com` |
| **AWS account ID** | GitHub secret `AWS_ACCOUNT_ID` | 12-digit account number |
| **AWS region** | GitHub Actions variable `AWS_REGION` | `eu-west-2` (London) |
| **GitHub org** | Inferred by pipeline (`github.repository_owner`) | No manual step |
| **GitHub repo** | Inferred by pipeline (`github.event.repository.name`) | No manual step |
| CDK bootstrap | One-time: `cdk bootstrap aws://<account>/eu-west-2 --profile SND` | Creates the CDK staging bucket in eu-west-2. **Note: also bootstrap us-east-1 if using cross-region cert lookup in the stack.** |

After first manual deploy of OxoOnlineOidcStack:

| What | Where to put it |
|------|----------------|
| **`DeployRoleArn` output** from the OIDC stack | GitHub secret `AWS_DEPLOY_ROLE_ARN` |
| **`WebBucketName` output** from OxoOnlineProd | GitHub Actions variable `S3_BUCKET_NAME` |
| **`DistributionId` output** from OxoOnlineProd | GitHub Actions variable `CLOUDFRONT_DISTRIBUTION_ID` |
| **Production URL** | GitHub Actions variable `PROD_URL` (e.g. `https://oxo.example.com`) |

### GitHub Actions variables vs secrets

| Name | Type | Reason |
|------|------|--------|
| `AWS_REGION` | Variable (not secret) | Not sensitive |
| `CLOUDFRONT_DISTRIBUTION_ID` | Variable (not secret) | Not sensitive |
| `S3_BUCKET_NAME` | Variable (not secret) | Not sensitive |
| `DOMAIN_NAME` | Variable (not secret) | Not sensitive |
| `PROD_URL` | Variable (not secret) | Not sensitive |
| `AWS_DEPLOY_ROLE_ARN` | Secret | Role ARN could aid enumeration |
| `AWS_ACCOUNT_ID` | Secret | Account ID not printed in logs |
| `ACM_CERT_ARN` | Secret | Contains account ID |
| `HOSTED_ZONE_ID` | Secret | Internal DNS detail |

---

## Slice 002 — local two-player game (current)

### What this slice adds

New React components and a pure game-logic module replace the placeholder screen:

- `src/game/logic.ts` (or equivalent) — pure functions for board state, move
  validation, win/draw detection. No side effects; no AWS touch.
- React components: game board, square, status display, player-turn indicator.
- No new AWS resources. No CDK changes. No new IAM permissions.

### Deploy path

Unchanged from slice 001. The existing pipeline handles this without modification:

```
push to main (work/oxo-online/**)
  → build job: npm ci → lint → unit tests (game logic + React) → npm run build
  → deploy job: OIDC assume role → S3 sync (3-pass cache strategy) → CF invalidation
  → smoke test: Playwright against live HTTPS URL
  → DORA deploy event recorded
```

### Test approach

| Layer | Tool | When | What is new in slice 002 |
|-------|------|------|--------------------------|
| Unit | Vitest | Every push, every PR | Game logic module (win/draw detection, move validation) — pure functions, straightforward to test exhaustively |
| Component | Vitest + React Testing Library | Every push, every PR | Board and square rendering; status display |
| Lint | ESLint | Every push, every PR | No change |
| Build gate | `npm run build` | Every push, every PR | No change |
| In-prod smoke | Playwright | After every deploy | Existing smoke tests still apply (page loads, TLS valid, no 4xx/5xx on root) |

No backend exists in slice 002; no backend tests needed.

### Rollback assets

No change from slice 001. S3 bucket versioning covers the new SPA bundle.
The existing rollback procedure (S3 version restore + CloudFront invalidation)
applies without modification. No DB migrations; nothing irreversible.

---

## Slice 003 — single-player vs AI (current)

### What this slice adds

A pure client-side minimax AI module and a mode selector. No AWS changes.

- `src/app/src/game/ai.ts` (or equivalent) — minimax engine; pure functions, no
  side effects, no network calls.
- React mode-selector component wiring the AI into the existing game loop.
- No new CDK stacks, IAM permissions, environment variables, secrets, or
  pipeline steps.

### Deploy path

Unchanged from slices 001–002.

```
push to main (work/oxo-online/**)
  → build job: npm ci → lint → unit tests (AI module + game logic + React) → npm run build
  → deploy job: OIDC assume role → S3 sync → CF invalidation
  → smoke test: Playwright against live HTTPS URL
  → DORA deploy event recorded
```

### Test approach

| Layer | Tool | When | What is new in slice 003 |
|-------|------|------|--------------------------|
| Unit | Vitest | Every push, every PR | AI module — minimax correctness (optimal move assertions), game-tree exhaustion (AI never loses), draw detection |
| Component | Vitest + React Testing Library | Every push, every PR | Mode-selector rendering; AI mode wires correctly |
| Lint | ESLint | Every push, every PR | No change |
| Build gate | `npm run build` | Every push, every PR | No change |
| In-prod smoke | Playwright | After every deploy | Existing smoke tests unchanged — page loads, TLS, no 4xx/5xx |

No backend tests needed; no backend exists in slices 001–003.
No new infra tests needed; no infrastructure changed.

### Rollback assets

Unchanged from slices 001–002. S3 versioned bucket covers the new SPA bundle.
Rollback: S3 version restore + CloudFront invalidation (see slice 001 procedure).
Nothing irreversible; no DB migrations.

### Pipeline changes

None. No new secrets, variables, IAM permissions, CDK stacks, or workflow steps
are required for this slice.

---

## Slice 004 — create game + shareable code (first backend slice)

### What this slice adds

First stateful backend: Lambda + DynamoDB + HTTP API Gateway. CloudFront gains a
`/api/*` behaviour routing to the HTTP API. New CDK stack `OxoGameProd` deployed
before `OxoOnlineProd`.

### Environments in play

**Production only.** Unchanged from slices 001–003.

### Deploy path

Two pipelines, both triggered on push to main:

```
push to main (work/oxo-online/src/infra/**)
  → infra-oxo-online.yml:
      validate context flags
      npm ci + tsc build
      OIDC assume oxo-infra-deploy
      cdk deploy OxoGameProd (Lambda + DynamoDB + HTTP API)
      cdk deploy OxoOnlineProd (CloudFront /api/* behaviour added)

push to main (work/oxo-online/src/app/** or src/lambda/**)
  → deploy-oxo-online.yml:
      build job: npm ci → lint → unit tests → build SPA
      deploy job:
        OIDC assume oxo-deploy
        S3 sync (3-pass cache strategy)
        CloudFront invalidation
        IF src/lambda/** changed: zip Lambda source → UpdateFunctionCode
      smoke test: Playwright against live HTTPS URL
      DORA deploy event recorded
```

### Infrastructure as code

| File | Purpose |
|------|---------|
| `src/infra/bin/app.ts` | CDK app entry; instantiates OxoGameProd BEFORE OxoOnlineProd |
| `src/infra/lib/game-stack.ts` | OxoGameStack stub — engineer fills: Lambda + DynamoDB + HTTP API |
| `src/infra/lib/oxo-online-shell-stack.ts` | OxoOnlineProd: S3 + CloudFront + /api/* origin |
| `src/infra/lib/oxo-online-oidc-stack.ts` | OIDC stack (one-time manual deploy) |
| `src/infra/STACK_ORDER.md` | Cross-stack reference pattern + deploy order explanation |
| `src/infra/DEPLOY_ROLE_EXTENSIONS.md` | Permissions to add to oxo-deploy for Lambda code update |

### New GitHub Actions variables/secrets required (slice 004)

| Name | Type | Set to |
|------|------|--------|
| `OXO_ONLINE_LAMBDA_FUNCTION_NAME` | Variable (not secret) | `LambdaFunctionName` CfnOutput value from `OxoGameProd` stack |

The following already exist and are reused:
- `OXO_ONLINE_INFRA_DEPLOY_ROLE_ARN` (secret) — `oxo-infra-deploy` role
- `AWS_ACCOUNT_ID` (secret) — used by infra pipeline for CDK

### Deploy role extension (oxo-deploy)

Before the Lambda update step in `deploy-oxo-online.yml` will work, the engineer
must add `lambda:UpdateFunctionCode` + `lambda:GetFunction` to the `oxo-deploy`
role (scoped to the function ARN) and redeploy `OxoOnlineOidcStack` manually.
See `src/infra/DEPLOY_ROLE_EXTENSIONS.md`.

### Rollback assets

**SPA:** S3 versioned bucket + CloudFront invalidation (unchanged from slices 001–003).

**Lambda:** Roll forward preferred. If Lambda versioning is enabled (set
`currentVersionOptions` on the CDK Function), re-deploy the prior package via
the pipeline. Without versioning: push a corrected commit; the pipeline overwrites
the function code.

**DynamoDB `Games` table:** Items are ephemeral (24h TTL). No migrations.
`RemovalPolicy.RETAIN` on the table (the engineer must set this) so stack destroy
does not delete the table. Items are not irreversible — any item written by a bad
deploy self-deletes after 24h.

**CloudFormation infra rollback:** `cdk deploy OxoGameProd --rollback` or
`cdk deploy OxoOnlineProd --rollback` (uses the previous change-set).

### Pre-flight checklist (§19) — result for slice 004

| Check | Result |
|-------|--------|
| No `GITHUB_` prefix env vars | PASS — pipeline uses `github.repository_owner` / `github.event.repository.name` expressions, not `GITHUB_*` env vars |
| All required vars documented | PASS — `OXO_ONLINE_LAMBDA_FUNCTION_NAME` documented above |
| `environment: production` gate | PASS — no `environment:` gate added; no approval queue introduced |
| CDK `cdk.json` app entry correct | PASS — `"app": "npx ts-node --prefer-ts-exts bin/app.ts"` unchanged |
| `ts-node` in devDependencies | PASS — `"ts-node": "^10.9.2"` present |
| CDK bootstrap trust covers infra role | PASS — `oxo-infra-deploy` was bootstrapped with `--trust 817047731316` (from existing pipeline comment) |
| `npm ci` in each job that needs it | PASS — infra pipeline: `npm ci` before `npm run build`; app pipeline: `npm ci` in build job |
| oxo-deploy has Lambda permissions | BLOCKED — engineer must add `LambdaCodeDeploy` policy to `oxo-online-oidc-stack.ts` and redeploy `OxoOnlineOidcStack` manually |

### Forward note

Deferred to slice 005+:
- WebSocket API (join, move relay)
- `Connections` DynamoDB table
- `code` GSI + join lookup
- WAF rate-based rule on CloudFront + HTTP API

---

## Slice 005 — join game by WebSocket (current)

### What this slice adds

First WebSocket surface: a new API Gateway WebSocket API, a new `oxo-ws-fn`
Lambda, a `Connections` DynamoDB table, and a `Games.code` GSI — all added to the
existing `OxoGameProd` stack. Stack count stays at three. The SPA connects directly
to the WSS endpoint (not via CloudFront); the wss URL is injected at deploy time as
a runtime config.

### Environments in play

**Production only.** Unchanged from slices 001–004. No new environment needed.

### Deploy path

Two pipelines, unchanged in structure. Key additions for slice 005:

```
push to main (work/oxo-online/src/infra/**)
  → infra-oxo-online.yml:
      build CDK TypeScript + Lambda TypeScript (existing steps cover new ws/ subdir)
      OIDC assume oxo-infra-deploy
      cdk deploy OxoGameProd  ← adds WS API, oxo-ws-fn, Connections table, code GSI
      cdk deploy OxoOnlineProd  ← no change (no new CFN import from OxoGameProd)

push to main (work/oxo-online/src/app/** or src/lambda/**)
  → deploy-oxo-online.yml:
      build job: npm ci → lint → unit tests → build SPA
      deploy job:
        OIDC assume oxo-deploy
        S3 sync (3-pass cache strategy)  ← SPA now includes config.js script tag
        CloudFront invalidation
        IF src/lambda/** changed:
          zip Lambda source
          UpdateFunctionCode → oxo-game-fn  (if OXO_ONLINE_LAMBDA_FUNCTION_NAME set)
          UpdateFunctionCode → oxo-ws-fn    (if OXO_ONLINE_WS_LAMBDA_FUNCTION_NAME set)
        Fetch wss URL from OxoGameProd CloudFormation outputs
        Write /config.js to S3 (window.OXO_CONFIG = {wsUrl: "wss://..."})
      smoke test: Playwright against live HTTPS URL
      DORA deploy event recorded
```

### wss URL injection mechanism

The SPA receives the WebSocket endpoint via a runtime config file (`/config.js`)
written to S3 at deploy time. The deploy pipeline:

1. Calls `aws cloudformation describe-stacks --stack-name OxoGameProd` to read
   the `OxoGameProd-WsApiEndpoint` output (the wss:// URL incl. `/prod` stage).
2. Writes `window.OXO_CONFIG={"wsUrl":"wss://..."};` to `/config.js` with
   `Cache-Control: no-cache` so browsers always pick up the latest value.
3. The SPA's `index.html` has `<script src="/config.js"></script>` before the
   main bundle; the app reads `window.OXO_CONFIG.wsUrl` at runtime.

This decouples the app build from the infra deploy: the Vite build does not need
to know the API Gateway ID; the deploy pipeline reads it live from CloudFormation.

Graceful degradation: if `wsUrl` is absent or empty, the join screen shows a
readable error ("Service unavailable — try again later") rather than crashing.

### Infrastructure as code

| File | Purpose |
|------|---------|
| `src/infra/lib/game-stack.ts` | Gains: WS API + prod stage, `oxo-ws-fn` Lambda, `Connections` table, `code-index` GSI, new CfnOutputs (WsApiEndpoint, WsLambdaFunctionName) |
| `src/infra/lib/oxo-online-oidc-stack.ts` | Gains: `WsLambdaCodeDeploy` + `ReadGameStackOutputs` policy statements on `oxo-deploy` role |
| `src/infra/STACK_ORDER.md` | Documents new CfnOutputs + wss URL injection mechanism |
| `src/infra/DEPLOY_ROLE_EXTENSIONS.md` | Documents slice 005 OIDC role extensions |
| `src/lambda/ws/` | New WS handler subdir — covered by existing Lambda build step and `src/lambda/**` path trigger |

### New GitHub Actions variables required (slice 005)

| Name | Type | Set to |
|------|------|--------|
| `OXO_ONLINE_WS_LAMBDA_FUNCTION_NAME` | Variable (not secret) | `WsLambdaFunctionName` CfnOutput value from `OxoGameProd` (e.g. `oxo-ws-fn`) |

The following already exist and are reused:
- `OXO_ONLINE_LAMBDA_FUNCTION_NAME` (variable) — `oxo-game-fn` (unchanged)
- `OXO_ONLINE_S3_BUCKET` (variable) — target for `/config.js` upload
- `OXO_ONLINE_DEPLOY_ROLE_ARN` (secret) — `oxo-deploy` role (now extended)

### Deploy role extension (oxo-deploy) — slice 005 additions

Before the ws-fn update step and wss URL injection step will work, the engineer
must add two policy statements to `oxo-online-oidc-stack.ts` and redeploy
`OxoOnlineOidcStack` manually:

1. `WsLambdaCodeDeploy` — `lambda:UpdateFunctionCode` + `lambda:GetFunction`
   scoped to `arn:aws:lambda:*:<account>:function:oxo-ws-fn`
2. `ReadGameStackOutputs` — `cloudformation:DescribeStacks` scoped to
   `arn:aws:cloudformation:*:<account>:stack/OxoGameProd/*`

See `src/infra/DEPLOY_ROLE_EXTENSIONS.md` for the exact TypeScript statements.

Manual step: `make -C work/oxo-online/src/infra deploy-oidc`

### Infra pipeline — path trigger coverage

The infra pipeline already triggers on `work/oxo-online/src/lambda/**`. The new
`src/lambda/ws/` subdirectory for `oxo-ws-fn` handlers falls under this glob —
no trigger change needed. The Lambda build step (`npm run build` in
`work/oxo-online/src/lambda`) compiles all TypeScript under `src/` regardless of
subdirectory depth — no build step change needed.

`OxoOnlineProd` gains **no** new CloudFormation import from `OxoGameProd` (the wss
URL handoff is a deploy-time config injection, not a CFN import). The sequential
`OxoGameProd` then `OxoOnlineProd` deploy order in the infra pipeline is
sufficient and unchanged.

### §19 pre-flight checklist — slice 005

| Check | Result |
|-------|--------|
| New Lambda dir (`src/lambda/ws/`) covered by path trigger `src/lambda/**` | PASS — existing glob covers all subdirs |
| Lambda build step compiles new ws/ subdir | PASS — `npm run build` in `src/lambda/` is not subdir-scoped |
| Sequential export-linked deploys (OxoGameProd then OxoOnlineProd) | PASS — unchanged; no new CFN import in OxoOnlineProd |
| Vitest run in CI uses `--run` flag (no watch-mode hang) | PASS — `npm test -- --run` in deploy workflow |
| Lock-file platform (npm ci vs npm install) | PASS for app (npm ci); CAUTION for infra (npm install — OI-7 open item) |
| No `GITHUB_` prefix env vars | PASS — all vars use `OXO_ONLINE_` prefix or `github.*` expressions |
| All new vars documented | PASS — `OXO_ONLINE_WS_LAMBDA_FUNCTION_NAME` documented above |
| `environment: production` gate absent (no approval queue) | PASS — no `environment:` block added |
| New OIDC permissions are ARN-scoped, no `iam:*` | PASS — `WsLambdaCodeDeploy` and `ReadGameStackOutputs` both ARN-scoped |
| wss URL injection graceful-degrades on missing output | PASS — pipeline logs warning and writes `wsUrl: ""`; SPA must handle (engineer task) |

### Rollback assets — slice 005

**SPA + config.js:** S3 versioned bucket covers both. Rollback: restore prior
`config.js` version + CloudFront invalidation.

**oxo-ws-fn Lambda code:** Roll forward preferred (no versioning). Push a
corrected commit; pipeline overwrites the function code.

**OxoGameProd infra (WS API, Connections table, code GSI):** All additive
resources. CloudFormation rollback removes them atomically; the s004 create-game
path (HTTP API + Games + oxo-game-fn) is unaffected. The `Connections` table
uses `RemovalPolicy.DESTROY` (ephemeral data; engineer must set this explicitly —
PITR off by design per the delta). The `Games` table uses `RemovalPolicy.RETAIN`
(unchanged from s004).

**GSI add (Games.code-index):** An in-place table update (no table replacement);
additive, backfills automatically. Rolling back `OxoGameProd` removes the GSI.
Low risk.

**Lambda code rollback (oxo-ws-fn):** Roll forward. No versioning enabled in
this slice (consistent with oxo-game-fn default).

**Wss URL config.js rollback:** If the wss URL in config.js is stale (e.g., after
a CDK stack re-deploy that regenerated the API Gateway ID), re-running the
deploy pipeline re-fetches and overwrites config.js automatically.
