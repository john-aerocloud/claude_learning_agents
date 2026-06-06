# Security controls — AWS WAFv2 WebACLs (rate-limiting public endpoints)

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

## Regional WebACL — WebSocket API stage (scope REGIONAL, eu-west-2)

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

## No WebACL on the HTTP API stage (Gate-2 decision)

- [ ] There is **no** REGIONAL WebACL associated with the HTTP API
      (`OxoGameProd` HTTP API) stage — coverage of `/api/*` is provided by the
      CloudFront global ACL. (synth: assert no `WebACLAssociation` targets the
      HTTP API stage ARN; prod:
      `aws wafv2 list-resources-for-web-acl` for the HTTP API stage returns
      empty.)

## Deploy-role least privilege (no over-broad grants)

- [ ] `oxo-deploy` WAFv2 grants are limited to the management + association
      actions listed in `DEPLOY_ROLE_EXTENSIONS.md` (Create/Get/Update/Delete/
      List/Tag WebACL, Associate/Disassociate/ListResourcesForWebACL) — **no
      `wafv2:*` wildcard** in the policy document.
- [ ] CloudFront grants are limited to
      `UpdateDistribution`/`GetDistribution`/`GetDistributionConfig` — **no
      `cloudfront:*` wildcard**, no `CreateDistribution`/`DeleteDistribution`.
- [ ] `oxo-deploy` still has **no `iam:*` mutation** actions (the deploy role
      cannot escalate by creating/attaching roles for the WAF resources;
      execution-plane IAM is owned by the CDK CloudFormation execution role).
- [ ] The deploy-role extension is applied (via `make deploy-oidc`) **before**
      the WAF resources deploy (§39 config-follows-resource ordering).

## Reversal / containment

- [ ] Disassociation is a clean, data-free reversal: removing the
      `WebACLAssociation` (WS) or clearing the distribution `webAclId` (CF)
      returns each endpoint to its prior state with no app/data change.
- [ ] A false-positive threshold can be raised in place via `UpdateWebACL`
      without disassociation (cheapest first response before full reversal).
