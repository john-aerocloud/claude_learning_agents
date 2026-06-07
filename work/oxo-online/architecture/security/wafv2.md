# Security controls — AWS WAFv2 WebACLs (rate-limiting public endpoints)

> **Amended 2026-06-06 (GATE-AMEND-H1-A — Option A rescope).** WAFv2 **cannot**
> associate with API Gateway **v2** APIs (HTTP or WebSocket). The planned
> REGIONAL WebACL on the WS v2 stage was rejected at deploy (invalid-ARN at
> CREATE) and is **REMOVED** from this slice. **Live control = the CloudFront
> global WebACL only.** WS connection-flood control is now the existing
> account/stage-level WS prod throttle (rate 20 / burst 40) as an **interim**
> measure; **per-IP** WS protection is re-scoped to the s005-h2 `$connect`
> authorizer (code-level). The "Regional WebACL" section below is **superseded**
> and retained for history only.

Introduced: s005-h1-waf (iteration 7). Control plane only.
Data class: **none** — WAF inspects request metadata (source IP, request rate);
it stores no application data. No PII.
Purpose: bound anonymous flood/exhaustion against the two public endpoints
(CloudFront-served `/api/*`, and the direct WSS API). REDUCES attack surface;
adds no new data flow or trust boundary.

Each item below is a **checkable statement** → becomes a policy/synth/prod test
case at implementation time. Threshold numbers are Gate-2 placeholders (see
delta §9 open risk 1).

## Global WebACL — CloudFront (scope CLOUDFRONT, us-east-1)

- [ ] A `CLOUDFRONT`-scope `AWS::WAFv2::WebACL` exists in **us-east-1**
      (prod: `aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1`
      returns it).
- [ ] It lives in the dedicated `OxoOnlineWafUsEast1` stack whose `env.region`
      is `us-east-1` (synth: SYNTH-CONTRACT-WAF-2).
- [ ] **Associated**: CloudFront distribution `E519HYABC57ZX` `WebAclId` is
      non-empty and equals this ACL's ARN
      (prod: `aws cloudfront get-distribution-config`; synth:
      SYNTH-CONTRACT-WAF-1 — `DistributionConfig.WebACLId` resolves via the
      cross-region reference, not empty, not hardcoded).
- [ ] Contains a **rate-based rule** (priority 1, aggregate key `IP`,
      evaluation window 5 min) with **limit <= 100** and action `Block`
      (synth: AC1.2 / SYNTH on the rule).
- [ ] Contains managed rule group `AWSManagedRulesAmazonIpReputationList`
      (priority 0) (synth: AC1.3).
- [ ] Default action is **Allow** (block only on rule match — legitimate
      traffic is never default-denied).
- [ ] `VisibilityConfig.CloudWatchMetricsEnabled = true` and
      `SampledRequestsEnabled = true` on the ACL and every rule (blocks are
      observable / auditable).

## Regional WebACL — WebSocket API stage — REMOVED (superseded, history only)

> **NOT BUILT.** WAFv2 REGIONAL WebACLs cannot associate with API Gateway v2
> (HTTP/WebSocket) APIs — associable types are REST v1 stages, ALB, AppSync,
> Cognito user pools, App Runner, Verified Access. The association below was
> rejected at deploy. The checkable statements in this section are **VOID** for
> s005-h1. The WS exhaustion control that DOES hold is in the interim block
> immediately after.

### (void — original intended statements, retained for audit trail)

- [ ] A `REGIONAL`-scope `AWS::WAFv2::WebACL` exists in eu-west-2 (synth:
      SYNTH-CONTRACT-WAF-3).
- [ ] An `AWS::WAFv2::WebACLAssociation` binds it to the WS API `ylbzjuo8lf`
      `prod` **stage ARN**, derived from API id + stage name (NOT hardcoded)
      (synth: AC2.1 / SYNTH-CONTRACT-WAF-3; prod:
      `aws wafv2 list-resources-for-web-acl --resource-type API_GATEWAY
      --region eu-west-2` returns the stage ARN — AC2.4).
- [ ] Contains a rate-based rule (priority 1, key `IP`, 5-min window) with
      **limit <= 20** and action `Block` (synth: AC2.2).
- [ ] Contains `AWSManagedRulesAmazonIpReputationList` (priority 0)
      (synth: AC2.3).
- [ ] Default action is **Allow**.
- [ ] CloudWatch metrics + sampled requests enabled.

## WS connection-exhaustion — interim control (post-amendment, the one that holds)

Because the regional WebACL is not buildable on the v2 WS stage, the WS
flood/exhaustion control for s005-h1 is the **existing** prod-stage throttle
(shipped s005) plus the reserved-concurrency + TTL floor:

- [ ] The WS API `prod` stage sets default route throttling
      `ThrottlingRateLimit = 20` / `ThrottlingBurstLimit = 40` — **account/
      stage-level, NOT per-IP**. Bounds aggregate connect/message rate only.
- [ ] `oxo-ws-fn` `ReservedConcurrentExecutions` cap bounds message-processing
      blast radius (unchanged from s005).
- [ ] `Connections` items carry a 2h TTL so orphaned connections self-expire
      (unchanged from s005).
- [ ] **Per-IP** WS rate-limiting is **NOT provided by this slice.** It is
      re-scoped to the s005-h2 `$connect` Lambda authorizer (code-level rate
      limit keyed on source IP).

**Residual risk (OPEN until s005-h2; accepted at GATE-AMEND-H1-A):** a single
source IP can open WS connections up to the account-level stage throttle —
there is no per-IP bound until the h2 authorizer ships. Accepted by the human
gate as the cost of the WAFv2/v2-API platform constraint.

## No WebACL on the HTTP API stage (Gate-2 decision)

- [ ] There is **no** REGIONAL WebACL associated with the HTTP API
      (`OxoGameProd` HTTP API) stage — coverage of `/api/*` is provided by the
      CloudFront global ACL. (synth: assert no `WebACLAssociation` targets the
      HTTP API stage ARN; prod:
      `aws wafv2 list-resources-for-web-acl` for the HTTP API stage returns
      empty.)

## Deploy-role least privilege (no over-broad grants)

- [ ] `oxo-deploy` WAFv2 grants are limited to the management actions needed
      for the **CloudFront global WebACL** (Create/Get/Update/Delete/List/Tag
      WebACL) — **no `wafv2:*` wildcard** in the policy document.
      **Post-amendment:** the `Associate`/`Disassociate`/`ListResourcesForWebACL`
      grants for the (removed) regional WS association are **dropped** — they
      are unused now that no v2-API association exists. (CloudFront association
      is set via the distribution `webAclId` property under `cloudfront:Update
      Distribution`, not a WAFv2 associate call.)
- [ ] CloudFront grants are limited to
      `UpdateDistribution`/`GetDistribution`/`GetDistributionConfig` — **no
      `cloudfront:*` wildcard**, no `CreateDistribution`/`DeleteDistribution`.
- [ ] `oxo-deploy` still has **no `iam:*` mutation** actions (the deploy role
      cannot escalate by creating/attaching roles for the WAF resources;
      execution-plane IAM is owned by the CDK CloudFormation execution role).
- [ ] The deploy-role extension is applied (via `make deploy-oidc`) **before**
      the WAF resources deploy (§39 config-follows-resource ordering).

## IMP-008 — `oxo-test-runner-ips` IP set + rate-rule scope-down (s007)

Adds a runner-IP exclusion to the **existing CloudFront-scope rate rule** so the
test runner is not rate-limited during smoke validation, **without** weakening the
rule for any real-user IP. New resource in the **existing** `OxoOnlineWafUsEast1`
stack (us-east-1, CLOUDFRONT scope — the already-documented platform-forced region
exception; **no new region**). New checkable controls (synth + prod tests):
- [ ] An `AWS::WAFv2::IPSet` named `oxo-test-runner-ips` (scope `CLOUDFRONT`,
      `IPAddressVersion IPV4`) exists in `OxoOnlineWafUsEast1` (synth:
      `waf-us-east-1-stack.test.ts`).
- [ ] The CloudFront rate-based rule's statement is wrapped in a scope-down
      `AndStatement` containing a **`NotStatement` around an
      `IPSetReferenceStatement`** referencing `oxo-test-runner-ips` — so the rule's
      rate COUNT applies only to IPs **not** in the set. The rule's **action
      (`Block`) and limit (≤100) are UNCHANGED** (synth asserts the NOT scope-down
      is present AND that action/limit are unmodified).
- [ ] **AC3.1 preserved for non-runner IPs:** a source IP **not** in the set is
      still rate-limited and Blocked exactly as before — `slice005-h1-waf-ac3.1.spec.ts`
      (or equivalent) stays green for a non-runner source. The scope-down narrows
      *applicability*, not *action*.
- [ ] **Governance — mutation is deploy-role / runner-script only:** the IP set is
      mutated solely via `aws wafv2 update-ip-set` from the `make
      waf-runner-ip-add`/`-remove` scripted flow (read-modify-write append, never
      replace, to survive parallel CI). No human, no app principal mutates it.
- [ ] **Entries are transient:** the runner IP/32 is added per smoke run and
      removed by a `trap`-guarded `post` step that **always** runs; a post-run
      `aws wafv2 get-ip-set` assertion confirms the set is empty after `make
      smoke-ci` (IMP-008 done-condition #6).
- [ ] **Standing drain guard (REQUIRED, not optional):** because WAF IP sets do
      not self-expire, a **scheduled (≤24h) drain Lambda** empties any leaked
      entry. Its synth test is the s007 cicd capability step. A leaked entry only
      over-privileges that one stale IP; the rule still fires for all others.
- [ ] **Deploy-role grant:** `oxo-deploy` (or the runner role) WAFv2 grants extend
      to `wafv2:GetIPSet`/`UpdateIPSet` on the named `oxo-test-runner-ips` ARN only
      — **no `wafv2:*` wildcard, no IP-set create/delete at runtime** (the set is
      CDK-managed; runtime only get/update its addresses). The drain Lambda's role
      is similarly scoped to `GetIPSet`/`UpdateIPSet` on this one ARN.

## Reversal / containment

- [ ] Disassociation is a clean, data-free reversal: removing the
      `WebACLAssociation` (WS) or clearing the distribution `webAclId` (CF)
      returns each endpoint to its prior state with no app/data change.
- [ ] A false-positive threshold can be raised in place via `UpdateWebACL`
      without disassociation (cheapest first response before full reversal).
