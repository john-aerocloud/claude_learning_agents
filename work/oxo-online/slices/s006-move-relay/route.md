---
slice: s006
slug: move-relay
iteration: 9
agent: engineer
process-ref: §37 (use-case routing), §12a (read-before-build / updated-in-commit), §19 (schedule constraints from hard edges), §40 (use-case flags), §41 (hexagonal ports/adapters), §30/§17 (skeleton + synth contract + code↔policy pin), v28 (local stand-up + browser tests in build), §5a (failure semantics + retry)
status: planned
model-input: work/oxo-online/architecture/dependencies/{data-flow.mmd, use-case-deps.mmd}; class-deps.mmd is created in this slice (first edition, UC1 step R1.1)
---

# TDD route — s006: move relay + server-authoritative play

Strict TDD throughout: each step is a failing test (red) → minimum code (green)
→ refactor → commit-when-green on trunk. NO production code without a failing
test first. Explicit-pathspec commits; `git pull --rebase` before push.

This route is built **against the dependency model** (§12a read-before-build).
The two `.mmd` files are the input; the hard edges they draw are §19 schedule
constraints on commit/push order (see "§19 hard edges" below). `class-deps.mmd`
does not yet exist — its **first edition** is authored as part of UC1's
port-definition commit (R1.1) and is updated-in-commit on every step that adds,
removes, or redirects a module/port/adapter seam, with the touched nodes/edges
marked `classDef changed` (the tester's plan input; marks cleared only at slice
delivery).

Tag every spec/describe with `@covers <node-id>` against `class-deps.mmd`
(domain-move, port-game-store, port-relay, port-game-lookup, ws-move-handler,
adapter-games-ddb, adapter-relay-mgmt, adapter-local-store, adapter-local-relay,
spa-online-move) and against `data-flow.mmd` (wsfn, games) so impacted specs are
mechanically listable when a node changes (IMP-007).

Counts to satisfy: **6 F, 6 T, 6 S** acceptance cases + the 27 AC-ids in
use-cases.md (AC1.1–AC6.8). F-cases are UC6 (tester-owned, prod). The engineer
owns UC1–UC5 build steps + the synth-contract / policy pins; UC6 is handed to
the tester after the §19 deploy/flip edges are satisfied.

---

## Hexagonal layout (OI-17 — this slice both ADDS move code and refactors)

Follow the s005-h2 ws-auth idiom (`ports.ts` domain-defined interfaces;
`adapters/` implements them; handler orchestrates, imports no SDK in domain).

```
src/lambda/
  move/                          # DOMAIN — pure, zero SDK/transport/APIGW imports
    move.ts                      #   applyMove(board,currentTurn,square,senderRole) → MoveOutcome  (UC1)
    move.test.ts
    ports.ts                     #   GameStorePort, RelayPort, GameLookupByConnectionPort (domain terms)  (UC1/UC2)
  ws/                            # ws-fn handler folder (existing); UC3 SHARED SEAM
    move-handler.ts              #   orchestrate: parse → bind identity → domain → store → relay  (UC3)
    move-handler.test.ts
    adapters/
      games-ddb.ts               #   GameStorePort over DynamoDB conditional UpdateItem CAS  (UC2)
      relay-mgmt.ts              #   RelayPort over @connections POST  (UC3 wiring; mechanism reused from s005)
src/app/
  src/game/                      # SPA (existing); UC4 behind UC4 flag
    OnlineBoard.tsx / socket.ts / JoinScreen.tsx   (move-send, render-on-broadcast, lock, OI-33 map)
  local/                         # UC5 local stand-up (OI-28) — committed run-local entry
    server.ts                    #   local WS server wiring local adapters behind the SAME ports
    adapters/{local-store.ts, local-relay.ts}
```

Domain (`move/move.ts`, `move/ports.ts`) imports **no** SDK / APIGW event type /
DynamoDB AttributeValue. Adapters depend on domain; never the reverse.

---

## WAVE PLAN (explicit — who builds what in parallel, where the seam serialises)

The model (`use-case-deps.mmd`) draws UC1→UC3, UC2→UC3 (port-stable-before-wire),
UC1→UC5, UC2→UC5, UC3→UC6, UC4→UC6. From that:

```
WAVE A (parallel — distinct artefacts, no shared file; default-OFF flags isolate):
  ENG-1  UC1  move domain core            (src/lambda/move/move.ts, move/ports.ts)  — pure, no flag needed
  ENG-1  UC2  Games store adapter          (ws/adapters/games-ddb.ts; join-init extends ws/join.ts)
  ENG-2  UC4  SPA move/render/lock/OI-33    (src/app/src/game/*) behind UC4 flag (default OFF)
  ENG-2  UC5  Local stand-up (OI-28)        (src/app/local/*) — needs UC1+UC2 PORTS to exist (interfaces only)

WAVE B (SEAM — serialised; starts after UC1 + UC2 PORT INTERFACES are stable & unit-green):
  ENG-1  UC3  ws-fn move route handler      (ws/move-handler.ts + dispatch wiring + infra route + synth/policy pins)
         UC3 is the SHARED SEAM: it is the ONLY UC writing ws-fn handler/dispatch.
         No other in-flight UC touches ws/handler.ts → no flag needed in the Lambda;
         the route is simply absent until UC3's infra commit lands.

SKELETON / DEPLOY (between B and C):
  thin deploy of OxoGameProd (move route + ws-fn code) then OxoOnlineProd (SPA),
  then the §17 walking-skeleton browser step (one real move through prod).

WAVE C (after UC3 deployed AND UC4 flag flipped ON in the deployed SPA):
  TESTER UC6 prod validation (F1–F5, T1–T6, S1–S6 prod observation)
```

**Where the seam serialises:** UC3 (ws-fn handler + dispatch). ENG-1 owns UC1→UC2→UC3
as a sequential chain (UC3 imports both ports). ENG-2 owns UC4+UC5 in parallel.
UC5 needs only the **port interfaces** from UC1/UC2 (the `move/ports.ts` file),
not their implementations — so the moment R1.1 (ports.ts) lands, ENG-2 can build
UC5's local adapters against them. If `move/ports.ts` is contested between ENG-1
(implementing) and ENG-2 (consuming for UC5), ENG-1 lands the interface FIRST
(R1.1) and ENG-2 only reads it — no shared-file write collision.

**Where flags isolate:** UC4 lands behind a **UC4 flag (default OFF)** because the
deployed server cannot route `action:'move'` until UC3 deploys; the SPA's
move-send path must be dark in prod until then. UC4 tests run flag-ON. The flag
is factored out of code, then configuration, as UC4's done condition (no orphan
flag at retro — §40). UC1/UC2/UC3 need no flag (pure / adapter / absent-route).

---

## §19 HARD EDGES (schedule constraints lifted from the model — commit/push ORDER)

These are NOT preferences; they are ordering constraints the dependency model
makes mandatory. Violating one is the DEFECT-H2-001 mint-before-secret class.

1. **`move/ports.ts` (R1.1) precedes UC3 handler wiring AND UC5 local adapters.**
   Model edges UC1→UC3, UC2→UC3, UC1→UC5, UC2→UC5 ("port interface must be
   stable before wire"). The port file lands first; consumers compile against it.
2. **UC1 domain (R1.x) + UC2 adapter (R2.x) unit-green BEFORE UC3 handler (R3.x).**
   UC3 imports both; it cannot be test-driven against unstable port shapes.
3. **UC2 join-time board-init write (R2.5) precedes the first prod move.** T6/AC2.5:
   the first `move` finds an initialised item (`board="---------"`, version=0). If
   the move route deployed before join-init, the first move hits an uninitialised
   item. Both land in the SAME ws-fn code push, but the init write must exist in
   code before R3 relies on it — schedule R2.5 before R3.
4. **UC3 deploy (OxoGameProd: move route + ws-fn code) PRECEDES UC4 flag flip.**
   Model UC3→UC6 + the slice note: the server cannot route `move` until UC3
   deploys, so flipping UC4 ON earlier sends `move` to an unrouted action (dropped).
   Deploy UC3 → THEN flip UC4 → THEN integrate.
5. **UC4 flag flip ON PRECEDES UC6 browser validation.** Model UC4→UC6: the SPA
   must be live with move-send + render-on-broadcast + OI-33 before the tester's
   two-browser prod suite can pass.
6. **Walking-skeleton step (§17) PRECEDES UC6's full suite.** One real move through
   the deployed path (valid relayed + out-of-turn rejected) is the early proof;
   the full F/T/S suite builds on a proven path, not a hoped one.
7. **Synth-contract (5th route key) + IAM no-widen policy pin land WITH the UC3
   infra commit** (R3.6 / R3.9) — a route/grant change is undetectable to the
   tester until a human watches a browser unless the contract test fails first
   (wire-on-deploy, process v27).

(No mint-before-secret edge in THIS slice — no new principal/secret. The standing
DEFECT-H2-001 evidence is why edges 1–4 are treated as hard, not soft.)

---

## class-deps.mmd — where it lands and what each commit marks (§12a updated-in-commit)

- **R1.1 (UC1 ports + domain):** CREATE `class-deps.mmd` first edition. Nodes:
  `domain-move`, `port-game-store`, `port-relay`, `port-game-lookup`,
  `ws-move-handler`, `adapter-games-ddb`, `adapter-relay-mgmt`,
  `adapter-local-store`, `adapter-local-relay`, `spa-online-move`. Mark the
  domain + port nodes `classDef changed` (this slice introduces them).
- **R2.1 (games-ddb adapter):** add edge `adapter-games-ddb --|implements|--> port-game-store`; mark both `changed`.
- **R3.1 (ws move handler):** add edges `ws-move-handler --> domain-move`,
  `ws-move-handler --> port-game-store`, `ws-move-handler --> port-relay`,
  `ws-move-handler --> port-game-lookup`; mark `ws-move-handler` `changed`.
- **R3.3 (relay adapter wiring):** add `adapter-relay-mgmt --|implements|--> port-relay`; mark `changed`.
- **R5.1 (local stand-up):** add `adapter-local-store --|implements|--> port-game-store`,
  `adapter-local-relay --|implements|--> port-relay`; mark `changed`.
- **R4.1 (SPA move-send):** add `spa-online-move` node + edge to the WS transport; mark `changed`.
- **data-flow.mmd** already carries the s006 `changed` marks (wsfn, games + dotted
  move edges, authored by the architect). Any divergence the engineer introduces
  (e.g. a read the model did not draw) is updated-in-commit on the touching step.
- **Slice-delivery:** clear `changed` marks ONLY after the tester has consumed them.

---

## UC1 — Move domain core (pure: validate+apply, win/draw) — OI-17 hexagonal seed
Owner: ENG-1. No flag (pure). @covers domain-move. ACs: AC1.1–AC1.6.

- **R1.1 (red→green, CREATES the seam + the model):** failing test for
  `move/ports.ts` existence is implicit; the real red is the first `applyMove`
  spec. Define `move/ports.ts` (`GameStorePort.getGame` / `.applyMoveWrite`,
  `RelayPort.postToConnections`, `GameLookupByConnectionPort.findGameByConnection`)
  in DOMAIN terms (no SDK). **Same commit CREATES `class-deps.mmd` first edition**
  (§12a). Commit intent: "UC1 ports: domain-defined move ports + class-deps first edition".
- **R1.2** AC1.6 happy path: accepted non-turn move → `{accepted, newBoard with
  board[square]=senderRole, nextTurn=opposite, terminal:false}`.
- **R1.3** AC1.3 out-of-turn (`senderRole !== currentTurn`) → `{accepted:false}`, no mutation.
- **R1.4** AC1.4 square-taken (`board[square] !== '-'`) → `{accepted:false}`.
- **R1.5** AC1.5 post-terminal guard (caller passes terminal flag) → `{accepted:false}`.
- **R1.6** AC1.1 all 8 win-lines × {X,O} → `terminal:true, winner=senderRole`
  (table-driven: 3 rows, 3 cols, 2 diagonals).
- **R1.7** AC1.2 draw-by-fill (`moveCount→9`, no line) → `terminal:true, winner=undefined`.

UC1 DONE: AC1.1–AC1.6 green, zero infra in any path. **Step count: 7.**

---

## UC2 — Games store adapter (single conditional UpdateItem CAS + join-init)
Owner: ENG-1. No flag. @covers adapter-games-ddb, port-game-store, games (data-flow).
ACs: AC2.1–AC2.6. T6, S3, S6. Delta posture: **reject over retry** (no blind retry
on ConditionalCheckFailed; ≤1 re-read only on a pure version race — §5a).

- **R2.1 (red→green)** AC2.1: `applyMoveWrite(gameId, expectedVersion, patch)` does a
  single `UpdateItem` with `ConditionExpression: status=:active AND currentTurn=:role
  AND version=:expected`; `UpdateExpression` SETs board/currentTurn/version+1/
  moveCount+1. Post-write GetItem shows square set, turn flipped, version+1,
  moveCount+1. Adapter under `ws/adapters/games-ddb.ts` (aws-sdk-client-mock).
  Same commit updates `class-deps.mmd` (adapter→port edge, `changed`).
- **R2.2** AC2.2/S6: stale `expectedVersion=0` after a version-1 write →
  `ConditionalCheckFailedException` surfaces as a **typed reject** (no partial write).
- **R2.3** AC2.3/S3: terminal win write sets `status=won` + `winner` in the SAME
  atomic UpdateItem; a follow-on write with `status=:active` condition fails.
- **R2.4** AC2.4: draw write (`moveCount+1=9`, no line) sets `status=drawn`, no `winner`.
- **R2.5 (HARD EDGE #3)** AC2.5/T6: extend the existing s005 `ws/join.ts` conditional
  write with `board=:empty, currentTurn=:X, version=:zero, moveCount=:zero` SET
  clauses (only on the waiting→active condition). GetItem after join shows the
  four init fields. (Tightens the s005 join write; touches `ws/join.ts` — flag the
  orchestrator if ENG-2 also needs join.ts, but UC4 does not, so no collision.)
- **R2.6** AC2.6/S3 code-policy pin: a synth/unit assertion that the move
  `UpdateItem` call carries a `ConditionExpression` containing all three terms
  (the CAS gate cannot be silently removed — mocked-adapter caution: this pins the
  CONDITION the local mock cannot enforce against real DDB).
- **R2.7** §5a/§41 failure-taxonomy + retry: ConditionalCheckFailed = business
  reject (no retry, logged category=`data`/4xx-class to sender); version-only race
  = ≤1 re-read then reject; DDB 5xx/throttle = SDK default backoff then
  category=`external-dependency` (or `internal-service` if our request was bad);
  assert the structured log category on each path (logging is TESTED).

UC2 DONE: AC2.1–AC2.6 + the retry/taxonomy assertions green against local adapter.
**Step count: 7.**

---

## UC4 — SPA (move-send online behind UC4 flag default OFF; render-on-broadcast; lock; OI-33)
Owner: ENG-2. **UC4 flag (default OFF; tests run flag-ON).** @covers spa-online-move.
F5, F6, T5. ACs: AC4.1–AC4.7. **OI-33 step is SCHEDULED FIRST in UC4 to heal the
already-RED trunk smoke fast** (`tests/smoke/slice005-validation.spec.ts` F3/T4
asserts "Game not found. Check the code and try again." — currently red because the
server/SPA path does not yield that text).

- **R4.0 (red→green — FIRST, heals RED smoke)** AC4.5/T5/F5 OI-33: map the server
  code-not-found signal to JoinScreen text "Game not found. Check the code and try
  again." JoinScreen already maps close-code 4040→that text; the red is the wiring
  (server emits the generic 4500 / the SPA error handler does not route
  code-not-found→4040). Pin it with a component test, then make the live smoke
  F3/T4 green. **This is NOT behind the UC4 flag** — OI-33 is independent of the
  move feature and must heal trunk red immediately. Commit intent: "Heal OI-33 red
  smoke: code-not-found → actionable join message (F5/T5)".
- **R4.1 (flag-ON)** AC4.1: clicking a square in online mode sends exactly one
  `{action:'move', square}` over WS; board does NOT update optimistically (no
  render before server `board-update`). Adds `spa-online-move` to class-deps.
- **R4.2** AC4.2: receiving `{type:'board-update', board, currentTurn, status}`
  re-renders the board from the server string + flips the turn indicator, with NO
  prior click (render-on-broadcast).
- **R4.3** AC4.3: after `game-over`, clicking any square fires 0 WS sends (board lock).
- **R4.4** AC4.4: `game-over result:'X-wins'` → "X wins"; `result:'draw'` → "Draw".
- **R4.5 (smoke-selector done-condition, §22/§23)** the online board now has
  interactive cells (was inert at s005). Verify `tests/smoke/` cell selectors
  (`[aria-label^="cell "]`, `data-testid="online-role"`) still isolate the correct
  elements after enabling clicks; the s005 F7 "cells inert/disabled" assertion must
  be migrated/updated (cells are no longer permanently disabled in online mode).
- **R4.6** AC4.6/AC4.7/F6: Playwright regression — local two-player + vs-AI full
  matches unaffected (these are flag-OFF paths; assert no regression with flag both
  states).
- **R4.7 (UC4 flag factor-out — done condition, §40)** once UC3 is deployed and the
  flag flipped ON (HARD EDGE #4/#5), remove the UC4 flag from code then config; no
  orphan flag at retro.

UC4 DONE: AC4.1–AC4.7 + F5/F6/T5 green; OI-33 trunk smoke green; flag factored out.
**Step count: 8.**

---

## UC5 — Local stand-up (OI-28: committed run-local entry + local adapters; browser tests in BUILD)
Owner: ENG-2. @covers adapter-local-store, adapter-local-relay. ACs: AC5.1–AC5.5.
Needs only `move/ports.ts` (R1.1) to exist — builds parallel to UC3 (v28,
principles/02: browser-delivered behaviour developed WITH a browser, red→green
against a LOCAL stand-up).

- **R5.1 (red→green — committed tooling, §33 self-service)** AC5.1: a committed
  `run-local` entry (root Makefile target `make -C work/oxo-online/src/app run-local`
  OR `npm --prefix work/oxo-online/src/app run local` — allowlist-shaped) starts a
  local WS server + SPA dev server with NO cloud creds. Add the local adapters
  `local-store.ts` (in-memory, **reproduces the version-CAS branch**) +
  `local-relay.ts` (records posts) behind the UC1/UC2 ports. Update class-deps
  (`adapter-local-* implements port-*`, `changed`). Name the new make target in the
  engineer return (tooling self-service).
- **R5.2 (Playwright, BUILD phase, local)** AC5.2: two browser contexts play a full
  online game to a WIN against the local server (send-on-click → render-on-broadcast
  → result), in `tests/skeleton/` or a local-tagged Playwright project.
- **R5.3** AC5.3: draw game (9 squares, no line) → both browsers show Draw result.
- **R5.4** AC5.4: out-of-turn click → sender gets `move-rejected`, board unchanged,
  turn unchanged (local stand-up).
- **R5.5** AC5.5: local in-memory adapter rejects a stale-`expectedVersion` second
  write (version-CAS branch exercised by the SAME adapter code UC2 unit-tests — not
  a parallel code path). **Mocked-adapter caution (§12a):** note in the spec what
  the local map CANNOT prove (real DDB conditional atomicity) — that gap is covered
  by R2.6 policy pin + UC6 prod zero-divergence, NOT by another mock assertion.

UC5 DONE: AC5.1–AC5.5 green; run-local committed + documented + named in return.
**Step count: 5.**

---

## UC3 — ws-fn move route handler (SHARED SEAM; after UC1+UC2 ports stable)
Owner: ENG-1. No flag (route absent until infra commit). @covers ws-move-handler,
adapter-relay-mgmt, wsfn (data-flow). T1, T3, T4; S1–S6. ACs: AC3.1–AC3.8.
SERIALISED after WAVE A ports are stable (HARD EDGE #1/#2).

- **R3.1 (red→green)** AC3.1/T1/S4: handler `ws/move-handler.ts` — parse `square`;
  read `connectionId` from `event.requestContext.connectionId`; (stub store/relay
  ports) valid in-turn move → transport-port spy records EXACTLY 2 `board-update`
  POSTs (one per bound connectionId), store-port stub records exactly 1 write.
  Wire dispatch in `ws/handler.ts` `case 'move'`. Update class-deps
  (`ws-move-handler → domain-move/port-game-store/port-relay/port-game-lookup`).
- **R3.2 (identity bind, S1)** AC3.4/S1: derive `senderRole` SERVER-SIDE from
  connectionId == hostConnectionId(X) | guestConnectionId(O) of THIS game (via
  `GameLookupByConnectionPort` over Connections→Games); connectionId matching
  neither → exactly 1 `move-rejected` to that connection, 0 writes. Role NEVER from
  a client field.
- **R3.3 (relay adapter)** wire `relay-mgmt.ts` RelayPort over `@connections` POST
  (mechanism reused from s005 — confirm grant, don't widen). Update class-deps
  (`adapter-relay-mgmt implements port-relay`, `changed`).
- **R3.4 (terminal, T3/S4)** AC3.2: winning move → spy records 2 `board-update` + 2
  `game-over` POSTs (4 total), 0 rejects.
- **R3.5 (out-of-turn, S2/T4)** AC3.3: out-of-turn → exactly 1 `move-rejected` to
  sender, 0 writes; DDB byte-unchanged.
- **R3.6 (SYNTH CONTRACT, §30 — lands with infra commit)** AC3.6: synth BOTH the
  WS API template and assert it contains EXACTLY 5 route keys incl. `move`, AND that
  the SPA's `action:'move'` string matches a synthesised `RouteKey` (the action↔route
  guard that caught the s004 prod-404). Add the `move` route to
  `infra/lib/game-stack.ts` `routeKeys` array (4→5). Same commit.
- **R3.7 (version race, S6)** AC3.5: ConditionalCheckFailed on first write → ≤1
  re-read → still illegal → exactly 1 `move-rejected`, 0 net writes (delta
  reject-over-retry posture).
- **R3.8 (relay best-effort, S4)** AC3.7: GoneException on one POST → logged
  (category structured), the other connection still receives its POST (no per-post
  retry; recovery deferred to s007).
- **R3.9 (IAM no-widen policy pin, S5 + code↔policy pin §30)** AC/S5: policy test on
  the synthesised `oxo-ws-fn` role asserts the grant set is BYTE-FOR-BYTE the s005
  set (GetItem+UpdateItem on Games, ManageConnections on this API ARN, Put/Delete
  Connections) — `move` added ZERO permissions, no `*`, no new action. Plus the
  code↔policy pin: the handler issues ONLY GetItem/UpdateItem against Games (assert
  no ungranted command type) so code cannot diverge into a prod AccessDenied.
- **R3.10 (buildSha log carrier, principles/01)** AC3.8: handler emits `buildSha`
  (from `BUILD_SHA` env, injected by pipeline — never hardcoded) as a structured
  log field on every invocation.

UC3 DONE: AC3.1–AC3.8 + S1–S6 unit/synth/policy green; 5th route synthesised; role
unwidened. **Step count: 10.**

---

## SKELETON + DEPLOY step (§17 walking-skeleton — BEFORE UC6 full suite)
Owner: ENG-1 (drives), cicd (pipeline). HARD EDGE #4/#6.

- **R-SK.0 (deploy)** thin deploy: `OxoGameProd` (move route + ws-fn code incl.
  join-init R2.5) → `OxoOnlineProd` (SPA with UC4 flag, then flipped ON).
- **R-SK.1 (walking-skeleton, REAL BROWSER, committed `tests/skeleton/` spec)** drive
  ONE real move through the FULL deployed path in a real browser (Playwright, not a
  node ws probe — node probes give FALSE GREEN below CSP/transport): (a) a valid
  in-turn move in browser A appears in browser B; (b) an out-of-turn move is
  rejected with the board byte-unchanged. **Mechanism is NOT new** (delta: relay
  @connections + conditional UpdateItem both probed at s005) so this is the
  functional-smoke proof, not a first-mechanism probe — but it still runs through a
  REAL browser before the full UC6 suite. Discovery→regression: any console error /
  blocked connection / undefined config found here becomes a committed failing spec.

This step PRECEDES the UC4 flag-flip→UC6 hand-off completion and proves the path the
tester's full suite then exercises. **Step count: 2.**

---

## UC6 — Prod validation (tester-owned; after UC3 deployed + UC4 flag ON)
Owner: TESTER. HARD EDGE #4/#5/#6 all satisfied first. F1–F5, T1–T6, S1,S2,S3,S6.
ACs: AC6.1–AC6.8. The engineer hands a green skeleton + the marked `.mmd` (the
tester's test-plan input) to the tester; engineer does NOT build UC6 specs.

Listed for completeness (tester executes): AC6.1 win two-browser, AC6.2 draw,
AC6.3 out-of-turn DDB-unchanged, AC6.4 board-lock-after-game-over, AC6.5 p95<1s over
≥10 moves, AC6.6 wrong-game forgery 0-writes, AC6.7 buildSha in CloudWatch log,
AC6.8 OI-33 prod check. **Step count (engineer): 0 build; hand-off only.**

---

## Step totals
UC1: 7 · UC2: 7 · UC4: 8 · UC5: 5 · UC3: 10 · Skeleton+deploy: 2 · UC6: 0 (tester).
**Engineer build steps: 39.**

## Failure-taxonomy & retry coverage summary (§5a/§41 — TESTED on each path)
- Inbound malformed `square` / out-of-turn / square-taken / post-terminal /
  wrong-game → 4xx-class business reject, `move-rejected` to sender, structured log
  category=`data`, 0 writes (R1.x, R2.2, R3.2, R3.5, R3.7).
- DDB 5xx/throttle → SDK default jittered backoff; exhaustion → log
  category=`external-dependency`; a self-owned bad request (4xx from DDB) →
  category=`internal-service` (defect signal, not terminal) (R2.7).
- Relay GoneException/transient → best-effort, logged, other post proceeds; no
  per-post retry (R3.8). Recovery deferred to s007 (OR-S006-b).
