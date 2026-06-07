---
slice: s005-h2
slug: connect-auth
result: FAIL
iteration: 8
sha-under-test: 11d468e3de0ca35ccd6941db7ba11c60cc2c616b
validated-by: tester (Claude Sonnet 4.6)
date: 2026-06-07
---

# Validation result — s005-h2-connect-auth

## Overall verdict: FAIL

One defect blocks sign-off (DEFECT-H2-003). All other acceptance cases passed.

---

## Identity check (principles/01)

BUILD IDENTITY CONFIRMED before any behavioural assertion:
- Authorizer log: `{"buildSha":"11d468e3de0ca35ccd6941db7ba11c60cc2c616b",...}` (multiple entries)
- sha under test matches: `11d468e3de0ca35ccd6941db7ba11c60cc2c616b`

---

## Per-acceptance-case results

| AC | Description | Result | Evidence |
|----|-------------|--------|----------|
| T1 / AC2.10 | REQUEST authorizer attached to WS API | PASS | `get-authorizers`: `AuthorizerType=REQUEST` `Name=oxo-ws-connect-authorizer` `AuthorizerUri=...oxo-ws-auth-fn/invocations` |
| T5 / AC2.11 | ConnectAttempts TTL enabled on `ttl` | PASS | `describe-time-to-live`: `TimeToLiveStatus=ENABLED AttributeName=ttl`; table=`oxo-connect-attempts` (note: logical name in acceptance is `ConnectAttempts`); PK=sourceIp, PAY_PER_REQUEST, SSE=KMS |
| T7 / AC1.1 | POST /api/games returns wsToken | PASS | `201 {gameId, code, wsToken}` confirmed |
| T7 / AC1.2 | wsToken shape `<b64url>.<b64url>`, payload `{gameId, role:"host", exp}` | PASS | `role=host exp-delta=60s` confirmed |
| T7 / AC1.4 | exp within 60s | PASS | delta=60s |
| T7 / AC1.5 | prod 201 with non-empty wsToken | PASS | confirmed |
| T7 / AC1.6 | gameId + code fields unchanged | PASS | confirmed |
| T7 / AC7.4 | POST /api/games → 201 with gameId, code, wsToken | PASS | confirmed via browser fetch in smoke spec |
| T9 | buildSha in authorizer log lines | PASS | `17 log lines` carrying `buildSha=11d468e3de0ca35ccd6941db7ba11c60cc2c616b`; Allow + Deny decisions both carry it |
| AC5.1 | No-credential connect rejected (HTTP 403 upgrade) | PASS | `opened=false error=connection failed`; log: `reason=no-credential` |
| AC5.2 | Tampered wsToken rejected | PASS | `opened=false`; log: `reason=bad-signature` |
| AC5.3 | Expired wsToken rejected | PASS | `opened=false` |
| AC5.4 | Non-existent code rejected | PASS | `opened=false`; log: `reason=code-not-found` |
| AC5.5 | oxo-ws-fn invocations flat during rejection probes | PASS | baseline=4 post=6 diff=2 (within +2 margin; 2 diff from AC4.3 legit connects in same window, not from rejection probes) |
| AC3.3 | No Deny for legit host connect | PASS | host wsToken connect `opened=true`; log: `effect=Allow role=host` |
| AC4.3 | No Deny for legit guest connect | PASS | guest code connect `opened=true`; log: `effect=Allow role=guest` |
| AC4.4 | Games record status=active with both connectionIds | NOTE | Direct individual-connect assertion passed; full pairing Games record check covered by existing slice005-aws-policy T2+T3 spec which also passed (hostConnId + guestConnId confirmed active). See note below. |
| AC6.1 | Burst >threshold yields Deny | PASS (precondition met) | Authorizer log shows `reason=rate-limit-exceeded`; ConnectAttempts `count=25` confirmed during burst run |
| AC6.2 | ConnectAttempts item count >= threshold | PASS | DynamoDB scan: `sourceIp=88.97.176.116 count=25 (>= threshold 20)` |
| AC6.4 | Best-effort caveat documented | PASS | OR-H2-a caveat recorded in spec + result (see below) |
| AC7.1 | Local two-player regression | PASS | Playwright Chromium: X wins top row, play-again resets |
| AC7.2 | vs-AI regression | PASS | Playwright Chromium: completed without X winning |
| AC7.3 | Online host+guest both reach board within 3s (BROWSER) | FAIL | See DEFECT-H2-003 below |
| F1/T1 (s005) | Pre-existing pairing smoke (slice005-validation.spec.ts) | FAIL | Same root cause as DEFECT-H2-003 |
| T2+T3 (s005) | Live pairing + DynamoDB Games/Connections check | PASS | hostConnId=elPnwfUc guestConnId=elPn6ddV; TTL delta ~7200s |
| T5 (s005) | No-hijack: second join closes 4041 | PASS | `close=4041 guestConnId unchanged` |

---

## OR-H2-a BEST-EFFORT CAVEAT (AC6.4)

Per acceptance case AC6.4 and acceptance.md S8, the following caveat is formally recorded:

**OR-H2-a:** Per-IP budget is best-effort for the following reasons:
1. Authorizer cache TTL=0 (deployed): each unique token invokes the authorizer and increments the counter — per-IP counting is accurate when distinct tokens are used.
2. IP cycling: a determined attacker changing IPs (VPN, multiple NAT gateways) bypasses the counter entirely. The per-IP budget is a deterrent, not a hard guarantee.
3. DynamoDB ADD is atomic per item; cross-container consistency is the DynamoDB guarantee.
4. Layered controls: stage throttle (rateLimit=20 burstLimit=40, confirmed) and reserved concurrency (15, confirmed) provide a complementary floor.
5. DEFECT-H2-003 (raised below): counter does not reset on TTL expiry until DynamoDB lazy-deletes the item — see defect.

Reversal path: CloudFront-front WS → edge WAF (documented in slice.md S8).

---

## DEFECT-H2-003 — Per-IP counter not reset on TTL expiry (BLOCKER)

**Defect ID:** DEFECT-H2-003
**Severity:** Blocker (prevents legitimate users from connecting after the budget window expires)
**Classification:** 5xx (service WE own) — owned engineering defect

**Expected behaviour (UC6 design):** The per-IP connect budget resets after the 5-minute TTL window. A new connect from the same IP after the TTL expires should be allowed (count=0 → count=1, below threshold).

**Actual behaviour:** The DynamoDB item's TTL expires (as designed), but DynamoDB lazy-deletes items up to 48 hours after expiry. While the item exists with an expired TTL, the `increment` adapter still reads and increments the `count` field (`ADD count :one`). The authorizer checks `count >= threshold` without checking whether `ttl > now()`. A count=29 item with a TTL expired 2 minutes ago continues to deny all connects from that IP indefinitely until DynamoDB garbage-collects the item.

**Root cause:** `ddb-connect-counter.ts` `increment()` uses `UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)'`. The `if_not_exists(ttl, :ttl)` only sets TTL on the FIRST write (when the item doesn't exist yet). On all subsequent writes, the TTL is not updated. When DynamoDB has not yet deleted the expired item, the counter keeps incrementing. The `authorizer.ts` `authorize()` function does not check `item.ttl > deps.now()` before using the count.

**Evidence:**
- DynamoDB item: `sourceIp=88.97.176.116 count=29 ttl=1780821264` (expired at 08:34:24 UTC; checked at 08:36:22 UTC = 118s after expiry; still present)
- Authorizer logs: `reason=rate-limit-exceeded` for 6 invocations after TTL expiry (08:35:28 UTC)
- AC7.3 browser smoke test: guest board did not appear; ARIA snapshot shows `alert: Something went wrong. Please try again.` — WS connection Denied by rate limiter
- ws-skeleton probe post-TTL: `host-wsToken-allowed: opened=false` (expected true)

**Fix direction (for engineering):**
Option A (adapter-level): In `DdbConnectCounter.increment()`, use a `ConditionExpression` that distinguishes a new window from a continuing one. For example: use a separate `GetItem` first, and if the item exists with `ttl <= now()`, delete it and re-insert with count=1. Or: change `UpdateExpression` to always overwrite TTL when the existing TTL is expired — `SET #ttl = if_not_exists(#ttl, :ttl)` → `SET #ttl = :ttl` combined with a ConditionalExpression. 

Option B (authorizer-level): In `authorizer.ts`, after getting the count, also read the item's `ttl` field and if `ttl <= now()`, treat count as 0 (window reset). This requires a `GetItem` or the counter to return both count and ttl.

Note: The cleanest fix is to read the existing item first, and if it exists but TTL has expired, conditionally put a new item with count=1 and a fresh TTL (avoiding the race). This is a standard "sliding window reset" pattern.

**Affected ACs:** AC7.3 (browser pairing), F1/T1 (pre-existing pairing smoke), AC6.3 (TTL expiry recovery — deferred in acceptance but now empirically broken)

---

## Suites run

| Suite | Tests | Pass | Fail | Result | Notes |
|-------|-------|------|------|--------|-------|
| tests/validation (--grep-invert burst) | 27 | 27 | 0 | GREEN | Excludes h2-burst |
| tests/smoke --grep h2 | 4 | 3 | 1 (AC7.3) | RED | Per-IP budget exhausted (DEFECT-H2-003) |
| tests/smoke F1/T1 (pre-existing) | 1 | 0 | 1 | RED | Same root cause |
| UC6 burst (manual observation) | n/a | n/a | n/a | OBSERVED | rate-limit-exceeded confirmed in logs |

---

## Specs committed (sha d9eb13d on trunk)

- `/work/oxo-online/src/app/tests/validation/slice005-h2-connect-auth.spec.ts` — NEW
- `/work/oxo-online/src/app/tests/validation/slice005-h2-burst.spec.ts` — NEW
- `/work/oxo-online/src/app/tests/smoke/slice005-h2-pairing.spec.ts` — NEW (browser-transport spec per process v27)
- `/work/oxo-online/scripts/ws-probe.js` — UPDATED (--ws-token arg for post-h2 pairing)
- `/work/oxo-online/src/app/tests/validation/slice005-aws-policy.spec.ts` — UPDATED (T2+T3 + T5: pass --ws-token)
- `/work/oxo-online/src/app/tests/validation/slice004-api-contract.spec.ts` — UPDATED (allows wsToken in response)
- `/work/oxo-online/src/app/tests/validation/README.md` — UPDATED (h2 specs listed)

---

## DORA rows written

- `task_start` (ref: 11d468e3) — tester session start
- `validation_run` (ref: d9eb13d:validation-main-27tests, outcome: success) — 27/27 main tests
- `failure` (ref: d9eb13d:DEFECT-H2-003, outcome: fail) — per-IP counter TTL reset defect

MTTR clock runs from this record until engineering's fix is validated.

---

## Deviations

- **Table name mismatch:** Acceptance prose says `ConnectAttempts`; deployed table is `oxo-connect-attempts`. Specs updated to correct name. No engineering action needed (behaviour correct, just naming divergence between acceptance doc and deploy).
- **AC7.3 browser-transport spec failure:** Failure is a genuine production defect (DEFECT-H2-003), not a test-harness issue. The spec correctly surfaces the user-visible symptom (board not appearing, generic error shown).
- **AC6.3 (optional) deferred:** Per acceptance.md § "at your discretion". The TTL expiry mechanism is confirmed broken by DEFECT-H2-003 — AC6.3 cannot pass until the defect is fixed.
