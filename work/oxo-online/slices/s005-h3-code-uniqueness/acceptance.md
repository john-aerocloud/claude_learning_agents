# Acceptance — s005-h3 code uniqueness

Co-authored: Product (job framing) + Solution-architect (technical/observable
conditions). Mechanism + full rationale: `architecture/deltas/009-h3-code-uniqueness.md`.

## Technical / observable conditions (Solution-architect-supplied)

These map to the slice success measures (SM-1..SM-4) and become the tester's
plan. PIN = a hard gate condition called out by the orchestrator brief.

- **AC-1 (SM-1, synthetic-duplicate injection):** pre-seed a `waiting` game with
  code `XXXXXX`; mock `generateCode` to return `XXXXXX` on attempt 1, a fresh code
  on attempt 2. `POST /api/games` → 201; returned `code` ≠ `XXXXXX`; a `Games`
  item exists with the fresh code; a `Codes` row exists for the fresh code.
  (Runs locally via the in-memory `CodeReservationPort` adapter AND on the prod path.)

- **AC-2 (SM-2 PIN — 50 concurrent distinct codes):** fire **N=50** concurrent
  `POST /api/games`; ALL 50 returned codes distinct AND `Codes` has no duplicate
  `code` PK AND `Games`/`code-index` shows no two `waiting`/active items sharing a
  `code`. MUST run against real DynamoDB (the local map cannot prove single-item
  CAS atomicity under genuine concurrency).

- **AC-3 (SM-3, client contract unchanged):** `POST /api/games` → 201
  `{ gameId, code, wsToken }`; `code` is 6-char Crockford alphabet; no new fields;
  p95 latency within 3s (reserve adds ≤1 extra single-item write on the happy path).

- **AC-4 (SM-4 PIN — retry-cap → 5xx, never a wrong code):** mock `generateCode`
  to return the same pre-reserved code on 6 consecutive draws → handler returns
  **HTTP 500** (`{ error:"Could not create game" }`), mints NO wsToken, emits ONE
  structured log line `reason:"code-reservation-exhausted"` carrying attempt count
  and `buildSha`; NEVER returns a duplicate code. Unit-test reachable.

- **AC-5 (IAM PIN — no widening beyond the named grant):** synth/policy test
  asserts `oxo-game-fn` gains EXACTLY `dynamodb:PutItem` on the `Codes` table ARN.
  Assert NEGATIVES on `Codes`: no `DeleteItem`, no `GetItem`/`Query`/`Scan`/
  `UpdateItem`, no GSI ARN, no wildcard resource. Pre-existing `Games`/
  `Connections`/secret/logs grants unchanged.

- **AC-6 (code-policy pin):** the reserve write's `ConditionExpression` is literally
  `attribute_not_exists(code)` (asserted in source/synth) — uniqueness enforced by
  the condition, not by code-side checking.

- **AC-7 (orphan-harmless):** a forced Games-write failure after a successful
  reservation leaves an orphan `Codes` row with `ttl` ~24h ahead; the join path is
  unaffected (join never reads `Codes`); no error surfaces to a later create.

## Out of scope (from slice.md, restated for the tester)
Code format/length change; vanity codes; collision UX; backfill of historical
games; collision-rate metrics beyond the existing retry log. OI-36 (oxo-ws-fn
BUILD_SHA) is DECLINED in this slice (does not touch the WS stack).
