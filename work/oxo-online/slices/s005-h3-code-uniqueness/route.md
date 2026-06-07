# Route — s005-h3 code uniqueness (engineer, SOLO serial)

Routed against the change-impact model (class-deps.mmd / data-flow.mmd s005-h3
marks present). Build order is a §19 schedule constraint: NEVER push reserve-call
code (UC2) before the Codes table exists (UC3 deployed). cicd confirmed single
combined infra+lambda pipeline OR infra-first. Serial order: UC1 → UC3 → UC2 → probe.

Each step is red→green→commit-on-trunk. Suites that must be green per commit:
make test-lambda, test-infra, synth-infra, test-local.

## UC1 — CodeReservationPort (hexagonal seam) — no runtime dep on Codes table

1. RED: `src/lambda/games/codes/ports.ts` — define `CodeReservationPort.reserve(code, gameId): Promise<void>`
   + typed `CodeCollision extends Error`. Pure domain types, zero SDK.
2. RED: `src/lambda/games/codes/ddb-code-reservation.test.ts` — assert the DynamoDB
   adapter issues a `PutCommand` to the Codes table with
   `ConditionExpression === 'attribute_not_exists(code)'` (AC-6 source pin),
   maps ConditionalCheckFailed → CodeCollision, and a NON-collision DDB error
   propagates as-is (NOT CodeCollision). Code↔policy pin: adapter only ever
   issues PutCommand (no Get/Update/Delete/Query/Scan command types).
   GREEN: `src/lambda/games/codes/ddb-code-reservation.ts`.
3. RED: `src/app/local/adapters/local-code-reservation.test.ts` — in-memory
   `Map<code, gameId>` adapter throws CodeCollision when key already present;
   §12a caution noted (branch SHAPE not real CAS atomicity).
   GREEN: `src/app/local/adapters/local-code-reservation.ts`.
4. Update class-deps.mmd: add portCodeReservation + adapterCodeReservationDdb +
   adapterLocalCodeReservation nodes (classDef changed), trace ACTUAL edges.
5. COMMIT (UC1): "Add CodeReservationPort seam + DDB/local adapters (UC1, AC-6 ConditionExpression pin)".

## UC3 — infra: Codes table + scoped IAM grant + synth pins (commit at/before UC2, §19)

6. RED: extend `src/infra/test/game-stack.test.ts` — Codes table shape (PK=code S,
   TTL on ttl, SSE, PAY_PER_REQUEST, no GSI); resourceCount 4 tables; AC-5 IAM pin:
   oxo-game-fn gains EXACTLY dynamodb:PutItem on the Codes ARN and NOTHING else on
   Codes (negatives: no Delete/Get/Query/Scan/Update, no GSI ARN, no wildcard).
   GREEN: add Codes table + `gamesTable`-style `codesTable.grant(gameFunction, 'dynamodb:PutItem')`
   + CODES_TABLE env on gameFunction + BUILD_SHA env on gameFunction (build identity).
7. make test-infra + synth-infra green.
8. COMMIT (UC3): "Add Codes reservation table + scoped PutItem grant on game-fn (UC3, AC-5 IAM pin, AC for table shape)".

## UC2 — create-game integration: reserve-before-write + retry-cap → 5xx

9. RED: extend `src/lambda/games/handler.test.ts` — inject CodeReservationPort fake:
   - AC-1: collision on attempt 1 (generateCode mocked XXXXXX then fresh) → 201 with fresh code ≠ XXXXXX; reserve called with the fresh code; Games PutItem carries fresh code.
   - AC-4: 6 consecutive collisions → HTTP 500 {error:"Could not create game"}, NO wsToken, ONE structured log reason:"code-reservation-exhausted" with buildSha + attempt count; never a duplicate code.
   - contract-unchanged: happy path 201 {gameId, code, wsToken} (existing tests stay green).
   - non-collision error from reserve → straight 500 (do not mask infra fault as collision).
   GREEN: wire `CodeReservationPort` into `createHandler` deps; reserve-before-Games-write; N=5 retry loop with FRESH generateCode each redraw; structured log on exhaustion. Default export wires the DDB adapter + buildSha + log.
10. make test-lambda + test-local green.
11. COMMIT (UC2): "Wire reserve-before-write retry-cap into create-game handler (UC2, AC-1, AC-4, contract-unchanged)".

## Probe — §11a committed prod probe (post-deploy)

12. `scripts/uniqueness-probe.js` — fires N concurrent POST /api/games, asserts all
    codes distinct + no duplicate Codes PK (SM-2 proof). Committed; `make uniqueness-probe`
    target. NOTE: `make uniqueness-probe *` not yet allowlisted → flag cicd; the
    underlying `node work/oxo-online/scripts/* *` IS allowlisted so the script runs.
13. COMMIT (probe): "Add uniqueness-probe (§11a) + make target".

## Push & deploy

14. Push → infra pipeline deploys OxoGameProd (Codes table + PutItem grant + handler atomically).
15. WATCH to success (gh run watch). App pipeline RED on s008 sha-gate (OI-40) is NOT mine.
16. Run uniqueness-probe against prod; DORA deploy + validation rows.

class-deps marks left for the tester; cleared only at slice delivery.
