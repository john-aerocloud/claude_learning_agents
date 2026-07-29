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

## 1. IaC default: SST v3 (Ion), TypeScript

> **This is the org standard (human-directed, 2026-07-11).** The prior CDK
> default caused repeated, cross-project problems (an un-gated CDK choice reached
> build + a live deploy on AdixOut before being caught; see
> `/process/principle-failures/2026-07-11-adixout-skipped-solution-architecture-gate-iac.md`).
> **Default to SST v3 (Ion). Do NOT default to CDK.** The reference implementation
> is the OagEventSource project (`Spike-FlightEventSource-OAG/sst.config.ts`) —
> read it before authoring infra.

- **Default:** **SST v3 (Ion)** in TypeScript — one SST app per project rooted at
  `sst.config.ts` (`export default $config({ app(){…}, async run(){…} })`).
  `app()` returns `{ name, home: "aws", removal: "retain", providers: { aws } }`
  with `aws = hasEnvCreds ? { region } : { region, profile: process.env.AWS_PROFILE ?? "<sandbox-profile>" }`
  (CI injects OIDC env creds → no profile; local falls back to the shared-config
  profile). Deploy per **stage**: `sst deploy --stage <env>`; tear down with
  `sst remove --stage <env>`.
- **Why:** SST v3 (Ion) provisions via Pulumi/Terraform providers (NOT
  CloudFormation), gives type-safe first-class components (`sst.aws.Function`,
  `sst.aws.Dynamo`, `sst.aws.Queue`, `sst.aws.ApiGatewayV1/V2`) with raw Pulumi
  (`aws.*`) available for anything without a first-class component (KMS, IAM,
  EventBridge cron, EventBus, Pipes), and it is the convention the org's live
  services already use — matching siblings avoids the cross-project drift the CDK
  default caused.
- **Construct notes that bite (from OagEventSource + AdixOut):**
  - **IAM is HAND-AUTHORED, not link/grant-inferred.** Pre-create `aws.iam.Role`
    + inline `aws.iam.RolePolicy` per function, ARN-scoped, enumerating the FULL
    op set of the real access path — including the READS a write path performs
    (`dynamodb:Query`/`GetItem`) and `kms:Decrypt` for SSE. Under-granting is the
    #1 SST failure mode (OAG hit `AccessDenied` three times this way). Pin
    code↔policy (§30) so they cannot drift.
    (This replaces CDK's automatic `grant*()` inference — there is no auto-grant.)
  - `sst.aws.Cron` wraps a handler *definition*, not a pre-built Function — for a
    scheduled invoke of a pre-built Function use **raw Pulumi**
    `aws.cloudwatch.EventRule` (`rate(1 minute)`) + `EventTarget` + `aws.lambda.Permission`.
  - Only `sst.aws.ApiGatewayV1` (REST) has usage plans / API keys; HTTP-API v2
    lacks them — choose V1 when per-consumer throttling is a (current or seam'd)
    requirement.
  - Tags do not propagate app-wide under Pulumi — set the §2a tag set per resource.
  - **To tag/customize a component's CHILD resource, use the component's
    construction-time `transform.<child>` PROP, NOT a global `$transform` (AdixOut
    UC-ADIX-016, 2 rework cycles).** A first-class component creates child resources
    *inside itself at construction* (e.g. `sst.aws.ApiGatewayV1` creates its
    `aws.apigateway.Stage`). Pulumi child resources inherit only transforms registered
    BEFORE their parent component is constructed, so a global
    `$transform(aws.apigateway.Stage, …)` registered after the component exists is a
    permanent NO-OP for that Stage — and worse, `sst diff` FALSELY shows the tag applying
    though it never lands live. Pass the customization on the component instead —
    `new sst.aws.ApiGatewayV1("api", { transform: { stage: { tags: {…} } } })`. (Resources
    added via LATER explicit calls — a UsagePlan/ApiKey created after the API — are NOT
    child-at-construction and are unaffected by this; a global `$transform` or direct prop
    works for them.)
  - SST keeps its deploy state in an SST-managed S3 bucket (`s3://sst-state-<hash>/<App>/<stage>/`) <!-- doc-lint:allow -->
    + encrypted `resource.enc` — a private bucket + a scoped OIDC deploy role are
    part of the security surface (see the project's `security/sst-deploy-and-state.md`) — <!-- doc-lint:allow -->
    this is SST's own IaC deploy state, a distinct concept from the event-sourced views.
- **Reversal → Terraform (plain):** if the project is multi-cloud beyond what
  SST's providers cover cleanly, or the team has strong existing Terraform
  expertise and no SST familiarity. **Reversal → CDK:** only with a specific,
  logged justification — it is NOT the default and diverges from the org's live
  services.
- **Never:** raw CloudFormation JSON/YAML; CDK-by-default; mixing two IaC
  frameworks in one project.

---

## 2. Accounts and environments

| Pattern | When to use |
|---------|-------------|
| **Single prod account** | Default. Fastest to first deploy; matches "deploy straight to prod" principle. |
| **Prod + staging accounts** | Once CFR justifies pre-prod gating (a real customer to protect). Use AWS Organizations + SCPs. |
| **Dev per-developer** | If engineers need sandbox experimentation without risk to prod. Introduce on demand. |

- All cross-account and CI/CD trust via **OIDC federation** — no long-lived IAM
  user keys ever.

### 2a. Resource tagging — the standard tag set (ADR-0007)

Source of truth: **AeroCloudSystems/ADR → ADR-0007 (AWS resource tagging strategy)**
+ ADR-0006 (release provenance). Apply at the IaC root so every taggable resource
inherits them (SST/Pulumi does NOT propagate app-wide tags — set them per-resource,
e.g. a shared `defaultTags` object spread onto every component's `transform`/tags).
Keys are `PascalCase`; org-internal keys may use an **`ac:`** namespace (e.g.
`ac:CostCentre`) to avoid third-party collision; values from a controlled vocabulary
where practical.

**Mandatory (deploy-block/flag if missing):**

| Key | Example | Purpose |
|-----|---------|---------|
| `Service` | `AdixOut` | The bounded context / service that owns the resource (use this, NOT `Project`) |
| `Environment` | `sandbox` | `dev` \| `staging` \| `prod` \| `sandbox` (controlled vocab) |
| `Owner` | `adixout-team` | Owning **team**, never an individual |
| `CostCentre` | `CC-xxxx` | Cost allocation / showback (activated cost-allocation tag) |
| `ManagedBy` | `sst` | `sst` \| `terraform` \| `console` — flags click-ops drift |
| `DataClassification` | `internal` | `public` \| `internal` \| `confidential` \| `restricted` |
| `Airport` | `LHR` / `shared` | IATA(3)/ICAO(4) uppercase, or **`shared`** for multi-tenant/platform. ALWAYS present (defaults `shared`) so nothing is un-attributable to an airport. |

**Release-provenance (applied by the pipeline at deploy time — ADR-0006 link):**

| Key | Example | Purpose |
|-----|---------|---------|
| `GitCommit` | full **40-char** SHA | Exact source that produced the resource (NOT a short sha) |
| `Version` | `2.4.1` or `2026.07.0` | Human release per the ADR-0006 §4 scheme for this workload |
| `Repository` | `AeroCloudSystems/AdixOut` | Where the source lives |
| `DeployedAt` | `2026-07-12T12:01Z` | When this revision deployed |

Recommended-when-relevant: `Backup`, `ExpiryDate` (sandbox teardown), `OnCall`,
`Product` (cost roll-up), `Compliance`. **Cost attribution (ADR-0007 §7) is
activity-based, not account-based:** `Service`/`CostCentre`/`Owner`/`Airport` are
activated cost-allocation tags queried from the CUR; the `Airport` tag lets shared
spend split down per-airport — this is the native mechanism that satisfies a
"running cost by airport / by service" need (e.g. a Finance-Officer persona).
Governance: Organizations Tag Policies + a `required-tags` Config rule + SCP
(report-only → enforce). **Do not invent a thinner set** — the old
`Project/Env/ManagedBy` trio is superseded by the above.

### 2b. Sharing data OUTSIDE the AWS Org (ADR-0011)

Source of truth: **AeroCloudSystems/ADR → ADR-0011 (external high-volume data
sharing — egress projection + webhook push, DRAFT; depends on ADR-0001 + ADR-0008;
pattern PAT-004).** Every OTHER sharing decision (ADR-0004 S3, ADR-0005
subscription, ADR-0008 bus topology, ADR-0009 governance) is **internal** — it
trusts IAM and assumes callers sit inside `aws:PrincipalOrgID`. **The moment you
share with a third party OUTSIDE the Org, none of that trust applies to the
external hop.** Design that boundary as a dedicated **External Distribution
(egress) service** — an anti-corruption layer:

- **Consume internally like any other subscriber** (own rule on the central bus →
  own SQS queue+DLQ, ADR-0005) — expose **nothing new** internally.
- **Project internal domain events → the external published language** (e.g. AIDX
  XML) at the egress; this seam decouples internal schema evolution (ADR-0009) from
  the external contract and is the **one place to redact PII / drop unlicensed
  fields** before the message is built.
- **Two customer surfaces we fully control:** (a) a **synchronous query API** for
  basic state — API GW → Lambda → read model, **OAuth2 client-credentials
  (Cognito/JWT authorizer) + WAF + per-customer usage plans** (NOT IAM, NOT an
  API-key alone); (b) the **high-volume stream** by **per-customer** delivery.
- **Delivery selection rule (scenario, not one answer — projection + entitlement
  layer is identical, only the last hop changes):** **webhook push (EventBridge API
  Destinations + Connection)** is the DEFAULT for HTTPS-capable customers
  (provider-side rate control, no customer AWS dependency, mTLS + payload
  signature); a **per-customer projected SQS queue** when the customer is AWS-native
  and wants pull (a pinned customer account/role ARN or STS temp creds — this is NOT
  "exposing a queue": projected AIDX, one entitlement, own DLQ); a **hardened
  dedicated MQ edge broker** (Amazon MQ for ActiveMQ; per-customer destination;
  mTLS; private connectivity; patch SLA — CVE-2023-46604 class) ONLY when a customer
  mandates JMS; a **cursor pull REST API** fallback for firewalled/non-AWS customers.
- **NEVER** expose the internal bus/queue, an internet-facing broker, or a **single
  shared** external queue/destination.
- **Non-negotiable external-boundary controls:** per-customer **entitlement enforced
  server-side** (customer cannot widen scope; Customer A never sees B), one
  **API Destination + Connection + DLQ + rate limit per customer** (bulkhead),
  per-customer secrets in **Secrets Manager (rotated, revocable)**, **WAF** + usage
  plans on the query API, **mTLS + signature** on push, and **least-privilege = the
  full read-then-write op set** of the router/query code path (reads the
  EntitlementStore + read model + `kms:Decrypt`, then `events:PutEvents` /
  `secretsmanager:GetSecretValue` on the per-customer ARNs only; §7/§30 pin).
- **Delivery semantics:** at-least-once, **NO end-to-end ordering** (state it in the
  customer contract); self-describing messages (`occurredAt` + monotonic per-entity
  version) so customers dedupe by msg-id and apply last-writer-wins.
- **Own account** for the egress boundary; **full security review** (this is a
  cross-Org surface — the internal trust model does not carry over).

ADR-0011 is **DRAFT** — mTLS-vs-signature baseline, AIDX version/profile, routing
impl (rules-per-customer vs router Lambda), self-service entitlements, and
billing/metering are open; adopt the shape, track the open questions. Worked
alignment: AdixOut IS this service — see its
`architecture/deltas/005-adr0011-external-distribution.md` + the four
`architecture/security/external-*.md` / `entitlement-store.md` notes.

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
- Encryption: AWS-managed key (`sst.aws.Dynamo` enables SSE; CMK only if the
  data is sensitive). PITR is always-on under `sst.aws.Dynamo`.
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

OIDC deploy role with raw Pulumi (inside `run()` in `sst.config.ts`):
```typescript
const ghProvider = new aws.iam.OpenIdConnectProvider("GithubOidc", {
  url: "https://token.actions.githubusercontent.com",
  clientIdLists: ["sts.amazonaws.com"],
  thumbprintLists: ["<gh-oidc-thumbprint>"],
});
const deployRole = new aws.iam.Role("DeployRole", {
  assumeRolePolicy: ghProvider.arn.apply((arn) => JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Federated: arn },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: { StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:<org>/<repo>:ref:refs/heads/main",
      } },
    }],
  })),
});
// The deploy role holds Pulumi resource-create perms + IAM-write scoped to the
// project's role-name prefix ONLY (no workload-role escalation). Workload
// function roles are separate, hand-authored, ARN-scoped (§1).
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

### Managed-WAF body rules false-positive on XML-body APIs (AdixOut UC-ADIX-017, 2026-07-22)
`AWSManagedRulesCommonRuleSet` (CRS) inspects the **request body**, and two of its
sub-rules BLOCK well-formed XML request bodies as if they were attacks:
- **`CrossSiteScripting_BODY`** — XML tag structure (`<...>`) reads as XSS.
- **`GenericRFI_BODY`** — namespace URIs (`http://…`, `urn:…`) contain `://`, which reads
  as remote-file-inclusion.
For ANY endpoint whose contract is an XML request body (e.g. an AIDX `FlightLegRQ` POST),
these fire on every legitimate message — the API silently rejects all real traffic while
happy-path (empty-body / query-param) probes pass. **PLAN THIS UPFRONT:** on that route,
set those two sub-rules to `count` (NEVER `allow`) via a scoped `ruleActionOverrides` on
the managed-rule-group statement, WITH compensating controls: schema/XSD validation of the
body + auth + entitlement, and **keep every other CRS rule and SSRF blocking intact**.
Route-scope the WebACL so the override applies only to the XML-body route. This WEAKENS a
managed control, so it is a **security-posture decision requiring human approval** — record
it as such in the delta and the per-resource security note. Founding incident: AdixOut
UC-ADIX-017 (human-approved 2026-07-22) — CRS blocked every real AIDX XML body until a
real-payload probe surfaced it.

### Lambda
- [ ] Execution role follows §7 (one role per function, ARN-scoped).
- [ ] No `AWSLambdaFullAccess` or `AdministratorAccess`.
- [ ] Environment variables: no secrets in plaintext — use SSM Parameter
      Store (SecureString) or Secrets Manager; resolve at deploy time in
      `sst.config.ts` (e.g. `aws.secretsmanager.getSecretVersionOutput`), never
      commit plaintext.
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
- [ ] Deploy role's `iam:CreateRole`/`AttachRolePolicy`/`PutRolePolicy` is
      **scoped to the project's role-name prefix only** (SST hand-authors
      workload roles, so the deploy identity MUST write IAM — but only for this
      project's roles, never `Resource:"*"`). No workload function role may
      itself write IAM (no privilege escalation from a workload role).

---

## 9. CI/CD pipeline (GitHub Actions defaults)

Minimal pipeline stages, in order:

```
1. install        → npm ci (or pip install)
2. lint           → eslint / ruff
3. test           → jest|vitest / pytest (with coverage gate)
4. build          → tsc / bundle the handler assets
5. deploy         → sst deploy --stage <env>  (infra + app in one SST apply;
                    OIDC env creds, no profile in CI)
6. record-state   → make wi-append EVENT=validated (or the item's deploy event)
7. smoke-test     → curl / playwright against the deployed URL
```

- Trigger: push to `main` only. PRs run steps 1–4.
- Auth: OIDC role (§7). No `AWS_ACCESS_KEY_ID` in secrets.
- Environment variables from GitHub Actions secrets → injected as env vars
  during the deploy step (never baked into the artifact).
- On failure at step 5+: append the item's failure/rejected event via
  `make wi-append` (the work-item substrate — see the `work-items` skill); alert
  via GitHub notification.

### 9a. Release management, versioning & provenance (ADR-0006)

Source of truth: **AeroCloudSystems/ADR → ADR-0006**. Non-negotiables: (1) always
know exactly what code is in prod, traceable to one commit; (2) each deployable
releases at its **own cadence** — no org-wide lockstep/version.

- **Conventional Commits are the vendor-neutral source of truth.**
  `type(scope): subject` (`feat`/`fix`/`chore`/`docs`/`refactor`/`test`/`build`/`ci`,
  `!`/`BREAKING CHANGE:` for breaking). Ticket linkage as a git **trailer**, not free
  text, so it parses deterministically: `Refs: LIN-482` (Linear) or `Refs: FIDS-1187`
  (Jira) — per-project config maps the prefix to the tracker. The commit history IS
  the release-notes DB.
- **Build once, promote by digest — never rebuild to promote.** The immutable
  artifact is keyed by the **full 40-char commit SHA** (container `sha-<full-sha>` →
  deploy by **image digest** `@sha256:…`; Lambda/bundle `…-<full-sha>.zip` in a
  versioned S3 object → pin the **object-version-id**). Dev/staging/prod deploy the
  **identical digest** — that is what makes "green on dev ⇒ same bits safe for prod"
  literally true. (This also frames the build-identity discipline: a resource's
  `GitCommit`/`Version` tag must name the digest actually serving — see the
  stream-Lambda deploy-atomicity principle-failure.)
- **Two promotion modes, one mechanism:** continuous (dev green → auto-promote same
  digest; version derived from commits) OR batched (cut a release on demand,
  bundling commits since the last tag into one versioned deploy + generated notes).
  Chosen per deployable; never couples one team's cadence to another's.
- **Versioning is a per-context policy, NOT one scheme** (ADR-0006 §4): **SemVer** if
  something external *pins a version of you* (APIs, desktop apps, shared IaC
  modules/libraries other teams import); **CalVer** (`YYYY.MM.patch` + `+sha`) for
  continuously-deployed web apps (everyone runs latest); **CalVer/sequential** for
  deployed leaf infra with no external consumer. Rule of thumb: *pinned → SemVer;
  leaf-deployed → CalVer/sequential.* Every stream independent + monotonic.
- **Pre-declare the bump, reconcile at release:** record intended significance on the
  ticket (`release-impact: patch|minor|major`) + the planned commit type; if it turns
  out more significant mid-flight, update the commit footer (`!`/`BREAKING CHANGE:`) —
  the computed version then reflects reality. Human sanity-check before the tag is cut.
- **Writing release metadata must NOT trigger a build** (a rebuild breaks provenance):
  annotated git tags carry the release + don't change the working tree; trigger
  build/deploy on **branch pushes, not tag pushes**; keep any `CHANGELOG`/manifest
  commit out of the trigger (path filters / `chore(release): … [skip ci]`).
- **Implementation:** a **release-please-style** CI-agnostic tool (parses Conventional
  Commits, computes the scheme-aware bump, opens a release PR, on merge cuts the
  annotated tag + CHANGELOG + notes). The CI vendor is a replaceable executor — the
  release logic lives in git.

Both ADR-0006 and ADR-0007 are **`proposed`** in the ADR repo (open questions
remain, e.g. ratifying the versioning mapping, the `ac:` prefix, cost-split driver) —
adopt them as the working standard and track those questions, don't treat them as
frozen.

---

## 10. Well-Architected pillars — quick checklist

| Pillar | Default action |
|--------|---------------|
| **Security** | OIDC for CI; OAC for S3; server-authoritative data; WAF at C4+; SSE everywhere; per-function roles |
| **Reliability** | Multi-AZ managed services (DynamoDB, API GW, Lambda); DynamoDB PITR on durable tables; TTL for ephemeral state; idempotent operations |
| **Performance** | CDN for static assets; DynamoDB single-item reads; Lambda cold-start monitoring; AI client-side where < 200ms target |
| **Cost** | Scale-to-zero (Lambda, DynamoDB on-demand, Aurora Serverless); no idle NAT/EC2/RDS; TTL avoids storage growth; tag all resources for cost allocation |
| **Operational Excellence** | IaC for all resources (**SST v3 / Ion**, §1); structured CloudWatch logs; work-item state (`make wi-append`) recorded from CI; CloudTrail enabled |
| **Sustainability** | On-demand over provisioned; scale-to-zero; no always-on infrastructure beyond what's needed |

---

## 11. Reversal log

Keep a running table here of any deviation from the defaults above, with the
condition that would trigger a reversal:

| Deviation | Project | Justification | Reversal condition |
|-----------|---------|---------------|-------------------|
| **IaC default changed CDK → SST v3 (Ion)** (2026-07-11, human-directed) | ALL / org-wide | CDK default caused repeated cross-project problems; org's live services (OagEventSource) use SST v3 Ion; §1 rewritten. Prior projects on CDK are grandfathered until they next touch infra. | Reversal → CDK only with a specific logged justification (not the default); reversal → plain Terraform if multi-cloud beyond SST's providers |
| **Adopt ADR-0007 tag set** (2026-07-12, human-directed) | ALL / org-wide | ADR-0007 supersedes the thin `Service/Env/Owner` (and the interim `Project/Env/ManagedBy/BuildSha`) — mandatory `Service/Environment/Owner/CostCentre/ManagedBy/DataClassification/Airport` + provenance `GitCommit(40-char)/Version/Repository/DeployedAt`; §2a added. `Airport`+cost-allocation gives per-airport spend. | ADR is `proposed`; open questions (mandatory-DataClassification scope, `ac:` prefix, activated cost tags) resolved at ADR acceptance |
| **Adopt ADR-0006 release/provenance** (2026-07-12, human-directed) | ALL / org-wide | Conventional Commits + trailers, build-once/promote-by-digest (full-SHA/object-version), per-context versioning (SemVer/CalVer/sequential), no-rebuild-on-release; §9a added. | ADR is `proposed`; ratify the §4 versioning mapping + release-tool choice at ADR acceptance |
| **Adopt ADR-0011 external egress pattern** (2026-07-22, human-directed) | ALL / org-wide (external data sharing) | First cross-Org sharing decision; internal IAM/`aws:PrincipalOrgID` trust does NOT extend past the external hop. Dedicated External Distribution (egress) service = anti-corruption projection → OAuth2/WAF query API + per-customer webhook push (API Destinations, mTLS+signature) / per-customer SQS / hardened MQ edge broker; server-side entitlement + per-customer isolation; §2b added. | ADR is `DRAFT`; mTLS-vs-signature baseline, AIDX version/profile, routing impl, self-service entitlements, billing resolved at ADR `proposed` |
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

## Layered rate controls (s007 lesson)
Rate limiting exists at MULTIPLE independent layers (edge WAF rate rules,
API Gateway stage throttles, application-level budgets such as authorizer
per-IP counters). An exemption granted at one layer does NOT propagate —
removing the outermost throttle simply unmasks the next-tighter control.
When designing a test/runner exemption, enumerate every rate-limiting layer
on the request path and exempt (or budget for) each explicitly, with the
same self-cleaning posture at each layer (s007: WAF IP-set exclusion alone
left the authorizer 20/5min budget blocking CI smoke; fixed by the EXEMPT#
item one layer deeper).
