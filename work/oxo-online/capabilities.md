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

## Forward note — not built in slice 001

From Chunk 4 the pipeline gains:
- Lambda packaging + `lambda:UpdateFunctionCode` deploy step
- DynamoDB table provisioning via IaC
- WebSocket + HTTP API deployment
- Backend integration tests
- WAF WebACL attached to CloudFront (per security note; deferred to C4)
- Capabilities file revised then.
