---
slice: s007-disconnect
iteration: 10
agent: tester
date: 2026-06-07
last-validated-sha: 5cfe6d6
sha-under-test: e078ea4b744085db320aa1c9eff4d018fabc6785
---

# Test Plan — s007-disconnect UC4 prod validation

## Model diff summary (5cfe6d6 → HEAD)

Changed nodes in data-flow.mmd (`class wsfn,conn,games,relay,cfwaf,wsauth,attempts changed`):
- **wsfn**: $disconnect stub → real (abandon+notify+clean up); +Connections GetItem grant
- **conn**: now READ on $disconnect path (was write-only) — new GetItem edge
- **games**: gains active→abandoned conditional transition on $disconnect
- **relay**: gains the 1-post survivor notify (0 on terminal/waiting)
- **cfwaf**: gains IMP-008 oxo-test-runner-ips IP-set scope-down
- **wsauth**: gains post-threshold exemption GetItem (waives RATE_LIMIT Deny only)
- **attempts**: gains EXEMPT#<ip> namespace (1h TTL)

Changed nodes in class-deps.mmd (`s007changed`):
- portConnectionStore, domainDisconnect, wsDisconnectHandler
- adapterConnectionsDdb, adapterLocalConnStore
- spaOnlineDisconnect, spaJoinScreen (S007-RENDER-FIX forward edge)

Changed nodes in class-deps.mmd (`s007aChanged`):
- portExemption, domainAuthorize, adapterConnectExemption, ddbConnectAttempts

Changed nodes in use-case-deps.mmd (`changed`):
- S7UC1 (disconnect handler), S7UC2 (infra), S7UC3 (SPA survivor UX), S7UC4 (prod validation)

## Budget state at run start

- WAF IP set oxo-test-runner-ips: EMPTY (0 addresses) — clean state
- oxo-connect-attempts table: 0 items — full budget available
- IMP-008 exemption approach: use `make waf-runner-ip-add` before smoke suite; remove via always-cleanup after

## Changed node -> spec coverage map

| Changed node | Covering spec(s) | Status |
|---|---|---|
| wsfn ($disconnect) | disconnect.skeleton.spec.ts (both directions) | WRITTEN + PASS |
| wsfn ($disconnect) | slice007-disconnect.smoke.spec.ts | WRITTEN + PASS |
| conn (GetItem) | slice007-disconnect.smoke.spec.ts AC4.3/AC4.8 | WRITTEN + PASS |
| games (abandoned transition) | slice007-disconnect.smoke.spec.ts AC4.2 via DDB GetItem | WRITTEN + PASS |
| relay (1-post survivor notify) | disconnect.skeleton.spec.ts + S4 log query | PASS (logs confirmed) |
| cfwaf (IMP-008 scope-down) | slice005-h1-waf-ac3.1.spec.ts (regression check) | existing, passes |
| wsauth (exemption) | smoke-ci exemption add/remove flow + rate-exempt log line | CONFIRMED |
| attempts (EXEMPT# ns) | cleanup hygiene check | CONFIRMED clean |
| spaJoinScreen (forward edge) | disconnect.skeleton.spec.ts AC4.1B (guest-closes) | WRITTEN + PASS (retry-1) |
| spaOnlineDisconnect | disconnect.skeleton.spec.ts AC4.1 (host-closes) | PASS |

## Tick-off list

### Identity (principles/01)
- [x] I1: served build-sha from SPA meta matches sha under test (e078ea4b74...)

### Two-browser disconnect — BOTH directions
- [x] D1: HOST closes during active game; GUEST (survivor) sees "Your opponent disconnected." <=10s, returns to mode selector (F1/T2, AC4.1) — disconnect.skeleton.spec.ts PASS (first attempt clean)
- [x] D2: GUEST closes during active game; HOST (survivor) sees "Your opponent disconnected." <=10s, returns to mode selector — disconnect.skeleton.spec.ts AC4.1B PASS (retry-1; first attempt was WS pairing timeout in sequential connect; S007-RENDER-FIX confirmed green in prod)

### DDB state checks (post-active-disconnect)
- [x] D3: AC4.2 — GetItem(Games, gameId=7e8b7d21-...) shows status=abandoned after active-game disconnect (T1) — CONFIRMED via direct DDB GetItem
- [x] D4: AC4.3 — Connection row deletion confirmed by proxy (T3) — handler ran DeleteItem branch; waiting-host status=waiting confirms correct branching

### Terminal-not-overwritten (T4)
- [x] D5: AC4.4 — Played to win, closed host tab post-game-over; guest stayed on win screen; no spurious disconnect message received; terminal-not-overwritten confirmed (T4 PASS)

### S4 Logs Insights relay-count pin (OI-35)
- [x] D6: AC4.6 — Logs Insights confirmed: 20+ disconnect-notify posted=1 lines for active-game disconnects; all posted=0 correspond to waiting/terminal/no-row disconnects; amplification bound = exactly 1 per active disconnect (S3 CONFIRMED)

### Waiting-host thin path (T5)
- [x] D7: AC4.8 — Host created game (status=waiting), no guest, host closed tab; GetItem via code-index GSI confirmed status=waiting (NOT abandoned); T5 PASS

### New-game after disconnect (F2/T6)
- [x] D8: AC4.5 — After opponent-disconnected transition, clicking Online started fresh create flow code="WFK8GT"; no prior state leaks; no reload; T6 PASS

### Local/AI regression (F4)
- [x] D9: AC4.7 — Local two-player X wins without regression; vs-AI game completed without regression (PASS)

### S5 IAM grant pin
- [x] S1: AC2.1/AC2.2 — ws-fn IAM policy has GetItem on Connections (ConnectionsRead Sid); no Query/Scan/wildcard on Connections; no new tables; all s006 grants intact (validation spec PASS 3/3)

### S6 WAF regression
- [x] S2: AC4.9 / AC2.6 — WAF IP set oxo-test-runner-ips present; NOT(IPSetReferenceStatement) scope-down confirmed; block semantics for non-runner IPs unchanged; WAF validation spec green when exemption not active

### IMP-008 budget hygiene
- [x] BH1: runner IP 88.97.176.116/32 added before smoke, removed after with waf-runner-ip-remove (always-cleanup). EXEMPT# item written+removed. WAF IP set empty post-cleanup. No lingering exemption.
- [x] BH2: rate-exempt log line confirmed in CloudWatch: {"buildSha":"fa08637...","effect":"Allow","reason":"rate-exempt","sourceIp":"88.97.176.116","count":41} (s007a observable confirmed in prod)

### T7 (idle-timeout posture)
- [x] T7: documented posture confirmed — disconnect-notify structured log carrier present with buildSha field; handler runs on any $disconnect trigger; FINDING: buildSha="unknown" in ws-fn (BUILD_SHA env var not injected in oxo-ws-fn lambda; fallback 'unknown' used — not a blocking failure, carrier structurally present)

## Specs created

1. `tests/skeleton/disconnect.skeleton.spec.ts` — AMENDED: added guest-closes direction (AC4.1B); covers spaJoinScreen S007-RENDER-FIX
2. `tests/smoke/slice007-disconnect.spec.ts` — NEW: covers AC4.1/AC4.1B/AC4.4/AC4.5/AC4.7/AC4.8 + DDB proxy checks
3. `tests/validation/slice007-disconnect.spec.ts` — NEW: covers S5 IAM (AC2.1+AC2.2), S4 Logs Insights (AC4.6), T7 posture (AC1.9)

## Spec amendments (stale pins corrected)

- `tests/smoke/slice006-move-relay.spec.ts`: KNOWN_DEPLOYED_SHA updated from ecd8c37 to e078ea4b744085db320aa1c9eff4d018fabc6785 (s007 deploy sha)
- `tests/validation/slice005-h2-connect-auth.spec.ts`: T9 EXPECTED_SHA updated from 40b7767 to fa08637 (s007a authorizer sha)

## Pre-existing failures (NOT caused by s007, NOT blocking)

These were in the DORA ledger before s007 validation:
- slice005-validation F4/T5: WS 3-context pairing timeout in 7-worker parallel run (per-IP budget under load)
- slice005-aws-policy T2+T3, T5: WS pairing timeout (same cause)
- slice006-move-relay S1a: pairBrowsers timeout in parallel 7-worker run (known from DORA 17:01:45)
- slice005-h2-burst AC6.1+AC6.2: rate-limit burst test fails while IP is exempt (expected by design)
- slice005-h1-waf-ac3.1 AC3.1: WAF rate-block test fails while runner IP is in WAF exemption set (expected by design)
- slice005-h2-connect-auth AC5.5: ws-fn invocation count exceeds baseline while exemption active (expected by design)

## Findings (§12a)

1. FINDING: BUILD_SHA env var not injected into oxo-ws-fn lambda. All disconnect-notify log lines show buildSha="unknown". The principles/01 carrier is structurally present (field exists, non-empty) but sha is not meaningful. Engineering note: inject BUILD_SHA at Lambda deploy time (same pattern as oxo-ws-auth-fn which shows the real sha).

2. FINDING: Direct connectionId extraction at smoke test level is not possible without a data-testid on the WS connection in the SPA. AC4.3 direct GetItem(Connections, connectionId) check requires the connectionId to be surfaced. Coverage gap: confirmed by proxy (waiting-host status=waiting, game status=abandoned), but direct Connections DeleteItem confirmation uses only proxy evidence.

3. FINDING: ACTIVE_GAME_ID / TERMINAL_GAME_ID env vars not wired from smoke spec to validation spec at runtime. AC4.6 S4 pin runs as best-effort (last 5-min window) rather than pinned to specific gameIds. Improvement: wire gameIds between smoke and validation spec invocations.
