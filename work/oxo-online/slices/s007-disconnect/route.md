---
slice: s007
slug: disconnect
doc: route
author: engineer
created: 2026-06-07
iteration: 10
process-ref: §11a (UC routing), §19 (schedule edges), §30 (synth/wire-on-deploy
  contracts), §41 (hexagonal), principles/01 (build identity), principles/02
  (local stand-up)
---

# s007 — thin route (ordered failing-test steps, grouped by use case)

ROUTE ONLY. Each step is a failing test (red) → minimum code (green) → commit.
"Commit when green." Steps are sequenced so the solution advances most per step.
Read against the change-impact model: `architecture/dependencies/{class-deps,
data-flow,use-case-deps}.mmd` (s007 `changed` marks present — see §"Which commits
carry .mmd updates").

The s007 blast radius from `data-flow.mmd` (tester planning input): `wsfn`
($disconnect stub→real + Connections GetItem grant), `conn` (now READ on
$disconnect — new GetItem edge), `games` (active→abandoned conditional
transition), `relay` (1-post survivor notify, 0 on terminal/waiting), `cfwaf`
(IMP-008 oxo-test-runner-ips IP-set scope-down). `class-deps.mmd` gains a
`portConnectionStore` node + `getConnection` extension and a `wsDisconnectHandler`
node consuming domain + the two store ports + relay port.

No new platform-integration MECHANISM (delta §"New-mechanism flag"): every
primitive — $disconnect lifecycle route, @connections POST, conditional
UpdateItem CAS, DynamoDB GetItem — is already in prod and probed. So **no new
walking-skeleton probe is required**; the in-slice end-to-end proof is the UC1+UC3
two-browser disconnect skeleton (committed, make target) + the UC2 smoke-ci cycle.

---

## §19 EDGES (schedule constraints on commit + push order — BINDING)

These are READ from the model before building (engineer.md: "a hard edge is a
schedule constraint on your commit and push order"; "the edge being present is
no protection if no one reads it"). Violating any edge below is a principle
failure.

| # | Edge | Constraint | Source |
|---|------|-----------|--------|
| E1 | **IpSetManage deploy-role grant → first push of any IMP-008 CDK resource** | `deployRole` must hold `wafv2:CreateIPSet/GetIPSet/UpdateIPSet/DeleteIPSet/ListIPSets` (scoped) AND that grant must be DEPLOYED via `make -C …/src/infra deploy-oidc` LOCALLY **BEFORE** any push that adds the `oxo-test-runner-ips` IPSet / scope-down / drain Lambda to `OxoOnlineWafUsEast1`. The infra pipeline must NEVER meet IPSet resources it cannot deploy (§39 config-follows-resource — exactly as `Wafv2Manage` was grant-before-WebACL at s005-h1). This is **UC2 STEP ZERO**. | capabilities.md s007 §IMP-008 deploy-role grant check; delta §IMP-008; engineer.md §config-follows-resource |
| E2 | **UC2 Connections:GetItem grant → UC1 handler code deploy** | The `dynamodb:GetItem` on Connections ARN grant must be deployed at or before the UC1 $disconnect handler. Both live in `OxoGameProd`, so a single `cdk deploy OxoGameProd` satisfies it automatically — but the commit adding the handler's `getConnection` cloud-adapter call MUST NOT land/deploy before the commit adding the grant (order them: grant-commit ≤ handler-commit, or same commit). Mint-before-secret class of outage. | use-cases.md §19 edge (S7UC2→S7UC1); delta §3; acceptance S5 |
| E3 | **IMP-008 WAF resources deployed → UC4 smoke-ci path** | `make waf-runner-ip-add` / `smoke-ci` cannot run until the IPSet + drain Lambda are deployed in `OxoOnlineWafUsEast1` (first stack in deploy order). UC4 is tester-owned; this is the deploy-order gate. | use-case-deps.mmd (S7UC2→S7UC4) |
| E4 | **UC1 handler deployed → UC4 prod validation** | The two-browser disconnect smoke needs the REAL handler live (not the stub). | use-case-deps.mmd (S7UC1→S7UC4) |
| E5 | **UC3 SPA deployed → UC4 prod validation** | The smoke needs the SPA to show `opponent-disconnected` and return to the mode selector. | use-case-deps.mmd (S7UC3→S7UC4) |
| E6 | **App-path stack deploy order (unchanged)** | `OxoOnlineWafUsEast1` → `OxoGameProd` → `OxoOnlineProd`. IMP-008 IP set is additive in the first stack; the handler+grant in `OxoGameProd`; the SPA in `OxoOnlineProd`. | delta §"Deploy order & rollback posture" |

**The push containing IMP-008 CDK is BLOCKED until E1 is satisfied locally.** This
is the cicd-flagged BLOCKER. Do UC2 STEP ZERO first, full stop.

---

## Wave plan (parallel UCs — disjoint layers)

`use-cases.md` Set A: UC1, UC2, UC3 build in parallel — disjoint artefacts.

| UC | Layer / owned paths | Parallel-safe? |
|----|---------------------|----------------|
| **UC1** disconnect handler | `src/lambda/` only: `move/ports.ts` (extend), `ws/adapters/connections-ddb.ts` (new), `ws/disconnect/decide.ts` (new pure domain), `ws/disconnect-handler.ts` (new), `ws/handler.ts` ($disconnect case), `ws/move/disconnect.test.ts`; `src/app/local/` move-handler/server parity (UC1 owns the local-server $disconnect path) | YES — Lambda + local-server are UC1's |
| **UC2** infra | `src/infra/` + `scripts/` only: `lib/oxo-online-oidc-stack.ts` (E1 grant), `lib/game-stack.ts` (Connections GetItem), `lib/waf-us-east-1-stack.ts` (IP set + scope-down + drain), `test/*.test.ts`, `scripts/waf-runner-ip.js` (new) | YES — infra + scripts are UC2's |
| **UC3** SPA | `src/app/src/game/` only: `GameRoot.tsx`, `socket.ts` (ServerMessage union), `GameRoot.test.tsx`, `tests/local/` survivor spec | YES — SPA app is UC3's |

**Disjoint at build time.** UC1 owns `src/app/local/` server+move-handler parity
(its own stand-up deliverable per principles/02); UC3 owns `src/app/src/game/`
(the SPA bundle). These are different trees under `src/app/` — no file overlap.

### THE ONE SHARED-FILE RISK (coordinate, do not work around)

Two files are touched by more than one UC. Both are merge-friendly; coordinate by
**appending distinct, path-scoped additions** — never rewrite another UC's region:

1. **Root `Makefile`** — cicd already landed `waf-runner-ip-add`, `waf-runner-ip-remove`,
   `smoke-ci` (lines 170-189) and the `.PHONY` line. Engineers ONLY ADD probe
   targets: UC1+UC3 add `disconnect-skeleton` (shared two-browser probe);
   UC2 adds nothing (its targets exist). Append your target at the end of the
   recipe block and add its name to the single `.PHONY` line as a distinct token.
   If two engineers must both touch `.PHONY` simultaneously → that is the
   collision to flag to the orchestrator, NOT to stash around.
2. **`architecture/dependencies/class-deps.mmd`** — UC1 adds the
   `portConnectionStore` + `wsDisconnectHandler` nodes/edges; UC3 adds nothing to
   class-deps (it touches `data-flow.mmd` `relay`/SPA only, already marked). Both
   mark their additions `classDef changed`. Merge-friendly: distinct node blocks,
   distinct `linkStyle` indices appended at the end. Coordinate by appending; both
   mark `changed`.

`data-flow.mmd` and `use-case-deps.mmd` already carry the s007 `changed` marks
(architect/product landed them) — engineers do not re-mark; the tester clears all
`changed` marks at slice delivery.

No `UCn` feature flag this slice: $disconnect is unconditional (capabilities.md
§Orphan-flag check — "No UC flags introduced in s007"). UC isolation is by
disjoint files, not flags. Do NOT introduce an orphan flag (§40 principle failure).

---

# UC2 — Infra: grant + IMP-008 WAF IP set + drain Lambda  [S5, S6 / AC2.1–2.6]

**Build this UC's STEP ZERO first — it is the cicd-flagged BLOCKER (E1).**

## UC2-S0 — IpSetManage deploy-role grant + LOCAL deploy-oidc (E1 BLOCKER)

- **Red:** `src/infra/test/oidc-stack.test.ts` — assert `deployRole` policy
  contains a statement granting EXACTLY `wafv2:CreateIPSet`, `wafv2:GetIPSet`,
  `wafv2:UpdateIPSet`, `wafv2:DeleteIPSet`, `wafv2:ListIPSets` (scoped — same
  `resources:['*']` justification as the existing `Wafv2Manage` statement, with
  the create-time-no-ARN note; NO `wafv2:*` wildcard, NO IAM escalation). This is
  the code↔policy pin (§30) for the IMP-008 IPSet management actions.
- **Green:** add an `Ipv2IpSetManage` (or fold into `Wafv2Manage`) PolicyStatement
  to `lib/oxo-online-oidc-stack.ts` with those five actions.
- **DEPLOY LOCALLY BEFORE ANY IMP-008 PUSH (E1):**
  `make sso-login` (profile from `.claude/config/aws-profile` = `dev-int`, only if
  token stale) → `make -C work/oxo-online/src/infra deploy-oidc`.
  Confirm the grant is live in the deploy role.
- **Commit:** "s007 UC2: grant deploy role IPSet management (IMP-008 E1 — config
  before resource)". This commit carries the oidc-stack `.mmd`? No — IAM-only,
  no class-dep edge. Push is SAFE (no IMP-008 CDK resource yet — only the grant).
- **Why:** the infra pipeline must never meet IPSet resources it cannot deploy.
  After this lands + deploys, the IPSet/scope-down/drain commits (UC2-S2/S3) may
  be pushed.

## UC2-S1 — Connections GetItem grant (one assertion changes; E2)

- **Red:** `src/infra/test/game-stack.test.ts` — the s006 ws-fn policy pin gains
  EXACTLY ONE changed assertion: `dynamodb:GetItem` on the **Connections table
  ARN** is now present (positive arm, AC2.1/S5). The negative arm (AC2.2/S5)
  asserts UNCHANGED: no `dynamodb:Query`/`Scan`/`*` on any table; `PutItem`+
  `DeleteItem` still on Connections; `GetItem`+`Query`+`UpdateItem` still on Games;
  `ManageConnections` still on the WS API ARN only; no new table. (s006 had a
  `ConnectionsWrite` statement Put+Delete at game-stack.ts:254-256 — either add
  `GetItem` there or add a scoped `ConnectionsRead` statement; the test pins the
  effective grant set, not the statement count.)
- **Green:** add `dynamodb:GetItem` on the Connections table ARN to the ws-fn role
  in `lib/game-stack.ts`.
- **Commit:** "s007 UC2: grant ws-fn dynamodb:GetItem on Connections (S5 — one
  assertion changed, E2 grant-before-use)". **Carries class-deps.mmd** if UC1 has
  not yet landed the `portConnectionStore` node — coordinate; otherwise IAM-only.
- **E2:** this grant must deploy at/before the UC1 handler. Same `OxoGameProd`
  stack → satisfied by the single deploy, but order the COMMITS grant ≤ handler.

## UC2-S2 — WAF IP set + NOT scope-down (S6 / AC2.3, AC2.4, AC2.6)

- **Red:** `src/infra/test/waf-us-east-1-stack.test.ts` —
  - AC2.3: synth contains `AWS::WAFv2::IPSet` `Name: oxo-test-runner-ips`,
    `Scope: CLOUDFRONT`, in the us-east-1 stack (IPAddressVersion IPV4, empty
    `Addresses` at synth).
  - AC2.4: the `RateLimitPerIp` rule's `rateBasedStatement` now carries a
    `scopeDownStatement` = `notStatement` wrapping an `ipSetReferenceStatement`
    referencing the new IP set's ARN; the `limit` (=`CF_RATE_LIMIT_PER_5MIN`) and
    the `block.customResponse.responseCode` (=429) are BYTE-FOR-BYTE unchanged.
  - AC2.6: the existing s005-h1 AC3.1 assertion (Block action + limit for a
    non-runner source) stays green — assert the rule still Blocks at the same
    limit; the scope-down narrows applicability, not action/limit (S6).
- **Green:** add the `CfnIPSet` and the `scopeDownStatement: { notStatement: {
  statement: { ipSetReferenceStatement: { arn: ipSet.attrArn } } } }` to the rate
  rule in `lib/waf-us-east-1-stack.ts`.
- **Mock-vs-platform note (engineer.md):** the synth pin encodes our belief about
  the WAF scope-down semantics; the platform truth (a runner IP actually bypasses
  the COUNT while a non-runner is still Blocked) is `cfwaf` — a `data-flow.mmd`
  platform-gate node in our blast radius. The synth pin covers the SHAPE; the live
  proof is UC4's smoke-ci add→verify→smoke→remove cycle + the non-runner Block
  regression. Do NOT add another mock assertion in lieu of the live cycle.
- **Commit (BLOCKED until E1 deployed):** "s007 UC2: oxo-test-runner-ips IP set +
  NOT scope-down (IMP-008, S6 — Block/limit unchanged for non-runner IPs)".

## UC2-S3 — 24h drain Lambda + schedule (AC2.5)

- **Red:** `waf-us-east-1-stack.test.ts` — synth contains a scheduled Lambda in
  `OxoOnlineWafUsEast1` with a 24h EventBridge (`Rule`/`Schedule`,
  `rate(24 hours)` or `cron`) targeting drain of `oxo-test-runner-ips` (the
  function reads the set, removes entries older than 24h). Assert the function +
  the schedule rule + the target wiring exist. (capabilities.md: the EventBridge
  schedule + same-stack InvokeFunction need NO new OIDC grant — CFN execution role
  handles it.)
- **Green:** add the drain `lambda.Function` + `events.Rule` (24h) + target in
  `lib/waf-us-east-1-stack.ts`; minimal drain handler (`scripts/`- or inline-
  bundled) that get-ip-set → filter age → update-ip-set.
- **Commit (BLOCKED until E1 deployed):** "s007 UC2: 24h drain Lambda for runner
  IP set (IMP-008 standing guard, AC2.5)".

## UC2-S4 — waf-runner-ip.js script (the cicd targets delegate to THIS)

- **Red:** `scripts/waf-runner-ip.test.js` (or a node test under
  `src/lambda`/a dedicated test runner) — assert the script:
  - `add <cidr>` / `remove <cidr>` sub-commands; resolves the IP set ID by NAME
    (`oxo-test-runner-ips`, scope CLOUDFRONT, region us-east-1) at call time (no
    hard-coded ID);
  - **read-modify-write with the lock token** — `GetIPSet` → read `Addresses` +
    `LockToken` → append/remove the CIDR → `UpdateIPSet` with that `LockToken`
    (append-never-replace, to survive parallel CI — IMP-008 open risk);
  - **fail-closed if checkip unreachable / no lock token** — exit non-zero rather
    than proceed (a missing exclusion would masquerade as smoke 429 failures —
    IMP-008 open risk); categorise failures (external availability vs our 4xx).
  - honours `--profile <profile>` passthrough (the Makefile passes
    `--profile $(AWS_PROFILE)` for local; omits it in CI).
- **Green:** write `work/oxo-online/scripts/waf-runner-ip.js`. The root-Makefile
  targets `waf-runner-ip-add`/`waf-runner-ip-remove`/`smoke-ci` already delegate
  to it (lines 170-189) — **the script is the missing piece the cicd targets
  call**; landing it makes those targets executable. No Makefile edit needed for
  UC2 (cicd landed the targets + the allowlist entries).
- **Commit:** "s007 UC2: waf-runner-ip.js read-modify-write IP-set script
  (lock-token, fail-closed; IMP-008 tooling)".

**UC2 §11a probe (UC2's deployable surface):** the smoke-ci cycle —
`make waf-runner-ip-add CIDR=… AWS_PROFILE=dev-int` → `aws wafv2 get-ip-set`
shows the CIDR PRESENT → run smoke → `make waf-runner-ip-remove` (via `smoke-ci`'s
`trap`) → `get-ip-set` shows it ABSENT (IMP-008 done-condition #6 cleanup pin) —
PLUS the drain-Lambda synth pin (UC2-S3) as the committed standing assertion. UC2
is done when AC2.1–2.6 pass AND the IPSet/drain/scope-down are deployed in
`OxoOnlineWafUsEast1` (flag-OFF/additive deploy counts, §11a) AND the add→verify→
remove cycle is green in prod.

**UC2 step count: 5** (S0 blocker, S1 grant, S2 IP set, S3 drain, S4 script).

---

# UC1 — disconnect handler: abandon + notify + clean up  [F3, T1–T5,T7, S1–S4 / AC1.1–1.9]

Hexagonal (§41): the **decision is a pure function**; the cloud adapter and the
handler wiring are separate, separately tested. Build domain-first.

## UC1-S1 — Connections store port + getConnection (port + local adapter)

- **Red:** unit test on the extended port via the LOCAL adapter — `getConnection
  (connectionId)` returns `{ gameId, role } | null`. (The s006 `LocalGameStore`/
  `LocalRelay` exist; add a local Connections store substitute.)
- **Green:** extend `src/lambda/move/ports.ts` with a `ConnectionStorePort`:
  `getConnection(connectionId): Promise<{ gameId; role } | null>` alongside the
  existing put/delete semantics (register.ts currently does raw Put/Delete — the
  port formalises the read; keep put/delete as-is or fold under the port).
- **mmd:** **carries `class-deps.mmd`** — add `portConnectionStore` node +
  `classDef changed`. (Coordinate the shared-file append with UC2-S1 if both land
  near-simultaneously.)
- **Commit:** "s007 UC1: extend store port with getConnection (Connections read
  seam, §41)".  `@covers port-connection-store`.

## UC1-S2 — pure disconnect decision function (S1, S2, S3 core)

- **Red:** `src/lambda/ws/disconnect/decide.test.ts` — pure
  `decideDisconnect(disconnectingConnectionId, gameItem | null)` →
  `{ abandon: bool, survivorId: string|null, notify: bool }`:
  - active game, disconnector = host → `{ abandon:true, survivorId: guest,
    notify:true }`; disconnector = guest → survivorId = host (S1 — only the bound
    game's survivor; the disconnecting connectionId IS the identity).
  - terminal (won/drawn) → `{ abandon:false, survivorId:null, notify:false }`.
  - waiting (no guest) → `{ abandon:false, notify:false }`.
  - null gameItem (missing Games row) → `{ abandon:false, notify:false }`.
  Zero AWS, zero SDK import (domain centre).
- **Green:** write `decide.ts`.
- **Commit:** "s007 UC1: pure disconnect decision (active→abandon+notify-survivor;
  terminal/waiting/missing→no-op; S1)". `@covers wsDisconnectHandler`.

## UC1-S3 — handler orchestration over the ports (T1–T5, S3, S4 / AC1.1–1.7)

- **Red:** `src/lambda/ws/disconnect-handler.test.ts` with port fakes
  (ConnectionStore spy, Games store spy, relay spy), one test per branch:
  - AC1.1 active: 1 UpdateItem(Games abandon) + exactly 1 survivor post + 1
    DeleteItem(Connections). (T1, T2, T3, S3.)
  - AC1.2 terminal: 0 UpdateItem, 0 posts, 1 DeleteItem. (T4, S2, S3.)
  - AC1.3 waiting: 0 UpdateItem, 0 posts, 1 DeleteItem. (T5.)
  - AC1.4 absent Connections row: 0 UpdateItem, 0 posts, delete no-op/logged.
  - AC1.5 absent Games row: 0 UpdateItem, 0 posts, still attempts DeleteItem.
  - AC1.6 survivor GoneException (410): post-attempt count == 1, retries == 0,
    swallowed; game still abandoned (UpdateItem committed before the post). (S4.)
  - AC1.7 simultaneous double-disconnect: first commits abandon; second's
    ConditionalCheckFailed swallowed → 0 posts; both Connections rows deleted.
  - **Order pinned:** abandon (3) → notify (4) → delete (5) last (delta §order
    rationale).
  - **Failure taxonomy (§41, logging tested):** each external-call failure path
    emits the correct category (5xx/timeout after SDK backoff = external
    availability; ConditionalCheckFailed = business swallow, not a failure;
    GoneException = swallow+log). Assert the log fields.
- **Green:** write `disconnect-handler.ts` — `getConnection` → `getGame` →
  `decideDisconnect` → conditional abandon (NOT in the handler — the condition
  lives on the store write, S2) → 1 survivor post when abandon committed →
  DeleteItem in ALL branches.
- **Commit:** "s007 UC1: $disconnect handler abandon+notify+clean-up over ports
  (T1–T5, S3, S4)". `@covers wsDisconnectHandler`.

## UC1-S4 — Connections cloud adapter (getConnection) + abandon-write CAS pin (S2/AC1.8) + structured log (AC1.9)

- **Red (adapter):** `src/lambda/ws/adapters/connections-ddb.test.ts` —
  `DdbConnectionStore.getConnection` issues a `GetCommand` keyed on connectionId
  and maps the item to `{ gameId, role }` / null. **Code↔policy pin (§30):** assert
  the adapter issues ONLY `GetItem` (read) + `DeleteItem` against the Connections
  table — NO Query/Scan — mirroring the games-ddb pin; pins the AC2.1/S5 grant so
  code cannot diverge into a prod AccessDenied.
- **Red (abandon CAS pin, AC1.8/S2):** a synth/code-policy test asserts the
  abandon `UpdateCommand` carries a `ConditionExpression` including `status =
  :active` (export the condition string as a constant — mirror
  `MOVE_CONDITION_EXPRESSION`). The won/drawn guard is the CONDITION, not code
  branching alone. (The local mock cannot enforce real DDB conditional atomicity —
  this pin + UC4 prod success-measure-#4 cover that `games` platform-gate gap.)
- **Red (AC1.9 log):** the handler emits
  `{ evt:'disconnect-notify', gameId, posted:1|0, gone:true|false, buildSha }`
  on every $disconnect invocation — the OI-35 S4 pin carrier the UC4 Logs-Insights
  query (AC4.6) reads. `buildSha` from `process.env.BUILD_SHA` (principles/01,
  never hardcoded).
- **Green:** write `connections-ddb.ts`; add the abandon-write method to the Games
  store adapter (or a small abandon adapter) with the pinned condition; wire the
  log line.
- **Commit:** "s007 UC1: Connections GetItem adapter + abandon CAS pin + S4 log
  carrier (AC1.8, AC1.9, code↔policy §30)". **Carries `class-deps.mmd`**: mark the
  `adapterConnectionsDdb -.->|implements| portConnectionStore` edge `changed`.

## UC1-S5 — wire $disconnect into handler.ts dispatch (E2-gated deploy)

- **Red:** `src/lambda/ws/handler.test.ts` — the `$disconnect` case (currently the
  stub `{ statusCode: 200 }` at handler.ts:73-74) now constructs the real adapters
  (DdbConnectionStore + DdbGamesStore + MgmtRelay, same wiring shape as the `move`
  case) and calls the disconnect handler; returns 200. (S1: reads
  `event.requestContext.connectionId` ONLY — never a body field; the $disconnect
  event carries no body.)
- **Green:** replace the stub case in `handler.ts`.
- **Commit:** "s007 UC1: wire real $disconnect handler into ws-fn dispatch
  (stub→real)". **E2 gate:** this commit (the deploy-bearing one) MUST be ordered
  ≥ UC2-S1 (Connections GetItem grant). Same `OxoGameProd` stack deploy satisfies
  the grant-before-use edge — but do not push this ahead of UC2-S1.

## UC1-S6 — local stand-up $disconnect parity (principles/02; make test-local covers survivor flow)

- **Red:** `src/app/local/move-handler.test.ts` (or a new `disconnect` local test)
  — the local server's `ws.on('close')` (server.ts:104-108 currently just
  unbinds) drives the SAME decision: on a host/guest close of an ACTIVE local
  game, the local relay records exactly 1 `opponent-disconnected` post to the
  survivor; terminal/waiting → 0. Run via `make test-local` (the existing
  Playwright local suite + the local-server change) so the survivor flow is
  covered locally end-to-end.
- **Green:** extend `src/app/local/server.ts` close handler + `move-handler.ts`
  local orchestration to call `decideDisconnect` (the SAME pure domain) over the
  local adapters — local/cloud parity behind the same ports (§41, principles/02).
- **Commit:** "s007 UC1: local stand-up $disconnect parity (survivor notify over
  local adapters; make test-local)".

**UC1 §11a probe:** SHARED two-browser disconnect skeleton with UC3 (defined once
below). UC1 is done when AC1.1–1.9 pass AND the handler is deployed in
`OxoGameProd` (E2 satisfied) AND the shared disconnect skeleton is green in prod
(AC4.1/AC4.2 — survivor sees the message, Games=abandoned).

**UC1 step count: 6** (S1 port, S2 decide, S3 handler, S4 adapter+pins, S5 wire,
S6 local parity).

---

# UC3 — SPA survivor UX: message + mode-selector return  [F1,F2,F4, T2,T6 / AC3.1–3.6]

Builds against a WS message stub (no UC1/UC2 dependency at build time).

## UC3-S1 — ServerMessage union gains opponent-disconnected (contract)

- **Red:** `socket.test.ts` — the `ServerMessage` union accepts
  `{ type: 'opponent-disconnected' }`; the parse path delivers it to `onMessage`.
- **Green:** add `OpponentDisconnectedMessage` to the union in `socket.ts`
  (alongside GameReady/BoardUpdate/GameOver/error).
- **Commit:** "s007 UC3: opponent-disconnected added to ServerMessage contract".

## UC3-S2 — GameRoot handles opponent-disconnected → message + mode-selector (T2, AC3.1, AC3.2, AC3.3)

- **Red:** `GameRoot.test.tsx`:
  - AC3.1: on `{ type:'opponent-disconnected' }`, text "Your opponent
    disconnected." is visible via a STABLE selector (`role="alert"` / a pinned
    `data-testid` / `getByText` of the EXACT pinned string — the tester's
    two-browser smoke keys off this exact text). Authoring-time stable selector
    (smoke-test discipline §22-23).
  - AC3.2: the mode-selector root (`[aria-label="game mode"]` group, already
    present) is rendered after the transition; assert NO `window.location.reload`
    is called (spy).
  - AC3.3: the WS spy records a `close()` after the message is processed.
- **Green:** in `GameRoot.tsx`, extend `handleGameReady` (the central message
  handler) with an `opponent-disconnected` branch: show the message, close the
  socket, clear online state (reuse the `selectMode`/idle-reset clearing of
  `gameId`/`gameCode`/`wsToken`/`onlineGame`/`playSocketRef`), set
  `onlinePhase='idle'` so the mode selector + its surrounding screen render —
  WITHOUT a reload.
- **Surface-change done condition (§22-23):** this adds a new visible message and
  re-renders the mode selector on a smoke-tested screen → verify `tests/smoke/`
  selectors still isolate the CORRECT mode-selector / Online controls after the
  change (not merely that counts pass).
- **Commit:** "s007 UC3: opponent-disconnected → message + mode-selector return,
  no reload (T2, S-stable-selectors)".

## UC3-S3 — clean restart: Online after disconnect starts fresh (F2, T6, AC3.4)

- **Red:** `GameRoot.test.tsx` AC3.4 — after the opponent-disconnect transition,
  clicking "Online" (`aria-label="play online"`) starts a fresh create flow with
  NO residual state: no prior gameId, no prior board, no retained socket.
- **Green:** ensure the disconnect-reset clears ALL online refs/state so the
  subsequent `playOnline` opens a clean socket (the `gameId`-keyed effect at
  GameRoot.tsx:160 re-fires cleanly).
- **Commit:** "s007 UC3: clean Online restart after opponent disconnect (F2, T6)".

## UC3-S4 — local-mode + vs-AI regression (F4, AC3.5, AC3.6) + local survivor browser test

- **Red:** confirm/extend `tests/local/` Playwright + `GameRoot.test.tsx`: local
  two-player plays to win (AC3.5) and vs-AI plays to completion (AC3.6) with NO
  regression — the disconnect path is never reached in those modes. PLUS a local
  browser test of the survivor flow: against the UC1 local stand-up (E: UC1-S6),
  Browser-survivor receives `opponent-disconnected` and lands on the mode selector
  (drives the real SPA in a real browser — engineer.md "real client = real
  browser").
- **Green:** any minimal fix to keep local/AI green.
- **Commit:** "s007 UC3: local-mode/vs-AI regression green + local survivor
  browser test (F4)".

**UC3 step count: 4** (S1 contract, S2 handler+UX, S3 clean restart, S4
regression+local browser).

---

# SHARED §11a probe — two-browser disconnect skeleton (UC1 + UC3, define once)

Per the directive: UC1+UC3 SHARE one committed two-browser disconnect skeleton.
Define it ONCE here; both UCs' §11a done conditions consume it.

- **Committed spec:** `tests/skeleton/disconnect.skeleton.spec.ts` (Playwright,
  REAL browsers — never a node `ws` probe; a node probe is a FALSE GREEN below
  CSP/transport, engineer.md). Two browser contexts pair into one online game
  (reuse the `move-skeleton` pairing helper); Browser A's context/tab is CLOSED;
  assert Browser B shows the EXACT "Your opponent disconnected." text (stable
  selector, the same pinned string as AC3.1) and returns to the mode selector
  within 10s — WITHOUT a reload.
- **make target (root Makefile, APPEND — shared-file coordination):** add
  `disconnect-skeleton` as a peer of `move-skeleton`/`ws-skeleton`:
  `PROD_URL=$(PROD_URL) npm --prefix $(APP) run test:skeleton:disconnect` (or a
  grep into the existing `test:skeleton` config). Append the recipe at the end of
  the IMP-008 block and add `disconnect-skeleton` to the single `.PHONY` token
  list. This is the ONE shared-file append UC1+UC3 coordinate on — distinct
  target name, path-scoped add.
- **Green in prod** = E4 (UC1 deployed) + E5 (UC3 deployed) both satisfied; this
  is the in-slice end-to-end proof that replaces a walking-skeleton probe (no new
  mechanism — delta §"New-mechanism flag").
- **DORA:** emit a `validation_run` row at ref `…:disconnect-skeleton` exactly as
  `ws-skeleton`/`move-skeleton` do.
- **Commit:** "s007: committed two-browser disconnect skeleton + make target
  (UC1+UC3 §11a probe)". This is the only commit that touches the shared root
  Makefile for a probe target — coordinate ownership between the UC1 and UC3
  engineers (single author lands it; the other consumes).

UC4 (tester-owned) consumes this skeleton + the UC2 smoke-ci cycle + the Logs
Insights S4 pin (AC4.6) + the DDB checks (AC4.2/4.3/4.4/4.8). Not an engineer
build step; listed for the deploy-order edges (E3, E4, E5).

---

## Which commits carry `.mmd` updates (engineer.md — same-commit rule)

| Commit | .mmd updated | Marks |
|--------|-------------|-------|
| UC1-S1 (getConnection port) | `class-deps.mmd` | ADD `portConnectionStore` node `classDef changed` |
| UC1-S2 (decide) | `class-deps.mmd` | ADD `wsDisconnectHandler` node `classDef changed` |
| UC1-S3 (handler) | `class-deps.mmd` | ADD edges `wsDisconnectHandler → domain decide / portConnectionStore / portGameStore / portRelay` `changed` |
| UC1-S4 (cloud adapter) | `class-deps.mmd` | ADD edge `adapterConnectionsDdb -.-> portConnectionStore` `changed` |
| UC2-S1 (Connections grant) | `class-deps.mmd` ONLY if portConnectionStore not yet landed (coordinate) — else IAM-only, no edge | — |

`data-flow.mmd` + `use-case-deps.mmd` already carry s007 `changed` marks (landed
by architect/product) — engineers do NOT re-edit them. The tester clears ALL
`changed` marks (all three files) at slice delivery after consuming them.

No unmarked dependency change is permitted (principle failure). Every spec carries
`@covers <node-id>` so impacted specs are mechanically listable (IMP-007).

---

## Capability gaps to flag to cicd (none new — confirm)

- The five IMP-008 allowlist entries (`aws wafv2 get-ip-set *`, `aws wafv2
  update-ip-set *`, `curl https://checkip.amazonaws.com`, `make smoke-ci *`,
  `make waf-runner-ip-add/remove *`) are ALREADY added (capabilities.md §New
  allowlist entries — s007). The cicd-landed root-Makefile targets delegate to
  `scripts/waf-runner-ip.js` which UC2-S4 creates. **No new allowlist gap.**
- `make -C work/oxo-online/src/infra deploy-oidc` + `make sso-login` are existing
  allowlisted forms. No gap for E1.
- If `disconnect-skeleton` needs an `npm run test:skeleton:disconnect` script in
  app `package.json`, that is engineer-owned (tooling self-service) — add it in
  the same commit; flag to cicd ONLY if a new allowlist pattern is required (the
  `npm --prefix $(APP) run …` form is already allowlisted).

---

## Summary

- **UC2: 5 steps** — S0 IpSetManage grant + LOCAL deploy-oidc (E1 BLOCKER), S1
  Connections GetItem (one assertion, E2), S2 IP set + NOT scope-down, S3 drain
  Lambda, S4 waf-runner-ip.js (lock-token, fail-closed). Probe = smoke-ci
  add→verify→remove cycle + drain synth pin.
- **UC1: 6 steps** — S1 port, S2 pure decide, S3 handler orchestration, S4 cloud
  adapter + CAS pin + S4 log, S5 wire dispatch (E2-gated), S6 local parity.
- **UC3: 4 steps** — S1 contract, S2 handler+UX, S3 clean restart, S4 regression +
  local browser.
- **+1 shared probe step** — two-browser disconnect skeleton (UC1+UC3 §11a).
- **§19 edges: E1 (BLOCKER), E2, E3, E4, E5, E6** — see table.
- **Wave:** UC1 (`src/lambda` + `src/app/local`) ∥ UC2 (`src/infra` + `scripts`) ∥
  UC3 (`src/app/src/game`). Shared-file risk: root `Makefile` (append distinct
  probe targets + `.PHONY` tokens) and `class-deps.mmd` (append distinct nodes/
  edges, both mark `changed`).
</content>
</invoke>
