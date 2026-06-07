---
name: aws-architecture
description: AWS Well-Architected reference for solution-architect and cicd agents. Covers service selection defaults, IaC approach, account and network structure, IAM least-privilege patterns, security controls by resource type, and reversal conditions. Load this before producing any AWS design, diagram, IAM policy, or IaC.
---

# AWS Architecture — Working Reference

Defaults for this team. Deviate only with justification; log deviations in
`/process/principle-failures/`. Reversal conditions are listed per decision so
the delta is cheap when requirements change.

---

## 0. Read the AWS profile first

Before any AWS CLI or SDK operation:
1. Read `.claude/config/aws-profile` to get the SSO profile name.
2. Run `aws sso login --profile <profile>` (opens browser, completes in ~2s).
3. Pass `--profile <profile>` to every `aws` CLI call.

---

## 1. IaC default: AWS CDK (TypeScript)

- **Default:** AWS CDK v2 in TypeScript. One CDK app per project under
  `infra/` in the repository. Stacks named by environment: `OxoOnlineProd`.
- **Why:** CDK generates CloudFormation, gives type-safe constructs, and
  integrates naturally with the TypeScript/Node backend this team uses.
- **Reversal → Terraform:** if the project is multi-cloud, or if the team has
  strong existing Terraform expertise and no TypeScript familiarity.
- **Never:** raw CloudFormation JSON/YAML (no type safety, no reuse).

CDK bootstrap: `cdk bootstrap aws://<account>/<region> --profile <profile>`.

---

## 2. Accounts and environments

| Pattern | When to use |
|---------|-------------|
| **Single prod account** | Default. Fastest to first deploy; matches "deploy straight to prod" principle. |
| **Prod + staging accounts** | Once CFR justifies pre-prod gating (a real customer to protect). Use AWS Organizations + SCPs. |
| **Dev per-developer** | If engineers need sandbox experimentation without risk to prod. Introduce on demand. |

- All cross-account and CI/CD trust via **OIDC federation** — no long-lived IAM
  user keys ever.
- Tag every resource: `Project`, `Env`, `ManagedBy=cdk`.

---

## 3. Compute: decision tree

```
Does the workload need a long-lived TCP connection (WebSocket server)?
  Yes → API Gateway WebSocket + Lambda (managed conns; Lambda per message)
       Reversal: ECS Fargate if cold-start p95 > 1s under load
  No  →
    Is it HTTP request/response?
      Spiky / low-volume / new project → Lambda + API Gateway HTTP
      High-sustained / CPU-bound / >15min → ECS Fargate (private subnet, ALB)
    Is it a background job?
      Short (< 15min) → Lambda (EventBridge or SQS trigger)
      Long-running → ECS Fargate task (Batch or Step Functions)
```

**Default for new projects:** Lambda everywhere until a reversal condition is
hit. Scale-to-zero = zero idle cost; no cluster/patching to manage.

Lambda settings:
- Runtime: Node 20.x (matches frontend stack) or Python 3.12.
- Memory: start 512MB; tune with Lambda Power Tuning if needed.
- Timeout: set per function (not the 15-min max); game-move handler ≤ 3s.
- Reserved concurrency: set for critical paths to prevent noisy-neighbour
  starvation.

---

## 4. Frontend: React SPA

- **S3 + CloudFront (OAC).** S3 bucket is private; CloudFront is the only
  allowed origin via Origin Access Control.
- CloudFront also routes `/api/*` and `/ws` to the backend so the SPA is
  same-origin (no CORS friction, simplifies cookie/auth scoping).
- TLS: ACM certificate in `us-east-1` (required for CloudFront). TLS 1.2+.
  Enforce HTTPS redirect at the distribution.
- SPA error routing: custom error response 403→`/index.html` (React Router).
- Cache: HTML files → `no-cache`; JS/CSS bundles → 1 year (content-hashed).

---

## 5. Database: decision tree

```
Is the data relational (joins, transactions across entities)?
  Yes → Aurora Serverless v2 (PostgreSQL-compatible). VPC private subnet.
  No  →
    Is it a simple key-value / document store?
      → DynamoDB (on-demand billing; TTL for ephemeral data)
    Is it session/cache?
      → ElastiCache (Redis) or DynamoDB with TTL
    Is it a search index?
      → OpenSearch Serverless
```

**DynamoDB defaults:**
- Billing: on-demand (not provisioned) for new projects.
- Encryption: AWS-managed key (SSE enabled by default in CDK).
- TTL: always set for ephemeral items (game state, WS connections, sessions).
  Prevents unbounded storage growth without a cleanup job.
- Access: Lambda execution roles only; never direct public access.

**Aurora Serverless v2 defaults:**
- Deployed into **private subnets** in a VPC. No public endpoint.
- Accessed by Lambda/ECS via **RDS Proxy** (connection pooling) or a VPC
  interface endpoint.
- Minimum capacity: 0.5 ACU (scale-to-near-zero for dev/low-traffic prod).
- Reversal → provisioned RDS: if workload is steady and ACU costs exceed
  reserved instance pricing.

---

## 6. Networking defaults

| Scenario | VPC needed? | Notes |
|----------|-------------|-------|
| Lambda + managed services only (DynamoDB, S3, API GW) | **No** | All traffic over AWS network via service endpoints. No VPC = no NAT cost, no SG management. |
| Lambda + Aurora/RDS | Yes | Private subnets for Lambda + RDS; NAT or VPC endpoints for S3/DynamoDB. |
| ECS Fargate | Yes | Private subnets for tasks; public subnets + ALB for ingress; no public IP on tasks. |

**If a VPC is needed:**
- `/16` CIDR for the VPC; `/24` subnets (3 AZs, private + public pair each).
- NAT Gateway: one per AZ for prod; one shared for non-prod (cost vs
  availability trade-off).
- Security groups: principle of least privilege; ALB→task on app port only;
  no `0.0.0.0/0` on inbound except the ALB.

---

## 7. IAM: least-privilege patterns

Rules:
1. One IAM role per Lambda function / ECS task. Never share roles between
   services.
2. Resource ARN scope on every policy statement — never `"Resource": "*"`.
3. CI/CD deploy role scoped to `repo/branch` via OIDC `sub` condition.
4. No inline policies on users. No IAM users for applications.
5. Enable AWS CloudTrail in all accounts (management + data events for S3).

Standard CDK construct for OIDC:
```typescript
const ghProvider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
  url: 'https://token.actions.githubusercontent.com',
  clientIds: ['sts.amazonaws.com'],
});
const deployRole = new iam.Role(this, 'DeployRole', {
  assumedBy: new iam.WebIdentityPrincipal(ghProvider.openIdConnectProviderArn, {
    StringEquals: {
      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub':
        'repo:<org>/<repo>:ref:refs/heads/main',
    },
  }),
});
```

---

## 8. Security controls by resource type

Use these as the checklist when writing `architecture/security/<resource>.md`.
Each item is a **checkable statement** that becomes a policy test.

### S3 (web/asset bucket)
- [ ] `BlockPublicAcls`, `BlockPublicPolicy`, `IgnorePublicAcls`,
      `RestrictPublicBuckets` all true.
- [ ] CloudFront OAC is the only allowed `s3:GetObject` principal.
- [ ] SSE-S3 or SSE-KMS enabled.
- [ ] Versioning enabled for buckets that hold deployment artifacts.
- [ ] Bucket policy denies `s3:*` except from the OAC principal.

### CloudFront
- [ ] HTTPS-only viewer protocol (redirect HTTP → HTTPS).
- [ ] TLS 1.2+ (use `SecurityPolicyProtocol.TLS_V1_2_2021`).
- [ ] `Strict-Transport-Security`, `Content-Security-Policy`,
      `X-Frame-Options` headers set via Response Headers Policy.
- [ ] Origin is OAC-authenticated S3 or a private ALB/API GW.
- [ ] WAF WebACL attached (rate limiting + managed rule groups) for C4+.

### API Gateway (HTTP + WebSocket)
- [ ] TLS only (API Gateway enforces this; document for completeness).
- [ ] Throttle default: burst 1000, rate 500 rps (adjust per load test).
- [ ] WAF: **only via CloudFront-front for v2 (HTTP/WebSocket) APIs** — a WAFv2
      WebACL cannot associate directly to a v2 API stage. See "WAFv2
      associability" below. For REST v1 stages a REGIONAL WebACL attaches
      directly.
- [ ] WebSocket `$connect`: verify capability token; reject unknown origins.
- [ ] Per-route authorizer where needed (not the same Lambda for all routes).

### WAFv2 associability (read BEFORE designing any WAF attachment)
A WAFv2 WebACL only protects targets it can actually associate with. Discovered
the hard way (oxo-online s005-h1-waf, deploy reject 2026-06-06):
- **CLOUDFRONT scope** (WebACL + ACM cert MUST be in **us-east-1**): attaches to
  **CloudFront distributions** (set via the distribution `webAclId` property).
- **REGIONAL scope** (home region): attaches to **REST API v1 stages, ALB,
  AppSync GraphQL APIs, Cognito user pools, App Runner services, Verified Access
  instances** — and **NOTHING ELSE**.
- **NOT associable: API Gateway *v2* APIs (HTTP API or WebSocket API).** A
  `CfnWebACLAssociation` against a v2 API/stage ARN is rejected at CREATE with an
  invalid-ARN error. Do not design a regional WebACL for an HTTP-v2/WebSocket
  stage — it will not deploy.
- **For v2 APIs, the protection pattern is:** stage **throttling** (account/
  stage-level rate+burst, not per-IP) + **Lambda authorizer-level controls**
  (a `$connect`/route authorizer CAN rate-limit on source IP and authenticate) +
  optionally **put CloudFront in front** and attach the global WebACL there
  (per-IP WAF then applies at the edge). Choose the authorizer for per-IP/auth;
  choose CloudFront-front for edge WAF + managed rule groups.

### Lambda
- [ ] Execution role follows §7 (one role per function, ARN-scoped).
- [ ] No `AWSLambdaFullAccess` or `AdministratorAccess`.
- [ ] Environment variables: no secrets in plaintext — use SSM Parameter
      Store (SecureString) or Secrets Manager; inject at deploy time via CDK.
- [ ] VPC attachment only if function needs VPC resources; otherwise no VPC
      (avoids cold-start penalty from ENI provisioning).
- [ ] Reserved concurrency set to prevent runaway cost.

### DynamoDB
- [ ] Encryption at rest (AWS-managed key default; CMK if data is sensitive).
- [ ] No public endpoint (not applicable — DynamoDB is private by design).
- [ ] TTL attribute configured for ephemeral tables.
- [ ] Point-in-time recovery (PITR) enabled on durable tables (leaderboard).
- [ ] Access only via scoped Lambda execution roles.

### IAM / OIDC
- [ ] No long-lived IAM user access keys for CI/CD.
- [ ] OIDC provider trust constrained to `repo:org/repo:ref:refs/heads/main`
      (or the deploy branch).
- [ ] Deploy role cannot `iam:CreateRole`, `iam:AttachRolePolicy`, or
      `iam:PutRolePolicy` (prevents privilege escalation via deploy).

---

## 9. CI/CD pipeline (GitHub Actions defaults)

Minimal pipeline stages, in order:

```
1. install        → npm ci (or pip install)
2. lint           → eslint / ruff
3. test           → jest / pytest (with coverage gate)
4. build          → tsc / webpack / docker build
5. deploy-infra   → cdk diff + cdk deploy (prod stack)
6. deploy-app     → aws s3 sync + CF invalidation (SPA)
                    or: aws lambda update-function-code (Lambda)
7. dora-record    → python .claude/skills/dora-ledger/scripts/dora.py record --event deploy
8. smoke-test     → curl / playwright against prod URL
```

- Trigger: push to `main` only. PRs run steps 1–4.
- Auth: OIDC role (§7). No `AWS_ACCESS_KEY_ID` in secrets.
- Environment variables from GitHub Actions secrets → injected as env vars
  during the deploy step (never baked into the artifact).
- On failure at step 5+: emit `--event failure` to DORA ledger; alert via
  GitHub notification.

---

## 10. Well-Architected pillars — quick checklist

| Pillar | Default action |
|--------|---------------|
| **Security** | OIDC for CI; OAC for S3; server-authoritative data; WAF at C4+; SSE everywhere; per-function roles |
| **Reliability** | Multi-AZ managed services (DynamoDB, API GW, Lambda); DynamoDB PITR on durable tables; TTL for ephemeral state; idempotent operations |
| **Performance** | CDN for static assets; DynamoDB single-item reads; Lambda cold-start monitoring; AI client-side where < 200ms target |
| **Cost** | Scale-to-zero (Lambda, DynamoDB on-demand, Aurora Serverless); no idle NAT/EC2/RDS; TTL avoids storage growth; tag all resources for cost allocation |
| **Operational Excellence** | IaC for all resources (CDK); structured CloudWatch logs; DORA ledger hooked into CI; CloudTrail enabled |
| **Sustainability** | On-demand over provisioned; scale-to-zero; no always-on infrastructure beyond what's needed |

---

## 11. Reversal log

Keep a running table here of any deviation from the defaults above, with the
condition that would trigger a reversal:

| Deviation | Project | Justification | Reversal condition |
|-----------|---------|---------------|-------------------|
| Lambda over ECS Fargate | oxo-online | Spiky low-volume; scale-to-zero | p95 move latency > 1s due to cold starts |
| API GW WS over ECS long-lived | oxo-online | Managed conns; no warm server needed | Message fan-out rate > API GW limits |
| DynamoDB over RDS | oxo-online | No relational need; ephemeral game state | Leaderboard needs ranked queries beyond top-N |
| No VPC (C1-C7) | oxo-online | All managed services; no EC2/ECS | Fargate reversal triggered; ECS needs VPC |
| Well-Architected from first principles (skill was missing) | oxo-online | `aws-architecture` skill absent at project start | Skill now present; use for future projects |
| WS per-IP WAF dropped; per-IP moved to `$connect` authorizer (2026-06-06, GATE-AMEND-H1-A) | oxo-online | WAFv2 cannot associate API GW v2 (WebSocket) — deploy reject; see "WAFv2 associability" §8 | If WS migrates to a fronted CloudFront path or REST v1, a regional/edge WebACL becomes attachable again |

## Region policy (human-directed, 2026-06-06)

**Single-region default: every resource lives in the project's home region
unless there is a very good reason not to.** (For current projects the home
region is recorded in the project's /work artifacts.)

Acceptable exception classes — each must be documented IN THE DELTA as a
justified exception, naming the forcing constraint:
- **Platform-forced placement** (e.g. WAFv2 WebACLs with CLOUDFRONT scope and
  ACM certs for CloudFront MUST be in us-east-1; CloudFront/IAM/Route53 are
  global services).
- A named, evidenced non-functional requirement (data residency, DR,
  latency to users) — introduced only as the need demands, never
  speculatively.

Consequences when an exception is taken: the cross-region stack is kept
MINIMAL (only the forced resources), the cross-region value handoff is a §30
contract (synth-assert the reference), and the deploy order/rollback notes
state the extra region explicitly. An undocumented out-of-region resource is
a review failure.

## WAFv2 rate-rule evaluation semantics (observed 2026-06-06)
Rate-based rules aggregate over a SLIDING window (default 300s) with periodic
evaluation (~30s cycles) and propagation latency. A short synchronous burst
completes before the counter trips — false negative. Designs and validation
specs must use SUSTAINED over-limit traffic (cross the threshold early, keep
several evaluation cycles of headroom). Blocks default to 403; if CloudFront
fronts the resource and maps 403 in CustomErrorResponses, use a custom block
response code DISJOINT from the CF error mapping (e.g. 429) and synth-assert
the disjointness, or blocks are invisible at HTTP level.

## API Gateway v2 WebSocket authorizer semantics (observed 2026-06-07)
- REQUEST authorizers on WEBSOCKET APIs return the REST-style IAM policy
  document ({principalId, policyDocument}), NOT the HTTP-API simple
  {isAuthorized} shape.
- WEBSOCKET APIs REJECT AuthorizerResultTtlInSeconds outright — WS
  authorizers never cache results; omit the property (no-cache is inherent).
  Setting it (even to 0) fails CREATE with BadRequestException. (strike 4)
- IdentitySource lists are ALL-REQUIRED (AND), NOT or. API Gateway rejects a
  $connect missing ANY listed identity source BEFORE invoking the authorizer
  (no log group ever appears — false-clean "authorizer never ran"). It cannot
  express OR. For either-or credentials (e.g. host ?wsToken XOR guest ?code),
  OMIT IdentitySource entirely — a REQUEST authorizer with no source is invoked
  UNCONDITIONALLY, and the authorizer fn does the either-or / deny-when-absent
  logic itself. (strike 5, DEFECT-H2-002)
