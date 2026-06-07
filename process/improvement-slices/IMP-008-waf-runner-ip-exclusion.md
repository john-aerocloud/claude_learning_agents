# IMP-008 — WAF runner-IP exclusion at build time (self-cleaning)

**Status:** queued (raised at s006 retro, 2026-06-07, human-directed)
**Owner:** cicd (build/deploy) / engineer (CDK IP-set resource) / tester (consumer)
**Raised by:** tester s006 UC6 validation — WAF 100 req/5min per-IP rate rule exhausted
by the 50-test smoke suite from a single local/CI IP, causing cascading 429 failures
on tests 40–50 that required isolated grepping and 5-min waits between runs.

---

## Problem

The WAF WebACL (`oxo-online-cf-global`, us-east-1, CLOUDFRONT scope) has a rate rule:
100 requests per 5-minute sliding window per source IP, Block action.

The full smoke suite (50 tests, workers=1) issues ~150–200 HTTP requests from a single
IP (page.goto + WS pairings + API calls). By test 40 the WAF sliding window fills and
subsequent tests receive 429, even with workers:1. This is a pre-existing issue
(OI-32-FOLLOW-UP from s005-h2) made more acute by s006 adding 6 two-browser pairing
tests (12 extra WS connections, ~20 extra requests).

**Root cause:** the rate rule was designed for external end-user IPs. The test runner
(local agent machine or CI worker) is a known, trusted source that should be excluded
from the rate rule during a validation window.

**Why monitor mode is NOT the fix:**
Switching the rate rule from BLOCK to COUNT removes the production protection that
AC3.1 explicitly validates (`slice005-h1-waf-ac3.1.spec.ts`). Monitor mode would make
the standing WAF regression test meaningless and leave the endpoint unprotected. The
fix must be scoped — exclude known runner IPs, keep the rule active for all other IPs.

---

## Solution design

### Mechanism: WAF IP set exclusion at build time, cleaned up on completion

The GitHub Actions smoke workflow (or the local tester's invocation) should:

1. **Discover the runner's external IP** at job start:
   `curl -s https://checkip.amazonaws.com` → runner external IP.
   (This curl pattern needs to be in the allowlist for CI; locally the tester can
   use the same curl form.)

2. **Add the IP to a WAF IP set** (`oxo-test-runner-ips`, CLOUDFRONT scope, us-east-1)
   that is referenced by the rate rule as a scope-down statement exclusion —
   traffic from IPs in this set bypasses the rate rule's count.
   Uses: `aws wafv2 update-ip-set` with the discovered IP/32.

3. **Run the smoke suite** (with the exclusion in place).

4. **Remove the IP from the set** in a `post` step (always runs, even on failure).
   Uses: `aws wafv2 update-ip-set` with the IP removed.
   This is the "self-cleaning" behaviour the human requested — the set empties after
   every run and stale IPs do not accumulate.

5. **Safety fallback:** if the cleanup step fails (network blip, job cancelled), the
   IP set contains an address that was temporarily trusted. The rate rule still fires
   for all other IPs; only the stale runner IP is over-privileged until manual cleanup.
   Mitigation: set a short TTL on the IP set (WAF IP sets do not natively expire entries,
   so a scheduled CloudWatch Events Lambda that drains the set every 24h is the
   permanent guard).

---

## Done condition

1. **CDK resource:** `oxo-test-runner-ips` WAF IP set (CLOUDFRONT, us-east-1) created in
   `OxoWafUsEast1Stack`. The rate rule's scope-down statement excludes IPs in this set
   (WAF `NOT` statement around the IP-set condition). Synth test (`waf-us-east-1-stack.test.ts`)
   asserts the IP set and the exclusion scope-down are present.

2. **`make smoke-ci` target (root Makefile):** parameterised entry point that:
   a. Calls `make waf-runner-ip-add` (discovers runner IP, adds to IP set).
   b. Calls `make smoke ITER=… SLICE=…` (existing target).
   c. Calls `make waf-runner-ip-remove` (removes runner IP, always — via `trap`).
   The three sub-targets (`waf-runner-ip-add`, `waf-runner-ip-remove`) are allowlisted
   individually so they can be called standalone for debugging.

3. **`make waf-runner-ip-add` and `make waf-runner-ip-remove`:** use the committed
   script `work/oxo-online/scripts/waf-runner-ip.js` (Node, reads `checkip.amazonaws.com`,
   calls `aws wafv2 update-ip-set`). The script is the allowlisted form — not an
   inline env-var-assembled CLI call.

4. **Allowlist entries added to `.claude/settings.json`:**
   - `Bash(aws wafv2 get-ip-set *)` — read the IP set
   - `Bash(aws wafv2 update-ip-set *)` — add/remove IPs (write, but scoped to named IP set)
   - `Bash(curl https://checkip.amazonaws.com)` — discover runner external IP
   - `Bash(make smoke-ci *)` — the combined target
   - `Bash(make waf-runner-ip-add *)`, `Bash(make waf-runner-ip-remove *)`

5. **Full smoke suite passes** (all 50 tests green via `make smoke-ci`) from a single
   runner IP, with no WAF 429s, in a single run without inter-test waits.

6. **Cleanup is verified:** after `make smoke-ci` completes, `aws wafv2 get-ip-set`
   shows the runner IP is absent from the set. Pinned in a post-run assertion in
   `waf-runner-ip-remove`.

7. **Synth test** for the drain Lambda (scheduled drainer) is out of scope for this
   IMP but named for s007 cicd capability step.

---

## DORA target

- **CFR from WAF 429:** 0% on tester smoke runs (currently ~100% when running the full
  suite back-to-back with validation).
- **Tester wall time:** eliminate the 5–6 minute inter-run waits forced by WAF budget
  exhaustion. Expected saving: ~10 minutes per full slice validation cycle.
- **Human gate waits:** 0 additional — this is autonomous tooling within the cicd
  capability step, no new human approval needed (the IP set resource is defence-in-depth,
  not a new trust boundary; the rate rule still applies to all other IPs).

---

## Dependency

- Requires the `oxo-test-runner-ips` WAF IP set to be deployed (CDK infra step) before
  the `make smoke-ci` target can use it.
- The CDK WAF stack (`OxoWafUsEast1Stack`) is already deployed in us-east-1. The IP set
  is a new resource in that stack — a one-deploy change, no cross-stack dependency.
- `aws wafv2 update-ip-set` requires a lock token (ETag-style). The script must get the
  current lock token before each update (`aws wafv2 get-ip-set`, extract `LockToken`).

---

## Open risks

- **CLOUDFRONT-scope WAF in us-east-1:** the `aws wafv2` calls must use `--scope CLOUDFRONT`
  and `--region us-east-1` (not eu-west-2). This is a platform-semantic already documented
  in the WAF skill — the allowlist patterns must include `us-east-1`.
- **Race condition (parallel CI workers):** if two CI runs add different IPs concurrently,
  the second `update-ip-set` must not clobber the first. The script must read-modify-write
  atomically (get current Addresses, append, update) rather than replace. Node concurrency
  is not an issue for sequential single-runner invocations; parallel CI is.
- **`checkip.amazonaws.com` availability:** if the service is down, the IP cannot be
  discovered. Fail the build rather than proceeding without the exclusion (proceeding
  would guarantee 429 failures that look like smoke failures).
