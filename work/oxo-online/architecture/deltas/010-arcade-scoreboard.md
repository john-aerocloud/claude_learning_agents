# Delta 010 — Arcade scoreboard: name entry + backend record + shared board

Slice: s009-arcade-scoreboard (iteration 14, opens chunk C5 — first durable
persistence). Reference: GATE-2-S009. Renamed from s009-leaderboard-record by
human redirect (arcade name-as-key model; see slice.md).

## Decision: FULL delta (security review GATED)
This slice introduces, all at once:
- a **new durable table** (`Leaderboard`),
- a **new principal** (`oxo-board-fn`),
- a **NEW platform integration mechanism** (first **DynamoDB Stream** in the
  system → §30 walking-skeleton probe required),
- a **new public read route** (`GET /api/leaderboard`),
- a **new public data flow with a real injection vector**: a free-text,
  unauthenticated, user-supplied **name** is written to a shared store and
  **rendered in other players' browsers** → STORED-XSS surface (§8).

Arch-lite (§21) does NOT apply. The C5 chunk is NOT tagged no-backend. Security
review is gated and run below.

Scope discipline (Killick minimum): name capture + propagation onto `Games`,
ONE decoupled tally writer, idempotency, ONE read route + minimal display. NO
auth, NO UUID, NO name uniqueness, NO moderation, NO pagination, NO per-game
history, NO self-play defence beyond what's already structurally true. The ≤10s
latency PROOF (Playwright smoke) is s010 — this slice ships the value.

---

## 1. Leaderboard table (NEW durable store)

- **Table `Leaderboard`**, PK = `playerName` (String) — the entered name IS the
  key. No sort key, no GSI in this slice (top-N is a small Scan at hobby scale;
  see §4 reversal).
- **Attributes:** `wins` (N), `draws` (N), `losses` (N) — Number counters,
  incremented via `ADD`. `scoredGames` (SS, String Set) — the idempotency
  dedup marker (see §3). All absent-on-create; `ADD`/set-add create-or-increment.
- **Billing:** on-demand. **Encryption:** SSE (AWS-managed key default).
  **PITR: ENABLED** — this is the system's FIRST and ONLY durable data store
  (all prior tables are TTL-ephemeral); standings must survive. (aws skill §8
  DynamoDB checklist: PITR on durable tables.)
- **NO TTL** — standings persist by design (contrast Games/Connections/Codes/
  ConnectAttempts which are all TTL-ephemeral). This is the first non-TTL table;
  named explicitly so the absence is a DECISION, not an omission.
- **Name collisions accumulate on one row BY DESIGN** (SM-2). Two "AAA" players
  share the `AAA` row; their tallies sum. No dedup, no uniqueness constraint.
  This is the arcade model, not a bug.
- Region: **eu-west-2** (home region; no exception). Lives in the existing
  `OxoGameProd` stack (same game-backend deployable — no new cross-stack
  data-plane import, consistent with s005 stack-placement rationale).

## 2. Name capture + propagation (additive contract changes)

The name MUST be on the `Games` item BEFORE game-over fires — that is the only
race-free point (slice.md "Where the name is entered"). At game-over the writer
reads `hostName`/`guestName` off the `Games` item; they must already be there.

- **`Games` schema add (schemaless, no rebuild):** `hostName` (S),
  `guestName` (S). No GSI change, no table change. The withdrawn
  `hostPlayerId`/`guestPlayerId` UUID attrs are NOT added.
- **Contract change — `POST /api/games` body gains `playerName` (additive,
  optional).** `oxo-game-fn` validates/normalises it (trim, ≤10 chars,
  charset-bound — see §8; empty/blank → `"AAA"` default, SM-3) and writes
  `hostName` onto the `Games` item in the EXISTING create `PutItem`. Old clients
  that omit it get `"AAA"`. No new IAM grant (same `PutItem` on `Games`).
- **Contract change — WS `join` frame gains `playerName` (additive, optional).**
  `oxo-ws-fn` validates/normalises identically and writes `guestName` onto the
  `Games` item in the EXISTING conditional join `UpdateItem` (the
  waiting→active transition). No new IAM grant (same `UpdateItem` on `Games`).
- **Validation is at the API boundary on BOTH paths** (game-fn create, ws-fn
  join) — the trim/length/charset bound is the write-side half of the
  stored-XSS control (§8). The name is normalised ONCE, server-side, before it
  ever reaches the durable store.
- **Retry/backoff posture:** name-write rides the EXISTING create/join writes —
  no new external call, no new posture. The pre-existing posture (conditional
  write, no app-level retry on `ConditionalCheckFailed`) is unchanged.

## 3. Result-recording mechanism — DECISION: **DynamoDB Stream** (not inline)

**Decision: DynamoDB Stream on `Games` (NEW_AND_OLD_IMAGES) → `oxo-board-fn`
event-source mapping.** NOT inline in `oxo-ws-fn`.

**Why Stream over inline:**
- **Zero hot-path change.** The s006 move handler and s007 $disconnect handler
  are UNTOUCHED. Game-over write latency (SM-6: game-over WS still ≤1s p95) is
  unaffected — the board write is fully off the hot path.
- **Failure isolation.** A `board-fn` failure (or a `Leaderboard` throttle) does
  NOT fail the game or the move relay. The board converges late, never breaks play.
- **Reuse of the EXISTING authoritative transition.** The move CAS already flips
  `status`→`won`/`drawn` and sets `winner` in ONE atomic write (s006). The
  stream record carries OLD+NEW images, so `board-fn` sees the transition
  directly — no extra read needed to know the outcome.
- **Cost of the choice — at-least-once delivery → IDEMPOTENCY MANDATORY (SM-4).**
  Stream records can be redelivered (consumer error, batch retry, resharding).
  A replayed game-over MUST NOT double-count. This is the crux; specified
  precisely below — NOT hand-waved.

`board-fn` **filters at the source** (event-source-mapping filter criteria) for:
`eventName = MODIFY` AND NEW-image `status ∈ {won, drawn}` AND OLD-image
`status = active` — i.e. only the active→terminal TRANSITION, never the many
`board-update` MODIFYs during play, never `abandoned` (SM-5: abandoned →
no tally). The transition filter is the first-line waste cut; the idempotency
marker below is the CORRECTNESS guarantee (filtering alone is insufficient under
redelivery — a redelivered transition record still matches the filter).

### Idempotency mechanism (PRECISE — this is the crux, SM-4)

**Mechanism: a conditional `scoredGames` String-Set marker, scoped per
participant name, written in the SAME `UpdateItem` that increments the tally.**

For each game-over, `board-fn` performs TWO independent conditional `UpdateItem`s
against `Leaderboard` (one per participant — winner+loser, or both draws):

```
UpdateItem Leaderboard
  Key:  { playerName: <name> }
  UpdateExpression:
        ADD wins :one,                  -- (or draws / losses per outcome+role)
            scoredGames :gameIdSet      -- SS add of {gameId}
  ConditionExpression:
        NOT contains(scoredGames, :gameId)   -- this name has NOT scored this game
  Values: :one = 1, :gameId = "<gameId>", :gameIdSet = {"<gameId>"}
```

- **Why per-name, not a single global marker:** the tally lives on the name row;
  the marker that guards it MUST be on the same item as the counter it guards, in
  the same atomic write. A separate `ProcessedGames` table would split the
  marker-check and the increment across two items → a window where a crash
  between them double-counts. Co-locating marker + counter on the name row makes
  the increment-and-mark a SINGLE atomic conditional op (DynamoDB single-item
  conditional write = the CAS primitive this system already uses on Games/Codes).
- **Replay (SM-4):** a redelivered game-over record runs the SAME two
  `UpdateItem`s. `contains(scoredGames, :gameId)` is now TRUE → `ConditionExpression`
  fails → `ConditionalCheckFailed` → **no write, no increment**. `board-fn`
  treats `ConditionalCheckFailed` as **success-already-done** (swallow, log,
  do NOT retry, do NOT fail the batch). The `Leaderboard` item after replay is
  byte-identical to after first processing.
- **Collision-safe (SM-2):** the marker is keyed by `gameId`, so two different
  games for the same "AAA" name each add their own `gameId` to `AAA.scoredGames`
  and each increments — collisions accumulate, replays don't. Two different
  names in the SAME game (winner "ACE", loser "AAA") each carry the same `gameId`
  on THEIR OWN row's set — independent, both score once.
- **`scoredGames` growth:** bounded in practice (a name plays finitely many
  games at hobby scale); acceptable for this slice. Reversal: if a hot name's set
  grows past comfort, move the marker to a separate per-game item with its own
  short-ish TTL longer than the max stream-redelivery horizon — explicitly
  deferred, not needed now.

### §30 walking-skeleton probe (NEW mechanism — first DynamoDB Stream)

Before use-case build-out the engineer MUST run, through the DEPLOYED stream
path (not a unit mock):
- **Probe A (one real game-over → exactly one increment):** drive one real game
  to `won` via the WS path; assert the winner's `Leaderboard.wins` went 0→1 and
  the loser's `losses` 0→1, each `scoredGames` contains the gameId exactly once.
- **Probe B (replay → no double-count):** re-inject/redeliver the SAME game-over
  stream record (or re-emit the transition) a second time; assert BOTH rows are
  byte-identical to after Probe A (no counter moved; `ConditionalCheckFailed`
  observed in `board-fn` logs). This proves the at-least-once→idempotent contract
  end-to-end on the real platform, which is exactly where un-modelled stream
  semantics hide.

## 4. Read path — DECISION: existing `oxo-game-fn`, CloudFront 5s TTL

- **`GET /api/leaderboard`** — NEW route on the EXISTING HTTP API v2 (route
  count grows by one; not a new infra-class). Returns the board as JSON:
  `{ entries: [{ name, wins, draws, losses }], buildSha }`, top-N (N=20)
  ordered `wins` desc, ties by `losses` asc then `name` asc (stable). At hobby
  scale this is a `Scan` of `Leaderboard` + in-memory sort/slice (small table;
  the aws-skill reversal — add a GSI / ranked store — triggers only if the board
  outgrows top-N Scan, slice.md says top-N only).
- **Handler — DECISION: the EXISTING `oxo-game-fn`**, NOT a new `read-fn`. It is
  already the HTTP-API-backed Lambda (it serves `POST /api/games`); adding one
  read handler avoids a new function/role/cold-start surface for one tiny read.
  It gains EXACTLY a scoped `dynamodb:Scan` on the `Leaderboard` table ARN (see
  §5). (Reversal: split a `read-fn` if the read path ever needs different scaling/
  concurrency from create — not now.)
- **CloudFront caching — DECISION: short TTL = 5s** (NOT no-cache, NOT the
  CachingDisabled used for `/api/games`). A dedicated cache behaviour for
  `/api/leaderboard` with `min/default/maxTTL = 5s`. Rationale: keeps read
  pressure off DynamoDB (many title-screen loads collapse to one origin fetch per
  5s window) while comfortably meeting SM-1's "within 10s" (5s cache + sub-1s
  stream propagation + fetch ≪ 10s). `POST /api/games` stays CachingDisabled
  (writes must never cache). The 5s is a NON-OBVIOUS gate semantic → modelled as
  a node annotation in data-flow.mmd.
- **Retry/backoff posture (the read call, browser→CF→HTTP API→Lambda→Scan):**
  the SPA fetch is a single GET; on failure the SPA shows an empty/stale board
  and **retries on next title-screen mount only** (no aggressive polling loop in
  this slice — explicit decision NOT to add a retry timer; the board is
  best-effort eventual). Lambda→DynamoDB `Scan` uses the AWS SDK default
  retry (jittered exponential backoff, max 3 attempts) — unchanged SDK default,
  stated for completeness. Timeout budget: Lambda 3s; on Scan exhaustion the
  handler returns 5xx (WE own it) and the SPA renders the empty board.

## 5. IAM — every grant, both sides; no widening beyond named

| Role | Grant in THIS slice | Asserted bound |
|------|---------------------|----------------|
| **`oxo-board-fn`** (NEW role) | `dynamodb:GetRecords`/`GetShardIterator`/`DescribeStream`/`ListStreams` on the **`Games` stream ARN only** (stream consume) + `dynamodb:UpdateItem` on the **`Leaderboard` table ARN only** + own CloudWatch Logs group. | NO `Games` table read/write (it reads the STREAM, not the table — the OLD+NEW images are in the record). NO `Scan`/`Query`/`DeleteItem` on Leaderboard. NO other table. NO wildcard. |
| **`oxo-game-fn`** (existing) | + `dynamodb:Scan` on the **`Leaderboard` table ARN only** (the read route). Name-write rides the EXISTING `PutItem` on `Games` — **NOT a new grant.** | NO `Query`/`UpdateItem`/`DeleteItem`/`GetItem` on Leaderboard (Scan-only for top-N). Existing Games/Codes/secret grants unchanged. |
| **`oxo-ws-fn`** (existing) | **NO new grant.** Name-write rides the EXISTING conditional `UpdateItem` on `Games` (the join transition). | Unchanged from s007 (the `Connections` GetItem set). |
| **`oxo-deploy`** (existing) | + scoped `lambda:UpdateFunctionCode`/`GetFunction` on the **`oxo-board-fn` ARN only** (deploy the new function). All else CDK/CFN-managed under bootstrap trust. **NO `iam:*` mutation.** | NO new `iam:*`; the new role + stream + table are CDK-synthesised under the existing bootstrap trust, not created by the deploy role at runtime. |

**No-widening assertion:** the ONLY new app-data-plane grants are
(a) `oxo-board-fn`'s stream-read + `Leaderboard` `UpdateItem`, and
(b) `oxo-game-fn`'s `Leaderboard` `Scan`. `oxo-ws-fn` gains NOTHING. No role gets
a wildcard, a second table, or a write it doesn't use. This is a checkable pin
(§ acceptance).

## 6. Local stand-up impact (principles/02 — local/prod gap)

| Part | Stands locally? | Control covering it |
|------|-----------------|---------------------|
| Name normalisation (trim/≤10/charset/`"AAA"` default) | YES — pure function in the create/join hexagonal ports | unit tests run locally |
| Tally outcome logic (won→W/L, drawn→D/D, abandoned→none) | YES — pure `(oldImage, newImage) → [{name, field, delta}]` function | unit tests run locally; SM-5 (abandoned→none) covered locally |
| **Idempotency branch** (conditional set-marker; replay → no-op) | YES — the LOCAL `Leaderboard` store adapter MUST reproduce the conditional-`ADD`-with-`NOT contains(scoredGames)` semantic so the replay test runs offline (principles/02). | local store adapter conditional-write contract test (the engineer's offline SM-4 proof) |
| Top-N sort/slice | YES — pure sort over the local store | unit test |
| **DynamoDB Stream delivery + at-least-once redelivery** | **NO — cloud-only platform runtime semantic.** Local can SIMULATE redelivery by invoking the board handler twice with the same record, but real stream sharding/ redelivery/filter-criteria evaluation is platform-only. | **§30 walking-skeleton Probe A+B** (real game-over → one increment; real replay → no double-count) + event-source-mapping filter is a synth-contract pin (CDK assert the filter criteria). |
| CloudFront 5s TTL behaviour | NO — CDN cache semantics are cloud-only | prod validation / s010 latency smoke; the SPA fetch + JSON contract stand locally against the local store. |

**Gap named:** the only genuinely cloud-only items are the Stream delivery/
redelivery semantics and the CloudFront 5s TTL — each has a named cover
(skeleton probe + synth-contract for the stream; prod/s010 smoke for the TTL).
Everything else (normalisation, tally maths, idempotency BRANCH, sort) stands
locally.

## 7. Build-identity carrier (principles/01)

- **`GET /api/leaderboard` response** carries `buildSha` in the JSON body (same
  carrier convention as the existing `OXO_CONFIG`/responses) — the read surface
  is version-identifiable.
- **`oxo-board-fn`** emits `buildSha` in its structured CloudWatch log line on
  every invocation (the stream consumer has no HTTP surface; the log field is its
  build-identity carrier).

## 8. Security review (GATED) — stored-XSS + abuse surface

### Threat 1 — STORED XSS (the material new surface)
A free-text, unauthenticated, user-supplied name is written to a shared durable
store and **rendered in other players' browsers** (Player B's title-screen
leaderboard shows Player A's name — SM-1). This is a classic stored-XSS vector:
a name like `<img src=x onerror=...>` written by A, executed in B's browser.

**Controls (defence in depth — write-side bound + render-side escape):**
- **Render-side (PRIMARY): the SPA renders every leaderboard name as TEXT, never
  as HTML.** React escapes string children by default (`{entry.name}` in JSX is
  auto-escaped); the control is the **explicit prohibition of
  `dangerouslySetInnerHTML` (and any `innerHTML`/`v-html`-equivalent) on the
  leaderboard name** — a code-policy pin the tester checks. React's default
  escaping neutralises the vector; the pin makes the reliance explicit and
  guards against a future "render rich name" regression.
- **Write-side (DEFENCE IN DEPTH): name normalised server-side at the API
  boundary (§2) — trim, length ≤10, and a charset bound** restricting the name
  to a printable, injection-safe set (the engineer pins the exact regex; the
  intent: no `<`, `>`, `&`, `"`, `'`, control chars — so even a future
  unescaped render or a non-SPA consumer of `GET /api/leaderboard` cannot be
  XSS'd). Names exceeding/violating are truncated/stripped to the safe set, not
  rejected (arcade UX — never block play over a name).
- **No new CSP directive needed** — the EXISTING CloudFront response-headers CSP
  applies to the SPA; names are data rendered as text, not script. STATED so the
  "no CSP change" is a decision, not an omission.
- **Existing CSP carries the residual:** if React escaping AND the charset bound
  both failed, the SPA CSP (no `unsafe-inline`, scoped script-src) is the
  backstop — unchanged, still in force.

### Threat 2 — Abuse: impersonation + offensive names (ACKNOWLEDGED, scoped out)
The name is user-controlled and UNAUTHENTICATED (the explicit product decision —
name is asserted, not owned; collisions accepted). Honest acknowledgement:
- **Impersonation:** anyone can play as "ACE" and add to ACE's row. There is NO
  ownership proof. This is INHERENT to the arcade name-as-key model (slice.md
  binding) — it is a product-accepted property, not a defect. The board is a
  shared arcade cabinet, not an identity system.
- **Offensive names:** a player can enter a slur/offensive string (within the
  charset bound) and it displays to others. **Profanity filtering / moderation is
  OUT OF SCOPE** (slice.md "Explicitly NOT in scope" — no moderation listed; no
  job demand). The abuse surface is REAL and is acknowledged here so it is a
  KNOWN, named risk — not a silent gap. If a moderation need arises it is a new
  chunk (filter at the §2 write-boundary, the natural insertion point).
- **Leaderboard farming/inflation:** anonymous self-play CAN inflate a name's
  tally. Partially bounded structurally (a game needs two distinct WS
  connections to reach a server-authoritative `won`/`drawn`; the move CAS is
  server-authoritative — clients cannot assert a result). Not fully defeated
  under anonymity; documented limitation at this scope (matches the existing
  `dynamodb-leaderboard.md` security note).

### Conclusion (VERBATIM)

> The arcade scoreboard adds one durable table, one decoupled stream-consumer
> principal, and one cached read route. The single material new attack surface is
> STORED XSS via a free-text unauthenticated name rendered in other browsers; it
> is covered defence-in-depth by React's default text-escaping (with an explicit
> no-`dangerouslySetInnerHTML` code-policy pin) plus a server-side
> length+charset bound at the write boundary, behind the unchanged SPA CSP. The
> idempotency of the tally write under at-least-once stream delivery is the
> correctness crux and is pinned by a co-located conditional set-marker
> (single-item CAS) proven end-to-end by the §30 walking-skeleton replay probe.
> All new IAM is table-/stream-/function-ARN-scoped with no widening of
> `oxo-ws-fn` and no wildcard. The impersonation and offensive-name abuse
> surfaces are INHERENT to the product-chosen unauthenticated arcade model and
> are explicitly acknowledged and scoped out (no moderation this slice), not
> silently ignored. With the XSS control specified as a checkable pin, the
> residual is product-accepted and well-understood: this is **§9a
> auto-acceptable** — no NEW material risk beyond the named, controlled
> stored-XSS pin and the explicitly product-accepted abuse surface requires
> fresh human eyes.

**Gate disposition: §9a AUTO-ACCEPT.** The stored-XSS vector, though new, has a
standard, checkable, defence-in-depth control; the abuse surface is a
product-decision consequence already bound in slice.md, not an architecture
choice. No human flag raised. (If a future slice added rich-text names,
name claiming, or removed React escaping, the gate would re-open.)

Security notes written/updated:
`architecture/security/dynamodb-leaderboard.md` (this slice's controls),
`architecture/security/lambda-execution-roles.md` (board-fn role),
`architecture/security/apigw-http.md` (GET /api/leaderboard + 5s cache),
`architecture/security/cloudfront-distribution.md` (leaderboard cache behaviour),
`architecture/security/dynamodb-games.md` (stream enabled; name attrs).

---

## T/S acceptance conditions (architect-supplied; Product assembles acceptance.md)

These are the technical/observable conditions; the ui-designer supplies WCAG.

- **T-LB-1 (table):** `Leaderboard` exists in eu-west-2 (`OxoGameProd`), PK
  `playerName` (S), SSE on, **PITR ENABLED**, **NO TTL**, on-demand. Synth-assert.
- **T-LB-2 (name propagation):** after `POST /api/games {playerName:"ACE"}` the
  `Games` item has `hostName="ACE"`; after WS `join {playerName:"BEE"}` it has
  `guestName="BEE"`. Blank/omitted → `"AAA"` (SM-3). Names >10 chars truncated;
  `<>&"'`/control chars stripped per the pinned charset (write-side §8).
- **T-LB-3 (SM-4 IDEMPOTENCY PIN — the crux):** drive one real game-over → each
  participant's counter +1 and `scoredGames` contains the gameId. **Replay the
  SAME game-over stream record → both `Leaderboard` rows BYTE-IDENTICAL to after
  first processing** (no counter moved; `ConditionalCheckFailed` in board-fn
  logs). The conditional `UpdateItem` MUST carry
  `ConditionExpression NOT contains(scoredGames, :gameId)`.
- **T-LB-4 (SM-2 collision):** two distinct games for name "AAA" (one won, one
  drawn) → ONE `AAA` row showing combined tally (1W + 1D), not two rows.
- **T-LB-5 (SM-5 abandoned):** a game that goes `active→abandoned` (s007 path)
  produces NO `Leaderboard` write/increment for either name (stream filter
  `OLD.status=active AND NEW.status∈{won,drawn}` excludes it).
- **T-LB-6 (read path + cache):** `GET /api/leaderboard` returns top-20 ordered
  `wins` desc / `losses` asc / name asc, with `buildSha` in the body; the
  `/api/leaderboard` CloudFront behaviour has TTL=5s (synth-assert) and
  `POST /api/games` stays CachingDisabled.
- **T-LB-7 (SM-1 cross-browser, within 10s):** A completes a game as "ACE";
  within 10s B's title-screen leaderboard fetch shows "ACE" + correct tally.
  (The automated ≤10s SMOKE proof is s010; this is the functional assertion.)
- **T-LB-8 (STORED-XSS PIN):** a name `<img src=x onerror=alert(1)>` (or its
  charset-stripped form) recorded and then rendered on the leaderboard does NOT
  execute script in the viewing browser; the SPA renders names as escaped text;
  **NO `dangerouslySetInnerHTML` on the leaderboard name** (code-policy pin).
- **T-LB-9 (IAM NO-WIDENING PIN):** `oxo-board-fn` = stream-read on Games-stream
  ARN + `UpdateItem` on Leaderboard ARN only (no Games table grant, no
  Scan/Query/Delete on Leaderboard, no wildcard); `oxo-game-fn` += `Scan` on
  Leaderboard ARN only; **`oxo-ws-fn` gains NOTHING**; `oxo-deploy` += scoped
  `UpdateFunctionCode` on board-fn ARN only, no `iam:*`. Synth/policy-assert.
- **T-LB-10 (§30 SKELETON PROBE):** Probe A (real game-over → exactly one
  increment) and Probe B (real replay → no double-count) both run through the
  DEPLOYED stream path BEFORE use-case build-out, evidence in the ledger.
- **T-LB-11 (SM-6 no regression):** game-over WS message still ≤1s p95; the
  stream/board path adds nothing to the hot path (board-fn is off-path).
- **T-LB-12 (SM-8 session persist):** name pre-fills from `sessionStorage` on the
  next create/join in the same tab (SPA-local; no backend assertion).

---

## New-mechanism flag
**YES — first DynamoDB Stream in the system.** §30 walking-skeleton probe
named above (T-LB-10 Probe A+B). The engineer schedules it BEFORE use-case
build-out. All other primitives (HTTP route, conditional single-item CAS,
CloudFront cache behaviour, Lambda+DynamoDB) are already in production.

## Region policy
**No exception.** `Leaderboard`, `oxo-board-fn`, the stream, and the HTTP route
are all eu-west-2 (home region), in `OxoGameProd`. The only out-of-region
resource in the system remains the s005-h1 us-east-1 CloudFront WebACL
(platform-forced, already documented).
