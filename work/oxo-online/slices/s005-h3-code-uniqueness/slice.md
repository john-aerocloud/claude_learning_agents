---
slice: s005-h3-code-uniqueness
chunk: C4
status: in-planning
classification: RISK-REDUCTION (C4 hardening residual — final)
decision-log: SEL-S005H3
closes: OI-3
---

# s005-h3 — Guaranteed code uniqueness

## Job served

**Risk-reduction job protecting the core job's integrity:**

When two active "waiting" games exist in the system, a player who joins by code
wants that code to map to exactly THEIR game, so a friend joining by code always
reaches the right game — never a stranger's.

This is not a new user-facing job. It is the correctness invariant that the core
job (C4 CORE: play a full online game with a specific friend) depends on. A code
collision — two simultaneous `waiting` games sharing the same 6-char code — would
produce an ambiguous lookup: the joiner could land on the wrong game, silently.
The risk is low at hobby volume (32^6 ≈ 1 billion combinations from the
unambiguous alphabet), but it is a structural correctness hole: the probability is
not zero and grows with volume. C5 (leaderboard) may bring more concurrent games.
This slice closes the hole before C5 opens.

The integrity guarantee that does not exist before this slice: a code collision can
no longer produce a wrong-game join. The create-game path will, after this slice,
be provably free of duplicate active codes. No user sees any change in the client
contract.

---

## Thin scope

The create-game path (`POST /api/games` → Lambda → DynamoDB) must guarantee that
the 6-char code it assigns to a new `waiting` game is not already in use by
another `waiting` game. The guarantee must be enforced at the storage layer — not
in-memory logic — so that concurrent Lambda invocations cannot race to assign the
same code.

**Product intent (mechanism left to architect):** The architect should choose among
mechanisms that provide this guarantee atomically at DynamoDB: a conditional
`PutItem` using the game code as a key (e.g. on a dedicated `Codes` table keyed by
`code`, or via a GSI uniqueness guard with a ConditionExpression that fails if a
`waiting` game already holds that code). The s006 CAS discipline (conditional
`UpdateItem`/`PutItem` with `ConditionExpression`) is the proven pattern here.

**Retry loop:** If the conditional write detects a collision, the Lambda generates
a fresh random code and retries the write — server-side, transparent, bounded (e.g.
≤ 5 retries before returning a 5xx). The client sees no change: it still receives
`{ gameId, code, wsToken }` with exactly one code, or a standard error if retries
are exhausted (effectively impossible at hobby volume but the path must exist).

**IAM:** If a new `Codes` table is introduced, `oxo-game-fn` gains `PutItem` and
`DeleteItem` on that table ARN only (narrow, no wildcard). The architect decides
whether to use a `Codes` table, a GSI uniqueness guard on `Games`, or another
atomically safe mechanism. All three are acceptable if the storage-layer uniqueness
guarantee holds.

---

## Explicitly NOT in scope

- Code format or length change (still 6-char Crockford unambiguous alphabet).
- Vanity/custom codes (player-chosen codes).
- Collision UX (there is none — the server retries transparently; the client
  contract is unchanged).
- Backfill of historical games (old `waiting` games with potentially duplicate
  codes are left to expire via the existing 24h TTL).
- Collision-rate metrics or observability beyond the existing retry path.
- s004 security notes revision beyond the OI-3 close acknowledgement.

---

## Success measures

**SM-1 — Synthetic-duplicate-injection test (proof of uniqueness guarantee):**
A test that artificially pre-seeds a `waiting` game with a known code `XXXXXX`,
then calls `POST /api/games` with the random generation mocked to produce `XXXXXX`
on the first attempt, confirms that:
- The create-game path does NOT return a duplicate code;
- The returned code is different from `XXXXXX` (i.e. the retry produced a fresh code);
- The new game item exists in DynamoDB with a unique code.

**SM-2 — No two simultaneous WAITING games share a code:**
After any number of concurrent `POST /api/games` calls (e.g. N=50 in parallel),
every returned code is distinct, and DynamoDB contains no two `waiting` items with
the same `code` value.

**SM-3 — Client contract unchanged:**
`POST /api/games` still returns HTTP 201 with `{ gameId, code, wsToken }`. The
`code` is a 6-char string from the Crockford alphabet. No new fields. No timing
regression beyond the retry overhead (p95 latency target unchanged: within 3s).

**SM-4 — Exhausted-retry path exists (defensive):**
If (hypothetically) all codes are taken — or a test forces 5+ consecutive
collisions — the Lambda returns a 5xx (not a silent wrong-code). This path need
not be exercised in prod but must be reachable in the code and covered by a unit
test.

---

## Killick test

Before this slice: a code collision can in principle produce a wrong-game join.
The probability is low, but the outcome (a stranger joining your game) is a
correctness failure with no detection.

After this slice: the create-game path provably cannot assign a duplicate active
code. If two concurrent creates happen to generate the same code, only one
succeeds at the storage layer; the other retries with a fresh code. The joining
flow remains exactly the same — the uniqueness guarantee is fully server-side and
invisible to users.

The new thing: a player joining by code is guaranteed to reach exactly the game
they were invited to, at any concurrent game volume.

---

## Notes

- This is the FINAL C4-adjacent hardening residual, closing OI-3 from the Gate-3
  s005 security review. After this slice, all three C4 hardening items (OI-1
  s005-h1, OI-2 s005-h2, OI-3 s005-h3) are closed.
- C4 done-condition (proved by s008 SM-5) is already met. This slice is a
  correctness hardening on the live C4 surface — it does not re-open C4's
  done-condition, but it cleans up the last integrity risk before C5.
- OI-36 (oxo-ws-fn missing BUILD_SHA injection) is a candidate piggyback in this
  slice if the engineer touches the game-stack Lambda (architect to decide).
- No sequence dependency on other in-flight slices (s005-h3 is independent of C5
  work; C5 may start in parallel but this should ship before C5's first write
  surface widens the concurrent-game load).
