# Delta 009 — Guaranteed code uniqueness at create (s005-h3, OI-3)

Closes the last C4 hardening residual (OI-3): a code collision between two
`waiting`/`active` games can no longer produce a wrong-game join. The guarantee
must hold at the STORAGE layer (atomic), not in Lambda memory, so concurrent
`oxo-game-fn` invocations cannot race to the same code.

NEW platform integration mechanism? **NO.** Conditional `PutItem` with
`attribute_not_exists` is the same CAS class already in production
(s005/s006/s007 conditional `UpdateItem`). A second DynamoDB table is not a new
mechanism class (DynamoDB + scoped Lambda grant already exist). No walking-
skeleton probe required — covered by the existing synth contract + the SM-1/SM-2
injection tests below.

---

## Mechanism decision — `Codes` reservation table (conditional PutItem)

### The honest atomicity question (the s006 discipline: name what it GUARANTEES)

DynamoDB cannot enforce uniqueness on a **non-key** attribute in a single
`PutItem`. `code` is not a key on `Games` (PK is `gameId`); the existing
`code-index` GSI gives no write-time uniqueness — GSIs are eventually consistent
and a `ConditionExpression` on a `PutItem` can only read the SAME item's key, not
"does any other item hold this code". So:

- **Rejected — single conditional `PutItem` on `Games` guarded by the GSI:**
  cannot work. There is no condition expressible on the `Games` `PutItem` that
  observes another item's `code`. A design that "looks atomic" here is not. (This
  is exactly the s006 trap — do not specify an apparent-atomic that isn't.)

- **Rejected — `TransactWriteItems` (Games item + a `code#<code>` marker item,
  both conditional, one transaction):** this DOES truly guarantee it and avoids
  the orphan question (both items commit or neither). But it costs 2x WCU per
  create, requires the marker table/partition anyway, and couples the create
  write to a transaction the retry loop must unwind on `TransactionCanceled`
  (collision) by parsing cancellation reasons. More moving parts than the
  invariant needs at hobby volume. Held in reserve as the reversal if the orphan
  posture below ever proves insufficient.

- **CHOSEN — dedicated `Codes` table, `code` as PK, conditional `PutItem`
  `attribute_not_exists(code)`:** the code IS a key on this table, so the
  condition is a true single-item CAS. The first writer to reserve `XXXXXX` wins
  atomically; a concurrent second writer gets `ConditionalCheckFailedException`
  and retries with a fresh code. **What this GUARANTEES:** at most one live
  reservation per code value across all concurrent invocations — a hard,
  storage-enforced, race-free uniqueness invariant on the reservation. No
  in-memory window exists.

### Write order and the orphan question (named, not hand-waved)

Two writes per successful create: (1) reserve the code on `Codes`, (2) write the
game on `Games`. Order and failure semantics:

1. **Reserve first:** conditional `PutItem` to `Codes`
   `Item={code, gameId, ttl}` with `ConditionExpression=attribute_not_exists(code)`.
   - Success → the code is now exclusively ours.
   - `ConditionalCheckFailedException` → collision; generate a fresh code, retry
     (bounded, below). This is the ONLY retryable branch.
2. **Then write the game:** the existing `PutItem` to `Games` (unchanged item
   shape). If THIS fails, the `Codes` reservation is an **orphan** (a reserved
   code pointing at a game that does not exist).

**Orphan handling — the reservation carries its own TTL, equal to the Games TTL
(24h), and the orphan is harmless for that window:**
- An orphaned `Codes` row reserves a code string but the join path NEVER reads
  `Codes` — join resolves a code via the `code-index` GSI on `Games` (unchanged,
  s005). An orphan reservation with no matching `Games` item simply makes that
  one code unavailable for ~24h, then the `Codes` TTL lazily deletes it. With
  ~1e9 codes that is a negligible, self-healing capacity loss, not a correctness
  defect. No compensating delete, no saga, no cleanup job.
- We do NOT add a best-effort `DeleteItem` of the reservation on the Games-write
  failure path: a delete that itself can fail buys nothing the 24h TTL doesn't
  already give, and an extra failure-path call is extra surface. (`DeleteItem`
  grant is therefore NOT requested — see IAM delta. Reversal: add it only if
  orphan-rate observability ever shows pressure, which at 1e9 codes it will not.)
- **The reservation is NOT the authoritative join pointer.** Join authority stays
  on `Games`/`code-index` exactly as today. `Codes` is a write-time uniqueness
  gate only. This keeps the consistency model single-authority and avoids a
  two-source-of-truth split for lookups.

### Retry-cap behaviour (SM-4, §5a — a 5xx WE own)

- The reserve→retry loop is bounded at **N = 5** fresh-code attempts.
- Each attempt generates a NEW code (`generateCode()`) and re-issues the
  conditional `PutItem`. Only `ConditionalCheckFailedException` retries; any
  other DynamoDB error is NOT a collision and breaks out to the 5xx path
  immediately (do not mask an infra fault as a collision).
- On the 6th consecutive collision (5 retries exhausted) the handler returns
  **HTTP 500** with the existing opaque body `{ error: "Could not create game" }`
  — NEVER a wrong/duplicate code. No `wsToken` is minted on this path (matches
  the existing 5xx contract in `handler.ts`).
- This is a **5xx WE own** (process v30 §5a): it is structured-logged with a
  distinct reason (`reason:"code-reservation-exhausted"`, plus the attempt count
  and `gameId`-less context — the gameId was never committed). At hobby volume
  this path is effectively unreachable (5 consecutive collisions ≈ (1/1e9)^... );
  it exists to make the invariant total, and it is unit-test-reachable by mocking
  `generateCode` to return a pre-seeded colliding code 6x.
- **Retry posture (this is an internal AWS-SDK call, not an external call):** the
  collision retry is NOT a backoff retry — a collision is deterministic given a
  fresh random draw, so the "backoff" is simply "draw again immediately" (no
  delay; delay would only add latency with zero benefit since each draw is
  independent). The SDK's own transient-error retry (default adaptive, 3
  attempts, jittered) still applies to the underlying `PutItem` for throttling/5xx
  from DynamoDB itself — left at SDK default. Timeout budget unchanged: handler
  stays at the 3s Lambda timeout; 5 immediate redraws are sub-millisecond of CPU
  plus ≤5 extra single-item writes, well inside budget (SM-3 p95 < 3s holds).

---

## What changes

### DynamoDB `Codes` table (NEW)
- Partition key: `code` (String). No sort key.
- Attributes: `code` (PK), `gameId` (String, for diagnosability only — NOT read
  by any lookup path), `ttl` (epoch seconds, +24h — matches Games TTL).
- Billing: on-demand. Encryption: AWS-owned key (SSE default). TTL: `ttl`,
  enabled (lazy deletion — see data-flow node semantics). PITR: OFF (ephemeral
  reservation data, deliberate cost choice, consistent with `Games`).
- Reached only via `oxo-game-fn`; no public endpoint.

### `oxo-game-fn` (create path) — reserve-before-write
- The create flow gains the reserve step (conditional `PutItem` on `Codes`) ahead
  of the existing `Games` `PutItem`, inside a bounded retry loop. Item shape of
  the `Games` write and the **client response `{ gameId, code, wsToken }` are
  UNCHANGED.**
- **Hexagonal seam (local standability, principles/02):** the create write today
  uses a module-global `ddb` client directly in `handler.ts` (no port — unlike
  `move` which uses `GameStorePort`). To make the conditional-reserve BRANCH
  reproducible locally and unit-testable (SM-1/SM-4), the engineer introduces a
  thin **`CodeReservationPort`** (one method, e.g. `reserve(code, gameId): Promise<void>`
  that throws a typed `CodeCollision` on `ConditionalCheckFailedException`) with:
  - a **DynamoDB adapter** (prod) issuing the conditional `PutItem`, and
  - a **local in-memory adapter** mirroring `LocalGameStore`'s established
    pattern — a `Map<code, gameId>` whose `reserve` throws `CodeCollision` when
    the key already exists. §12a caution applies VERBATIM: a JS map reproduces
    the reject BRANCH SHAPE, not real DynamoDB conditional ATOMICITY under genuine
    concurrency; the platform atomicity guarantee is covered by the
    code-policy pin (ConditionExpression `attribute_not_exists(code)` asserted in
    synth/source) + SM-2 prod-class concurrency test, NOT by the local adapter.

### IAM delta (the ONLY widening)
- `oxo-game-fn` execution role gains **`dynamodb:PutItem` on the `Codes` table
  ARN only**. Nothing else.
- Explicitly NOT requested: `DeleteItem` (orphans expire via TTL — see above),
  `GetItem`/`Query`/`Scan`/`UpdateItem` on `Codes`, any GSI ARN, any wildcard
  resource, any second principal. The slice.md mentioned a possible `DeleteItem`;
  this delta deliberately declines it as unnecessary surface.
- `oxo-deploy` gains nothing new beyond the `CodeReservationPort`/table being
  inside the existing `OxoGameStack` (already deployable by the existing
  function-ARN-scoped grants); no new IAM-mutation actions.

### OI-36 piggyback (BUILD_SHA on oxo-ws-fn) — DECLINED in this slice
This slice touches `oxo-game-fn` and the game stack, NOT `oxo-ws-fn`. Per the
slice note the architect decides: piggybacking the `oxo-ws-fn` `BUILD_SHA`
injection here would couple an unrelated WS-stack change into a Games-stack
hardening slice and widen blast radius for no shared mechanism. **OI-36 stays
deferred to a slice that genuinely opens the WS stack.** (Logged here so the
decision is visible, not silently dropped.)

---

## What does NOT change (client + system contract)
- **Client contract:** `POST /api/games` still returns `201 { gameId, code, wsToken }`,
  `code` still a 6-char Crockford-alphabet string, no new fields, no new error
  shape (the exhausted-retry path reuses the existing opaque 500).
- **Join/lookup path:** UNCHANGED. Join still resolves a code via `Games`
  `code-index` (s005). `Codes` is never on the read/join path.
- **`Games` table, GSI, item shape, TTL:** unchanged. `oxo-ws-fn`, the WS API,
  the authorizer, `Connections`, the move/disconnect paths: all unchanged.
- **`generateCode()` algorithm/alphabet:** unchanged (still CSPRNG, 31-char
  unambiguous alphabet, length 6). Only its CALLER changes (loop + reserve).
- **No new attack surface:** no new endpoint, no new principal, no new internet-
  reachable route. The only new flow is an internal `oxo-game-fn → Codes` write.

---

## Build-identity carrier (principles/01)
No new deployable surface is introduced (no new endpoint, no new Lambda, no new
client bundle). The create response already carries no version field; build
identity for `oxo-game-fn` remains its existing structured-log `buildSha`
field (unchanged). The new `code-reservation-exhausted` 5xx log line MUST be
emitted on that same logger so it inherits the `buildSha` field — assert it does.

---

## Local / prod gap (principles/02)
| Concern | Stands locally? | Control if cloud-only |
|---|---|---|
| Create flow + reserve→retry BRANCH (collision → fresh code) | YES — local in-memory `CodeReservationPort` adapter reproduces the `CodeCollision` reject branch; the engineer's SM-1/SM-4 injection tests run locally | — |
| Bounded-retry-then-5xx logic (SM-4) | YES — pure handler logic over the port; unit-testable locally with a mock that always collides | — |
| Real conditional-`PutItem` ATOMICITY under genuine concurrency (SM-2, 50-way) | NO — JS map cannot reproduce DynamoDB single-item CAS atomicity | code-policy pin on `ConditionExpression=attribute_not_exists(code)` (synth/source assert) + SM-2 prod-class concurrent-create validation |
| TTL lazy deletion of orphan reservations | NO — platform runtime semantic | covered by the lazy-deletion node annotation on the data-flow + the "orphan harmless for 24h" argument; no test needed (not on any read path) |
| IAM grant scoping (PutItem on Codes ARN only, no DeleteItem) | NO — IAM is cloud-only | synth contract test asserts the grant set (the SM IAM pin below) |

---

## Acceptance — technical/observable conditions (co-authored with Product → acceptance.md)

**T/S — Tester/Solution-architect-supplied observable conditions:**

- **AC-1 (SM-1, injection):** pre-seed a `waiting` game with code `XXXXXX`; mock
  `generateCode` to return `XXXXXX` on attempt 1 then a fresh code on attempt 2.
  `POST /api/games` returns 201; the returned `code` ≠ `XXXXXX`; a `Games` item
  exists with the fresh code; a `Codes` row exists for the fresh code. (Runs
  locally via the in-memory adapter AND as a prod-path test.)
- **AC-2 (SM-2 PIN — 50 concurrent distinct codes):** fire **N = 50** concurrent
  `POST /api/games`; ALL 50 returned codes are distinct AND `Codes` contains no
  duplicate `code` PK AND `Games` (via `code-index`) shows no two `waiting`/active
  items sharing a `code`. This is the storage-atomicity proof and MUST run against
  real DynamoDB (the local map cannot prove it).
- **AC-3 (SM-3, contract unchanged):** `POST /api/games` returns 201
  `{ gameId, code, wsToken }`, `code` 6-char Crockford alphabet, no new fields,
  p95 latency within 3s (reserve adds ≤1 extra single-item write on the happy
  path).
- **AC-4 (SM-4 PIN — retry-cap → 5xx, never a wrong code):** mock `generateCode`
  to return the same pre-reserved code on 6 consecutive draws; the handler returns
  **HTTP 500** (the opaque `{ error:"Could not create game" }`), mints NO wsToken,
  and emits ONE structured log line `reason:"code-reservation-exhausted"` carrying
  the attempt count and `buildSha`. It NEVER returns a duplicate code. Unit-test
  reachable.
- **AC-5 (IAM PIN — no widening beyond the named grant):** the synth/policy test
  asserts `oxo-game-fn` gains EXACTLY `dynamodb:PutItem` on the `Codes` table ARN
  and nothing else on `Codes` — assert the NEGATIVES: no `DeleteItem`, no
  `GetItem`/`Query`/`Scan`/`UpdateItem`, no GSI ARN, no wildcard resource. All
  pre-existing `Games`/`Connections`/logs grants unchanged.
- **AC-6 (code-policy pin):** the `Codes` reserve write's `ConditionExpression` is
  literally `attribute_not_exists(code)` (asserted in source/synth) — the
  uniqueness is enforced by the condition, not by code-side checking.
- **AC-7 (orphan-harmless):** a forced Games-write failure after a successful
  reservation leaves an orphan `Codes` row with a `ttl` ~24h ahead; the join path
  is unaffected (join never reads `Codes`); no error surfaces to a subsequent
  create with a different code.

---

## Security review

**New attack surface?** No new endpoint, route, or principal. The only new flow
is an internal `oxo-game-fn → Codes` conditional write — inside the existing
trust boundary, reached only by the existing execution role.

**New data flow?** One: `oxo-game-fn` writes a `{code, gameId, ttl}` row to the
new `Codes` table. No data leaves the system (response shape unchanged). `gameId`
on the reservation is server-generated; `code` is server-generated. No PII, no
client-controlled persisted field (the body is still untrusted; nothing from it
is written, consistent with delta 004 S1).

**New trust boundary / principal?** No. Same `oxo-game-fn` role, one new
ARN-scoped `PutItem` grant on one new table. No new role, no cross-account, no
new internet reachability.

**Data classification:** `Codes` holds ephemeral, non-PII, low-value reservation
tokens (the `code` is the same low-value shareable token already in `Games`).
Encrypted at rest, 24h TTL, no public endpoint, single scoped writer.

**Least privilege:** the grant is the minimal `PutItem` on the single new table
ARN. `DeleteItem` is explicitly declined (orphans expire via TTL). No read grant
on `Codes` (the create path only writes; join reads `Games`, not `Codes`).

### Security conclusion (VERBATIM)
This slice introduces NO new attack surface, NO new internet-reachable route, and
NO new principal or trust boundary beyond a single ARN-scoped `dynamodb:PutItem`
grant for the existing `oxo-game-fn` role on one new ephemeral, encrypted,
TTL-bounded, non-PII `Codes` table; the create→reserve→retry→5xx path is a
storage-layer CAS of the same class already in production and changes no client
contract, so the design carries no new material control or risk — per §9a this
auto-accepts.

Per-infra security note added: `architecture/security/dynamodb-codes.md`.
`dynamodb-games.md` updated to record that OI-3 is closed and uniqueness is now
storage-enforced via the `Codes` reservation (superseding the s005 "accepted
residual" line).
