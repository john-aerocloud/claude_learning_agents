# Architecture delta — s005-h1-waf (WAF / rate-limiting on public endpoints)

Gate-2 approved: GATE-2-H1. Iteration 7. Project class: **cloud/hosted** (full
AWS Well-Architected; `aws-architecture` skill loaded). This is a hardening
slice: new infrastructure on the **control plane** only.

---

## 1. Resources added

| Resource | Scope / region | Stack | Associated target |
|----------|----------------|-------|--------------------|
| `CfnWebACL` "global" | `CLOUDFRONT`, **us-east-1** | **NEW** `OxoOnlineWafUsEast1` | CloudFront distribution `E519HYABC57ZX` |
| `CfnWebACL` "regional" | `REGIONAL`, eu-west-2 | `OxoGameProd` | WS API `ylbzjuo8lf` `prod` stage |
| `CfnWebACLAssociation` (regional only) | eu-west-2 | `OxoGameProd` | WS stage ARN |
| Distribution `webAclId` property | n/a | `OxoOnlineProd` | the global WebACL ARN (handoff) |

Both WebACLs carry: default action **allow**; managed rule group
`AWSManagedRulesAmazonIpReputationList` (priority 0, action from group); one
rate-based rule (priority 1, aggregate key `IP`):
- Global (CloudFront): **100 requests / 5-min / IP**.
- Regional (WS connect): **20 requests / 5-min / IP**.
CloudWatch metrics + sampled requests enabled on every rule and on the ACL
default (visibility config), so blocks are observable.

**NO WebACL on the HTTP API REGIONAL stage** — Gate-2 decision. The CloudFront
global ACL covers all `/api/*` traffic; the HTTP API origin is an internal
CloudFront origin, not the advertised public path. Duplicating a stage ACL adds
cost with no new path covered.

## 2. What does NOT change

- **No application code.** No Lambda source touched (`oxo-game-fn`, `oxo-ws-fn`
  unchanged). Default-allow ACLs are transparent to handlers.
- **No new Lambda, route, DynamoDB table, GSI, or data flow.**
- **No pipeline-structure change.** The two existing pipelines
  (`infra-oxo-online.yml`, `deploy-oxo-online.yml`) keep their current stages;
  infra pipeline gains the new us-east-1 stack in its deploy sequence (see §3),
  which is a sequencing addition, not a structural change.
- **No new trust boundary.** No new principal, no new inbound surface. The
  public surface (CloudFront + two API Gateways) is unchanged in shape — WAF
  sits in front of two of those existing surfaces.
- **WS transport is still direct** (not via CloudFront) — unchanged.

## 3. Cross-region handling — the global (CloudFront) WebACL

**Constraint:** a `CLOUDFRONT`-scope WAFv2 WebACL MUST be created in
`us-east-1`. All current stacks deploy to **eu-west-2**. The CloudFront
distribution itself is a global resource defined in `OxoOnlineProd`
(eu-west-2 home region), and a distribution's `webAclId` is set **in the
distribution config** — i.e. owned by `OxoOnlineProd`, not by the WAF stack.

**Mechanism chosen: separate small us-east-1 stack + cross-region reference.**

- **NEW stack `OxoOnlineWafUsEast1`** (`env.region = 'us-east-1'`, same account)
  holds ONLY the global `CfnWebACL`. It exports the WebACL ARN.
- `OxoOnlineProd` (eu-west-2) consumes that ARN and sets it as the
  distribution's `webAclId`. The WAF→distribution association is therefore an
  **`OxoOnlineProd` change** (a property on the existing distribution), exactly
  as Gate-2 noted.
- Cross-region handoff uses CDK **`crossRegionReferences: true`** on both
  stacks (CDK writes the ARN to an SSM parameter in us-east-1 and a custom
  resource reads it in eu-west-2). This is the supported CDK mechanism for a
  us-east-1 → eu-west-2 ARN handoff and avoids hand-rolled `Fn.importValue`
  across regions (which CloudFormation does not support).

**Why a separate stack, not `CfnWebACL` inline in OxoOnlineProd:** a single
CloudFormation stack cannot create resources in two regions. The WebACL must
physically live in us-east-1; `OxoOnlineProd` lives in eu-west-2. A dedicated
us-east-1 stack is the minimal, reversible carrier.

**Stack placement + deploy order (updates STACK_ORDER.md):**

```
1. OxoOnlineWafUsEast1   (us-east-1)  — create global WebACL, export ARN
2. OxoGameProd           (eu-west-2)  — incl. NEW regional WebACL + association
3. OxoOnlineProd         (eu-west-2)  — sets distribution webAclId = WAF ARN (imports #1)
```

`OxoOnlineWafUsEast1` must deploy **before** `OxoOnlineProd` because
`OxoOnlineProd` imports its ARN (cross-region reference). `OxoGameProd` keeps
its existing "before OxoOnlineProd" position (regional WebACL + association are
self-contained inside it, so its ordering is unchanged relative to the data
plane). The regional ACL is independent of the us-east-1 stack.

**§30 composed-contract implication — the cross-stack WebAclId handoff.**
The WebACL ARN flowing from `OxoOnlineWafUsEast1` to `OxoOnlineProd`'s
distribution `webAclId` is a **cross-stack (and cross-region) contract**. Name
the synth assertion that pins it (synth contract test, runs in CI, no AWS
creds):
- **SYNTH-CONTRACT-WAF-1:** in the synthesised `OxoOnlineProd` template, the
  `AWS::CloudFront::Distribution` `DistributionConfig.WebACLId` resolves to a
  cross-region reference (SSM-reader custom resource output / `Fn::GetAtt` on
  the cross-region reference), NOT empty and NOT a hardcoded ARN string. This
  proves the handoff is wired at template level before any deploy.
- **SYNTH-CONTRACT-WAF-2:** `OxoOnlineWafUsEast1` synthesises exactly one
  `AWS::WAFv2::WebACL` with `Scope: CLOUDFRONT`, and the stack's `env.region`
  is `us-east-1`.
- **SYNTH-CONTRACT-WAF-3:** `OxoGameProd` synthesises one
  `AWS::WAFv2::WebACL` (`Scope: REGIONAL`) and one
  `AWS::WAFv2::WebACLAssociation` whose `ResourceArn` resolves to the WS API
  `prod` stage ARN (derived from the API id + stage name, not hardcoded).

## 4. New-mechanism flag (process v25 §30): **YES**

This is the **first WAF** (first use of WAFv2, first cross-region CDK stack,
first cross-region reference) in this system. Per §30 the route MUST include a
**walking-skeleton probe** that one real-client request through the deployed
path proves, scheduled **BEFORE** UC3 builds the full validation suite on it.

**WALKING-SKELETON-WAF (runs first, after UC1+UC2 deploy, before UC3 suite):**
One real client, from a single source IP, against each deployed ACL:
1. Send a burst of `POST /api/games` exceeding 100/5-min from one IP →
   observe at least one **HTTP 403** (WAF block) returned **before** Lambda is
   invoked (confirm via absence of a corresponding Lambda invocation / 403 body
   is the AWS WAF block page, not an app response).
2. Send a burst of WS connect attempts exceeding 20/5-min from one IP →
   observe connection **refusal/rejection** by the regional ACL before
   `$connect` Lambda runs.
3. Immediately after, one **normal** flow (single `POST /api/games` → 201,
   then one WS connect → `game-ready`) **succeeds unblocked**.

What it proves: the ACL is real, associated, the rate threshold actually fires
end-to-end from a real client, and the default-allow path leaves legitimate
traffic untouched. This is the minimum that de-risks the new mechanism before
the tester invests in the full UC3 acceptance suite (AC3.1–AC3.5).

## 5. Local/prod gap list (process v28, principles/02)

WAF is a managed AWS edge/regional service — **it cannot stand up locally at
all**. There is no local adapter for WAFv2; it is purely cloud-only control
plane. Enumerate every gap and the control that covers it:

| Item | Stands locally? | Cloud-only? | Covering control |
|------|-----------------|-------------|------------------|
| App handlers (create/join/register) | Yes (existing hexagonal local adapters) | No | unchanged — existing local run + unit tests |
| Rate-rule **behaviour** (block after threshold) | **No** — WAFv2 has no local emulation | Yes | **WALKING-SKELETON-WAF probe** (§4) + tester prod validation (AC3.1/AC3.2) |
| ACL **existence + association** (ACL attached to CF dist / WS stage) | **No** | Yes | **synth contract tests** SYNTH-CONTRACT-WAF-1/2/3 (§3) at CI synth time + prod validation (AC1.4/1.5, AC2.4) |
| Legit-flow-unaffected (default-allow transparency) | Partially (app flow runs locally without WAF) | Block-vs-allow edge behaviour is cloud-only | **existing smoke suite** (AC3.3/3.4/3.5 Playwright + create→join) confirms no regression post-deploy |
| Cross-region ARN handoff (us-east-1 → eu-west-2) | **No** (CloudFormation/CDK cross-region machinery) | Yes | **synth contract** SYNTH-CONTRACT-WAF-1 + prod validation that `webAclId` is non-empty (AC1.4) |

No item is left uncovered: every cloud-only item maps to either the skeleton
probe, a synth contract test, or prod validation.

## 6. Deploy-role delta (oxo-deploy)

The infra deploy role needs additive, scoped WAFv2 + CloudFront grants. Staged
in `DEPLOY_ROLE_EXTENSIONS.md` per the established pattern: **engineer wires the
statement into `OxoOnlineOidcStack`; the OIDC stack is applied manually via
`make -C work/oxo-online/src/infra deploy-oidc`** (it is excluded from the
automated pipeline to avoid re-creating the OIDC provider).

Actions to add (no wildcards beyond what WAFv2 management inherently requires):
- `wafv2:CreateWebACL`, `wafv2:GetWebACL`, `wafv2:UpdateWebACL`,
  `wafv2:DeleteWebACL`, `wafv2:ListWebACLs`, `wafv2:TagResource` — needed for
  CDK to manage both ACLs.
- `wafv2:AssociateWebACL`, `wafv2:DisassociateWebACL`,
  `wafv2:ListResourcesForWebACL` — for the regional WS stage association
  (and clean rollback).
- `cloudfront:UpdateDistribution`, `cloudfront:GetDistribution`,
  `cloudfront:GetDistributionConfig` — to set/read the distribution `webAclId`.

**§39 config-follows-resource ordering:** the deploy-role grant (config) MUST be
applied BEFORE the resources that need it are deployed. Concretely: run
`make deploy-oidc` to extend `oxo-deploy` FIRST, then run the infra pipeline
that creates the WebACLs and sets `webAclId`. If the WAF resources are deployed
before the role is extended, CloudFormation fails with AccessDenied on the
`wafv2:CreateWebACL` / `cloudfront:UpdateDistribution` calls. Resource-before-
config is the reversal failure mode — avoid it by applying the OIDC change in
the same slice, ahead of the infra deploy.

Note on cross-region: the deploy role must be usable for a us-east-1 deploy
(WAFv2 actions are global-ish but the API calls target us-east-1 for the
CLOUDFRONT-scope ACL). The role's permissions are not region-scoped on the
WAFv2 statements, so no additional region-conditioned statement is needed.

## 7. Version-identifiable deployment (principles/01)

WAF adds no new *served surface* with its own build identity — it is a control
on existing surfaces whose build identity is already carried (SPA build hash in
`/config.js` / page; HTTP API responses). The WebACLs themselves carry build
identity as **CDK tags** `Project=oxo-online, Env=prod, ManagedBy=cdk` plus the
CloudFormation stack name, which ties each ACL to the deploying stack/template
version. No new readable-build-identity carrier is required for this delta; the
ACLs are discoverable and version-attributable via stack tags.

## 8. Rollback — clean reversal

- **Regional WS ACL:** delete the `CfnWebACLAssociation` then the `CfnWebACL`
  (CDK removes both on stack update). Disassociation is a clean reversal — the
  WS `prod` stage returns to its prior state (reserved concurrency + stage
  throttle remain as the defence-in-depth floor). No data, no client contract
  affected.
- **Global CF ACL:** set the distribution `webAclId` back to empty
  (disassociation) in `OxoOnlineProd`, then destroy `OxoOnlineWafUsEast1`.
  CloudFront simply stops consulting the ACL; all routes continue to serve.
- **Reversal trigger / condition:** if a rate threshold causes false-positive
  blocks of legitimate players (observed via WAF CloudWatch BlockedRequests on
  the normal-flow path), the cheap first response is to raise the threshold
  (UpdateWebACL); full disassociation is the worst-case reversal and is clean
  because the ACL is the only thing removed — no app/data change to unwind.

## 9. Conclusion (for the human gate)

This delta introduces **new control-plane infrastructure** that **REDUCES the
attack surface** (bounds anonymous flood/exhaustion against the two public
endpoints). It introduces **no new data flow and no new trust boundary** — no
new principal, no new inbound path, no new persistence. Default-allow ACLs are
transparent to legitimate traffic.

**Open risks enumerated for GATE-3:**
1. **Rate thresholds are pre-launch placeholders** (100/5-min CF; 20/5-min WS).
   Hobby-volume guesses, not load-tested. Must be re-calibrated against real
   traffic before any public launch; a too-low threshold risks blocking real
   players, a too-high one weakens the control.
2. **WAF cost.** Each WebACL carries a monthly base charge + per-rule +
   per-request inspection cost (two ACLs now). Small at hobby volume but a new
   non-zero standing cost on an otherwise scale-to-zero stack. Flag for cost
   review.
3. **New deploy surface — us-east-1 stack.** Adds a second region to the deploy
   footprint and a cross-region CDK reference (SSM-backed custom resource). New
   failure mode: cross-region handoff can fail independently of the home-region
   deploy. Covered by SYNTH-CONTRACT-WAF-1 and the skeleton probe, but it is new
   operational surface to monitor.
4. **Residual (unchanged, not closed here):** no `$connect` capability-token
   authorizer on the WS endpoint (s005-h2). WAF rate-limits connection *volume*
   per IP; it does not authenticate. The unauthenticated-endpoint residual risk
   in `apigw-websocket.md` is *reduced* (rate-bounded) but not *eliminated* by
   this slice.
