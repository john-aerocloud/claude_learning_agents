---
slice: s005-h3-code-uniqueness
iteration: 12
tester: tester (sonnet)
status: complete
last-validated-sha: 24ab651 (s008)
sha-under-test: 74caf25
validation-outcome: PASS
---

# Test Plan — s005-h3 Code Uniqueness (UC4 in-prod validation)

## Change map diff (24ab651 → HEAD 74caf25)

Source: class-deps.mmd `s005h3changed` marks + data-flow.mmd `codes` node / `gamefn→codes` edge.

Changed nodes:
- [N1] portCodeReservation — NEW domain-defined port (games/codes/ports.ts): `reserve(code, gameId)` throws `CodeCollision`
- [N2] adapterCodeReservationDdb — NEW cloud adapter (games/codes/ddb-code-reservation.ts): conditional PutItem `attribute_not_exists(code)` on Codes table
- [N3] adapterLocalCodeReservation — NEW local adapter (src/app/local/adapters/local-code-reservation.ts): in-memory Map reject-branch shape
- [N4] gamesCreateHandler — CHANGED handler (games/handler.ts): reserve(code,gameId) BEFORE Games PutItem; CodeCollision->retry (N=5); exhausted->5xx

Changed data-flow nodes/edges:
- [D1] codes — NEW store node: oxo-codes table, PK=code, conditional PutItem CAS, write-gate only
- [D2] gamefn→codes — NEW edge: reserve BEFORE Games PutItem, collision=>retry

## Acceptance cases → spec coverage map

| AC | Changed node | Spec | Status |
|----|-------------|------|--------|
| AC-1 / SM-1: collision injection retries to fresh code | N4, portCodeReservation | handler.test.ts @covers gamesCreateHandler (unit-pinned) | PASS (unit-pinned) |
| AC-2 / SM-2: 50 concurrent → 50 distinct codes; Codes table scan no duplicate PK | D1, D2, N2 | slice005-h3-code-uniqueness.spec.ts (new) | PASS distinct=50/50 p95=246ms; DDB scan 231 items 0 dups |
| AC-3 / SM-3: 201 {gameId,code,wsToken} unchanged; p95 < 3s across batch | N4 | slice005-h3-code-uniqueness.spec.ts (new) | PASS p95=246ms |
| AC-4 / SM-4: retry-cap → 500 {error:"Could not create game"}, no wsToken | N4 | handler.test.ts @covers gamesCreateHandler (unit-pinned) | PASS (unit-pinned) |
| AC-5: IAM pin — game-fn role = PutItem on Games+Codes ARNs; no Delete/Get/Scan on Codes | N2, D1 | slice005-h3-code-uniqueness.spec.ts (new) | PASS |
| AC-6: ConditionExpression pin present in deployed adapter | N2 | ddb-code-reservation.test.ts @covers adapterCodeReservationDdb (unit-pinned) | PASS (unit-pinned) |
| AC-7: orphan-harmless: Games-write-fail leaves orphan Codes row; join path unaffected | D1, D2 | slice005-h3-code-uniqueness.spec.ts F3/AC-7 | PASS (no GSI; join path unchanged) |
| F1-F3: integrity guarantee; no visible change; exhaustion UX | N4 | slice005-h3-code-uniqueness.spec.ts | PASS |

## OI-40 fix

- s006, s007, s008 smoke specs: replaced hardcoded `KNOWN_DEPLOYED_SHA` / `KNOWN_DEPLOYED_SHAS` arrays
  with dynamic `_resolveExpectedSha()` using `DEPLOY_SHA` env var (pipeline) or `git rev-parse HEAD` (local).
- This closes OI-40: the identity gate is now forward-compatible on every deploy.

## Stale spec fixed

- slice004-aws-policy.spec.ts T3: was asserting PutItem on oxo-games ARN ONLY.
  s005-h3 widened to Codes+Games. T3 amended to assert both ARNs and tighten
  the assertion to "no other DynamoDB actions". Now PASS.

## Tick-off (COMPLETE)

- [x] Read tester.md (plan from change map)
- [x] Diff model 24ab651..HEAD
- [x] Map changed nodes → specs
- [x] Confirm unit pins (AC-1, AC-4, AC-6) are still valid for changed contracts
- [x] Write test-plan.md
- [x] Write slice005-h3-code-uniqueness.spec.ts (AC-2/SM-2/AC-3/AC-5 + F1-F3)
- [x] Fix OI-40 in s006/s007/s008 smoke specs
- [x] Fix stale T3 spec in slice004-aws-policy.spec.ts
- [x] Run slice005-h3 validation spec: 6/6 PASS
- [x] SM-2: 50 concurrent POST /api/games → distinct=50/50; p95=246ms
- [x] DDB scan oxo-codes: 231 items, 0 duplicate PKs
- [x] AC-5 IAM PASS: PutItem on Games+Codes; no Scan/Get/Delete on Codes
- [x] Write result.md
- [x] Clear s005h3changed marks in class-deps.mmd + data-flow.mmd
- [x] DORA rows (task_start, validation_run, task_end pending)
