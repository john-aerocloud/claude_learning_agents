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

---

## Slice s005-h1 — WAF rate-limiting (hardening; control-plane only)

### What this slice adds

Two WAFv2 WebACLs on the two public endpoints:
- Global `CLOUDFRONT`-scope ACL in `us-east-1` (new `OxoOnlineWafUsEast1`
  stack) — associated with the CloudFront distribution; covers all `/api/*`
  traffic.
- Regional `REGIONAL`-scope ACL in `eu-west-2` (inside `OxoGameProd`) —
  associated with the WS API `prod` stage.

Both ACLs: default-allow, IP-reputation list (priority 0), rate-based rule
(priority 1). Rate limits: 100/5-min/IP (CF global), 20/5-min/IP (WS regional).
No application code changes.

### Environments in play

**Production only.** Unchanged. WAF is a managed cloud service — no local
emulation exists. All WAF validation is cloud-only (walking-skeleton probe +
tester prod validation). See delta s005-h1-waf.md §5 for the local/prod gap
table.

### Deploy path

```
push to main (work/oxo-online/src/infra/**)
  → infra-oxo-online.yml:
      validate context flags
      npm install (infra) + npm ci (lambda) + build both
      OIDC assume oxo-infra-deploy
      cdk deploy OxoOnlineWafUsEast1  ← NEW; us-east-1; exports global WebACL ARN
      cdk deploy OxoGameProd           ← regional WAFv2 WebACL + WS association
      cdk deploy OxoOnlineProd         ← sets distribution webAclId (cross-region import)
```

App pipeline (deploy-oxo-online.yml) is unchanged by this slice.

### Pre-requisites before first WAF deploy (human must action)

| Step | What | Command |
|------|------|---------|
| 1 | Engineer adds `Wafv2Manage` + `CloudFrontSetWebAcl` statements to `oxo-online-oidc-stack.ts` | (engineer task) |
| 2 | Apply OIDC role change (§39 — config before resource) | `make -C work/oxo-online/src/infra deploy-oidc` |
| 3 | Bootstrap CDK in us-east-1 (ABSENT as of 2026-06-06 — one-time manual step) | `npx cdk bootstrap aws://817047731316/us-east-1 --trust 817047731316 --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --profile dev-int` |
| 4 | Push infra change; pipeline deploys all three stacks in order | git push to main |

### New GitHub Actions variables/secrets required (s005-h1)

None. The new stacks deploy under the existing `OXO_ONLINE_INFRA_DEPLOY_ROLE_ARN`
with the extended WAFv2 + CloudFront grants. No new GH secrets or variables.

### Stack ordering

```
1. OxoOnlineWafUsEast1   (us-east-1)  — global WebACL ARN exported
2. OxoGameProd           (eu-west-2)  — regional WebACL + WS association
3. OxoOnlineProd         (eu-west-2)  — distribution webAclId set (imports #1)
```

Cross-region reference: CDK `crossRegionReferences: true` on both
`OxoOnlineWafUsEast1` and `OxoOnlineProd`. CDK writes the ARN to an SSM
parameter in us-east-1; a custom resource in `OxoOnlineProd` reads it at deploy
time. CloudFormation has no native cross-region `Fn::ImportValue`.

### Rollback assets

**Global CF ACL rollback:** Set distribution `webAclId` back to empty in
`OxoOnlineProd` (CDK update), then destroy `OxoOnlineWafUsEast1`.
CloudFront stops consulting the ACL; all routes continue to serve.

**Regional WS ACL rollback:** Remove `CfnWebACLAssociation` then `CfnWebACL`
from `OxoGameProd` via CDK update. WS `prod` stage returns to prior state
(reserved concurrency + stage throttle remain as defence-in-depth floor).

Both reversals are data-free: no app data, no client contract affected.
Default behaviour on block: raise threshold (`UpdateWebACL`) before full
disassociation.

### §19 pre-flight checklist — s005-h1

| Check | Result |
|-------|--------|
| No `GITHUB_` prefix env vars | PASS — pipeline uses `github.repository_owner` / `github.event.repository.name` expressions; `CDK_DEFAULT_REGION` set to literal `us-east-1` for WAF step (not a GITHUB_ prefix) |
| OIDC trust policy uses `StringLike` for sub | PASS — inherited from existing OIDC stack (unchanged) |
| us-east-1 CDK bootstrap exists | BLOCKED — CDKToolkit not found in us-east-1 (2026-06-06 check); manual bootstrap required (see pre-requisites table above) |
| `crossRegionReferences: true` on both WAF + OxoOnlineProd stacks | NOTE FOR ENGINEER — both stacks must set this flag; engineer wires in stack constructors |
| deploy-role WAFv2 + CloudFront grants applied before WAF deploy (§39) | BLOCKED until engineer extends OIDC stack + `make deploy-oidc` runs |
| Stacks deploy sequentially (not batch) | PASS — three separate pipeline steps |
| Diff step includes OxoOnlineWafUsEast1 | PASS — updated in infra workflow |
| No new GH secrets or variables | PASS |

---

## Slice s005-h2 — $connect authorizer + per-IP rate-limiting (iteration 8)

### What this slice adds

A Lambda REQUEST authorizer (`oxo-ws-auth-fn`) on the WebSocket API `$connect`
route, a `ConnectAttempts` DynamoDB table for per-IP rolling counters, and a
shared HMAC secret for host-token mint (`oxo-game-fn`) and verify
(`oxo-ws-auth-fn`). All resources are added to the existing `OxoGameProd` stack.

### Environments in play

**Production only.** Unchanged from prior slices.

### Deploy path

```
push to main (work/oxo-online/src/infra/** or src/lambda/**)
  → infra-oxo-online.yml:
      npm install (infra) + npm ci (lambda) + build both
      OIDC assume oxo-infra-deploy
      cdk deploy OxoOnlineWafUsEast1   (no change — included for completeness)
      cdk deploy OxoGameProd           ← adds oxo-ws-auth-fn, ConnectAttempts table,
                                           WS authorizer, $connect route update,
                                           shared secret, env vars + grants on both fns
      cdk deploy OxoOnlineProd         (no change)
```

App pipeline (deploy-oxo-online.yml) is unchanged by this slice. There are no
new `UpdateFunctionCode` steps: the authorizer function code is deployed
exclusively via CDK `fromAsset()` through the infra pipeline (OI-24 pattern).

### Lambda build coverage — generalised (s005-h2 fix)

The build script in `src/lambda/package.json` previously hardcoded each
subdir's tsconfig. For s005-h2 it was generalised to auto-discover:

```json
"build": "tsc && for f in tsconfig.*.json; do tsc --project \"$f\"; done"
```

This means the engineer only needs to add a `tsconfig.auth.json` (or any new
`tsconfig.<name>.json`) and the pipeline picks it up automatically. No build
script edit required for new Lambda subdirs going forward.

**Naming convention (documented here for engineer):** the `oxo-ws-auth-fn`
handler source goes in `src/lambda/auth/` (or `ws-auth/`). The corresponding
tsconfig must be `tsconfig.auth.json` (or `tsconfig.ws-auth.json`) at the
`src/lambda/` root, with `"rootDir": "./auth"` and `"outDir": "./auth/dist"`.
CDK `fromAsset('./auth/dist')` then finds the compiled output.

### Stack ordering

Unchanged: `OxoOnlineWafUsEast1` → `OxoGameProd` → `OxoOnlineProd`.
All new resources live inside `OxoGameProd`. No new cross-stack import.

### New GitHub Actions variables/secrets required (s005-h2)

None. All new resources are CDK-managed inside `OxoGameProd` under the
existing `OXO_ONLINE_INFRA_DEPLOY_ROLE_ARN`. No new GH secrets or variables.

### Deploy-role grants — none new

Confirmed per delta §9: `oxo-ws-auth-fn` lifecycle is CDK-owned; the
`oxo-deploy` (app pipeline) role is not involved. The execution-plane IAM
(authorizer role + two secret-read grants) is created by the CDK bootstrap
execution role. No new statement is required in `DEPLOY_ROLE_EXTENSIONS.md`.

### Rollback assets — s005-h2

**Authorizer rollback:** Remove the `AuthorizationType: CUSTOM` + `AuthorizerId`
from the `$connect` route (set route back to `NONE` in CDK), then re-deploy
`OxoGameProd`. This detaches the authorizer without deleting it; all
connections are immediately accepted without checking tokens. Roll forward
is preferred. Revert commit + re-deploy is sufficient.

**ConnectAttempts table:** `RemovalPolicy.DESTROY` (data is ephemeral, 5-min TTL;
no persistent state to protect). Removed on stack destroy.

**Shared secret:** CDK-generated, CDK-managed. Rotating: update the secret
value and force a cold start on both functions (re-deploy). Deleting the secret
is a CDK stack destroy operation — the two Lambda env vars reference it by name
and will fail on next cold start without it.

**OxoGameProd rollback:** CloudFormation rollback (`cdk deploy OxoGameProd
--rollback`) reverts to the prior change-set, removing the authorizer + table +
secret atomically. `Connections` + `Games` tables unaffected (separate resources
with `RemovalPolicy.RETAIN`/`DESTROY` already set from prior slices).

### §19 pre-flight checklist — s005-h2

| Check | Result |
|-------|--------|
| No manual pre-push step | PASS — shared secret is CDK-generated in-stack; no manual seed step (delta §10) |
| New Lambda dir (`src/lambda/auth/` or `ws-auth/`) covered by path trigger `src/lambda/**` | PASS — infra workflow already triggers on `work/oxo-online/src/lambda/**` |
| Lambda build auto-discovers new auth tsconfig | PASS — build script generalised (this slice); engineer adds `tsconfig.auth.json` only |
| `oxo-ws-auth-fn` code deployed via CDK `fromAsset`, not app-pipeline hot-swap | PASS — OI-24 pattern; no new `UpdateFunctionCode` step in deploy-oxo-online.yml |
| Stack deploy order unchanged | PASS — `OxoOnlineWafUsEast1` → `OxoGameProd` → `OxoOnlineProd`; no new cross-stack import |
| All resources inside `OxoGameProd` | PASS — no new stack, no new region |
| No `GITHUB_` prefix env vars | PASS — no new env vars |
| No new GH secrets or variables | PASS — confirmed in delta §9 |
| No new deploy-role grants | PASS — confirmed in delta §9 |
| `environment: production` gate absent | PASS — unchanged |
| Fail-fast validation step covers all required secrets | PASS — `OXO_ONLINE_INFRA_DEPLOY_ROLE_ARN` + `AWS_ACCOUNT_ID` already validated; no new secrets added |
| Stacks deploy sequentially | PASS — three separate pipeline steps unchanged |

### New allowlist entries — s005-h2 (cicd-owned, .claude/settings.json)

| Pattern | Rationale |
|---------|-----------|
| `Bash(aws apigatewayv2 get-authorizers *)` | Tester/probe verifies authorizer is attached to the WS API (SYNTH-CONTRACT-H2-1 live check) |
| `Bash(aws ssm describe-parameters *)` | Metadata-only SSM check (parameter names, types, ARNs) — verifies the shared secret parameter exists without exposing its value. `GetParameter` / `GetParametersByPath` are intentionally ABSENT: they would return the decrypted SecureString value, which is a secret and must never appear in agent output or logs. |
| `Bash(aws secretsmanager describe-secret *)` | Metadata-only secret check (ARN, name, rotation status) — if the engineer chooses `secretsmanager.Secret` instead of SSM SecureString. `GetSecretValue` is intentionally ABSENT: same rationale as SSM — value-reading verbs for secrets are banned from the allowlist regardless of construct choice. |

### Open items (s005-h2)

| ID | Item | Owner |
|----|------|-------|
| OI-H2-1 | Walking-skeleton probe (delta §0): after UC2 deploys, run one garbage-token connect (expect 403) and one valid-token connect (expect game-logic reached). This is cloud-only (APIGW authorizer attachment is not locally emulable). | tester |
| OI-H2-2 | Engineer must add `tsconfig.auth.json` (or matching name) to `src/lambda/` before creating the auth handler source. Build will pick it up automatically. | engineer |
| OI-H2-3 | `BUILD_SHA` env var must be injected on `oxo-ws-auth-fn` at CDK synth time (same pattern as `oxo-game-fn`/`oxo-ws-fn` per delta §8 + principles/01). | engineer |

---

## Slice s006 — move relay (iteration 9)

### What this slice adds

A `move` WS route on the EXISTING WebSocket API + `oxo-ws-fn` Lambda. Games
table gains `board`, `currentTurn`, `winner`, `version`, and `moveCount`
attributes. Move validation, state mutation, and relay to the opponent are
handled in the existing Lambda (no new function, no new stack, no new IAM
grant). s006 is a pure delta inside `OxoGameProd`.

### Environments in play

**Production only.** Unchanged from prior slices.

### Deploy path

Unchanged in structure — two pipelines, both green from s005-h2. s006
engineers push to `src/infra/**` (CDK schema + route registration) and
`src/lambda/**` (move handler). Both pipelines trigger as before.

```
push to main (work/oxo-online/src/infra/** or src/lambda/**)
  → infra-oxo-online.yml:
      npm install (infra) + npm ci (lambda) + build both
      cdk deploy OxoOnlineWafUsEast1 (no change)
      cdk deploy OxoGameProd  ← adds move route + schema changes
      cdk deploy OxoOnlineProd (no change)

push to main (work/oxo-online/src/app/**)
  → deploy-oxo-online.yml:
      Build SPA (VITE_BUILD_SHA=${{ github.sha }})
      S3 sync (3-pass) + CloudFront invalidation + wait
      wss URL runtime config write
      Smoke tests (workers:1, DEPLOY_SHA=${{ github.sha }})
      DORA record
```

### OI-25: SPA build-sha carrier (principles/01)

The SPA bundle now carries the commit sha baked in at build time.

**Mechanism:**
- `vite.config.ts`: no change needed beyond existing Vite HTML env substitution.
- `index.html`: `<meta name="build-sha" content="%VITE_BUILD_SHA%">` — Vite
  substitutes this at build time with the value of `VITE_BUILD_SHA`.
- Pipeline `Build SPA` step: `env: VITE_BUILD_SHA: ${{ github.sha }}`.
- Local builds: `VITE_BUILD_SHA` is absent; Vite leaves the literal string
  `%VITE_BUILD_SHA%` unchanged (or replaces with empty string depending on Vite
  version — either is acceptable in local dev).

**Exposure for tester:**
```
meta[name="build-sha"].content
```
Read in Playwright:
```ts
await page.locator('meta[name="build-sha"]').getAttribute('content')
```

**Smoke gate:**
`shell.spec.ts` includes a `sha-gate` test (first in the describe block) that
asserts `served_sha === DEPLOY_SHA` (env var set by pipeline to `github.sha`)
BEFORE any behavioural tests. Skipped when `DEPLOY_SHA` is absent (local dev).
This is the §39-correct CDN propagation check — not sleep/wait.

### OI-32: Smoke serialisation — partial (OI-32-FOLLOW-UP)

`playwright.config.ts` retains its pre-change defaults (`fullyParallel: true`,
default workers). The root cause of EXP-009 false-reds is the `$connect`
authorizer's per-IP rolling counter (ConnectAttempts DDB, 5-min TTL), NOT the
WAF 20/5-min limit. Empirical finding during s006-cap: setting `workers:1`
(serial execution) caused the per-IP authorizer counter to accumulate across
sequential WS tests, triggering 30s timeouts on legitimate connections (F6, F7)
after only 4 prior connections. The pre-change parallel config passes 41/42
tests; `workers:1` caused cascading failures.

**True fix (OI-32-FOLLOW-UP, engineer+tester):** Raise the per-IP authorizer
limit in `oxo-ws-auth-fn` for the CI runner's IP range, OR add inter-test
cool-down delays (e.g. `page.waitForTimeout(...)`) in the WS pairing specs
between tests that each open WS connections. CICD cannot fix a per-IP rate
counter inside the application authorizer without changing the authorizer limit
or test isolation strategy.

**Pre-existing defect (F3/T4):** The test asserts `"Game not found. Check the
code and try again."` but the live app returns `"Something went wrong. Please
try again."` for unknown codes (WS close code 4500 path). This message mismatch
was present before s006 and is unchanged by the CICD capability step. Tracked
as a separate engineer/tester defect.

### Orphan-flag check (§40)

- `H2_ENFORCE`: **no orphan.** The flag was factored out at `45b0aa4`
  (two-phase credential rollout, §40 lifecycle complete). The only remaining
  reference is a comment in `game-stack.ts` line 590 documenting the removal
  — not an active flag. Grep of production lambda source and SPA source:
  zero hits.
- No flags from s005-h2 remain in production code paths.
- UC flag mechanism for UC4+ (SPA-side): the project uses `window.OXO_CONFIG`
  (runtime config) and Vite build-time defines for feature flags. Introduce UC4
  flag as `OXO_CONFIG.uc4Enabled` (default `false`) written by the deploy
  pipeline or as a Vite define — document in delta when UC4 is sliced. No
  orphan to create now.

### §19 pre-flight checklist — s006

| Check | Result |
|-------|--------|
| No new stacks / functions / IAM grants | PASS — delta says no new surface; move route rides existing CDK exec role |
| No new GH secrets or variables | PASS — confirmed |
| `VITE_BUILD_SHA` env var uses `VITE_` prefix (not reserved `GITHUB_`) | PASS |
| `DEPLOY_SHA` env var uses non-reserved prefix | PASS |
| Workers:1 set in playwright.config.ts before engineers push smoke-triggering code | PASS — set in this capability step |
| Sha-gate test skips gracefully when DEPLOY_SHA absent (local dev) | PASS — `test.skip(!DEPLOY_SHA, ...)` |
| `aws dynamodb get-item` allowlisted for UC6 DDB-unchanged-after-reject assertion | PASS — already in settings.json |
| No new allowlist additions needed | PASS — all s006 command patterns already covered |

### Rollback assets — s006

No new rollback procedure. `OxoGameProd` CDK rollback (prior change-set) reverts
the move route and any schema changes atomically. Games table schema additions are
additive — items written before the move route existed are valid after rollback
(no attribute is required by prior code paths). Move relay is stateless between
WS messages: no rollback for in-flight messages needed.

### New GitHub Actions variables/secrets required (s006)

None.

---

## Slice s007 — real $disconnect + IMP-008 WAF runner-IP exclusion (iteration 10)

### What this slice adds

Two independent concerns shipped together:

1. **$disconnect handler (app path):** the existing stub route in `oxo-ws-fn`
   becomes a real abandon + notify + Connections-delete handler. One IAM grant
   added: `dynamodb:GetItem` on the `Connections` table for `oxo-ws-fn`. No new
   route, function, table, API, or region. CDK-managed inside `OxoGameProd`.

2. **IMP-008 WAF runner-IP exclusion (cicd/infra path):** a `oxo-test-runner-ips`
   WAFv2 IP set (scope `CLOUDFRONT`, region `us-east-1`) is added to the existing
   `OxoOnlineWafUsEast1` stack. The CloudFront rate-based rule gains a
   `NOT(IPSetReferenceStatement)` scope-down so traffic from a whitelisted runner
   IP does NOT count against the rate rule. The Block action and limit for all
   other IPs are **unchanged** — AC3.1 remains valid for non-runner sources.
   A scheduled 24h drain Lambda (also `us-east-1`, inside `OxoOnlineWafUsEast1`)
   clears any leaked entry as standing hygiene (required, not optional — per
   delta §IMP-008 architect blessing).

### Environments in play

**Production only.** Unchanged. No new environment, no new region (us-east-1
WAF was already the documented platform-forced exception from s005-h1).

### Deploy path

Unchanged in structure. Key additions for s007:

```
push to main (work/oxo-online/src/infra/**)
  → infra-oxo-online.yml:
      npm install (infra) + npm ci (lambda) + build both
      OIDC assume oxo-infra-deploy
      cdk deploy OxoOnlineWafUsEast1  ← adds oxo-test-runner-ips IP set
                                         + scope-down on rate rule
                                         + 24h drain Lambda + EventBridge schedule
      cdk deploy OxoGameProd           ← adds Connections:GetItem grant to
                                         oxo-ws-fn; $disconnect handler code
                                         ships via CDK fromAsset
      cdk deploy OxoOnlineProd         ← SPA opponent-disconnected UI change

push to main (work/oxo-online/src/app/**)
  → deploy-oxo-online.yml: unchanged (SPA build + sync + invalidation + smoke)
```

### §19 pre-flight checklist — s007

| Check | Result |
|-------|--------|
| No new manual pre-push step for $disconnect | PASS — Connections:GetItem grant rides the same `cdk deploy OxoGameProd` as the handler code (CDK-managed under existing bootstrap exec role; no `make deploy-oidc` needed) |
| us-east-1 CDK bootstrap exists | PASS — confirmed bootstrapped in s005-h1; drain Lambda is us-east-1 and is inside the existing `OxoOnlineWafUsEast1` stack which already deploys in us-east-1 |
| infra pipeline deploys `OxoOnlineWafUsEast1` | PASS — confirmed in `infra-oxo-online.yml` line 144: `npx cdk deploy OxoOnlineWafUsEast1 --require-approval never` with `CDK_DEFAULT_REGION: us-east-1` |
| EventBridge schedule for drain Lambda needs no new deploy-role grant | PASS — `scheduler:CreateSchedule`/`DeleteSchedule` and Lambda `InvokeFunction` on a same-stack resource are executed by the CDK bootstrap execution role (AdministratorAccess), not the `oxo-infra-deploy` OIDC role. The `oxo-infra-deploy` role only needs `cloudformation:*` + CDK bootstrap assumption, both already granted. No new OIDC role extension required |
| IMP-008 scope-down preserves AC3.1 block for non-runner IPs | PASS — scope-down is a `NOT(IPSetReferenceStatement)` on the rate rule; the Block action and rate limit are unchanged for any IP not in the set |
| No new GH secrets or variables | PASS — IP set name resolved at call time by the waf-runner-ip.js script; no new secret needed |
| No `GITHUB_` prefix env vars | PASS — no new env vars in pipelines |
| Stacks deploy sequentially | PASS — three separate pipeline steps unchanged |
| smoke-ci + waf-runner-ip-add/remove Makefile targets and allowlist entries | PASS — added in this capability step (see allowlist section below) |

### IMP-008 deploy-role grant check

The `oxo-infra-deploy` OIDC role already holds `Wafv2Manage` + `CloudFrontSetWebAcl`
statements (added at s005-h1). Those grants cover:
- `wafv2:CreateWebACL`, `UpdateWebACL`, `DeleteWebACL`, `GetWebACL`, `ListWebACLs`
- `wafv2:TagResource`, `UntagResource`, `ListTagsForResource`

The IP set management actions (`wafv2:CreateIPSet`, `wafv2:UpdateIPSet`,
`wafv2:DeleteIPSet`, `wafv2:GetIPSet`, `wafv2:ListIPSets`) are NOT covered by
the existing grant. **The engineer must add an `IpSetManage` policy statement to
`oxo-online-oidc-stack.ts` and run `make -C work/oxo-online/src/infra deploy-oidc`
BEFORE the first push of the IMP-008 CDK change.** See DEPLOY_ROLE_EXTENSIONS.md.

The 24h drain Lambda's EventBridge schedule is created by CloudFormation (the CDK
bootstrap execution role) — no additional OIDC role grant for EventBridge scheduler
is needed.

### Orphan-flag check (§40) — s007 entering

- `uc4Enabled`: confirmed factored out at s006 delivery (`ecd8c37`). References
  found are comments and test assertions about the factoring — no active flag in
  production code paths. **Zero orphan.**
- `H2_ENFORCE`: confirmed factored out at s005-h2 delivery (`45b0aa4`). Remaining
  reference in `game-stack.ts` is a comment documenting removal, not an active
  flag. **Zero orphan.**
- No UC flags introduced in s007 ($disconnect is unconditional; IMP-008 IP set
  is infrastructure, not a feature flag). **Zero flags to track for s008.**

### New allowlist entries added — s007

| Pattern | Rationale | Status |
|---------|-----------|--------|
| `Bash(aws wafv2 get-ip-set *)` | Tester/engineer reads IP set metadata (ARN, current addresses) to verify oxo-test-runner-ips exists and entries are correct | ADDED |
| `Bash(aws wafv2 update-ip-set *)` | `waf-runner-ip.js` script invoked by `make waf-runner-ip-add/remove` to append/remove CIDR entries | ADDED |
| `Bash(curl https://checkip.amazonaws.com)` | Auto-detect runner public IP in `make smoke-ci` (exact host, not a wildcard — preserves existing curl CF-domain restriction) | ADDED |
| `Bash(make smoke-ci *)` | Tester invokes the add-smoke-remove sequence from one command | ADDED |
| `Bash(make waf-runner-ip-add *)` | Tester/engineer manually adds a CIDR to the runner IP set | ADDED |
| `Bash(make waf-runner-ip-remove *)` | Tester/engineer manually removes a CIDR from the runner IP set | ADDED |
| `Bash(aws logs start-query *)` | Tester runs Logs Insights queries for OI-35 S4 pin (disconnect-notify log count) | ADDED |
| `Bash(aws logs get-query-results *)` | Tester polls Logs Insights query results for OI-35 S4 assertion | ADDED |

Already covered (no new entry needed):
- `Bash(aws wafv2 get-web-acl *)` — already in allowlist from s005-h1
- `Bash(aws logs filter-log-events *)` — already in allowlist; covers simpler log checks

### Rollback assets — s007

**$disconnect handler:** roll forward preferred. Reverting `oxo-ws-fn` code
(via a corrected commit → infra pipeline re-deploys) restores the s006 stub.
The `Connections:GetItem` grant removal is a CDK policy rollback. No data loss:
any `abandoned` items TTL-reap in 24h. The s006 frozen-board behaviour is the
rollback state.

**IMP-008 IP set + scope-down + drain Lambda:** removing these CDK resources
from `OxoOnlineWafUsEast1` returns the rate rule to applying to all IPs (the
pre-s007 state). No app/data change. CI runs against the rate-rule-full surface
until the IP set is re-provisioned.

---

## Slice s009 — arcade scoreboard (iteration 14, opens C5)

### §19 pre-flight verdict

**No new pre-push step required before the engineer's UC2 push.**

All five checks confirmed:

**1. Deploy-role grant — NO new grant needed.**

`oxo-board-fn` code is deployed exclusively via CDK `fromAsset()` through the
infra pipeline (OI-24 pattern — Lambda hot-swap was removed from the app pipeline
at s005-h2; see deploy-oxo-online.yml lines 34-41). The `oxo-deploy` OIDC role's
`LambdaCodeDeploy` statement currently covers `oxo-game-fn` and `oxo-ws-fn` only,
and that statement does NOT need extending for `oxo-board-fn` because the app
pipeline never calls `UpdateFunctionCode` on any Lambda.

The CDK bootstrap execution role (AdministratorAccess) creates:
- The `Leaderboard` DynamoDB table (NEW_PITR).
- The DynamoDB Stream on `Games` (StreamSpecification enablement on existing table).
- The event-source mapping (`oxo-board-fn` ESM on the Games stream).
- The `oxo-board-fn` Lambda and its least-privilege execution role.
- The `GET /api/leaderboard` route on the existing HTTP API.
- The `dynamodb:Scan` grant on `Leaderboard` for `oxo-game-fn`.
- The 5s CloudFront cache behaviour for `/api/leaderboard`.

None of these require the `oxo-infra-deploy` OIDC role to have any grant beyond
the existing `CdkBootstrapRoleAssume` (assume `cdk-*-deploy-role-*` + publishing
roles). The bootstrap exec role is AdministratorAccess and handles all of this.

Delta §5 also notes `oxo-deploy += scoped UpdateFunctionCode/GetFunction on
board-fn ARN` — but since the app pipeline never hot-swaps any Lambda (OI-24),
this grant is UNNEEDED. The engineer MUST NOT add it; the OIDC stack is already
correct.

**Conclusion: NO `make deploy-oidc` step before UC2 push. Pure CDK deploy.**

**2. Stream enablement on Games — NON-DESTRUCTIVE UPDATE (no data loss).**

The current `GamesTable` CDK construct (game-stack.ts line 54) has no
`stream` property — DynamoDB Streams is currently DISABLED on the Games table.
Enabling `StreamSpecification` (`stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES`)
on an existing DynamoDB table is a CloudFormation in-place UPDATE — not a
table replacement. DynamoDB supports enabling/changing stream settings on live
tables via the `UpdateTable` API, which CloudFormation calls. No item is
affected; no data is lost. The table ARN, partition key, existing items,
TTL, GSIs, and `RemovalPolicy.RETAIN` are all untouched.

This is confirmed by the CDK/CloudFormation resource model: `AWS::DynamoDB::Table`
`StreamSpecification` is a mutable property; CloudFormation can UPDATE it
without replacement. (A replacement would be triggered by changes to the
`KeySchema` or `TableName` — neither changes here.)

**Verdict: SAFE. The engineer enables the stream; no live game data is at risk.**

The engineer must add to the `GamesTable` construct:
```typescript
stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
```
This triggers a CloudFormation UPDATE (not REPLACE) on the Games table resource.

**3. Allowlist — already fully covered.**

| Tester action | Pattern | Status |
|---|---|---|
| `aws dynamodb scan` on Leaderboard | `Bash(aws dynamodb scan *)` | COVERED (added s005-h3) |
| `aws dynamodb get-item` on Leaderboard | `Bash(aws dynamodb get-item *)` | COVERED |
| `aws dynamodb describe-table` on Leaderboard | `Bash(aws dynamodb describe-table *)` | COVERED |
| `curl GET /api/leaderboard` via CloudFront | `Bash(curl https://d3pf3kcvzpau1x.cloudfront.net*)` | COVERED — the glob `*` after the hostname matches any path including `/api/leaderboard` |

No new allowlist entries needed.

**4. Orphan-flag check (§40) — ZERO orphans.**

Confirmed by grep of production Lambda source and SPA source:
- `H2_ENFORCE`: factored out at `45b0aa4` (s005-h2). The only remaining
  reference in `game-stack.ts` is a comment documenting the removal. Zero active
  code references.
- `uc4Enabled`: factored out at s006. The `OnlineBoard.tsx` comment at line
  references the removal explicitly ("was factored out at slice delivery").
  Zero active flag code.
- No UC flags introduced in s008 (no feature flags in s008 scope).
- `UC2`/`UC4` references in source files are section annotations in comments
  and JSDoc, not runtime flag checks.

**Zero active UC flags in any production code path going into s009.**

s009 does NOT need a new UC flag — `oxo-board-fn`, `Leaderboard`, the Stream,
and the `/api/leaderboard` route are all unconditionally shipped. No phased rollout.

**5. Pipeline state — GREEN.**

App pipeline (deploy-oxo-online.yml): run 27120930662 — SUCCESS (DEFECT-S002-001
board-geometry fix, committed `cd2edaf`). The sha-gate smoke (OI-40 dynamic-sha-gate
fix) was applied and the app pipeline is confirmed healthy.

Infra pipeline (infra-oxo-online.yml): run 27105854184 — SUCCESS (uniqueness-probe
make target, s005-h3 UC2/UC3 validation).

Both pipelines green at HEAD.

### What s009 adds to the deploy path

```
push to main (work/oxo-online/src/infra/** or src/lambda/**)
  → infra-oxo-online.yml:
      npm install (infra) + npm ci (lambda) + build both
      OIDC assume oxo-infra-deploy
      cdk deploy OxoOnlineWafUsEast1   (no change)
      cdk deploy OxoGameProd           ← adds: Games Stream enabled,
                                           Leaderboard table (PITR),
                                           oxo-board-fn Lambda + ESM,
                                           GET /api/leaderboard route,
                                           Scan grant on oxo-game-fn,
                                           5s CF cache behaviour for /api/leaderboard
      cdk deploy OxoOnlineProd         ← adds: /api/leaderboard 5s cache behaviour
```

App pipeline (deploy-oxo-online.yml): SPA changes (name-entry field, leaderboard
panel) trigger the app pipeline. No new deploy steps; SPA build + S3 sync + CF
invalidation + sha-gate smoke covers it.

### Stack ordering

All new s009 resources are inside `OxoGameProd`. No new cross-stack export (the
`/api/leaderboard` route lives in the same HTTP API already exported). The
existing three-stack sequence is sufficient and unchanged.

The 5s CloudFront cache behaviour for `/api/leaderboard` lives in `OxoOnlineProd`
(the distribution stack). The `HttpApiEndpoint` export from `OxoGameProd` is
already consumed by `OxoOnlineProd` for the `/api/*` origin — the leaderboard
behaviour uses the same origin. No new CfnOutput cross-stack reference is
introduced.

### Rollback assets — s009

**Leaderboard table:** `RemovalPolicy.RETAIN` (durable table — first non-TTL
table; must never auto-drop). CDK rollback cannot delete it. Forward-fix is the
only path; the table accumulates correctly from any version of `oxo-board-fn`.

**DynamoDB Stream on Games:** disabling the stream (removing the `stream:`
property) is a non-destructive UPDATE reversing the same non-destructive UPDATE
that enabled it. No data loss in either direction. The event-source mapping is
removed on rollback; `oxo-board-fn` stops receiving events.

**`oxo-board-fn`:** roll forward preferred. CDK rollback removes the function.
Leaderboard writes stop; the table retains its prior state (PITR recoverable).

**GET /api/leaderboard:** removing the route from the HTTP API is a non-destructive
UPDATE. The SPA renders an empty board on 404 (graceful degrade).

**5s CF cache behaviour:** removing it from OxoOnlineProd falls back to the
default CachingDisabled behaviour for `/api/leaderboard` — requests pass through
unthrottled. Not a data-loss risk.

### New GitHub Actions variables/secrets required (s009)

None. All new resources deploy under existing `OXO_ONLINE_INFRA_DEPLOY_ROLE_ARN`
via CDK bootstrap exec role (AdministratorAccess). No new GH secrets or variables.

### §19 pre-flight checklist — s009

| Check | Result |
|-------|--------|
| No new `make deploy-oidc` step before UC2 push | PASS — confirmed; all new resources under bootstrap exec role AdministratorAccess |
| Stream enablement on Games = non-destructive UPDATE (not REPLACE) | PASS — StreamSpecification is a mutable CFN property; no KeySchema change |
| No new OIDC role grants needed | PASS — `oxo-board-fn` code deploys via infra pipeline CDK fromAsset (OI-24); app pipeline never calls UpdateFunctionCode |
| Allowlist covers all tester patterns | PASS — scan/get-item/describe-table/curl CF glob already present |
| Zero orphan UC flags | PASS — H2_ENFORCE and uc4Enabled both confirmed factored out |
| Stack deploy order unchanged (WAF → OxoGameProd → OxoOnlineProd) | PASS — all s009 resources inside OxoGameProd; 5s CF behaviour inside OxoOnlineProd; no new cross-stack CfnOutput |
| No new GH secrets or variables | PASS |
| `GITHUB_` prefix env vars absent | PASS — no new env vars |
| `environment: production` gate absent | PASS — unchanged |

### Capability note for engineer (UC2)

The engineer must add `stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES` to
the `GamesTable` construct in `game-stack.ts` before creating the event-source
mapping. The stream ARN used by the `oxo-board-fn` ESM is
`gamesTable.tableStreamArn` — available immediately after the property is set
(it is a CloudFormation `Fn::GetAtt` reference, resolved at deploy time). No
separate stack step; no pre-push manual action.
