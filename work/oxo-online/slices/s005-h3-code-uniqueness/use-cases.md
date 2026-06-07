---
slice: s005-h3-code-uniqueness
authored-by: product (co-author iteration 12)
process: §37 (v18)
---

# Use cases — s005-h3 code uniqueness

## Overview

This is a small backend hardening slice — four use cases is the honest
decomposition. The mechanism is a hexagonal port + DynamoDB conditional write +
infra enabler + validation. The customer-observable surface is the integrity
guarantee itself: a joiner always reaches the right game.

## Parallel / serial call

UC1 (port + adapter) and UC3 (infra: Codes table + IAM grant) can be built in
parallel — they share no code dependency and can land in separate PRs or be
built by the same engineer in sequence without a gate between them. UC2 (create-
game integration) depends on UC1's port interface being stable before wiring
begins (UC1 → UC2). UC4 (validation) depends on all three prior UCs being
deployed and exercisable (UC1+UC2+UC3 → UC4). So the dependency graph is:

  UC1 ─┐
       ├─> UC2 ─> UC4
  UC3 ─┘

At one-engineer serial: UC1 → UC3 → UC2 → UC4 is fine. At two engineers:
UC1 and UC3 in parallel, then UC2, then UC4.

---

## UC1 — CodeReservationPort: port interface + adapters

**Actor:** engineer (build-time); oxo-game-fn create handler (runtime).

**Trigger:** engineer creates the port interface and both adapters before UC2
wires the create handler.

**Observable outcome:** `CodeReservationPort` interface defines `reserve(code,
gameId): Promise<void>` throwing a typed `CodeCollision` on conflict; the
DynamoDB adapter issues a conditional `PutItem` with
`ConditionExpression=attribute_not_exists(code)` and maps
`ConditionalCheckFailedException` to `CodeCollision`; the in-memory local
adapter (`Map<code, gameId>`) throws `CodeCollision` when the key is already
present — reproducing the reject branch shape for local tests and SM-1/SM-4
injection tests. Any non-collision DynamoDB error from the real adapter is NOT
mapped to `CodeCollision` (it propagates as-is, triggering the 5xx path in
UC2).

**Done condition:** UC1 is done when the port + both adapters compile, the
in-memory adapter's collision branch can be exercised by a unit test that pre-
seeds a code and calls `reserve` a second time expecting `CodeCollision`, and the
DynamoDB adapter asserts `ConditionExpression=attribute_not_exists(code)` in its
write call — independently of UC2 or UC3 being done.

**Acceptance cases:** AC-6 (code-policy pin: `attribute_not_exists(code)` in
source/synth), UC1 unit-test for collision branch.

**Dependencies:** none — UC1 is a free-standing seam (no runtime dependency on
the Codes table until wired in UC2+UC3).

---

## UC2 — Create-game integration: reserve-before-write + retry loop + retry-cap 5xx

**Actor:** a player calling `POST /api/games`; oxo-game-fn create handler.

**Trigger:** `POST /api/games` arrives at the Lambda handler.

**Observable outcome:** the handler calls `CodeReservationPort.reserve(code,
gameId)` before the existing `Games` PutItem; on `CodeCollision` it generates a
fresh code and retries, up to N=5 total attempts; on the 6th consecutive
collision it returns HTTP 500 `{ error:"Could not create game" }` with no wsToken
and emits one structured log line `reason:"code-reservation-exhausted"` carrying
attempt count and `buildSha`; any non-collision error from the port propagates
immediately to the existing 5xx path; on the happy path the client response
`{ gameId, code, wsToken }` is identical to today (contract unchanged). The Games
PutItem item shape is unchanged.

**Done condition:** UC2 is done when (a) AC-1 (injection: pre-seeded collision →
retry → 201 with fresh code) passes, (b) AC-4 (retry-cap mock: 6 consecutive
collisions → HTTP 500, no wsToken, structured log emitted) passes, (c) AC-3
(contract: 201 `{ gameId, code, wsToken }`, p95 < 3s) passes — all three
independently of UC3 being deployed to prod (the in-memory adapter enables (a)
and (b) locally).

**Acceptance cases:** AC-1 (UC2), AC-3 (UC2), AC-4 (UC2).

**F-case:** F1, F2, F3 (see acceptance.md).

**Dependencies:** UC1 (port interface must be stable before handler is wired).

---

## UC3 — Infra: Codes table + scoped IAM grant + synth/policy pins

**Actor:** engineer / CDK / AWS; `oxo-deploy` pipeline.

**Trigger:** OxoGameStack CDK synthesises and deploys.

**Observable outcome:** a DynamoDB `Codes` table exists with PK `code` (String),
no sort key, TTL attribute `ttl`, on-demand billing, SSE (AWS-owned key), PITR
OFF. `oxo-game-fn` execution role holds exactly `dynamodb:PutItem` on the
`Codes` table ARN and nothing else on `Codes` (no DeleteItem, GetItem, Query,
Scan, UpdateItem, no GSI ARN, no wildcard). No other principal or trust boundary
is touched.

**Done condition:** UC3 is done when AC-5 (IAM pin: EXACTLY PutItem on Codes ARN,
negatives asserted) and AC-7 (orphan-harmless: orphan Codes row does not affect
the join path) pass independently — i.e. the synth/policy test can run before
the create-handler code change is deployed.

**Acceptance cases:** AC-5 (UC3), AC-7 (UC3).

**Dependencies:** none — infra is parallel to UC1.

---

## UC4 — Validation (tester): storage-atomicity proof + prod pins

**Actor:** tester; real DynamoDB in prod-class environment.

**Trigger:** tester executes the validation plan after UC1+UC2+UC3 are deployed.

**Observable outcome:** AC-2 (50-concurrent-distinct codes: all 50 returned
codes distinct, no duplicate code PK in `Codes`, no two `waiting`/active `Games`
items sharing a code — storage-atomicity proof against real DynamoDB) passes;
AC-1 prod-path variant passes; AC-3 p95 latency passes; AC-5 and AC-6 pin
assertions verified in deployed synth; AC-7 orphan-harmless verified (forced
Games-write failure → orphan Codes row, join unaffected).

**Done condition:** UC4 is done when all seven ACs (AC-1 through AC-7) pass in
the prod-class environment and the tester signs off.

**Acceptance cases:** AC-1 (prod path), AC-2, AC-3, AC-4 (unit), AC-5, AC-6, AC-7.

**Dependencies:** UC1, UC2, UC3 (all must be deployed before the prod validation
plan is executable).

---

## Dependency summary

| UC  | Depends on | Can start when          |
|-----|------------|-------------------------|
| UC1 | —          | immediately             |
| UC3 | —          | immediately (parallel to UC1) |
| UC2 | UC1        | UC1 port interface stable |
| UC4 | UC1, UC2, UC3 | all three deployed     |

## Acceptance case ↔ UC coverage map

| AC  | Description                                  | UC primary | UC also    |
|-----|----------------------------------------------|------------|------------|
| AC-1 | Injection: collision → retry → 201 fresh code | UC2       | UC4 (prod) |
| AC-2 | 50-concurrent distinct (real DDB atomicity)  | UC4        | —          |
| AC-3 | Client contract unchanged, p95 < 3s          | UC2        | UC4        |
| AC-4 | Retry-cap → HTTP 500, no wsToken, log emitted | UC2        | —          |
| AC-5 | IAM pin: exactly PutItem on Codes ARN, negatives | UC3    | UC4        |
| AC-6 | ConditionExpression pin: attribute_not_exists(code) | UC1 | UC3, UC4   |
| AC-7 | Orphan-harmless: join path unaffected        | UC3        | UC4        |
| F1  | Joiner always reaches their game             | UC2        | UC4        |
| F2  | Player sees no change (same code, same UX)   | UC2        | —          |
| F3  | Exhaustion: clear "couldn't create" not silent wrong code | UC2 | UC4 |
