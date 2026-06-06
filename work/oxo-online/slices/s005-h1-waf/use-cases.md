---
slice: s005-h1
slug: waf-rate-limiting
process-ref: §37
---

# Use cases — s005-h1: WAF / rate-limiting

These use cases are separately buildable and separately testable. They share no
code dependency on each other; UC1 and UC2 can be built in parallel by the
engineer (different CDK stacks, different AWS WAF scopes). UC3 is a validation
step, not a build step; it can run in parallel to UC2 if UC1 is complete.

---

## UC1 — WAF on CloudFront (HTTP API protection)

**ID:** UC1
**Actor:** Infrastructure (CDK / CloudFormation)
**Stack:** OxoOnlineProd (CloudFront distribution lives here)
**WAF scope:** GLOBAL — must be deployed to us-east-1

### Trigger → observable outcome

The `OxoOnlineProd` CDK stack is synthesised and deployed with a new
`CfnWebACL` (scope `CLOUDFRONT`, region `us-east-1`) containing:
- `AWSManagedRulesAmazonIpReputationList` managed rule group (priority 0).
- A rate-based rule (priority 1): count requests per IP over 5 minutes;
  block when the rate exceeds the configured threshold (default: 100 for
  hobby volume).
- Default action: allow.

The WebACL ARN is associated with the CloudFront distribution via
`WebAclId` in the distribution config.

Observable outcome: `aws cloudfront get-distribution-config` shows a
non-empty `WebAclId` matching the new WebACL ARN.

### Done condition

`aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1` returns
the WebACL; `aws cloudfront get-distribution-config` `WebAclId` matches its
ARN; synth-time contract test (`cdk synth`) confirms the association at
template level.

### Acceptance cases

- AC1.1: CloudFront distribution template contains `WebAclId` referencing the
  new WebACL (synth/CDK test).
- AC1.2: WebACL contains a rate-based rule with threshold <= 100 (synth/CDK
  test on the rule).
- AC1.3: WebACL contains `AWSManagedRulesAmazonIpReputationList` as a managed
  rule group (synth test).
- AC1.4: `aws cloudfront get-distribution-config` in prod returns a non-empty
  `WebAclId` (tester prod validation).
- AC1.5: `aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1` in
  prod lists the WebACL (tester prod validation).

### Dependencies

None. UC1 is independent of UC2 and UC3. The CloudFront distribution already
exists; this adds a property to it.

---

## UC2 — WAF on WebSocket API stage (WS connection protection)

**ID:** UC2
**Actor:** Infrastructure (CDK / CloudFormation)
**Stack:** OxoGameProd (WS API lives here)
**WAF scope:** REGIONAL — same region as the WS API

### Trigger → observable outcome

The `OxoGameProd` CDK stack is synthesised and deployed with a new
`CfnWebACL` (scope `REGIONAL`, same region as deployment) containing:
- `AWSManagedRulesAmazonIpReputationList` managed rule group (priority 0).
- A rate-based rule (priority 1): count WS connection attempts per IP over 5
  minutes; block when rate exceeds the configured threshold (default: 20 for
  hobby volume).
- Default action: allow.

The WebACL is associated with the WebSocket API `prod` stage via
`CfnWebACLAssociation` using the stage ARN.

Observable outcome: `aws wafv2 list-resources-for-web-acl --resource-type
API_GATEWAY --region <region>` returns the WS API stage ARN.

### Done condition

`aws wafv2 list-resources-for-web-acl` in prod returns the stage ARN;
synth-time contract test confirms `CfnWebACLAssociation` references the
correct stage ARN; the WS API `prod` stage ARN is correctly derived from
the API ID and stage name (not hardcoded).

### Acceptance cases

- AC2.1: OxoGameProd stack template contains a `CfnWebACLAssociation` with
  `ResourceArn` resolving to the WS API `prod` stage (synth test).
- AC2.2: REGIONAL WebACL template contains a rate-based rule with threshold
  <= 20 (synth test).
- AC2.3: REGIONAL WebACL contains `AWSManagedRulesAmazonIpReputationList`
  (synth test).
- AC2.4: `aws wafv2 list-resources-for-web-acl --resource-type API_GATEWAY`
  in prod returns the WS stage ARN (tester prod validation).

### Dependencies

UC2 depends on s005 being delivered (the WS API `prod` stage must exist to
associate). UC2 is independent of UC1 (different stacks, different WAF scope).

---

## UC3 — Rate-limit triggers under synthetic burst; normal flow unaffected

**ID:** UC3
**Actor:** Tester (validation spec)
**Trigger:** Post-deploy validation run

### Trigger → observable outcome

After both UC1 and UC2 are deployed, the tester runs a synthetic burst
validation:
1. Rapid repeated `POST /api/games` requests from a single IP (using a loop
   in the validation script) hit the CloudFront WAF rate rule and receive
   HTTP 403 responses after the threshold is exceeded.
2. Rapid repeated WS connect attempts (using the existing `node
   work/oxo-online/scripts/ws-probe.js` or equivalent) hit the WS WAF rate
   rule and receive connection refusals after the threshold.
3. Normal flow (one `POST /api/games` → 201, then WS connect → `game-ready`)
   continues to work with no WAF block.
4. Smoke test (all existing s005 acceptance cases) remains green.

Observable outcome: WAF block responses observed under burst; zero blocks
observed under normal usage pattern.

### Done condition

All acceptance cases below pass in the prod environment post-deploy.

### Acceptance cases

- AC3.1: After N rapid `POST /api/games` requests (N > rate threshold in a 5
  min window), at least one request returns HTTP 403 with an AWS WAF block
  response body (tester validation spec).
- AC3.2: After N rapid WS connect attempts, at least one is refused/rejected
  by the WAF before connection is established (tester validation spec).
- AC3.3: A single `POST /api/games` followed by a WS connect + `register` +
  `join` (simulating normal create-and-join) completes without a WAF block
  (normal flow unaffected — tester smoke test).
- AC3.4: Local game and vs-AI modes render and function correctly (regression
  — tester Playwright smoke).
- AC3.5: `POST /api/games` returns 201 with a 6-char code when not rate-
  limited (regression — tester Playwright smoke, already pinned).

### Dependencies

UC3 depends on both UC1 (CloudFront WAF) and UC2 (WS WAF) being deployed.
UC3 has no build-step content — it is pure validation.

---

## Dependency summary

```
UC1 (CF WAF)        — no build dependencies
UC2 (WS WAF)        — requires s005 WS API prod stage to exist
UC3 (validation)    — requires UC1 + UC2 deployed
```

UC1 and UC2 can be built in parallel. UC3 runs after both are deployed.

---

## Infra enabler notes (co-decided with solution-architect)

The engineer will need `wafv2:CreateWebACL`, `wafv2:AssociateWebACL`,
`wafv2:GetWebACL`, `cloudfront:UpdateDistribution` in the deploy role
(`oxo-deploy`) for this slice. These are additive grants scoped to the new
WebACL ARNs and the existing distribution ARN — no wildcard. If the deploy
role does not have these, the architect must extend `DEPLOY_ROLE_EXTENSIONS.md`
as part of this slice's delta.

CDK WAF L2 constructs (`aws-cdk-lib/aws-wafv2`) are stable for v2.x —
use the L1 `CfnWebACL` / `CfnWebACLAssociation` constructs if L2 coverage
is insufficient.

The GLOBAL WebACL for CloudFront must be created in `us-east-1`. If the CDK
app uses a single region stack for `OxoOnlineProd`, the WAF WebACL may need a
cross-region resource approach (CDK `CrossRegionExportReader` or a separate
CDK environment pinned to `us-east-1`). The architect owns this decision in
the delta; this use-cases file names the constraint.
