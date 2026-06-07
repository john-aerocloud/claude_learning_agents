---
slice: s007
slug: disconnect
process-ref: §37
co-authored: product + solution-architect
---

# Use cases — s007: disconnect & timeout handling

Use cases are separately buildable and separately testable. Dependency edges are
listed only where a genuine build or deploy dependency exists. False edges waste
parallelism and are not added.

The `$disconnect` Lambda handler is the shared seam for this slice (UC1). UC2
is infra-only (IAM grant + IMP-008 WAF resources); it partially enables UC1 —
the Connections:GetItem grant must land at or before the handler deploy. UC3 is
SPA-only and shares no files with UC1 or UC2. UC4 is tester-owned prod
validation that runs after UC1 + UC3 are deployed.

---

## Parallel sets

```
SET A (parallel — no cross-file dependencies at build time):
  UC1 — disconnect domain/handler (lambda: abandon + notify + clean up)
  UC2 — infra: Connections GetItem grant + IMP-008 WAF IP set + drain Lambda
  UC3 — SPA survivor UX: opponent-disconnected message + mode-selector return

SET B (after UC1 deployed AND UC2 IAM grant lands):
  (UC1 depends on UC2 grant for cloud deploy only — not for local unit tests;
   UC2 grant must be in place at or before the UC1 handler deploy per §19 edge)

SET C (after UC1 + UC3 deployed to prod):
  UC4 — validation: two-browser disconnect smoke + DDB checks + S4/IMP-008
```

UC1 and UC3 share no files (Lambda vs SPA app) and can be built in parallel.
UC2 is independently deployable but has a sequencing constraint: the
Connections:GetItem grant (UC2 synth/policy pin) must land in the SAME infra
commit as or before the UC1 handler code deploy (§19 edge: grant before use).
UC4 is tester-owned; it runs only after UC1 and UC3 are live in prod.

---

## UC1 — Disconnect domain/handler: abandon + notify + clean up

**ID:** UC1
**Actor:** `oxo-ws-fn` Lambda / platform (AWS API Gateway fires `$disconnect`)
**Trigger:** API Gateway fires the `$disconnect` lifecycle event carrying
`event.requestContext.connectionId` for the departing connection.

### Trigger -> observable outcome

The `$disconnect` handler executes the following flow:

1. **`GetItem(Connections, connectionId)`** — resolve the disconnecting
   connection's `gameId` and `role`. If the row is absent (already TTL-reaped,
   or a connection that never registered/joined): log and return (no game to
   abandon, no survivor to notify). Connections delete still attempted (step 5).
2. **`GetItem(Games, gameId)`** — read `status`, `hostConnectionId`,
   `guestConnectionId`. If absent (24h-TTL-reaped): log, attempt step 5,
   return.
3. **Conditional abandon** — `UpdateItem(Games, gameId)` with
   `ConditionExpression: status = :active` → `SET status = :abandoned`. On
   `ConditionalCheckFailedException` (game not active: `won`, `drawn`,
   `waiting`, or already `abandoned`): swallow, no write, do not notify.
4. **Notify the survivor** — post `{ type: 'opponent-disconnected' }` to the
   ONE surviving connectionId (whichever of `hostConnectionId`/
   `guestConnectionId` is NOT the disconnecting one). Sent ONLY when step 3
   actually committed (game was `active`). On `GoneException` (410): swallow +
   log, zero retries (both players gone — nobody to tell).
5. **Delete the disconnecting Connections row** — `DeleteItem(Connections,
   connectionId)`. Runs in ALL branches (active, terminal, missing-game). Best-
   effort: on failure, log; the 2h TTL is the backstop.

**Order:** abandon (3) before notify (4), delete (5) last — so a mid-handler
crash leaves the Connections row for TTL reap rather than orphaning a half-
abandoned game with no trace.

The handler emits a structured log line per post attempt:
`{ evt:'disconnect-notify', gameId, posted:1|0, gone:true|false, buildSha }`.
This line is the OI-35 S4 relay-count pin carrier.

Observable outcomes across branches:
- **Active game disconnect:** `Games.status = abandoned`, exactly 1
  `opponent-disconnected` post to survivor, disconnecting Connections row gone.
- **Terminal (won/drawn) disconnect:** no write to Games, 0 posts, Connections
  row gone.
- **Waiting-host disconnect:** no write to Games (status ≠ active), 0 posts,
  Connections row gone.
- **Both-gone (simultaneous disconnect, survivor GoneException):** first
  invocation commits abandon; second's condition fails. Survivor post swallowed.
  Both Connections rows deleted.

The hexagonal seams from s006 are extended: the Connections store port gains
`getConnection(connectionId)` alongside the existing `putConnection`/
`deleteConnection`. The relay/transport port's `postToConnections` is reused
unchanged. The disconnect decision logic is a pure function
`(disconnectingConnectionId, gameItem) → { abandon, survivorId, notify }`,
zero-infra, fully unit-testable locally.

### Done condition

All of the following pass:
- Unit tests (local adapter / in-memory store) cover: active-game disconnect
  (abandon + notify); terminal-game disconnect (no write, 0 posts); waiting-host
  disconnect (no write, 0 posts); missing-Connections-row (no-op + delete);
  missing-Games-row (delete only); GoneException on survivor post (swallowed,
  0 retries); simultaneous double-disconnect (condition serialises, second is
  no-op).
- Transport-port spy asserts exactly 1 post on active-game disconnect, 0 on all
  other branches.
- Synth/code-policy test: the `UpdateItem` call carries `ConditionExpression`
  with `status = :active` (code-policy pin — won/drawn guard is the condition,
  not code alone).
- UC2 IAM grant (`Connections:GetItem`) is deployed at or before this handler.
- Prod functional smoke (UC4 T1 + T2) passes.

### Acceptance cases

- AC1.1: Unit test — active-game disconnect: after calling the handler with an
  `active` game, the store-port spy records exactly 1 `UpdateItem` to
  `Games` (status → abandoned), the transport-port spy records exactly 1
  `opponent-disconnected` post to the survivor connectionId, and the store-port
  records 1 `DeleteItem` on the disconnecting Connections row.
- AC1.2: Unit test — terminal-game disconnect: handler called with `status=won`
  game: store-port records 0 `UpdateItem` calls to `Games`, transport-port
  records 0 posts, store-port records 1 `DeleteItem` on the Connections row.
- AC1.3: Unit test — waiting-host disconnect: handler called with `status=waiting`
  game (no guest): store-port records 0 `UpdateItem` to `Games`, 0 posts, 1
  `DeleteItem` on Connections.
- AC1.4: Unit test — absent Connections row: `GetItem(Connections)` returns
  nothing; handler logs and returns; 0 `UpdateItem`, 0 posts, 0 `DeleteItem`
  (row not present — delete is a no-op or logged).
- AC1.5: Unit test — absent Games row: `GetItem(Games)` returns nothing; handler
  logs, skips abandon/notify, still attempts `DeleteItem` on Connections row.
- AC1.6: Unit test — GoneException on survivor post: transport-port spy returns
  410 for the survivor post; handler records 1 post attempt (not 2+), 0
  retries; game is still `abandoned` (the UpdateItem committed before the post
  attempt).
- AC1.7: Unit test — simultaneous double-disconnect: first invocation commits
  `UpdateItem` (active→abandoned), second's `ConditionalCheckFailedException`
  is swallowed; second invocation posts 0 `opponent-disconnected` frames; both
  Connections rows are deleted.
- AC1.8: Synth/code-policy test — the `UpdateItem` call for the abandon write
  carries a `ConditionExpression` that includes `status = :active` (pin: the
  won/drawn guard is the condition, not code alone; mirrors s006 AC2.6 / S3).
- AC1.9: Structured log: the handler emits a `disconnect-notify` log line with
  `gameId`, `posted: 1|0`, `gone: true|false`, and `buildSha` on every
  `$disconnect` invocation (OI-35 S4 pin carrier + principles/01).

### Dependencies

- UC2 IAM grant must be deployed at or before the UC1 handler code deploy (§19
  edge — grant before use). Local unit tests do not require UC2 (the local
  adapter stubs all AWS calls).
- No dependency on UC3 (SPA layer — different artefact).

---

## UC2 — Infra: Connections GetItem grant + IMP-008 WAF IP set + drain Lambda

**ID:** UC2
**Actor:** Engineer/CICD (CDK/CFN stack update + WAF IP-set tooling)
**Trigger:** (a) Stack deploy for `OxoGameProd` (IAM policy update);
(b) `make waf-runner-ip-add` / `make waf-runner-ip-remove` in CI (IMP-008
runner IP management); (c) Scheduled 24h drain Lambda (IMP-008 standing guard).

### Trigger -> observable outcome

Three independently observable infrastructure changes:

**A — Connections:GetItem grant (OxoGameProd):**
`oxo-ws-fn` execution role gains exactly `dynamodb:GetItem` on the `Connections`
table ARN only. The synth/policy pin test changes EXACTLY ONE assertion from
the s006 pin: the new grant (`dynamodb:GetItem` on `Connections`) is asserted
positive; everything else in the s006 grant set is asserted unchanged (`PutItem`,
`DeleteItem` on `Connections`; `GetItem`, `UpdateItem` on `Games`;
`ManageConnections` on the WS API ARN; no `Query`, no `Scan`, no `*`, no new
table).

**B — IMP-008 WAF IP set + scope-down (OxoOnlineWafUsEast1):**
A `oxo-test-runner-ips` WAF IP set (scope CLOUDFRONT, us-east-1) is added to
the existing `OxoOnlineWafUsEast1` stack. The existing CloudFront rate-based
rule gains a `NOT(IPSetReferenceStatement)` scope-down so runner-IP traffic does
not count toward the rate rule, while all non-runner IPs are still rate-limited
and Blocked (AC3.1 / S6 preserved). The IP set is mutated by a deploy-role/
runner-script only (`make waf-runner-ip-add`/`remove`). Entries are transient:
added per run, removed by `trap` on exit.

**C — 24h drain Lambda (OxoOnlineWafUsEast1):**
A scheduled Lambda runs every 24h and removes all entries from
`oxo-test-runner-ips` that are older than 24h — the standing guard against a
leaked entry over-privileging a stale IP. The drain Lambda's synth test is the
CICD capability step for this slice; it is required, not optional.

### Done condition

All of the following pass:
- Synth/policy test for the IAM change: asserts `dynamodb:GetItem` on
  `Connections` ARN is newly present; asserts all s006 grants are unchanged;
  asserts no `Query`, no `Scan`, no `*`, no additional table. This test changes
  EXACTLY ONE assertion from the s006 version of this test.
- Synth test for the WAF IP set: `OxoOnlineWafUsEast1` synthesises an
  `AWS::WAFv2::IPSet` named `oxo-test-runner-ips` with scope CLOUDFRONT in
  us-east-1; the rate-based rule's scope-down statement is a NOT wrapping the
  IP set reference.
- Synth test for the drain Lambda: a scheduled Lambda exists in
  `OxoOnlineWafUsEast1` with a 24h EventBridge schedule targeting
  `oxo-test-runner-ips`.
- The WAF rule's Block action and limit for non-runner IPs are demonstrably
  unchanged from the s005-h1 state (S6 / `slice005-h1-waf-ac3.1.spec.ts` stays
  green for a non-runner source).

### Acceptance cases

- AC2.1: Synth/policy test — `oxo-ws-fn` execution role policy now includes
  `dynamodb:GetItem` on the `Connections` table ARN (positive assertion: the one
  new grant is present) (S5 positive arm).
- AC2.2: Synth/policy test — the role policy does NOT include `dynamodb:Query`,
  `dynamodb:Scan`, or `dynamodb:*` on any table; `ManageConnections`,
  `UpdateItem`, `DeleteItem`, `PutItem`, and the existing `GetItem` on `Games`
  are present and scoped to the same ARNs as s006 (S5 negative arm — nothing else
  widened; exactly one assertion changes from the s006 pin).
- AC2.3: Synth test — `OxoOnlineWafUsEast1` contains an `AWS::WAFv2::IPSet`
  resource with `Name: oxo-test-runner-ips`, `Scope: CLOUDFRONT`, in the
  us-east-1 stack (IMP-008 IP set resource present).
- AC2.4: Synth test — the CloudFront rate-based rule carries a scope-down
  statement that is a `NOT(IPSetReferenceStatement)` referencing
  `oxo-test-runner-ips`; the rate limit and Block action are byte-for-byte
  unchanged from the s005-h1 state (IMP-008 scope-down correct; S6 Block
  semantics preserved).
- AC2.5: Synth test — a scheduled Lambda exists in `OxoOnlineWafUsEast1` with a
  24h EventBridge (or CloudWatch Events) schedule, targeting the
  `oxo-test-runner-ips` IP set for drain (IMP-008 drain Lambda required).
- AC2.6: Regression — `slice005-h1-waf-ac3.1.spec.ts` (or its functional
  equivalent) remains green for a non-runner source IP after the scope-down is
  applied (S6 AC3.1 preserved).

### Dependencies

UC2 has no build dependency on UC1 or UC3. The Connections:GetItem grant (AC2.1)
has a DEPLOY sequencing constraint: it must be in place at or before the UC1
handler code deploy (§19). The IMP-008 WAF resources are independently deployable
in `OxoOnlineWafUsEast1` (first in the stack deploy order).

---

## UC3 — SPA survivor UX: opponent-disconnected message + mode-selector return

**ID:** UC3
**Actor:** SPA (surviving player's browser)
**Trigger:** SPA receives a `{ type: 'opponent-disconnected' }` WS message.

### Trigger -> observable outcome

On receipt of `opponent-disconnected`:
1. The SPA displays a short, visible "Your opponent disconnected." message.
2. The SPA closes the WS and clears game state client-side.
3. The SPA returns to the mode selector (the app-load screen — "Local", "vs
   Computer", "Online") WITHOUT a page reload.
4. The mode selector is functional: clicking "Online" initiates a fresh game
   creation flow (a new game can be started immediately).

This is pure app code in `OxoOnlineProd` — no Lambda, no API, no infra change.
Stable, inspectable selectors are used throughout (no fragile className or DOM-
structure selectors) per the tester's test-stability contract. The local two-
player and vs-AI modes are unaffected.

### Done condition

SPA component tests cover: the `opponent-disconnected` message is displayed;
the mode selector is rendered (the app returns to the correct screen); the WS
spy records a close event; clicking "Online" after the transition starts a
fresh create flow (no prior game state leaks). Local two-player and vs-AI
regression specs remain green.

### Acceptance cases

- AC3.1: SPA component test — on receipt of `{ type: 'opponent-disconnected' }`,
  the text "Your opponent disconnected." is visible in the UI (stable selector;
  exact text pinned for tester's two-browser smoke).
- AC3.2: SPA component test — after the `opponent-disconnected` message, the
  mode selector screen is rendered (stable selector on the mode-selector root
  element) without a page reload (no `window.location.reload` call observed).
- AC3.3: SPA component test — the WS spy records a `close()` call after
  `opponent-disconnected` is processed (WS cleaned up; no stale socket).
- AC3.4: SPA component test — clicking the "Online" button in the mode selector
  after an opponent-disconnect transition initiates a fresh create flow with no
  residual game state (no prior gameId, no prior board, no prior WS retained
  from the abandoned session).
- AC3.5: Playwright regression — local two-player game plays a full match to win
  without regression (UC3 SPA changes do not touch local mode).
- AC3.6: Playwright regression — vs-AI game plays a full match without regression
  (UC3 SPA changes do not touch AI mode).

### Dependencies

None at build time — UC3 builds against a WS message stub. UC3 needs UC1
deployed for the end-to-end smoke (UC4 validation). UC3 shares no files with
UC1 (Lambda) or UC2 (CDK/WAF) — fully parallel at build time.

---

## UC4 — Validation: two-browser disconnect smoke + DDB checks + S4 log pin + IMP-008

**ID:** UC4
**Actor:** Tester (prod validation spec, post-deploy)
**Trigger:** Post-deploy validation run, after UC1 + UC3 are deployed to prod
and UC2 IAM grant + WAF resources are in place.

### Trigger -> observable outcome

The tester exercises the deployed system across five areas:

1. **Two-browser disconnect smoke (T1 + T2):** Browser A and Browser B are in an
   active online game. Browser A's tab is closed. Within 10 seconds, Browser B
   displays "Your opponent disconnected." and transitions to the mode selector
   without a reload.

2. **DDB abandoned check (T1):** After the smoke, `GetItem` on the `Games` record
   shows `status = abandoned`.

3. **No-stale-connections check (T3):** After the smoke, `GetItem` on the
   `Connections` table for browser A's connectionId shows the row is absent;
   browser B's row is still present.

4. **Won/drawn-not-overwritten check (T4):** Close the tab AFTER a `game-over`
   event. `GetItem` on `Games` shows `status ∈ {won, drawn}` — NOT `abandoned`.
   Zero `opponent-disconnected` posts were sent (observable via Logs Insights).

5. **S4 Logs Insights relay-count pin (S3):** A CloudWatch Logs Insights query
   over the smoke-window logs asserts exactly 1 `disconnect-notify posted:1` log
   line per active-game `$disconnect` event; 0 for terminal/waiting disconnects
   or survivor GoneException.

6. **New-game after disconnect (T6):** After the `opponent-disconnected`
   transition, clicking "Online" in the mode selector initiates a fresh create
   flow without a reload.

7. **IMP-008 smoke-CI path (S6):** The `make smoke-ci` flow adds the runner IP,
   runs the smoke, and removes the runner IP via `trap`. The WAF rate-rule Block
   behaviour is confirmed for a non-runner source (`slice005-h1-waf-ac3.1.spec.ts`
   or equivalent still green).

8. **Waiting-host thin handling (T5):** Browser A creates a game but no guest
   joins. A closes the tab. `GetItem` on `Games` shows `status = waiting` (NOT
   `abandoned`). `GetItem` on `Connections` shows A's row is absent.

### Done condition

All acceptance cases below pass. Success-measures #1–#5 from slice.md are all
green.

### Acceptance cases

- AC4.1: Two-browser Playwright smoke — browser A closes its tab during an
  active online game; browser B displays "Your opponent disconnected." within
  10 seconds of the tab close and transitions to the mode selector without a
  page reload (success-measure #1 / T2) [F1, T1, T2].
- AC4.2: DDB abandoned check — after AC4.1, `GetItem(Games, gameId)` returns
  `status = abandoned` (success-measure #2 / T1) [T1].
- AC4.3: No-stale-connections check — after AC4.1, `GetItem(Connections,
  connectionIdA)` returns no item (row absent); `GetItem(Connections,
  connectionIdB)` returns the survivor's row (success-measure #3 / T3) [T3].
- AC4.4: Won/drawn-not-overwritten — browser A closes its tab immediately after
  seeing a `game-over` result; `GetItem(Games)` shows `status` is `won` or
  `drawn` (NOT `abandoned`); a Logs Insights query over the window shows 0
  `disconnect-notify posted:1` lines for that gameId (success-measure #4 / T4)
  [F3, T4].
- AC4.5: New-game after disconnect — after the `opponent-disconnected`
  transition in AC4.1, clicking "Online" in the mode selector successfully
  initiates a fresh create flow; no reload required (success-measure #5 / T6)
  [F2, T6].
- AC4.6: S4 Logs Insights relay-count pin — a CloudWatch Logs Insights query
  `filter evt = 'disconnect-notify' and posted = 1 | stats count()` over the
  smoke-window returns a count of exactly 1 for the active-game `$disconnect`
  event; a parallel query for the terminal-game `$disconnect` (AC4.4 event)
  returns 0 (OI-35 S4 pin — amplification bound confirmed in prod) [S3].
- AC4.7: Local/AI modes unaffected — a local two-player game and a vs-AI game
  each play to completion without regression; the disconnect handling code path
  is not reached in these modes (mode-selector regression) [F4].
- AC4.8: Waiting-host thin handling — browser A creates a game (status=waiting),
  no guest joins, A closes tab; `GetItem(Games)` shows `status = waiting`;
  `GetItem(Connections, connectionIdA)` shows row absent (T5) [T5].
- AC4.9: IMP-008 smoke-CI path — the CI runner adds its IP to
  `oxo-test-runner-ips` via `make waf-runner-ip-add`, the smoke runs, and
  `make waf-runner-ip-remove` is called via `trap`; the WAF rate-rule Block for
  a non-runner source IP is confirmed green (`slice005-h1-waf-ac3.1.spec.ts` or
  equivalent passes) (S6 / IMP-008) [S6].

### Dependencies

- UC1 must be deployed (handler live in prod — `$disconnect` route real, not stub).
- UC3 must be deployed (SPA shows the `opponent-disconnected` message and returns
  to mode selector).
- UC2 IAM grant must be deployed (handler can `GetItem(Connections)`).
- UC2 IMP-008 WAF resources must be deployed (`make waf-runner-ip-add` targets
  exist; drain Lambda is scheduled).

---

## Dependency summary

```
UC1 ($disconnect handler)    — no local build dependencies; UC2 grant required at deploy
UC2 (infra: grant + IMP-008) — no build dependencies (independent CDK stack update)
UC3 (SPA survivor UX)        — no build dependencies (independent; builds against WS stub)
UC4 (prod validation)        — requires UC1 + UC3 deployed; UC2 grant + WAF in place
```

Parallel sets:
- **Set A (build in parallel):** UC1, UC2, UC3
- **Set B (after UC1 deployed AND UC2 IAM grant lands):** *(no additional build
  step — the handler deploy IS the Set B gate; local unit tests for UC1 run in
  Set A)*
- **Set C (after UC1 + UC3 deployed to prod):** UC4

Shared seam note: UC1 is the only UC writing to the `$disconnect` branch of
`oxo-ws-fn`. UC3 touches only the SPA. UC2 touches only CDK stack definitions.
No serialisation among Set A members — they operate on distinct artefacts.

§19 sequencing edge (UC2 → UC1 deploy): the Connections:GetItem IAM grant (UC2)
must be deployed at or before the UC1 handler code deploy. In a CDK pipeline,
this means the policy update and handler code ship in the SAME `cdk deploy
OxoGameProd` invocation (they are in the same stack), satisfying the constraint
automatically. The IMP-008 resources are in `OxoOnlineWafUsEast1` (first in
deploy order) and have no UC1 dependency at all.

---

## Infra enabler notes (co-decided with solution-architect)

1. **No new route** — `$disconnect` stub becomes real; route count stays 5, no
   `$default`. No `AWS::ApiGatewayV2::Route` resource change.

2. **No new function** — reuse `oxo-ws-fn`. The `$disconnect` handler body is
   the only code addition.

3. **Connections store port extended** — `getConnection(connectionId)` added to
   the port interface alongside existing `putConnection`/`deleteConnection`.
   Local adapter: in-memory map. Cloud adapter: `GetItem` on `Connections`
   (backed by the UC2 grant).

4. **IAM — one grant added:** `dynamodb:GetItem` on `Connections` ARN only
   (UC2). The synth/policy pin test (AC2.1 + AC2.2) changes EXACTLY ONE
   assertion from the s006 version — the positive arm adds the new grant; the
   negative arm asserts nothing else changed.

5. **IMP-008 WAF IP set** — new resource in the EXISTING `OxoOnlineWafUsEast1`
   stack (us-east-1, CLOUDFRONT scope — platform-forced region, not a new
   region). No new cross-stack export/import. `make waf-runner-ip-add/remove`
   tooling consumes the set by name.

6. **Drain Lambda** — required (not optional). Scheduled 24h. Guards against
   stale runner IPs in the WAF IP set. Synth test asserts its existence (AC2.5).

7. **Hexagonal seams (OI-17):** the s006 hexagonal ports are extended. The
   disconnect decision logic is a pure function with no AWS calls — locally
   testable in UC1 without cloud. The relay/transport port is reused unchanged.

8. **Build-sha carriers (principles/01):** `oxo-ws-fn` already injects
   `BUILD_SHA` into every invocation via the `buildSha` structured log field.
   The `disconnect-notify` log line carries this field on every `$disconnect`
   invocation (OI-35 S4 pin carrier). No new carrier needed.
