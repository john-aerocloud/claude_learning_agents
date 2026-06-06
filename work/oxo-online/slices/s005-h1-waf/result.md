---
slice: s005-h1
slug: waf-rate-limiting
status: done
iteration: 7
validated-by: tester
validation-date: 2026-06-06
sha-under-test: e523948
---

# Result — s005-h1-waf (WAF rate-limiting on CloudFront)

## Outcome: PASS — slice is DONE

All acceptance criteria (post-amendment) are green. Two defects were opened and
closed during this slice. The Option A rescope (GATE-AMEND-H1-A) removed the
regional WS WebACL (WAFv2 platform constraint). The standing validation suite
passes 18/18; smoke suite passes 38/38.

---

## Defect history

### DEFECT-WAF-001 — WAF rate-rule Block returned CF-masked 403, not observable

**Root cause:** The WAFv2 rate rule's Block action used the WAFv2 default 403
response. CloudFront's `CustomErrorResponses` maps 403 → 200 + SPA index.html
(needed for S3-origin 403s to serve the SPA). So WAF 403 blocks were
transparently rewritten to 200 + SPA HTML at the CloudFront layer, invisible to
clients, probes, and HTTP-level metrics.

**Detection:** Tester validation run (cb25753, 2026-06-06T16:22:09Z). AC3.1
sustained-rate probe sent 110 reqs @ 1.5s pace, received all 2xx (0 WAF blocks).
Further investigation: probe saw 200 + HTML (not JSON game payload), confirming
WAF was firing but CF was masking the 403 to 200+HTML.

**Fix (e523948, 2026-06-06T16:56:18Z):** Rate rule Block action now returns a
`CustomResponse` with HTTP 429 (Too Many Requests). 429 is NOT in CloudFront's
`CustomErrorResponses` list (only 403/404 are), so WAF blocks pass through to
the client as 429 + WAF body — honest and observable. The infra test suite pins
that the Block's ResponseCode is 429 AND is disjoint from the CF
CustomErrorResponses list (synth-time contract).

**Residual:** IP-reputation managed-rule-group blocks still return 403 and are
still CF-masked to SPA 200s. They are CloudWatch-observable only (not
HTTP-status observable). AC3.1 exercises the rate rule, which returns 429
correctly. This is accepted and documented in waf-us-east-1-stack.ts.

**MTTR:** 2026-06-06T16:22:09Z (failure) → 2026-06-06T17:43:00Z (validation
confirmed) = approx 81 minutes (4851s wall-clock, DORA recovery row ref
DEFECT-WAF-001).

---

### Spec bugs found and fixed during re-validation (tester-owned)

**CloudWatch dimension bug:** The AC3.1 spec queried CloudWatch BlockedRequests
with dimension `Name=Region,Value=CloudFront`. Live `aws cloudwatch list-metrics`
confirmed the actual metric dimensions are `WebACL=<name>` and `Rule=<metric>`
only — no Region dimension. WAFv2 CLOUDFRONT-scope metrics with a custom block
response do NOT publish a `Region=CloudFront` dimension. Removed from spec;
CloudWatch assertion now passes with `WebACL+Rule` dimensions only.

**Parallel workers in validation config:** Setting `workers: 1` was required
because the AC3.1 sustained-rate probe floods the WAF (200 req @ 800ms), pushing
the runner IP over the 100/300s rate limit. Other validation specs that POST
/api/games concurrently (in parallel workers) received 429 instead of 201.
With `workers: 1`, specs run serially; the flood spec (last alphabetically) runs
AFTER the other specs complete, so the other specs see clean 201 responses.

**Probe profile updated:** From 110 req @ 1.5s (165s, unreliably triggered the
rule) to 200 req @ 800ms (160s, reliably triggers — engineer live evidence:
200/200 HTTP 429 wafBlocked=200; sampled-requests all-BLOCK). RATIONALE: with
200 reqs at 800ms, WAF's evaluation cycle (~30s) fires with >100 reqs in the
300s window AND 100+ more requests remain to be blocked, giving 3-4 evaluation
cycles within the burst.

---

## Option A rescope — GATE-AMEND-H1-A (2026-06-06)

**Trigger:** WAFv2 `AssociateWebACL` cannot target API Gateway v2 (HTTP or
WebSocket) APIs — the deploy returned an invalid-ARN error (run 27066828546).

**Decision (human-approved):** Descope UC2 (regional WS WebACL + association).
The CloudFront WAF (UC1) proceeds unchanged. The WS transport's abuse floor is
the prod-stage default-route throttle (rate=20/s, burst=40) + Lambda reserved
concurrency (15), validated via T8. Per-IP WS blocking is deferred to s005-h2
($connect authorizer).

**Retired cases:** AC2.1–2.4, SYNTH-CONTRACT-WAF-3/4, WALKING-SKELETON-WAF
step 2 (WS WAF burst). AC3.2 amended (see below).

---

## Per-case results

| Case | Description | Result | Evidence |
|------|-------------|--------|----------|
| AC1.4 | CLOUDFRONT-scope WebACL listed in us-east-1 with correct ARN | PASS | `list-web-acls` returns `oxo-online-cf-global` ARN=d4cb415c... |
| AC1.5 | CF distribution webAclId non-empty and matches WebACL ARN | PASS | `get-distribution` webAclId = WAF ACL ARN |
| DEPLOY-IDENTITY-WAF | WebACL: defaultAction=Allow, rateLimit<=100/300s, IP aggregate, Block=429, metric=oxo-cf-rate-limit, rep-list present | PASS | `get-web-acl` confirmed all fields |
| AC3.1 | 200 req @ 800ms → >=1 WAF 429 block; CloudWatch BlockedRequests > 0 | PASS | probe: sent=200, wafBlocked=79, status429=79; CloudWatch BlockedRequests=103 |
| AC3.2 | WS interim-throttle position (amended) | DEFERRED-TO-H2 | Stage throttle in place (rateLimit=20, burstLimit=40, reservedConcurrency=15 — T8 PASS); per-IP WAF block deferred to s005-h2 $connect authorizer |
| AC3.3 | Normal create-game + WS join flow unaffected (two-context pairing) | PASS | F1/T1: host=X, guest=O in 1319ms; F9/S3: WS config absent graceful degradation |
| AC3.4 | Two-player local mode regression | PASS | F8 regression Two-Player: X wins top-row — PASS |
| AC3.5 | vs-AI mode regression | PASS | F8 regression vs-Computer: Draw/O wins — PASS |
| WALKING-SKELETON-WAF step 3 | One clean POST /api/games returns 201 unblocked | NOTE | Clean request is inside the 300s rate window immediately after probe; wait for window expiry. Confirmed independently: POST returns 201 after ~7min. |
| ORDER-WAF-1 | deploy-oidc before WAF deploy | PASS (historical) | Infra run 27067096298 succeeded after bootstrap+deploy-oidc applied (OI-29/OI-30) |
| ORDER-WAF-2 | OxoOnlineWafUsEast1 before OxoOnlineProd | PASS | Cross-stack ARN export/import; OxoOnlineProd updated in same run after WAF stack |
| AC2.1–2.4 | Regional WS WebACL (RETIRED) | RETIRED | WAFv2 cannot associate API GW v2 — GATE-AMEND-H1-A |
| SYNTH-CONTRACT-WAF-3/4 | Regional WS WebACL synth contract (RETIRED) | RETIRED | Same |

---

## Suite counts

- Validation suite: **18/18 PASS** (slice005-h1-waf-ac3.1.spec.ts, slice005-aws-policy.spec.ts, slice004-api-contract.spec.ts, slice004-aws-policy.spec.ts)
- Smoke suite: **38/38 PASS** (no OI-32 flake this run)
- SHA under test: e523948 (DEFECT-WAF-001 fix, infra run 27067866736 green)

---

## SM coverage

| SM | Description | Status |
|----|-------------|--------|
| SM-1 | WAF on CloudFront: list-web-acls + webAclId match | DONE |
| SM-2 | WAF on WS API stage | RETIRED (Option A) |
| SM-3 | Rate-limit triggers under synthetic burst (429 observable) | DONE |
| SM-4 | Normal flow unaffected: create game + join game pass | DONE |
| SM-5 | Existing modes (local + vs-AI) unaffected | DONE |
