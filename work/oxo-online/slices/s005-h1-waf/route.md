# Route — Slice s005-h1-waf (WAF / rate-limiting on public endpoints)

Thinnest ordered TDD sequence to advance every checkable acceptance case. Each
step is a single red→green cycle that lands independently on trunk. No
production code before a failing test. Steps are grouped by use case (§37);
parallel claim boundaries are stated below so two engineers can work UC1 and UC2
concurrently.

Legend: **AC** = acceptance/contract case advanced. Test files are the red→green
driver.

---

## Local-standability note (process v28, principles/02) — CONSCIOUS GAP-LIST APPLICATION

The delta's §5 local/prod gap list states WAF **cannot stand up locally at all**
— there is no WAFv2 emulator, and the rate-rule *behaviour* and ACL
*association* are pure cloud control-plane. Therefore the v28 "build browser
behaviour against a local stand-up" obligation **does NOT bite this slice**: this
slice adds no served surface and no browser-delivered behaviour. The obligation
reduces to **keeping the existing app/infra suites green** (no regression) and
covering every cloud-only item exactly as the gap list maps it:

- ACL existence + association + cross-region handoff → **synth contract tests**
  (SYNTH-CONTRACT-WAF-1/2/3/4), Phase A, at CI synth time, no AWS creds.
- Rate-rule firing behaviour → **WALKING-SKELETON-WAF probe** (Phase C) +
  tester prod validation (UC3).
- Legit-flow-unaffected (default-allow transparency) → **existing smoke suite**
  re-run post-deploy (UC3 AC3.3/3.4/3.5).

This is a recorded, deliberate application of the gap list — not an omission.
The local stand-up deliverable is unchanged; we only assert no existing suite
regresses.

---

## Use-case claim boundaries (§37 / §40)

| Claim | Owns (files) | Flag |
|-------|--------------|------|
| **UC1** — CF global WAF | NEW `src/infra/lib/waf-us-east-1-stack.ts`; `OxoOnlineProd` `webAclId` wiring in `src/infra/lib/oxo-online-shell-stack.ts`; NEW `src/infra/test/waf-us-east-1-stack.test.ts`; shell-stack test additions in `src/infra/test/shell-stack.test.ts` | n/a (infra; isolated by file) |
| **UC2** — WS regional WAF | `src/infra/lib/game-stack.ts` (regional WebACL + association); `src/infra/test/game-stack.test.ts` additions | n/a (infra; isolated by file) |
| **Shared (deploy-role)** — either engineer, claim explicitly | `src/infra/lib/oxo-online-oidc-stack.ts`; `src/infra/test/oidc-stack.test.ts` | n/a |
| **SEQUENTIAL SEAM** | `src/infra/bin/app.ts` — both UCs register a stack/edit here | — |

**The one sequential seam:** `bin/app.ts`. UC1 registers `OxoOnlineWafUsEast1`
(us-east-1 env) AND passes the WebACL ARN into `OxoOnlineProd` — UC1 lands
`bin/app.ts` first. UC2 adds nothing to `bin/app.ts` itself (its regional ACL +
association are self-contained inside `game-stack.ts`), but if UC2 needs any
`bin/app.ts` touch it **rebases on UC1's landed `bin/app.ts`** — never edits it
concurrently. Flag any other shared-file collision to the orchestrator rather
than working around it. cicd runs concurrently on `workflows/` + `capabilities`
— no collision with this route or any infra `lib/`/`test/` file.

---

## UC1 — WAF on CloudFront (HTTP API protection) — GLOBAL, us-east-1

### Step 1 — NEW us-east-1 WAF stack: exactly one CLOUDFRONT WebACL, region pinned
- **Build:** `src/infra/lib/waf-us-east-1-stack.ts` — new stack
  (`env.region='us-east-1'`, `crossRegionReferences: true`) holding ONLY one
  `CfnWebACL` (`Scope: CLOUDFRONT`, default action **Allow**), exporting its ARN
  as a public readonly stack property. Register it in `bin/app.ts` (lands the
  seam) with the standard `Project/Env/ManagedBy=cdk` tags.
- **AC:** SYNTH-CONTRACT-WAF-2, DEPLOY-IDENTITY-WAF, ORDER-WAF-2 (stack exists to
  order before OxoOnlineProd).
- **Test (red→green):** `src/infra/test/waf-us-east-1-stack.test.ts` — synth
  `OxoOnlineWafUsEast1`: Template has exactly one `AWS::WAFv2::WebACL` with
  `Scope: 'CLOUDFRONT'` and `DefaultAction` = Allow; the stack's resolved
  `env.region === 'us-east-1'`; the WebACL carries tags
  `Project=oxo-online, Env=prod, ManagedBy=cdk`.
- **Done:** assertions green; `synth-infra STACKS="OxoOnlineWafUsEast1"` passes.

### Step 2 — Global ACL rules: IP-reputation group + rate rule threshold as named constant
- **Build:** add to the global WebACL the managed rule group
  `AWSManagedRulesAmazonIpReputationList` (priority 0) and a rate-based rule
  (priority 1, aggregate key `IP`) at a threshold defined as a **named exported
  constant** `CF_RATE_LIMIT_PER_5MIN = 100` (no magic literal); visibility config
  (CloudWatch metrics + sampled requests) on each rule and on the ACL default.
- **AC:** AC1.2 (rate rule <= 100), AC1.3 (IP-reputation group present),
  SYNTH-CONTRACT-WAF-2 (rate limit <= 100 + managed group present).
- **Test (red→green):** in `waf-us-east-1-stack.test.ts` — the WebACL has a
  rate-based rule whose `Limit <= 100` and equals the imported constant; a
  managed-rule-group statement referencing `AWSManagedRulesAmazonIpReputationList`
  exists; assert the threshold is sourced from the named constant (import the
  constant in the test and compare — pins "not hardcoded literal in the rule").
- **Done:** rule assertions green.

### Step 3 — OxoOnlineProd consumes the ARN cross-region → distribution `webAclId`
- **Build:** in `oxo-online-shell-stack.ts` accept the global WebACL ARN (from
  the us-east-1 stack property, passed via `bin/app.ts` with
  `crossRegionReferences: true` on `OxoOnlineProd`) and set it as the
  distribution `webAclId`. No hardcoded ARN.
- **AC:** AC1.1 (`WebAclId` references the new WebACL),
  **SYNTH-CONTRACT-WAF-1** (cross-region ref, non-empty, NOT a hardcoded literal
  ARN).
- **Test (red→green):** `src/infra/test/shell-stack.test.ts` additions — synth
  `OxoOnlineProd`: `AWS::CloudFront::Distribution` `DistributionConfig.WebACLId`
  is present and non-empty; it resolves to a cross-region reference shape (SSM
  reader custom-resource output / `Fn::GetAtt`/`Ref`, NOT a plain string literal
  matching `arn:aws:wafv2:...`); assert it is not the empty string. Existing
  shell-stack `/api/*` behaviour assertions remain green (no regression).
- **Done:** `synth-infra STACKS="OxoOnlineWafUsEast1 OxoOnlineProd"` succeeds
  (proves the cross-region handoff resolves at synth); assertions green.
  **Commit when green** — UC1 synth contract landed.

---

## UC2 — WAF on WebSocket API stage (WS connection protection) — REGIONAL

### Step 4 — Regional WebACL in OxoGameProd: rate rule threshold as named constant
- **Build:** in `game-stack.ts` add one `CfnWebACL` (`Scope: REGIONAL`, default
  action **Allow**) with `AWSManagedRulesAmazonIpReputationList` (priority 0) and
  a rate-based rule (priority 1, key `IP`) at threshold named constant
  `WS_RATE_LIMIT_PER_5MIN = 20`; visibility config on each rule + default; tags
  `Project/Env/ManagedBy=cdk`.
- **AC:** AC2.2 (rate <= 20), AC2.3 (IP-reputation group),
  SYNTH-CONTRACT-WAF-3 (REGIONAL ACL, limit <= 20, group, default Allow),
  DEPLOY-IDENTITY-WAF.
- **Test (red→green):** `src/infra/test/game-stack.test.ts` additions — synth
  `OxoGameProd`: a `AWS::WAFv2::WebACL` with `Scope: 'REGIONAL'`, default Allow,
  rate-based rule `Limit <= 20` equal to the imported `WS_RATE_LIMIT_PER_5MIN`
  constant, and the managed IP-reputation group present; ACL carries the tags.
- **Done:** assertions green.

### Step 5 — Associate the regional ACL to the WS `prod` stage (ARN derived, not hardcoded)
- **Build:** in `game-stack.ts` add a `CfnWebACLAssociation` whose `ResourceArn`
  is the WS API `prod` stage ARN derived from the API id + stage name (CDK
  ref/`Fn::Sub`), and `WebACLArn` is the regional WebACL ARN.
- **AC:** AC2.1 (association → WS prod stage),
  SYNTH-CONTRACT-WAF-3 (association `ResourceArn` resolves to WS prod stage,
  derived not hardcoded), **SYNTH-CONTRACT-WAF-4** (no association targets the
  HTTP API stage).
- **Test (red→green):** `game-stack.test.ts` additions —
  (a) exactly one `AWS::WAFv2::WebACLAssociation` whose `ResourceArn` resolves
  via the API id + `prod` stage (assert it is a `Ref`/`Fn::Sub` referencing the
  WS API + stage, NOT a literal `arn:aws:apigateway:...` string);
  (b) **SYNTH-CONTRACT-WAF-4:** no `WebACLAssociation` `ResourceArn` references
  the HTTP API id / HTTP stage (Gate-2: no WebACL on the HTTP API stage).
- **Done:** association assertions green; `synth-infra STACKS="OxoGameProd"`
  passes. **Commit when green** — UC2 synth contract landed. (Rebase on UC1's
  landed `bin/app.ts` first if UC1 already pushed.)

---

## Shared — deploy-role grant (config-follows-resource, §39) — claim explicitly

### Step 6 — oxo-deploy role: scoped WAFv2 + CloudFront grants pinned (code↔policy)
- **Build:** add `Wafv2Manage` + `CloudFrontSetWebAcl` statements to
  `oxo-online-oidc-stack.ts` `deployRole` exactly per DEPLOY_ROLE_EXTENSIONS.md
  (no `wafv2:*` wildcard beyond the enumerated actions; CloudFront actions scoped
  to distribution `E519HYABC57ZX`; NO `iam:*`).
- **AC:** ORDER-WAF-1 (role grants exist to apply before the WAF deploy);
  code↔policy pin (process v25 §30) — the granted action set is pinned and no
  ungranted escalation action is present.
- **Test (red→green):** `src/infra/test/oidc-stack.test.ts` additions —
  the `oxo-deploy` role policy includes each enumerated `wafv2:` action and the
  three `cloudfront:` actions scoped to the distribution ARN; **assert NONE of**
  `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PutRolePolicy`,
  `cloudfront:CreateDistribution`, `cloudfront:DeleteDistribution`,
  `wafv2:PutLoggingConfiguration` are granted (least-privilege pin so code and
  policy cannot silently diverge into a prod AccessDenied or over-grant).
- **Done:** OIDC assertions green. Manual `make -C work/oxo-online/src/infra
  deploy-oidc` is the operational apply (Phase D Step 7), recorded in the deploy
  ledger — not a code test.

---

## Phase D — Deploy (real environment; §39 config-before-resource ordering)

### Step 7 — Apply the deploy-role grant FIRST (deploy-oidc)
- **Action:** `make -C work/oxo-online/src/infra deploy-oidc` updates
  `OxoOnlineOidcStack` so `oxo-deploy` carries the WAFv2 + CloudFront grants
  BEFORE any WAF resource is deployed.
- **AC:** ORDER-WAF-1.
- **Done (green):** OIDC stack update completes; deploy/ledger row emitted. This
  must precede Step 8 or the infra deploy fails with AccessDenied on
  `wafv2:CreateWebACL` / `cloudfront:UpdateDistribution` (the resource-before-
  config reversal failure mode, §39).

### Step 8 — Infra pipeline deploys WafUsEast1 → OxoGameProd → OxoOnlineProd
- **Action:** infra pipeline (`infra-oxo-online.yml`, owned/extended by cicd)
  deploys, in this order: `OxoOnlineWafUsEast1` (us-east-1) → `OxoGameProd`
  (eu-west-2, regional ACL + association) → `OxoOnlineProd` (eu-west-2, sets
  distribution `webAclId` from the cross-region ARN import).
- **AC:** ORDER-WAF-2; makes AC1.4/1.5, AC2.4 live-verifiable.
- **Done (green):** infra workflow run finishes green; both WebACLs exist;
  distribution `webAclId` set; deploy row emitted to the DORA ledger. (If the
  pipeline lacks a us-east-1 stack step or per-stack sequential deploy, that is a
  **cicd capability gap** — flag it; do not work around with a novel command.)

---

## Phase C — WALKING-SKELETON-WAF probe (process v25 §30) — RUNS FIRST after deploy, BEFORE the UC3 suite

### Step 9 — Committed burst-probe drives ONE real flow through both deployed ACLs
- **Build:** `work/oxo-online/scripts/waf-burst-probe.js` (committed; self-served
  tooling, runnable via a root Makefile target `make waf-probe` — name the target
  in the return for the allowlist owner if a new pattern is needed). The probe,
  from a single source IP:
  1. **HTTP burst:** `fetch` POST `/api/games` rapidly past 100/5-min →
     assert **>= 1 HTTP 403** WAF block (AWS WAF block body, not an app 4xx);
  2. **WS connect burst:** rapid WS connects past 20/5-min →
     assert **>= 1 pre-`$connect` WAF rejection** (refused before `$connect`
     Lambda runs);
  3. **then one clean flow:** single `POST /api/games` → 201 → one WS connect →
     `game-ready` succeeds unblocked (default-allow leaves legit traffic alone).
- **AC:** WALKING-SKELETON-WAF (gate to the full UC3 suite); de-risks the FIRST
  WAFv2 / FIRST cross-region mechanism before the tester invests in UC3.
- **PROBE-CLIENT JUSTIFICATION (§17):** a **node `fetch`/`ws` probe is
  acceptable here** for the HTTP path even though §17 normally demands a real
  browser — because **WAF acts BELOW the browser-layer concerns** §17 exists to
  protect. WAF inspects IP rate + reputation at the CloudFront/API-GW edge; it is
  blind to CSP `connect-src`, `window.OXO_CONFIG` runtime-config injection
  ordering, and mixed-content rules. **This slice changes none of those** (no
  served-surface change, no config wiring change), and the **existing browser
  smoke** continues to cover them under UC3 (AC3.3/3.4/3.5). A node probe
  therefore gives a TRUE green for the WAF mechanism, not the false green §17
  warns against for browser-delivered behaviour. The skeleton's purpose — prove
  the ACL is real, associated, fires at threshold, and is transparent to legit
  traffic — is fully exercised at the transport layer the WAF operates on.
- **Done (green):** probe observes >=1 block on each endpoint and a clean
  create→join flow; gate satisfied → proceed to UC3. Hand any failing in-prod
  symptom (e.g. no block fires, legit flow blocked) to the tester. A defect is
  not closed until the end-to-end user symptom is reproduced and pinned, not just
  a partial cause.

---

## UC3 — Prod validation (tester-owned build-out; runs AFTER Phase C gate)

### Step 10 — Burst validation specs pinned into tests/validation/
- **Build:** `src/app/tests/validation/s005-h1-waf.spec.ts` (or
  `tests/validation/` per project convention) — converts the skeleton findings
  into standing regression: HTTP burst → >=1 403 WAF block (AC3.1); WS connect
  burst → >=1 WAF-level rejection (AC3.2).
- **AC:** AC3.1, AC3.2.
- **Done (green):** validation specs green against prod via `make validate
  ITER=7 SLICE=s005-h1-waf PROD_URL=…`; validation_run row emitted.

### Step 11 — Legit-flow + regression smoke green
- **Build:** smoke coverage (existing s005 suite + WAF transparency case):
  single create→join completes unblocked (AC3.3); local game + vs-AI render and
  function (AC3.4); `POST /api/games` returns 201 with a 6-char code when not
  rate-limited (AC3.5, already pinned). Verify existing `tests/smoke/` stable
  selectors still isolate the correct elements (surface unchanged this slice, so
  expected pass — confirm, do not merely assume).
- **AC:** AC3.3, AC3.4, AC3.5; SM-4, SM-5.
- **Done (green):** smoke green against prod via `make smoke`; validation_run row
  emitted.

### Step 12 — CLI policy / observable-condition checks (acceptance.md §D)
- **Verify:** `aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1`
  lists the global ACL (AC1.5); `aws cloudfront get-distribution-config`
  `WebAclId` non-empty + matches the ACL ARN (AC1.4);
  `aws wafv2 list-resources-for-web-acl --resource-type API_GATEWAY
  --region eu-west-2` returns the WS prod stage ARN (AC2.4); both WebACLs carry
  tags `Project/Env/ManagedBy=cdk` (DEPLOY-IDENTITY-WAF).
- **AC:** AC1.4, AC1.5, AC2.4, DEPLOY-IDENTITY-WAF.
- **Done:** all CLI checks pass; hand any failing in-prod behaviour to the tester.

---

## Independence notes

- **UC1 (Steps 1–3)** and **UC2 (Steps 4–5)** touch DIFFERENT files (new
  us-east-1 stack + shell-stack vs game-stack) and DIFFERENT WAF scopes — fully
  parallel across two engineers. The ONLY shared mutation is `bin/app.ts`: **UC1
  lands it; UC2 rebases on the landed version** — never a concurrent edit.
- **Step 6 (oidc-stack)** touches a third file, independent of UC1/UC2 build
  steps; whichever engineer claims it does so explicitly. It must land before
  Step 7 (deploy-oidc).
- **Step 7 (deploy-oidc)** must precede **Step 8 (infra deploy)** — §39
  config-before-resource. Step 8 deploys in the strict order
  WafUsEast1 → OxoGameProd → OxoOnlineProd (§ORDER-WAF-2).
- **Step 9 (skeleton probe)** depends on a successful Step 8 and runs BEFORE the
  UC3 suite — it is the gate.
- **UC3 (Steps 10–12)** depends on the Step 9 gate; it is tester-owned validation
  with no production-code build content.
- cicd works `workflows/` + `capabilities` concurrently — no file collision with
  this route or any infra `lib/`/`test/` file owned here. Pipeline ordering /
  us-east-1 stack step / new `make waf-probe` allowlist entry are cicd-owned
  capability items: flag, do not work around.

## Step count

12 steps across 5 phases (UC1: 1–3, UC2: 4–5, Shared deploy-role: 6,
Deploy: 7–8, Skeleton probe: 9, UC3 validation: 10–12).
