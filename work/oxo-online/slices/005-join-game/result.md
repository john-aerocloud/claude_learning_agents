---
slice: 005-join-game
iteration: 6
tester: tester
validated-at: 2026-06-06T14:57Z
sha-under-test: ff06b15
deploy-run: 27065309179 (green)
smoke-suite: 38/38
validation-suite: 14/14
outcome: PASS
---

# Slice 005 — Join Game by Code: Validation Result

## Success Measures vs Observed

| SM | Measure | Observed |
|----|---------|---------|
| SM1 | Both players see the game board with role labels within 3s | PASS — F1/T1: guest board in 318ms; host X / guest O confirmed |
| SM2 | Games record active with both connectionIds populated | PASS — T2: status=active, hostConnId and guestConnId non-empty and distinct |
| SM3 | Invalid code shows readable error | PASS — F3/T4: "Game not found. Check the code and try again." shown; code retained |
| SM4 | Already-active game is rejected | PASS — F4/T5: "This game is no longer available." shown; guestConnectionId unchanged (no-hijack) |
| SM5 | Connections table populated with ~2h TTL | PASS — T3: host TTL delta=7201s, guest TTL delta=7201s (target 7200s +/-300s) |
| SM6 | Existing modes unaffected | PASS — F8 regression: Two-Player X-wins in 225ms; vs-Computer Draw/O-wins confirmed |
| SM7 | Pipeline deploys cleanly | PASS — deploy run 27065309179 green (Install/Lint/Test/Build + Deploy to Production) |

## Per-Acceptance-Case Table

| Case | Description | Result |
|------|-------------|--------|
| F1/T1 | Two-context pairing: both reach board, host=X guest=O within 3s | PASS (318ms) |
| F2 | Games record active with both connectionIds | PASS (via T2 validation) |
| F3/T4 | Unknown code: error shown, join screen remains, code retained | PASS |
| F4/T5 | Already-active game: second joiner rejected, no hijack | PASS (close 4041, record byte-identical) |
| F5 | Connections table with ~2h TTL | PASS (via T3 validation, delta=7201s) |
| F6 | Host waiting screen shows connecting indicator; code remains | PASS |
| F7 | Board squares inert after pairing; status line persists | PASS (9/9 cells disabled; status line correct) |
| F8 | Regression: local two-player and vs-AI complete | PASS |
| F9/S3 | WS config absent: readable error, no white-screen | PASS ("Something went wrong. Please try again.") |
| F10 | Pipeline deploys cleanly | PASS (run 27065309179) |
| T2+T3 | Live pairing: Games record active, Connections ~2h TTL | PASS |
| T5 | No-hijack: second join closes 4041; Games record unchanged | PASS |
| T8 | oxo-ws-fn reserved concurrency=15; rate=20 burst=40 | PASS |
| T9 | Connections table: SSE=ENABLED, PAY_PER_REQUEST, PK=connectionId | PASS |
| S1 | oxo-ws-fn DynamoDB grants: exact delta, no wildcard, no extra tables | PASS |
| S2 | ManageConnections scoped to this WS API ARN only | PASS (resource contains API id + prod stage + connections path) |
| S4 | oxo-deploy: WS extension ARN-scoped; no iam:Create/Attach/Put | PASS |

## Suite Counts

- Smoke (tests/smoke): 38/38 passed — sha 15c32c9, deploy run 27065309179
- Validation (tests/validation): 14/14 passed — sha ff06b15

## CloudWatch Check

No ERROR events in /aws/lambda/oxo-ws-fn in the last 1 hour. No unhandled exceptions, no timeouts on the happy/4040/4041 paths. All 544 events in the window were START/END/REPORT lines.

## DEFECT-005-001 Two-Round Defect Story

### Round 1 — Initial Failure (opened 2026-06-06T13:20:01Z)

Tester ran smoke at sha 8449f07 and found:
- F1/T1 FAIL: WS close mechanism broken — Lambda non-2xx does not send custom close codes; register handler raised ConditionalCheckFailedException on null hostConnectionId.
- F3/T4/T5 FAIL: error codes not delivered correctly.
- Result: 34/38 smoke, 12/14 validation.

Engineer R1 fix at sha c2c6169:
- Added error-frame + DELETE drain pattern for close codes.
- Tester re-validated at sha 0fa1187 — STILL FAIL: register called UpdateItem on Connections (IAM denied PutItem vs UpdateItem confusion) causing F1/T1 failure. F3/T4 error message race condition. 34/38 smoke, 12/14 validation.

### Round 2 — R2 Fix (sha 736f7b6, infra; sha ff06b15, spec fix)

Engineer R2 fixed five root causes:
1. register handler: UpdateItem on Connections -> PutCommand (correct operation matching IAM grant).
2. Server drain: error frame + DELETE with proper await to eliminate race condition.
3. Client grace: close event handler with short delay for error frame processing.
4. GONE-host join fan-out: returns 4041 (not masking 4500) when host connection is gone.
5. config.js load order: moved before the bundle script in index.html so OXO_CONFIG.wsUrl is defined when the app initialises.
6. CSP wss connect-src: added wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com so the browser can open the WebSocket.

Two remaining tester harness defects:
- F7 smoke spec: used .click() on disabled <button> elements; Playwright actionability check blocks ~30s. Fixed to .toBeDisabled() assertions.
- Validation spec: JSDoc block comment contained non-ASCII section sign (U+00A7) and @connections patterns that esbuild/Babel parsed as decorator annotations, causing SyntaxError at parse stage (0/14 ran). Fixed by rewriting the header as a plain ASCII block comment.

### Recovery

- MTTR: 1h 36m 47s (failure 2026-06-06T13:20:01Z to recovery 2026-06-06T14:56:48Z)
- Deploy run 27065309179 — green
- 38/38 smoke + 14/14 validation — both green
- No CloudWatch unhandled errors

## Commit SHAs

- F7 spec fix commit: 15c32c9
- Validation spec fix + ledger commit: ff06b15
- Engineer R2 infra deploy: 736f7b6
