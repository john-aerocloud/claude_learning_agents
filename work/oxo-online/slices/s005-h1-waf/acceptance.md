---
slice: s005-h1
slug: waf-rate-limiting
co-authors: [product, solution-architect]
---

# Acceptance test cases — s005-h1-waf

Product owns the behavioural cases (AC1.x / AC2.x / AC3.x in `use-cases.md`).
The solution-architect supplies the **technical / observable conditions** below:
synth-time contract assertions, the walking-skeleton probe (runs before the
full UC3 suite), and the deploy-ordering check. These are the source for
generating policy/synth tests at implementation time.

## A. Synth-time contract assertions (CI, no AWS creds)

- **SYNTH-CONTRACT-WAF-1** — In the synthesised `OxoOnlineProd` template, the
  `AWS::CloudFront::Distribution` `DistributionConfig.WebACLId` is present, is a
  cross-region reference (resolves to the us-east-1 WebACL ARN via the CDK
  cross-region SSM reader), and is NOT empty / NOT a hardcoded literal ARN.
- **SYNTH-CONTRACT-WAF-2** — `OxoOnlineWafUsEast1` synthesises exactly one
  `AWS::WAFv2::WebACL` with `Scope: CLOUDFRONT`; the stack `env.region` is
  `us-east-1`; the rate rule limit <= 100; `AWSManagedRulesAmazonIpReputationList`
  present; default action Allow.
- **SYNTH-CONTRACT-WAF-3** — `OxoGameProd` synthesises one
  `AWS::WAFv2::WebACL` (`Scope: REGIONAL`, rate limit <= 20, IP-reputation group,
  default Allow) and one `AWS::WAFv2::WebACLAssociation` whose `ResourceArn`
  resolves to the WS API `prod` stage ARN (derived from API id + stage, not
  hardcoded).
- **SYNTH-CONTRACT-WAF-4** — No `AWS::WAFv2::WebACLAssociation` in any stack
  targets the HTTP API stage ARN (Gate-2 decision: no WebACL on HTTP API stage).
- Maps to / strengthens Product AC1.1–AC1.3, AC2.1–AC2.3.

## B. Walking-skeleton probe (runs FIRST, before the UC3 suite)

- **WALKING-SKELETON-WAF** — After UC1+UC2 deploy and before the tester builds
  the full UC3 acceptance suite, one real client from a single source IP:
  1. bursts `POST /api/games` over 100/5-min → at least one HTTP 403 WAF block
     returned before Lambda is invoked;
  2. bursts WS connects over 20/5-min → at least one WAF-level rejection before
     `$connect` Lambda runs;
  3. then one normal flow (`POST /api/games` 201 → WS connect → `game-ready`)
     succeeds unblocked.
  Proves: ACL real + associated + threshold fires end-to-end + default-allow
  leaves legit traffic untouched. Gate to proceed to the full UC3 suite.

## C. Deploy-ordering / config-follows-resource (§39)

- **ORDER-WAF-1** — The `oxo-deploy` role WAFv2 + CloudFront grants are applied
  (`make -C work/oxo-online/src/infra deploy-oidc`) BEFORE the infra pipeline
  deploys the WebACLs / sets `webAclId`. Verifiable: the OIDC stack update
  precedes the WAF-bearing infra deploy in the deploy log; the infra deploy does
  not fail with AccessDenied on `wafv2:CreateWebACL` / `cloudfront:UpdateDistribution`.
- **ORDER-WAF-2** — Stack deploy order is `OxoOnlineWafUsEast1` → `OxoGameProd`
  → `OxoOnlineProd` (the us-east-1 WAF stack exports the ARN that `OxoOnlineProd`
  imports cross-region).

## D. Prod observable conditions (tester validation — mirrors Product cases)

- Maps to Product AC1.4/AC1.5 (CF WebACL listed + `webAclId` non-empty),
  AC2.4 (WS stage ARN returned by `list-resources-for-web-acl`),
  AC3.1–AC3.5 (burst blocks; normal + regression flows green).
- **DEPLOY-IDENTITY-WAF** — both WebACLs carry tags
  `Project=oxo-online, Env=prod, ManagedBy=cdk` (build-identity carrier for a
  non-served control-plane resource per principles/01).
