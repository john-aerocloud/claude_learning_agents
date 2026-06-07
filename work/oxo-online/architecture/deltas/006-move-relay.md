# Delta 006 — Server-authoritative move relay (the core-job payoff)

> **AMENDMENT 2026-06-07 (GATE-AMEND, UC3 read-before-build blocker).**
> The move frame is `{ action:'move', gameId, square }` — `gameId` added as a
> **non-trusted lookup key** so the handler can `GetItem(Games, gameId)` (a grant
> it already has) instead of resolving connectionId→gameId via a Connections read
> (Option A, which would widen S5). Identity/role is STILL derived server-side by
> matching the real `event.requestContext.connectionId` against the stored
> host/guestConnectionId; a forged/mismatched `gameId` resolves a game the sender
> is not in → matches neither slot → reject, no write. **S5 (IAM) unchanged.**
> **S1 sharpened** to assert the forged-gameId reject explicitly. Cause: the
> connectionId→gameId binding lives only in Connections, which the move path is
> (correctly) not granted to read. Required UC3-adjacent server change: the
> `game-ready` frame must carry `gameId` so the GUEST (who joins by code and has
> no gameId client-side) can thread it into its move frame — see §Frame shape.

## Decision: FULL delta (arch-lite §21 does NOT apply, but the delta is SMALL)
This slice adds a new **runtime data flow** (a `move` message that mutates the
authoritative board and fans out to two clients) and a new **state-transition
trust rule** (no moves after `won`/`drawn`, enforced by a conditional write).
That is a new data flow and a sharpened trust boundary, so the security review
is gated. It does **not** add a new public surface, a new principal, a new
table, a new API, a new region, or a new deploy-role grant — so the
infrastructure delta is deliberately thin. We reuse what s004/s005/s005-h2 built.

Scope discipline (Killick minimum): exactly the happy-path move→relay→win/draw
flow, plus the OI-33 two-line SPA error-text fold-in. No `$disconnect` cleanup,
no reconnect, no leaderboard write, no share-link — all explicitly deferred by
the slice.

---

## New-mechanism flag (process §30)
**NO new platform integration mechanism.** Every primitive this slice uses is
already in production and already probed:
- WS route → `oxo-ws-fn` (AWS_PROXY): same as `register`/`join` (s005).
- `execute-api:ManageConnections` `@connections` POST: first used and
  walking-skeleton-probed in s005 (`game-ready` fan-out). The `board-update` /
  `game-over` relay is the **same** mechanism, same role grant, same API ARN.
- Conditional `UpdateItem` on `Games`: same mechanism as the s005 no-hijack join
  write; we add `version` to the condition.

Because no mechanism is new, **no new walking-skeleton probe is required**. The
s005 `@connections` probe already proves the deployed relay path works. The
in-slice proof obligation is the **functional smoke** (move in browser A appears
in browser B < 1s p95) — an acceptance condition, not a skeleton probe.

---

## What changes

### 1. WS API — new `move` action route (on the EXISTING API, EXISTING function)
- Add one `AWS::ApiGatewayV2::Route` with `RouteKey: 'move'` to the existing
  WebSocket API in `OxoGameProd`, integrating the **existing** `oxo-ws-fn`
  Lambda (AWS_PROXY). `RouteSelectionExpression` is already
  `$request.body.action`; the client sends
  `{ action: 'move', gameId: <string>, square: <0..8> }` where `gameId` is a
  **non-trusted lookup key** (amended 2026-06-07 — see §Frame shape & the
  apigw-websocket.md S1 note). The handler uses it ONLY as the `GetItem(Games,…)`
  key; authorization is the server-side connectionId-vs-binding match.
- **No new function.** `oxo-ws-fn` already owns the `Games` table, the
  `Connections` table, and `ManageConnections` on this API — move is the same
  ephemeral-game-state bounded context. Splitting a `move-fn` out would force
  duplicating the `Games` RW grant and the `ManageConnections` grant onto a
  second principal for zero blast-radius benefit. The C3-components note in
  current.md already anticipated a single route-dispatch handler; this honours it.
- Route count on the WS API goes 4 → 5
  (`$connect`/`$disconnect`/`register`/`join`/`move`). Still **no `$default`**
  catch-all — an unrouted `action` is dropped by the service, not handled.

### 2. `Games` item — board-state schema delta
The `Games` item gains the authoritative play fields (written by the `move`
handler, read by it and never by clients):

| Attribute | Type | Semantics |
|-----------|------|-----------|
| `board` | String(9) | The 9 squares, index 0..8, chars `X`/`O`/`-`. A 9-char fixed-width string (not a list) so a single conditional write replaces it atomically and it is trivially diffable. Initialised to `"---------"` (set lazily on the first move, or at join — see init note). |
| `currentTurn` | String | `"X"` or `"O"` — whose move the server will accept next. Host = `X`, guest = `O` (the role assignment fixed at s005 `game-ready`). |
| `status` | String | Existing attr; gains transitions `active` → `won` / `drawn`. Terminal values are write-locked (see locking). |
| `winner` | String (opt) | `"X"` / `"O"` on a win; absent on draw/in-play. Set in the same write that flips `status` to `won`. |
| `version` | Number | **Optimistic-lock counter.** Starts at 0 (or absent ⇒ treated as 0), incremented by exactly 1 on every accepted move write. See locking below. |
| `moveCount` | Number | 0..9 squares filled — drives draw detection (count == 9 with no win ⇒ draw) without re-scanning, and bounds replay. |

**Board initialisation.** `board="---------"`, `currentTurn="X"`,
`version=0`, `moveCount=0` are set **in the existing s005 `join` conditional
write** (the same atomic `UpdateItem` that flips `status` to `active` and sets
`guestConnectionId`). This costs nothing extra, removes a "board may be absent
on first move" branch, and means the first `move` already finds an initialised
item. (This is a tightening of the s005 join write, not a new write.)

### 3. Optimistic locking for concurrent move writes (the integrity core)
Two moves can race (a fast double-click, a malicious replay, or genuinely
near-simultaneous clicks). The authoritative write MUST serialize them. We use a
**single atomic conditional `UpdateItem`** that is BOTH the turn/legality gate
and the lock:

`ConditionExpression` (all ANDed):
- `status = :active` — no moves on a `waiting`/`won`/`drawn` game
  (**this is the state-transition lock — see §state-transition integrity**).
- `currentTurn = :senderRole` — the sender is the player whose turn it is.
- `version = :expectedVersion` — the read-modify-write the handler computed is
  still current; if another move landed first, this fails and the handler
  rejects/retries.
- `attribute_type(board, :S)` is implied; the square-free check is done in the
  `SET` via `board` substring comparison done in-handler before the write, AND
  re-guarded by the version check (a stale read that thought the square was free
  fails on `version`).

`UpdateExpression`: `SET board = :newBoard, currentTurn = :nextTurn, version = version + :one, moveCount = moveCount + :one [, status = :terminal, winner = :w]`.

The win/draw computation runs **in-handler on the post-move board** and, when
terminal, the same write sets `status` to `won`/`drawn` (+ `winner`). So
**reaching a terminal state and locking the board are one atomic operation** —
there is no window in which a move could slip in after game-over.

**On `ConditionalCheckFailedException`:** the handler does NOT retry blindly for
the turn/status failures (those are legitimate rejects → `move-rejected` to the
sender only). For a pure `version` race where the move is still otherwise legal,
the handler MAY re-read once and re-evaluate (bounded single retry — see retry
posture); if still illegal, `move-rejected`. We prefer **reject over silent
retry** to keep latency tight and avoid surprising the player; a `version` clash
where the same player double-fired is just a rejected duplicate.

**Why a version counter and not last-writer-wins:** without it, two reads of the
same `currentTurn` could both pass the turn check and the second overwrites the
first (a lost move / board corruption). `version` makes the write
compare-and-swap. It is the minimum mechanism that closes the concurrent-write
race; it is not speculative — the slice's success-measure #4 (zero board
divergence) depends on it.

### 4. Relay posture — exactly two `@connections` POSTs per accepted move
On an **accepted** move the handler posts to BOTH connections
(`hostConnectionId`, `guestConnectionId`) read from the `Games` item:
- one `board-update` `{ type:'board-update', board, currentTurn, status }` to each
  → **2 POSTs**.
- if the move was terminal, **also** a `game-over`
  `{ type:'game-over', result:'X-wins'|'O-wins'|'draw' }` to each → **+2 POSTs**.

So a non-terminal accepted move = **exactly 2** posts; a terminal move = **4**
(or a single combined `board-update`+terminal flag if we fold them — engineer's
call, but the amplification ceiling is **fixed and small**: bounded by 2 known
connection targets, never a broadcast). A **rejected** move = **1** post
(`move-rejected` to the sender only), **0** writes. This bounded fan-out is the
relay-amplification control (see security).

**`ManageConnections` grant is UNCHANGED** — `oxo-ws-fn` already has
`execute-api:ManageConnections` on this WS API ARN only (s005). We **confirm, do
not widen**. No GoneException-driven cleanup in this slice (that is `$disconnect`
/ s007); a stale connection 410 is logged and the other post still proceeds.

### 4a. Frame shape (amended 2026-06-07) — `gameId` as non-trusted lookup key
The move frame is `{ action:'move', gameId, square }`.

- **Why `gameId` is in the frame:** UC3 must `GetItem(Games)` to authorize and
  apply a move, and `GetItem` needs the `gameId` key. The connectionId→gameId
  binding lives ONLY in the `Connections` table; the move path is deliberately
  NOT granted to read `Connections` (S5), and the delta forbids a new
  connection-keyed Games GSI. So the client supplies `gameId` as the lookup key.
- **Why it is SAFE (no trust given to the client):** `gameId` selects WHICH game
  record to read; it confers no role and no capability. Authorization is
  unchanged — the handler matches the REAL
  `event.requestContext.connectionId` against the fetched item's stored
  `hostConnectionId`/`guestConnectionId`. A forged/guessed `gameId` resolves a
  record the sender is not bound to → matches neither slot → **reject, no write**.
  Identity is never read from the body (same rule as the s005 "never trust a
  body connectionId"). See apigw-websocket.md S1 for the full invariant.
- **Required UC3-adjacent server change — guest gameId availability.** Verified
  in code (2026-06-07): the **host** holds `gameId` client-side (it minted the
  game and sends `{action:'register', gameId}`), but the **guest** joins by
  `code` and the `game-ready` frame today carries only `{ type, role }`
  (`src/lambda/ws/join.ts:148-166`, `src/app/src/game/socket.ts` `GameReadyMessage`).
  The guest therefore has NO `gameId` to put in its move frame.
  **This slice must add `gameId` to the `game-ready` frame** so the guest learns
  it. This is a small server + SPA-type change inside the s006 boundary (no new
  data class — `gameId` is an opaque server-generated id already known to both
  sides post-join; it is not the join `code` and discloses no opponent
  connection detail). The engineer makes this change as part of UC3/UC4:
    - `join.ts` `game-ready` payload: add `gameId` to BOTH the host and guest
      `postToConnection` payloads.
    - `socket.ts` `GameReadyMessage`: add `gameId: string`; `ClientFrame`
      `move` variant: add `gameId: string`; SPA stores the `gameId` from
      `game-ready` and threads it into every `move` send.

### 5. SPA — render only server broadcasts (no infra touch) + OI-33 fold-in
- The board screen sends `{action:'move', gameId, square}` on click (the
  `gameId` learned from the `game-ready` frame — §4a) and **does not**
  update optimistically; it renders `board`/`currentTurn`/`status` from the
  `board-update` it receives, and the result screen from `game-over`. This is the
  server-authoritative contract already stated in current.md §Game integrity.
- **OI-33:** the SPA's WS error handler maps server reason `code-not-found` →
  "Game not found. Check the code and try again." (replacing the generic
  "Something went wrong"). One-line mapping, **no Lambda/API change**, no infra.

### 6. OI-25 SPA build-sha carrier (version-identifiability, principles/01)
The slice references the SPA build-sha carrier. **This is a pipeline/build-define
concern, not an infra resource** in this delta — named here for cicd:
- The SPA already serves through CloudFront/S3 (s001). Its build identity carrier
  is the **`window.OXO_CONFIG.buildSha`** runtime-config field written by the
  same deploy step that injects `wsUrl` (s005 config-injection mechanism reused),
  sourced from `GITHUB_SHA`, and surfaced in a DOM `<meta name="build-sha">` /
  visible footer so a deployed page is version-identifiable. **cicd owns wiring
  the define/inject step; no CDK resource changes.**
- The **backend** build identity (already required by principles/01 for the WS
  surface): `oxo-ws-fn` emits its build sha (from a `BUILD_SHA` env var set at
  `update-function-code` time, or the Lambda version) as a **structured log
  field** on every invocation, so a relayed move is traceable to a code version.
  This is a log-field carrier on an existing function — **named for the engineer,
  no infra resource added.**

---

## What does NOT change (confirm, don't widen)
- **No new Lambda function.** `move` reuses `oxo-ws-fn`.
- **No new table.** `board`/`currentTurn`/`status`/`winner`/`version`/`moveCount`
  are attributes on the existing `Games` item (schemaless add — no table update,
  no GSI). `Connections`, `ConnectAttempts` unchanged.
- **No new API, no new route-selection expression, no new stage.** One added
  route key on the existing WS API.
- **`oxo-ws-fn` IAM role UNCHANGED.** It already has `Query`/`GetItem` on Games +
  GSI, conditional `UpdateItem` on Games, Put/Delete on Connections, and
  `ManageConnections` on this API ARN. `move` needs **`GetItem` on Games** (read
  current board — already granted) and the **already-granted** `UpdateItem` +
  `ManageConnections`. **No grant is widened.** (Confirm in the policy test.)
- **No new principal, no `oxo-ws-auth-fn` change** — `move` is post-`$connect`,
  the connection is already authorized; the authorizer does not re-run per
  message (and on WS it has no result cache by platform rule — strike 4 — but it
  is simply not in the per-message path at all).
- **No new deploy-role grant** — `oxo-deploy` already has
  `lambda:UpdateFunctionCode`/`GetFunction` on `oxo-ws-fn`; route + attribute
  adds are CDK/CFN-managed under existing bootstrap trust. No manual deploy step.
- **No WAF/CloudFront/region change.** WS path is not fronted; eu-west-2 only;
  us-east-1 still only holds the CloudFront WebACL.
- **`$connect` authorizer, WAF, throttle, TTLs** — all unchanged.
- **Local two-player (s002) / vs-AI (s003)** — untouched, client-only.

---

## §30 — cross-stack contract for this slice
No new cross-stack handoff. The s005 wss-URL handoff and route-key/action match
contract is **extended by one route**: the composed synth-contract test now
asserts the WS API synthesises **five** route keys including `move`, so the SPA's
`action:'move'` value matches a synthesised `RouteKey` (the same "action equals a
route" guard that caught the s004 prod-404 class). No new export, no new import.

---

## Retry/backoff posture per call (process §5a)
This slice's calls are all **in-AWS, low-latency, single-region**:
- **`UpdateItem` (the move write):** no exponential-backoff retry on
  `ConditionalCheckFailedException` (it is a business reject, not a transient
  fault → `move-rejected`). For the **`version`-only race** where the move is
  otherwise legal: **at most ONE** immediate re-read + re-evaluate, then
  reject — no jittered loop (keeps p95 < 1s; an unbounded retry could blow the
  latency budget). Transient DynamoDB throttling/5xx uses the **AWS SDK default
  retry** (standard mode: exponential backoff + jitter, max 3 attempts);
  timeout budget for the whole handler is the Lambda 5s timeout; on exhaustion
  the handler logs and sends `move-rejected` so the player can retry the click
  (the board is unchanged because no write committed).
- **`@connections` POST (relay):** **no application-level retry** — a failed post
  to one connection (e.g. 410 Gone / transient) is logged; the other post still
  proceeds; the SDK default retry covers transient 5xx. Rationale: a move's
  authoritative state is already committed in `Games`; the relay is a
  best-effort push, and a missed push is recovered by **reconnect-replay in
  s007**, not by hammering a possibly-dead socket. Timeout: SDK default per post,
  well within the 5s handler budget. On exhaustion: log + continue (the other
  player still sees the move).
- **`GetItem` (read current board):** SDK default retry; if it exhausts, the
  handler aborts before any write → board unchanged → `move-rejected`.

---

## Local vs cloud-only gap (principles/02 — this is the engineer's OI-28 spec)

The engineer builds the local stand-up (OI-28) this slice. The move handler must
be written against **hexagonal ports** (OI-17) so it stands up locally:

**Stands up LOCALLY (port + local adapter substitute):**
- **Move validation + win/draw + draw-by-fill logic** — pure function over
  `(board, currentTurn, square, senderRole)` → `{accepted, newBoard, nextTurn,
  terminal, winner}`. Zero AWS. This is the bulk of the slice's logic and is
  fully unit-testable and locally runnable.
- **Games store port** — `getGame(gameId)`, `applyMove(gameId, expectedVersion,
  patch)` (the conditional write) behind an interface. Local adapter: in-memory
  map or DynamoDB-Local; the conditional/version semantics are reproduced by the
  local adapter so the optimistic-lock branch is exercised locally.
- **Relay/transport port** — `postToConnections([id], message)` behind an
  interface. Local adapter: an in-process WS or a stub that records posts, so the
  "exactly 2 posts / 1 reject post / 4 on terminal" assertions run locally.
- **The SPA move-send + render-on-broadcast loop** — runs locally against the
  local transport adapter (no cloud).

**Cloud-only (cannot stand locally) — and the covering control:**
| Cloud-only item | Why | Covering control |
|---|---|---|
| `$request.body.action='move'` → route → Lambda dispatch | API GW v2 route-selection is a platform behaviour | **Synth-contract test** asserts the 5th route key `move` exists (the action-matches-route §30 guard); + prod **functional smoke** (move A→B) |
| Real `@connections` POST delivery semantics (410 Gone, ordering, latency) | API GW Management API runtime behaviour | s005 walking-skeleton **already proved** the deployed relay path; this slice's **prod smoke** (success-measure #1, p95 < 1s) re-exercises it with 2 real browsers |
| DynamoDB conditional-write atomicity under genuine concurrency | Platform consistency guarantee | Local adapter reproduces the *branch*; the *guarantee* is a **code-policy pin** (the `ConditionExpression` is asserted present in a synth/unit test) + **prod smoke** on success-measure #4 (zero divergence) |
| `oxo-ws-fn` IAM grant sufficiency (no widening) | IAM is cloud-only | **Policy test** asserts the role still has exactly the s005 grant set and no more (move added zero permissions) |
| Lambda build-sha env/log carrier | deploy-time injection | **Prod validation:** a relayed-move log line carries `buildSha` (principles/01) |

A delta with no local/prod gap list is incomplete — this table is the engineer's
contract for what the local stand-up must substitute and what must be proven in
cloud.

---

## Version-identifiable deployment (principles/01)
Deployable surfaces touched and their build-identity carriers:
- **SPA (CloudFront/S3):** `window.OXO_CONFIG.buildSha` runtime-config field +
  visible `<meta name="build-sha">`/footer, injected by the deploy step from
  `GITHUB_SHA` (OI-25 — cicd wires it; no infra resource).
- **`oxo-ws-fn` (the move relay surface):** `buildSha` structured **log field**
  on every invocation (from a `BUILD_SHA` env set at `update-function-code`, or
  the Lambda version), so a relayed/rejected move is attributable to a code
  version. Named for the engineer; no infra resource added.

---

## Deploy order & rollback posture
- **Deploy order unchanged:** `OxoOnlineWafUsEast1` → `OxoGameProd` →
  `OxoOnlineProd`. The `move` route + the `oxo-ws-fn` code update are inside
  `OxoGameProd`; the SPA render/OI-33/buildSha changes are app code in
  `OxoOnlineProd`.
- **Attribute add is schemaless** (no DynamoDB table update, no GSI, no
  replacement) — zero-downtime, additive.
- **Route add is an in-place WS API update** — additive, low risk.
- **Rollback:** removing the `move` route and rolling back `oxo-ws-fn` code
  reverts to the s005 join-only behaviour; the new `Games` attributes simply stop
  being written/read (harmless orphan fields, TTL-reaped in 24h). SPA rollback is
  a prior-artifact redeploy; if a client sends `move` to a rolled-back API the
  action is unrouted and dropped (no crash) — the board screen shows no update
  and the user can retry after the next deploy. Lambda code rollback is
  roll-forward (versioning not enabled — s004 default).

---

## Acceptance — technical/observable conditions (I contribute these; co-authored NEXT with product)
T = technical/observable; S = security-policy (becomes a policy test).

- **T1 (relay happy path):** With an `active` game and both connections bound, a
  valid in-turn `move` from the current player results in a `board-update` to
  **both** connections within 1s (p95 over ≥10 moves), with identical `board`
  and the `currentTurn` flipped to the other role.
- **T2 (zero divergence):** At game end, the `board` rendered in browser A equals
  browser B square-for-square (success-measure #4).
- **T3 (server win/draw):** A winning line produces a `game-over`
  `result:'X-wins'|'O-wins'` to both; nine filled squares with no line produces
  `result:'draw'` to both; both within 1s of each other (success-measure #3).
- **T4 (board lock after terminal):** After `game-over`, a further `move` from
  either connection is rejected (`move-rejected`) and a `GetItem` on `Games`
  shows `status` ∈ {`won`,`drawn`} and `board` unchanged.
- **T5 (OI-33):** Joining a non-existent code yields the readable "Game not
  found. Check the code and try again." message (the prior generic text is gone;
  the s005 failing case F3/T4 goes green).
- **T6 (init):** After a successful `join`, a `GetItem` shows
  `board="---------"`, `currentTurn="X"`, `version=0`, `moveCount=0` (set in the
  join conditional write).

- **S1 (sender-is-a-player binding; amended 2026-06-07):** The move frame is
  `{ action:'move', gameId, square }` where `gameId` is a **non-trusted lookup
  key**. A `move` is accepted ONLY when, after `GetItem(Games, gameId)`,
  `event.requestContext.connectionId` equals the `hostConnectionId` or
  `guestConnectionId` of THAT item, AND that connection's role equals
  `currentTurn`. The role is derived server-side from the connectionId↔game
  binding, **never** from a client-supplied `role`/`player`/`connectionId`/`gameId`
  field. Explicit reject cases (each yields `move-rejected`, **no write**):
    - **S1a forged/foreign gameId:** a `move` whose `gameId` names a game the
      sender's REAL connectionId is NOT bound to → matches neither slot → reject;
    - **S1b non-existent gameId:** `GetItem` miss → reject;
    - **S1c spectator/stale/wrong-game connection** on the sender's own game →
      reject.
  `gameId` selects the record to authorize against; it cannot promote the sender
  into a role its connectionId does not hold.
- **S2 (turn enforcement, DDB unchanged):** An out-of-turn `move` yields
  `move-rejected` to the sender only and a `GetItem` confirms `board` and
  `currentTurn` are byte-identical to pre-move (success-measure #2).
- **S3 (state-transition lock by condition, not just code):** No accepted write
  occurs when `status ≠ 'active'`; this is enforced by the `UpdateItem`
  `ConditionExpression` (`status = 'active'` AND `currentTurn = senderRole` AND
  `version = expected`), proven by a test that mutates `status` to `won` out of
  band and shows a subsequent `move` writes nothing.
- **S4 (relay amplification bound):** An accepted non-terminal move triggers
  **exactly 2** `@connections` POSTs (terminal ≤ 4); a rejected move triggers
  **1** POST and **0** writes — asserted via the transport-port spy locally and
  observable in cloud logs.
- **S5 (no grant widening):** `oxo-ws-fn`'s IAM policy is byte-for-byte the s005
  grant set — `move` added zero permissions (no new action, no `*`).
- **S6 (square-free + version CAS):** Two near-simultaneous moves on the same
  free square result in exactly one accepted write (`version`+1) and one
  `move-rejected`; the board never holds two writes for one click (no lost
  move / no double-fill).

---

## Security conclusion (gates §9a auto-accept vs human review)
See `architecture/security/apigw-websocket.md` (s006 section) and
`architecture/security/dynamodb-games.md` (s006 additions) for the per-resource
checkable controls. Conclusion sentence (verbatim in the return):

**Is there new attack surface / data flow / trust boundary? A new DATA FLOW and a
sharpened TRUST RULE — YES; a new public surface, principal, table, API, region,
or IAM grant — NO; therefore this is NOT a §9a auto-accept and the gated
security review applies, but its blast radius is bounded to the existing
`oxo-ws-fn`/`Games` boundary and every new control is a condition on an existing
write or an assertion that an existing grant was not widened.**

### Open risks (carried to the gate)
- **OR-S006-a — `version` re-read single retry vs strict reject:** a legitimate
  near-simultaneous move that loses the `version` CAS is rejected (player
  re-clicks) rather than auto-retried beyond one re-read, to protect the < 1s p95.
  Bounded, deliberate; reversal: widen the bounded retry if rejects annoy users.
- **OR-S006-b — relay is best-effort (no per-post retry / no GoneException
  cleanup):** a dropped `@connections` push is not re-pushed this slice; recovery
  is reconnect-replay in **s007**. The authoritative board is always correct in
  `Games`; only the *push* can be missed. Carried, closed by s007.
- **OR-H2-b (inherited):** guest code-as-credential pre-join — unchanged, closed
  by identity (C6).
- **OI-10 (inherited):** no reconnect-after-reload — deferred to s007 by the slice.
