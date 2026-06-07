# Delta 007 — Real `$disconnect`: abandon + notify + clean up

## Decision: FULL delta (arch-lite §21 does NOT apply, but the delta is SMALL)
The slice turns the EXISTING `$disconnect` **stub** route into a real handler.
It adds a runtime data flow (a `$disconnect`-triggered conditional `Games`
abandon + a single survivor notification + a `Connections` delete) and touches
one trust rule (a platform-fired-only handler must never let one client abandon
another's game). That is a sharpened data flow, so the security review is gated.
It does **not** add a new public surface, a new principal, a new table, a new
API, a new region, or a new deploy-role grant. **One IAM grant IS added** — a
scoped `dynamodb:GetItem` on the `Connections` table for `oxo-ws-fn` (see §3) —
the only non-confirm change in the delta. We reuse everything else from
s004/s005/s005-h2/s006.

Scope discipline (Killick minimum): the graceful-disconnect path only —
look up game, conditional-abandon (never overwrite a terminal game), notify the
ONE survivor, delete the disconnecting row. **No reconnect** (OI-10 ruled OUT by
the slice), no leaderboard write (C5/s009), no waiting-host UI, no idle-TTL
change.

---

## Confirmations the slice asked for (no widening except §3)
- **No new route.** `$disconnect` already exists on the WS API as a **stub**
  (route count stays **5**: `$connect`/`$disconnect`/`register`/`join`/`move`;
  still **no `$default`**). We make the stub real — no `AWS::ApiGatewayV2::Route`
  add.
- **No new function.** `$disconnect` is already wired to the existing `oxo-ws-fn`
  (route-dispatch on `$request.body.action`, with `$disconnect` a platform
  lifecycle route, not an `action`). Reuse it.
- **Survivor notification via the EXISTING `ManageConnections` grant.** `oxo-ws-fn`
  has `execute-api:ManageConnections` on **this WS API ARN only** (s005,
  re-confirmed s006). The `opponent-disconnected` post is the **same** mechanism
  as `game-ready`/`board-update`. **No grant widening here.** **Confirmed.**
- **`Connections` row delete uses the EXISTING `DeleteItem` grant.** `oxo-ws-fn`
  already has `dynamodb:DeleteItem` on the `Connections` table ARN (s005).
  **Confirmed, not widened.**
- **`Games` conditional abandon uses the EXISTING conditional `UpdateItem`
  grant** on the `Games` table ARN (s005/s006). Same CAS discipline as the s006
  move write — a `ConditionExpression`, not a read-modify-write race.
  **Confirmed, not widened.**

---

## New-mechanism flag (process §30)
**NO new platform integration mechanism.** Every primitive is already in
production and probed:
- `$disconnect` lifecycle route → `oxo-ws-fn`: the route already exists (stub).
  The platform `$disconnect` event itself is a new *handler-body* but not a new
  *mechanism* — `$connect`/`$disconnect` lifecycle routing was stood up at s005.
- `@connections` POST (survivor notify): walking-skeleton-probed at s005,
  re-used at s006. Same role grant, same API ARN. The `opponent-disconnected`
  message is the same mechanism.
- Conditional `UpdateItem` on `Games`: same CAS mechanism as the s006 move write.
- `GetItem` on `Connections`: the **action** is new for this role (see §3), but
  `dynamodb:GetItem` against a DynamoDB table is a mechanism this system already
  exercises (the move path `GetItem`s `Games`; the authorizer `GetItem`s the
  `code-index`). No new mechanism — only a new resource-scoped grant.

Because no mechanism is new, **no new walking-skeleton probe is required.** The
in-slice proof obligation is the **functional smoke** (close browser A → browser
B sees `opponent-disconnected` and returns to the mode selector < 10s) — an
acceptance condition (success-measure #1), not a skeleton probe.

---

## What changes

### 1. `$disconnect` handler — abandon + notify + clean up (the slice core)
The platform fires `$disconnect` with **only** the disconnecting
`event.requestContext.connectionId` — it carries **no `gameId`**. So the handler
must:

1. **`GetItem(Connections, connectionId)`** to resolve the disconnecting
   connection's `gameId` and `role`. (This is the NEW grant — §3.) If the row is
   **absent** (already TTL-reaped, or a connection that never registered/joined):
   nothing to do → log and return (no game to abandon, no survivor to notify).
2. **`GetItem(Games, gameId)`** (already-granted read) to read `status`,
   `hostConnectionId`, `guestConnectionId`. If absent (24h-TTL-reaped) → log,
   then still attempt the `Connections` delete in step 5 and return.
3. **Conditional abandon — `active` → `abandoned` ONLY.** A single atomic
   conditional `UpdateItem` on `Games`:
   - `ConditionExpression`: `status = :active`
   - `UpdateExpression`: `SET status = :abandoned`
   - On `ConditionalCheckFailedException`: the game was **not** `active` (it was
     `won`/`drawn`/already-`abandoned`/`waiting`-without-the-active-flip, or a
     simultaneous second disconnect already abandoned it) → **no write, swallow
     the exception**, do not notify on a terminal game (see §waiting/terminal).
     This is the **won/drawn guard** — a terminal result is never overwritten.
4. **Notify the survivor — at most ONE `@connections` POST.** The survivor is the
   bound connection that is **not** the disconnecting one
   (`hostConnectionId`/`guestConnectionId`, whichever ≠ the disconnecting
   `connectionId`). Post **one** `{ type:'opponent-disconnected' }` frame to it.
   This post happens **only when the step-3 abandon actually committed** (i.e. the
   game was `active`) — so a terminal-game disconnect sends **zero** posts.
   - **Survivor post fails with `GoneException` (410):** the survivor's socket is
     also already gone → **both players gone** → swallow + log, **no retry, no
     re-post storm** (there is nobody to tell). The game is already `abandoned`;
     the `Games`/`Connections` TTLs reap the rest. This is the bounded answer to
     the slice's "what happens when the survivor's post fails".
5. **Delete the disconnecting `Connections` row** — `DeleteItem(Connections,
   connectionId)` (already-granted). Runs in **all** branches above (active,
   terminal, missing-game) so no stale `connectionId` accumulates. Best-effort: a
   `DeleteItem` failure is logged; the 2h `Connections` TTL is the backstop.

**Order rationale:** abandon (3) before notify (4) so the survivor is never told
"opponent disconnected" on a game we then fail to abandon; delete (5) last so a
mid-handler crash still leaves the Connections row for the TTL to reap rather
than orphaning a half-abandoned game with no trace.

### 2. Waiting-state / terminal-state disconnects (thin handling — confirm)
- **Host leaves while `waiting`** (created a game, guest never joined): step-3
  condition `status = :active` is **false** (status is `waiting`) → **no abandon
  write**, and there is **no survivor** (`guestConnectionId` absent) → **zero
  posts**. Just the step-5 `Connections` delete. The `waiting` game is left to
  the 24h `Games` TTL. **Thin handling confirmed** — we do NOT add a
  `waiting`→`abandoned` transition (no observer to benefit; the slice §NOT-in-scope
  defers waiting-host UX). *(If a later slice wants waiting games abandoned for
  hygiene, widen the condition to `status IN (active, waiting)` — noted, not done.)*
- **Disconnect after `won`/`drawn`** (player closes tab on the result screen):
  step-3 condition false → no write, no notify (the game is over; the survivor
  already saw `game-over`). Just the `Connections` delete. Success-measure #4
  (terminal status not overwritten) is satisfied by the condition.
- **Simultaneous double-disconnect** (both tabs close together): each invocation
  runs independently. The first to commit flips `active`→`abandoned`; the
  second's condition fails (status now `abandoned`) → no second write, its
  survivor post (if attempted) hits `GoneException` → swallowed. Both
  `Connections` rows deleted. No race corruption — the condition serializes them.

### 3. IAM — ONE added grant: `dynamodb:GetItem` on `Connections` for `oxo-ws-fn`
This is the **only** permission change in the slice. `$disconnect` must resolve
`connectionId → gameId`, and that binding lives **only** in the `Connections`
table. s005 granted `oxo-ws-fn` `PutItem`/`DeleteItem` on `Connections` but
deliberately **not** `GetItem` (the move path was kept Connections-read-free —
s006 §S5). `$disconnect` legitimately needs the read.

- **Add:** `dynamodb:GetItem` on the **`Connections` table ARN only** to the
  `oxo-ws-fn` execution role. No `Query`, no `Scan`, no second table, no `*`.
- **Why this is not the s006 move-path widening we avoided:** the move path stays
  Connections-read-free (move authorizes by matching `connectionId` against the
  `Games` item it already reads). Only the `$disconnect` code path uses this read,
  and it reads exactly the **disconnecting connection's own** row by its primary
  key — it cannot enumerate or read other games' connection rows (no `Query`/`Scan`).
- This grant is **CDK/CFN-managed under existing bootstrap trust** — **no new
  deploy-role grant** (`oxo-deploy` already updates `oxo-ws-fn` code/policy via
  CDK; it has no `iam:*` mutation — the execution-plane IAM is the CFN execution
  role's job). **No manual deploy step.**

### 4. SPA — `opponent-disconnected` → mode selector (no infra touch)
On receipt of `{ type:'opponent-disconnected' }`, the SPA shows a short visible
"Your opponent disconnected." message and returns the surviving player to the
**mode selector** (the app-load screen) **without a reload** — the WS is closed
and game state cleared client-side. This is app code in `OxoOnlineProd`; **no
Lambda/API/infra change.** Clicking "Online" afterwards starts a fresh
create/join flow (success-measure #5).

### 5. Idle-timeout mechanism (name it; no custom keepalive)
API Gateway WebSocket closes any connection **idle for 10 minutes** and fires the
**same `$disconnect` event** through the **same handler** — so a silently-dropped
client (laptop sleep, network loss with no FIN) is reaped by the platform idle
timeout, then abandon+notify runs exactly as for a tab-close. **We add NO
server-side ping/pong keepalive** (slice §NOT-in-scope). The 10-minute APIGW idle
close is **the** timeout mechanism; the 2h `Connections` TTL is the backstop for
the rare case where the `$disconnect` event itself is lost. Name this on the
data-flow node so the tester knows the survivor-notify latency ceiling for a
silent drop is bounded by the 10-min idle close, not by anything we built.

---

## What does NOT change (confirm, don't widen)
- **No new route** — `$disconnect` stub becomes real; route count stays 5, no
  `$default`.
- **No new function** — reuse `oxo-ws-fn`.
- **No new table** — `Connections`/`Games`/`ConnectAttempts` schema unchanged.
  `abandoned` is an existing-attribute value (`status`), not a new attribute.
- **No new API, no new stage, no new route-selection expression.**
- **`ManageConnections` grant UNCHANGED** — survivor notify reuses the s005
  grant on this API ARN only. **`DeleteItem`/conditional `UpdateItem` UNCHANGED.**
- **ONE IAM addition only:** `dynamodb:GetItem` on `Connections` (§3). Everything
  else is byte-for-byte the s006 grant set.
- **No new principal** — `oxo-ws-auth-fn` untouched; `$disconnect` is
  post-`$connect`, the authorizer does not re-run on disconnect.
- **No WAF/CloudFront/region change on the app path.** (The IMP-008 WAF change in
  §IMP-008 is a separate cicd/infra concern in the us-east-1 WAF stack, not the
  app data plane; it does not touch `$disconnect`.)
- **No `$connect` authorizer / throttle / TTL change.** 24h `Games` TTL and 2h
  `Connections` TTL unchanged.

---

## IMP-008 — WAF runner-IP exclusion (cicd executes; architect blesses the design)
**Blessing (with one tightening).** The IMP-008 design is **sound and accepted**
as written: a `oxo-test-runner-ips` WAF **IP set** (scope **CLOUDFRONT**,
**us-east-1**) added to the existing `OxoOnlineWafUsEast1` stack, referenced by
the existing CloudFront rate-based rule via a **scope-down statement that is a
`NOT` wrapping the IP-set match** — so traffic from a runner IP does NOT count
toward the rate rule, while **all other IPs are still rate-limited and Blocked
exactly as AC3.1 validates.** The `NOT(IPSetReferenceStatement)` scope-down
narrows the rule's *applicability*, it does not change the rule's *action* or
*limit*; the rate rule's Block semantics for non-runner IPs are **preserved
unchanged**, so `slice005-h1-waf-ac3.1.spec.ts` stays meaningful and green for a
non-runner source. The us-east-1 placement is the **already-documented
platform-forced region exception** (CLOUDFRONT-scope WAF MUST live in us-east-1 —
current.md Accounts; aws-architecture skill §region-policy); **no new region is
introduced** — the IP set is a new resource in the *existing* us-east-1 WAF stack.
**One tightening I require:** the IP set is **transient-by-protocol** — the
`make smoke-ci` flow adds the runner IP/32 via read-modify-write (append, never
replace, to survive parallel CI), runs, and **always removes it via `trap`**; and
because WAF IP sets do not self-expire, the **scheduled 24h drain Lambda** named
in IMP-008 done-condition #7 is **required, not optional** — it is the standing
guard against a leaked entry over-privileging a stale IP. The drain Lambda's
synth test is the cicd capability step for this slice. Governance of the set is in
§5 of the security review (deploy-role-only mutation; runner entries transient).

---

## OI-35 — S4 relay-post-count pin on this surface (the honest answer)
**A CloudWatch-metric pin on the `$disconnect` survivor post is NOT cheaply
achievable as a per-call metric.** `execute-api:ManageConnections`
(`@connections` POST) emits **no per-call CloudWatch metric by default** — there
is no out-of-the-box "PostToConnection count" metric scoped to a single
invocation, and standing up a custom EMF metric per post is more machinery than a
hobby-slice pin warrants. **The honest, cheap pin is log-derived:** `oxo-ws-fn`
already emits **structured logs** (and a `buildSha` log field per principles/01),
so the `$disconnect` handler emits a **structured log line per post attempt**
(e.g. `{ evt:'disconnect-notify', gameId, posted:1|0, gone:true|false }`). The S4
pin is therefore a **CloudWatch Logs Insights count over the smoke-window logs**:
assert exactly **≤ 1** `disconnect-notify posted:1` per `$disconnect` event (1 on
an active-game disconnect, **0** on a terminal/waiting disconnect or a survivor
`GoneException`). **Spec THAT as the S4 pin** (same shape as the s006 S4
log-derived assertion). The tester confirms feasibility at acceptance planning;
the carrier already exists, so the cost is one Logs-Insights query, not new infra.

---

## §30 — cross-stack contract for this slice
No new cross-stack handoff on the app path. The s005 wss-URL + route-key/action
match contract is unchanged (no new route key). The IMP-008 IP set adds a
**within-stack** resource in `OxoOnlineWafUsEast1` (no new export/import); its
ARN is consumed by the `make waf-runner-ip-add/remove` CLI by **name**, not by a
cross-stack reference, so no §30 cross-region handoff is added. The existing
SYNTH-CONTRACT-WAF-1 (CloudFront `webAclId` cross-region reference) is unchanged.

---

## Retry/backoff posture per call (process §5a)
All calls are in-AWS, low-latency, single-region (eu-west-2):
- **`GetItem(Connections, connectionId)`:** SDK default retry (standard mode:
  exponential backoff + jitter, max 3 attempts). On exhaustion → log and abort
  the handler (cannot resolve gameId → cannot safely abandon/notify); the 2h
  `Connections` TTL + 24h `Games` TTL are the backstop. Timeout: within the
  Lambda timeout budget.
- **`GetItem(Games, gameId)`:** SDK default retry; on exhaustion → log, skip
  abandon/notify, still attempt the `Connections` delete, return.
- **Conditional `UpdateItem` (abandon):** **no application-level retry on
  `ConditionalCheckFailedException`** — it is a legitimate "not active" outcome
  (terminal/waiting/already-abandoned), **swallowed**, not retried (a retry would
  never succeed and risks overwriting a terminal result). Transient
  throttling/5xx uses SDK default retry. On 5xx exhaustion → log; the game stays
  `active` and the 24h `Games` TTL reaps it (acceptable — a survivor on a still-
  `active` orphaned game is the pre-s007 behaviour, bounded by TTL; **owned
  defect task only if observed**, per process v30 5xx semantics).
- **`@connections` POST (survivor notify):** **no application-level retry.** A
  `GoneException` (410) means the survivor is also gone → swallow + log, **do not
  re-post** (no recipient; a retry storm would be pure waste). Transient 5xx uses
  SDK default retry; on exhaustion → log + continue (the game is already
  `abandoned`; the survivor recovers via their own `$disconnect`/TTL or simply
  reloads). **Exactly ONE post attempt per disconnect** (the amplification bound).
- **`DeleteItem(Connections, connectionId)`:** SDK default retry; on exhaustion →
  log; the 2h `Connections` TTL is the backstop (no stale-row accumulation
  guarantee is lost — TTL still reaps it).

---

## Local vs cloud-only gap (principles/02 — the engineer's stand-up contract)

The s006 hexagonal ports (Games store port, relay transport port) are reused; one
port is extended.

**Stands up LOCALLY (port + local adapter substitute):**
- **The `$disconnect` decision logic** — pure function over
  `(disconnectingConnectionId, gameItem)` → `{ abandon: bool, survivorId: id|none,
  notify: bool }`. Zero AWS. Fully unit-testable: active→abandon+notify-survivor;
  terminal→no-op; waiting→no-op+delete; missing-game→delete-only.
- **Connections store port — extended** with `getConnection(connectionId)`
  (the new read) alongside the existing `putConnection`/`deleteConnection`. Local
  adapter: in-memory map / DynamoDB-Local; the conditional-abandon CAS is
  reproduced by the local `Games` adapter (reusing the s006 conditional-write
  local adapter) so the `won`/`drawn` guard branch runs locally.
- **Relay/transport port** — `postToConnections([survivorId], message)` reused;
  the local stub records the post so the "exactly 1 survivor post / 0 on terminal"
  assertion runs locally; a local `GoneException` simulation exercises the
  swallow-no-retry branch.
- **The SPA `opponent-disconnected` → mode-selector transition** — runs locally
  against the local transport adapter (no cloud).

**Cloud-only (cannot stand locally) — and the covering control:**
| Cloud-only item | Why | Covering control |
|---|---|---|
| Platform `$disconnect` lifecycle event firing on socket close | API GW v2 lifecycle behaviour | **Prod functional smoke** (success-measure #1: close browser A → browser B notified < 10s) |
| API GW **10-min idle timeout** firing `$disconnect` on a silent drop | Platform timeout semantics, un-reproducible locally | **Prod validation note** (named on the data-flow node; not gated by a 10-min test in CI — documented mechanism, the functional smoke uses an explicit close) |
| Real `@connections` 410 Gone delivery semantics for the survivor post | API GW Management API runtime | s005 walking-skeleton **already proved** the relay path; the local stub reproduces the **branch**; prod smoke re-exercises a real post |
| DynamoDB conditional-write atomicity of the abandon under genuine concurrent double-disconnect | Platform consistency guarantee | Local adapter reproduces the **branch**; the **guarantee** is a **code-policy pin** (the `status = :active` `ConditionExpression` asserted present in a synth/unit test) + prod smoke on success-measure #4 |
| `oxo-ws-fn` IAM grant = s006 set **+ exactly one** `Connections:GetItem` | IAM is cloud-only | **Policy test** asserts the role gained exactly `dynamodb:GetItem` on the `Connections` ARN and **nothing else** (no `Query`/`Scan`, no new table, no `*`) |
| Lambda build-sha log carrier on the `$disconnect` invocation | deploy-time injection | **Prod validation:** a `disconnect-notify` log line carries `buildSha` (principles/01) — and is the OI-35 S4 pin carrier |

A delta with no local/prod gap list is incomplete — this table is the engineer's
contract for what the local stand-up substitutes and what must be proven in cloud.

---

## Version-identifiable deployment (principles/01)
Deployable surfaces touched and their build-identity carriers:
- **`oxo-ws-fn` (the `$disconnect` surface):** the existing `buildSha` structured
  **log field** (from the `BUILD_SHA` env set at `update-function-code`, s006) is
  emitted on every `$disconnect` invocation — so an abandon/notify is attributable
  to a code version. This same log line is the OI-35 S4 relay-count pin carrier.
  No infra resource added.
- **SPA (CloudFront/S3):** unchanged carrier — `window.OXO_CONFIG.buildSha` +
  `<meta name="build-sha">` (s006/OI-25). The mode-selector-return code ships
  through the same deploy step; no new carrier.

---

## Deploy order & rollback posture
- **Deploy order unchanged on the app path:** `OxoOnlineWafUsEast1` →
  `OxoGameProd` → `OxoOnlineProd`. The `$disconnect` handler code + the
  `Connections:GetItem` policy add are inside `OxoGameProd`; the SPA
  opponent-disconnected change is app code in `OxoOnlineProd`. The IMP-008 IP set
  is an additive resource in `OxoOnlineWafUsEast1` (first stack in the order;
  one-deploy change, no cross-stack dependency).
- **IAM add is additive** (one scoped read action) — zero-downtime.
- **Rollback:** rolling back `oxo-ws-fn` code reverts `$disconnect` to the s006
  stub (no abandon, no notify — the pre-s007 frozen-board behaviour, bounded by
  TTL). Removing the `Connections:GetItem` grant is a policy roll-back. The
  `abandoned` status value simply stops being written (harmless; existing
  `abandoned` items TTL-reap in 24h). SPA rollback is a prior-artifact redeploy.
  The IMP-008 IP set removal clears the rate-rule scope-down (returns the rule to
  applying to all IPs — its pre-IMP-008 state) with no app/data change.

---

## Acceptance — technical/observable conditions (I contribute these; co-authored with product)
T = technical/observable; S = security-policy (becomes a policy test).

- **T1 (abandon on active disconnect):** With an `active` two-player game, closing
  one connection causes a `GetItem` on the `Games` record to show
  `status = abandoned` within the smoke window (success-measure #2).
- **T2 (survivor notified < 10s):** The surviving connection receives exactly one
  `{ type:'opponent-disconnected' }` frame, and the SPA returns to the mode
  selector without reload, within 10s of the other tab closing (success-measure
  #1, two-browser Playwright).
- **T3 (no stale connectionId):** After the flow, a `GetItem`/`Query` shows the
  disconnecting `connectionId` row is absent from `Connections`; the survivor's
  row is intact (success-measure #3).
- **T4 (terminal not overwritten):** A `$disconnect` fired after `game-over` (tab
  closed on the result screen) does NOT change `Games.status` — a `GetItem` shows
  it remains `won`/`drawn`, and **zero** `opponent-disconnected` posts were sent
  (success-measure #4).
- **T5 (waiting-host thin handling):** A host that closes its tab while `waiting`
  (no guest) leaves `Games.status = waiting` (NOT `abandoned`), sends **zero**
  posts, and its `Connections` row is deleted.
- **T6 (new-game after disconnect):** After the opponent-disconnected transition,
  the mode selector is functional — clicking "Online" initiates a fresh create
  flow with no reload (success-measure #5).
- **T7 (idle-timeout path):** *(documented, prod-validated, not a 10-min CI test)*
  a connection left idle beyond the APIGW 10-min idle close fires the same
  `$disconnect` abandon+notify path — named on the data-flow node.

- **S1 (no cross-game force-abandon — connectionId IS the identity):** A
  `$disconnect` can only abandon the game bound to the **disconnecting
  connection's own** `connectionId` (resolved via `GetItem(Connections,
  event.requestContext.connectionId)`). There is **no client-supplied gameId or
  connectionId** on the `$disconnect` event — the platform sets the connectionId
  and the handler reads it from `requestContext`, never from a body. Therefore a
  client **cannot** force-abandon another player's game (no spoof path). Proven by
  a test that confirms the only game touched is the one whose
  `host`/`guestConnectionId` equals the disconnecting connection.
- **S2 (abandon is conditional, not unconditional):** The abandon write carries
  `ConditionExpression status = :active`; a test mutates `status` to `won` out of
  band and shows a subsequent `$disconnect` writes nothing (the won/drawn guard is
  the condition, not code alone) — mirrors s006 S3.
- **S3 (notification amplification bound = 1):** An active-game disconnect triggers
  **exactly 1** `@connections` POST (to the survivor only); a terminal/waiting
  disconnect or a survivor `GoneException` triggers **0**; never a broadcast.
  Asserted via the transport-port spy locally and the OI-35 log-derived count in
  cloud.
- **S4 (no retry storm on survivor GoneException):** A survivor post that returns
  410 Gone is swallowed with **zero** re-posts — asserted via the local
  GoneException stub (post-attempt count == 1, retries == 0).
- **S5 (exactly one IAM grant added, nothing else):** `oxo-ws-fn`'s IAM policy is
  the s006 grant set **plus exactly** `dynamodb:GetItem` on the **`Connections`
  table ARN only** — **no** `Query`, **no** `Scan`, **no** second table, **no**
  `*`, and **no** widening of `ManageConnections`/`UpdateItem`/`DeleteItem`.
  Assert the positive (the one add) and the negative (nothing else).
- **S6 (IMP-008 preserves AC3.1 block for non-runner IPs):** The CloudFront rate
  rule's `NOT(IPSetReferenceStatement oxo-test-runner-ips)` scope-down leaves the
  Block action and limit unchanged for any source IP **not** in the set;
  `slice005-h1-waf-ac3.1.spec.ts` (or its equivalent) stays green for a
  non-runner source. The IP set mutation is **deploy-role/runner-script only**
  and entries are **transient** (added per-run, removed by `trap`, drained ≤24h).

---

## Security conclusion (gates §9a auto-accept vs human review)
See `architecture/security/apigw-websocket.md` (s007 section),
`architecture/security/dynamodb-connections.md` (s007 GetItem addition),
`architecture/security/dynamodb-games.md` (s007 abandon transition), and
`architecture/security/wafv2.md` (IMP-008 IP set) for the per-resource checkable
controls. Conclusion sentence (verbatim in the return):

**Is there new attack surface / data flow / trust boundary? A new DATA FLOW
(the `$disconnect`-triggered abandon + survivor notify + Connections read/delete)
— YES; a new public surface, principal, table, API, region, or trust boundary —
NO; the one IAM grant added (`dynamodb:GetItem` on `Connections`, used only by the
platform-fired `$disconnect` path, keyed on the disconnecting connection's OWN
connectionId) widens no trust boundary because the connectionId IS the identity
and is set by the platform, not the client — so there is NO force-abandon spoof
path; therefore this is NOT a §9a auto-accept and the gated security review
applies, but its blast radius is bounded to the existing `oxo-ws-fn`/`Games`/
`Connections` boundary and every control is a condition on an existing write, a
single bounded notification, or an assertion that the one added grant was scoped
to exactly one read action on one table.**

### Open risks (carried to the gate)
- **OR-S007-a — `Connections:GetItem` is a real (if minimal) grant widening:** the
  `$disconnect` path now reads `Connections`. Bounded to a single primary-key
  read of the disconnecting connection's own row (no `Query`/`Scan`, cannot
  enumerate other games). Accepted as the minimum to resolve connectionId→gameId.
  Reversal: if a connection→game GSI on `Games` is ever added for another reason,
  `$disconnect` could resolve via `Games` instead and this grant could be dropped.
- **OR-S007-b — survivor notify is best-effort, single attempt:** a survivor on a
  flaky link that misses the one `opponent-disconnected` post is not re-notified;
  their own `$disconnect`/2h TTL or a manual reload recovers them. Bounded,
  deliberate (no retry storm — S4). **This CLOSES OR-S006-b** (the s006
  best-effort-relay risk whose stated recovery was "reconnect-replay in s007"):
  per the OI-10 ruling, relay-loss recovery is **abandon + notify** (this slice),
  **not** reconnect-replay. See the OR-S006-b re-word below.
- **Inherited:** OR-H2-b (guest code-as-credential pre-join, closed by C6),
  OR-S006-a (version CAS reject vs retry — unrelated, unchanged).

### OR-S006-b — RE-WORDED per the OI-10 ruling (slice §OI-10)
The s006 delta and `apigw-websocket.md` s006 section recorded OR-S006-b as
"best-effort relay; recovery is **reconnect-replay in s007**." The OI-10 ruling
(reconnect OUT of s007, unscheduled) makes that framing wrong. **Re-worded
(applied in the s006 security note and risk register at this slice):**

> **OR-S006-b (re-worded 2026-06-07, s007):** the `@connections` relay is
> best-effort (no per-post retry; a dropped board-update push is not re-pushed).
> The authoritative board in `Games` is always correct; only the *push* can be
> missed. **Recovery is graceful disconnect — abandon + survivor-notify (s007),
> NOT reconnect-replay.** Reconnect-replay is **unscheduled** (candidate for a
> C6-adjacent slice or never; per OI-10). In practice a player who misses a
> board-update and whose opponent then disconnects gets the
> `opponent-disconnected` signal and returns to the selector; a player who
> reloads loses the game (no resume) and lands on a fresh mode selector. This is
> the accepted recovery story for relay loss as of s007.
