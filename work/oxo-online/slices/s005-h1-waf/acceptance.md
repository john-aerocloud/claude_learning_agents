---
slice: s005-h1
slug: waf-rate-limiting
co-authors: [product, solution-architect]
---

# Acceptance test cases — s005-h1-waf

> **Amended 2026-06-06 (GATE-AMEND-H1-A — Option A rescope).** WAFv2 cannot
> associate with API Gateway v2 APIs; UC2 (regional WS WebACL + association) is
> REMOVED. Cases tied to UC2 are marked **RETIRED** below (kept for history, not
> run). The CloudFront cases (AC1.x, SYNTH-CONTRACT-WAF-1/2) and the regression
> cases (AC3.3–3.5) are unchanged. AC3.2 (WS burst) is rewritten to the
> honestly-testable interim stage-throttle behaviour. SYNTH-CONTRACT-WAF-3/4 and
> AC2.x are RETIRED. The walking-skeleton probe loses its WS-WAF step.

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
- **SYNTH-CONTRACT-WAF-3** — **RETIRED (GATE-AMEND-H1-A).** Pinned the regional
  WS WebACL + association, which is removed (WAFv2 cannot associate API GW v2).
  No resource left to assert.
- **SYNTH-CONTRACT-WAF-4** — **RETIRED (GATE-AMEND-H1-A).** "No association on
  the HTTP API stage" is now trivially true by platform constraint (WAFv2
  cannot associate ANY v2 API), so a dedicated assertion adds no value. The
  intent is preserved descriptively in `wafv2.md`.
- Maps to / strengthens Product AC1.1–AC1.3 (AC2.x retired).

## B. Walking-skeleton probe (runs FIRST, before the UC3 suite)

- **WALKING-SKELETON-WAF** (AMENDED, GATE-AMEND-H1-A — WS-WAF step removed)
  — After UC1 deploys and before the tester builds the full UC3 acceptance
  suite, one real client from a single source IP:
  1. bursts `POST /api/games` over 100/5-min → at least one HTTP 403 WAF block
     returned before Lambda is invoked;
  2. ~~bursts WS connects over 20/5-min → WAF-level rejection~~ **RETIRED** —
     no WS WAF exists (UC2 removed). WS flood control is the interim stage
     throttle, exercised under AC3.2, not a per-IP WAF block;
  3. then one normal flow (`POST /api/games` 201 → WS connect → `game-ready`)
     succeeds unblocked.
  Proves: the CloudFront ACL is real + associated + threshold fires end-to-end +
  default-allow leaves legit traffic untouched. Gate to proceed to the UC3 suite.

## C. Deploy-ordering / config-follows-resource (§39)

- **ORDER-WAF-1** — The `oxo-deploy` role WAFv2 + CloudFront grants are applied
  (`make -C work/oxo-online/src/infra deploy-oidc`) BEFORE the infra pipeline
  deploys the WebACLs / sets `webAclId`. Verifiable: the OIDC stack update
  precedes the WAF-bearing infra deploy in the deploy log; the infra deploy does
  not fail with AccessDenied on `wafv2:CreateWebACL` / `cloudfront:UpdateDistribution`.
- **ORDER-WAF-2** (AMENDED) — Stack deploy order is `OxoOnlineWafUsEast1` →
  `OxoOnlineProd` (the us-east-1 WAF stack exports the ARN that `OxoOnlineProd`
  imports cross-region). `OxoGameProd` no longer carries a WAF resource (regional
  WebACL removed), so it has no WAF-driven ordering constraint in this slice.

## D. Prod observable conditions (tester validation — mirrors Product cases)

- Maps to Product AC1.4/AC1.5 (CF WebACL listed + `webAclId` non-empty);
  AC3.1, AC3.3–AC3.5 (CF burst block; normal + regression flows green).
- **AC3.2 (AMENDED)** — WS burst now validates interim **stage-throttle** class
  behaviour (or records deferred-to-h2), NOT a per-IP WAF block. See §E.
- **DEPLOY-IDENTITY-WAF** — the CloudFront WebACL carries tags
  `Project=oxo-online, Env=prod, ManagedBy=cdk` (build-identity carrier for a
  non-served control-plane resource per principles/01). (Only one WebACL now —
  the regional one is removed.)

## E. RETIRED cases (history — not run; GATE-AMEND-H1-A 2026-06-06)

UC2 is removed because WAFv2 cannot associate with API Gateway v2 APIs. These
cases are retired with that reason; kept for audit trail.

- **AC2.1 / AC2.2 / AC2.3 / AC2.4 — RETIRED.** No regional WS WebACL or
  association exists to assert.
- **SYNTH-CONTRACT-WAF-3 / SYNTH-CONTRACT-WAF-4 — RETIRED** (see §A).
- **WALKING-SKELETON-WAF step 2 (WS WAF burst) — RETIRED** (see §B).

**AC3.2 — amended (not retired).** Original: "after N rapid WS connect attempts,
at least one is refused by the WAF." Became: under a sustained WS connect burst
exceeding the stage throttle (rate 20 / burst 40), the WS `prod` stage exhibits
throttle-class shedding at the **account/stage level** (connections
refused / throttling-class behaviour) — **NOT** a per-IP block. Per-IP WS
rejection is **deferred to s005-h2** ($connect authorizer). This is what is
honestly testable post-amendment: the tester asserts the interim throttle
shedding if observable from a single client within the burst budget, otherwise
records it as **deferred-to-h2** with the reason. No WAF block is expected on
the WS path because no WS WAF exists.
