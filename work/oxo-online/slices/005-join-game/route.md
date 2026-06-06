# Route — Slice 005 join-game (WebSocket connect + game-ready)

Thinnest ordered TDD sequence to advance through every acceptance case, **grouped
by use case** per process §37. Each step is a single red→green cycle that lands
independently on trunk. No production code before a failing test. Steps are
ordered so the **deploy constraint holds** (`OxoGameProd` before `OxoOnlineProd`;
the §30 composed contract test exists before any deploy phase) and so the
**dependency edges** between use-case sets are honoured:

- **Set A — backend handlers + infra (UC1, UC2, UC4).** Shared `oxo-ws-fn`
  Lambda (different route branches) + the shared infra enablers (WS API,
  Connections table, `code-index` GSI, deploy-role extension), all inside the
  **existing `OxoGameProd` stack** (delta §"WebSocket API lives in OxoGameProd").
  Infra enablers are phased to land **once, early**, with synth tests.
- **Set B — UI-only (UC5).** Pure React board with role labels driven by a
  **mocked `game-ready` event**; no infra dependency, buildable day one.
- **Set C — happy-path integration (UC3).** The pairing payoff: atomic
  conditional write + `game-ready` fan-out to both sides. Built last; the only
  UC that cannot be integration-tested until UC1+UC2+UC5 are deployable
  end-to-end.

Ordering rationale: Phase A0 lands the shared infra enablers once (synth-proven,
no deploy). Phases A1/A2/A4 build the `oxo-ws-fn` route branches in isolation
(pure handler unit tests, mocked AWS clients). Phase B builds the React board
against a mock event — fully parallel with all of A. Phase C composes the
happy-path join (UC3) once its dependencies exist. Phase D is the §30 composed
synth contract test, which **must precede** the deploy phase E. Phase E wires
the pipeline and deploys (`OxoGameProd` → `OxoOnlineProd`; manual deploy-oidc
step). Phase F is live production verification (two-browser pairing, CLI checks,
S-policy checks) through the committed validation framework per §35.

Legend: **UC** = use case advanced. **AC** = acceptance case(s) advanced. Test
files are the red→green driver. Claim tags mark which parallel engineer set owns
the step and the **file-ownership boundary**.

---

## File-ownership boundaries (parallel claim contract)

Three engineers may work concurrently. WIP boundary is by file:

| Set | Owns (may create/modify) | MUST NOT touch |
|-----|--------------------------|----------------|
| **A** (UC1, UC2, UC4) | `src/lambda/ws/**` (new), `src/infra/lib/game-stack.ts` additions, `src/infra/lib/oxo-online-oidc-stack.ts` additions, `src/infra/test/game-stack.test.ts` + `oidc-stack.test.ts` additions | `src/app/**`, `shell-stack.ts` |
| **B** (UC5) | `src/app/src/game/**` (board/join components + their `*.test.tsx`), `src/app/src/game/GameRoot.tsx` join/board wiring | `src/lambda/**`, `src/infra/**` |
| **C** (UC3) | the **happy-path branch** of `src/lambda/ws/join.ts` + its handler test; the SPA `game-ready` reception/transition in `src/app/src/game/**` | infra files (A owns), board render internals (B owns) |

**Collision points — flagged, NOT worked around:**
- `src/lambda/ws/join.ts` is touched by A (UC2 4040 branch, UC4 4041 branch) and
  C (UC3 happy-path branch). These are **sequential on the same file**: A2 and
  A4 land the error branches first; C1 adds the happy path on top. C must not
  begin its join-handler step until A2+A4 are merged. Flag to orchestrator if
  both are claimed simultaneously.
- `src/app/src/game/GameRoot.tsx` is touched by B (board/join screens, UC5) and
  C (game-ready transition). Sequential: B lands the components and the mocked
  transition; C wires the real socket reception. Flag if contested.
- `src/infra/lib/game-stack.ts` is mutated by every A0/A-infra step — those
  steps are **sequential within Set A** (one engineer holds the infra steps).

---

## Phase A0 — Shared infra enablers (Set A, sequential, synth-proven, NO deploy)

These land **once, early**, before any handler integration. All are CDK
`assertions`/synth tests against the existing `OxoGameProd` template — no AWS
calls. One engineer holds this whole phase (single-file `game-stack.ts` mutation
chain).

### Step A0.1 — WebSocket API + prod stage with exactly four route keys
- **Claim:** Set A. **UC:** UC1–UC4 (enabler).
- **Build:** in `game-stack.ts`, add `AWS::ApiGatewayV2::Api`
  (`ProtocolType: WEBSOCKET`, `RouteSelectionExpression: $request.body.action`),
  the four routes `$connect`/`$disconnect`/`register`/`join` (AWS_PROXY to a
  placeholder `oxo-ws-fn` ref added in A0.3 — order A0.3 before A0.1 if the ref
  must resolve; see independence notes), and a `prod` stage with `AutoDeploy`.
- **AC:** T7 (route-key set, no `$default`), T8 (stage throttling — partial).
- **Test (red→green):** `src/infra/test/game-stack.test.ts`: synthesised
  `OxoGameProd` has exactly the four `AWS::ApiGatewayV2::Route` `RouteKey`s and
  **no `$default`**; the `prod` `Stage` sets `DefaultRouteSettings` with finite
  `ThrottlingRateLimit` + `ThrottlingBurstLimit`.
- **Done:** route-key + throttling assertions green; `cdk synth OxoGameProd` ok.

### Step A0.2 — `Connections` table: PK, SSE, TTL, on-demand, no public policy
- **Claim:** Set A. **UC:** UC1, UC3 (enabler).
- **Build:** add the `Connections` `AWS::DynamoDB::Table` (PK `connectionId`
  String HASH, no sort key, SSE on, TTL on `ttl`, `PAY_PER_REQUEST`, PITR off).
- **AC:** T9.
- **Test (red→green):** `game-stack.test.ts`: Connections table has
  `KeySchema` HASH=`connectionId` and no RANGE, `SSESpecification.SSEEnabled`,
  `TimeToLiveSpecification = {AttributeName:'ttl',Enabled:true}`,
  `BillingMode='PAY_PER_REQUEST'`; `findResources` confirms no `ResourcePolicy`
  granting a public principal.
- **Done:** Connections table assertions green.

### Step A0.3 — `oxo-ws-fn` Lambda + execution role scoped to the exact delta grants
- **Claim:** Set A. **UC:** UC1–UC4 (enabler).
- **Build:** add `oxo-ws-fn` (Node 20, fixed `functionName:'oxo-ws-fn'`, env
  `GAMES_TABLE`/`GAMES_CODE_INDEX`/`CONNECTIONS_TABLE`/`WS_API_ENDPOINT`,
  **reserved concurrency** finite >0) wired as the AWS_PROXY integration for all
  four routes; inline execution-role policy granting ONLY: `Query`/`GetItem` on
  Games table ARN + `code-index` GSI ARN; `UpdateItem` on Games table ARN;
  `PutItem`/`DeleteItem` on Connections ARN; `execute-api:ManageConnections` on
  this WS API ARN only; own log-group actions.
- **AC:** S1 (DynamoDB scope exact), S2 (ManageConnections this-API-only), T8
  (reserved concurrency).
- **Test (red→green):** `game-stack.test.ts`:
  - runtime `nodejs20.x`, `ReservedConcurrentExecutions > 0`;
  - **S1:** enumerate the role's `AWS::IAM::Policy` statements — assert exactly
    the allowed action/resource pairs above; assert NO `dynamodb:Scan`, NO
    `dynamodb:*`, NO `Put`/`Delete` on Games, NO read/`Scan` on Connections, NO
    wildcard `Resource:'*'`, NO third table;
  - **S2:** the only `execute-api:` statement is `ManageConnections` with
    `Resource` referencing this WS API id (not `*`, not `execute-api:*`).
- **Done:** Lambda + least-privilege role assertions green.

### Step A0.4 — `Games.code-index` GSI added; base key schema unchanged
- **Claim:** Set A. **UC:** UC2, UC3, UC4 (enabler).
- **Build:** add GSI `code-index` to the existing `Games` table (PK `code`
  String HASH, minimal projection covering `status`/`hostConnectionId`/
  `guestConnectionId`).
- **AC:** T10, S5 (Games base schema unchanged — regression).
- **Test (red→green):** `game-stack.test.ts`: Games table
  `GlobalSecondaryIndexes` contains `code-index` (PK `code`, projection not
  wider than needed); base-table `KeySchema` still exactly
  `[{AttributeName:'gameId',KeyType:'HASH'}]` (additive, no replacement).
- **Done:** GSI assertion green; existing s004 Games assertions still green.

### Step A0.5 — Cross-stack CfnOutputs (additive only): WsApiEndpoint + WsApiId
- **Claim:** Set A. **UC:** UC1–UC4 (enabler for §30/deploy).
- **Build:** add `CfnOutput`s `OxoGameProd-WsApiEndpoint` (wss invoke URL incl.
  `/prod`) and `OxoGameProd-WsApiId`. Do NOT touch `OxoGameProd-HttpApiEndpoint`.
- **AC:** T7 (export exists — partial), S5 (HttpApiEndpoint untouched).
- **Test (red→green):** `game-stack.test.ts`: `hasOutput` for
  `OxoGameProd-WsApiEndpoint` resolving to id+`/prod` (not a placeholder) and for
  `OxoGameProd-WsApiId`; assert `OxoGameProd-HttpApiEndpoint` export name still
  present and unchanged.
- **Done:** output assertions green; s004 export untouched.

### Step A0.6 — `oxo-deploy` role gains scoped WS Lambda deploy perms (no iam:*)
- **Claim:** Set A. **UC:** UC1–UC4 (deploy enabler). **File:** `oxo-online-oidc-stack.ts` (distinct from game-stack — independent of A0.1–A0.5).
- **Build:** add `lambda:UpdateFunctionCode` + `lambda:GetFunction` scoped to the
  `oxo-ws-fn` function ARN only to `oxo-deploy`.
- **AC:** S4.
- **Test (red→green):** `src/infra/test/oidc-stack.test.ts`: `oxo-deploy` policy
  includes the two Lambda actions scoped to the `oxo-ws-fn` ARN (not `*`), and
  grants none of `iam:CreateRole`/`iam:AttachRolePolicy`/`iam:PutRolePolicy`.
- **Done:** OIDC assertions green. (Manual `make deploy-oidc` is an operational
  step in Phase E, not a code test.)

---

## Phase A1 — UC1 host register path (Set A, handler unit, no AWS)

### Step A1.1 — `$connect` writes a Connections item with null gameId + 2h TTL
- **Claim:** Set A. **UC:** UC1.
- **Build:** `src/lambda/ws/connect.ts` — on `$connect`, PutItem to Connections
  with `connectionId` (from `event.requestContext.connectionId`), `gameId=null`,
  `ttl=now+2h`. DynamoDB client mocked (`aws-sdk-client-mock`).
- **AC:** T3 (TTL ~2h — backend half), T6 (connectionId from context).
- **Test (red→green):** `src/lambda/ws/connect.test.ts`: mocked `PutItemCommand`
  receives `connectionId === requestContext.connectionId`, `gameId` null/absent,
  `ttl` numeric ~7200s ahead (skew tolerance); a planted body `connectionId`
  is never read.
- **Done:** connect handler test green.

### Step A1.2 — `register` binds host connection to the game (conditional, context id)
- **Claim:** Set A. **UC:** UC1.
- **Build:** `src/lambda/ws/register.ts` — on `register`, UpdateItem the
  Connections item to set `gameId`+`role='host'`, and conditional UpdateItem on
  Games to set `hostConnectionId = requestContext.connectionId` only if
  `attribute_not_exists(hostConnectionId)`.
- **AC:** F6 (host side — connection established), T6 (id from context, planted
  body ignored), S1 (UpdateItem-on-Games only path exercised).
- **Test (red→green):** `src/lambda/ws/register.test.ts`: persisted
  `hostConnectionId === 'CTX-ID'` when body plants `connectionId='SPOOF'`
  (SPOOF appears nowhere); Games UpdateItem carries the
  `attribute_not_exists(hostConnectionId)` ConditionExpression; Connections item
  gains `role='host'` and the `gameId`.
- **Done:** register handler test green.

---

## Phase A2 — UC2 join rejected, unknown code (Set A, handler unit, no AWS)

### Step A2.1 — `join` GSI lookup miss → close 4040, no Connections write
- **Claim:** Set A. **UC:** UC2. **File:** creates `src/lambda/ws/join.ts` (error branches only; happy path added by C1 later — collision flagged above).
- **Build:** `src/lambda/ws/join.ts` — Query `code-index` by `code`; on empty
  result, close the socket with **4040** and write nothing to Connections.
- **AC:** F3 (backend half), T4 (4040 + Games unchanged), S3 (close-code map,
  no internal leak).
- **Test (red→green):** `src/lambda/ws/join.test.ts`: mocked GSI Query returns
  empty → handler issues close 4040, performs **no** Connections PutItem and no
  Games write; the close reason/payload contains no stack trace, exception class,
  table ARN, or request id.
- **Done:** 4040 branch test green.

### Step A2.2 — `join` internal fault → close 4500, generic message, no leak
- **Claim:** Set A. **UC:** UC2/UC3 (error contract). **File:** `src/lambda/ws/join.ts`.
- **Build:** wrap the handler so any unexpected error (e.g. DynamoDB throws) maps
  to close **4500** with a generic client message; nothing internal leaks.
- **AC:** F9 (backend half), S3 (4500 branch).
- **Test (red→green):** `join.test.ts`: when the mocked client rejects, handler
  closes 4500; asserts the client-visible payload/reason carries no internal
  strings.
- **Done:** 4500 branch test green.

---

## Phase A4 — UC4 join rejected, game not waiting (Set A, handler unit, no AWS)

### Step A4.1 — conditional UpdateItem fails → close 4041, no mutation
- **Claim:** Set A. **UC:** UC4. **File:** `src/lambda/ws/join.ts` (adds the conditional-write rejection branch; sequential after A2 on this file).
- **Build:** in `join.ts`, when the GSI hit is found, attempt the conditional
  `UpdateItem` (`status='waiting'` AND `attribute_not_exists(guestConnectionId)`);
  on `ConditionalCheckFailedException` close **4041** and perform NO write.
- **AC:** F4 (backend half), T5 (no-hijack conditional write, 4041), S3 (4041
  branch).
- **Test (red→green):** `join.test.ts`: mocked `UpdateItemCommand` rejects with
  `ConditionalCheckFailedException` → handler closes 4041; assert the handler
  issued exactly that one (rejected) write and no Connections mutation; payload
  carries no internal detail.
- **Done:** 4041 branch test green.

---

## Phase B — UC5 board + join screen UI (Set B, React, mocked, fully parallel)

These run concurrently with all of Phase A/A0 — no infra dependency. Set B owns
`src/app/src/game/**`.

### Step B1 — Join screen: code input, submit, connecting indicator
- **Claim:** Set B. **UC:** UC2/UC3 (UI), F6 (joiner side).
- **Build:** `src/app/src/game/JoinScreen.tsx` reached from the mode selector —
  6-char code input, submit button, a "connecting…" indicator while pending.
  Socket open is injected/mockable (no real WS).
- **AC:** F3 (input retains code), F6 (connecting indicator).
- **Test (red→green):** `JoinScreen.test.tsx`: entering a code + submit shows the
  connecting indicator; the entered code is retained in the field after a
  (mocked) close event.
- **Done:** join-screen tests green; existing GameRoot tests still green.

### Step B2 — Join screen renders the three close-code error messages
- **Claim:** Set B. **UC:** UC2/UC4. 
- **Build:** map a (mocked) close event code to the readable message: 4040 →
  "Game not found. Check the code and try again.", 4041 → "This game is no longer
  available.", 4500 → "Something went wrong. Please try again." Join screen stays
  accessible; code retained.
- **AC:** F3, F4, F9 (UI half), S3 (client maps only the defined close codes to
  generic messages).
- **Test (red→green):** `JoinScreen.test.tsx`: each mocked close code renders its
  exact message; the screen remains mounted (no white-screen / error boundary).
- **Done:** error-message tests green.

### Step B3 — Game board with role labels + inert squares + status line
- **Claim:** Set B. **UC:** UC5.
- **Build:** `src/app/src/game/OnlineBoard.tsx` (wraps/extends the existing board
  from s002/s003 — not rebuilt): renders 3x3, label "You are X"/"You are O" from
  a `role` prop, status line "Game active — moves coming in the next update";
  clicks dispatch nothing.
- **AC:** F1 (board + labels), F7 (inert clicks).
- **Test (red→green):** `OnlineBoard.test.tsx`: role='host' shows "You are X",
  role='guest' shows "You are O"; the status line is present; clicking any square
  produces no state change, no dispatch, no thrown error.
- **Done:** board tests green.

### Step B4 — Mocked `game-ready` transitions waiting/connecting → board
- **Claim:** Set B. **UC:** UC5 (and the seam UC3 will plug a real socket into).
- **Build:** wire `GameRoot.tsx` so a (mocked/injected) `game-ready` event with
  `{type,role}` transitions the waiting screen (host) and connecting screen
  (joiner) to `OnlineBoard` with the right role.
- **AC:** F1 (transition), F8 (local + vs-AI modes still selectable/unaffected).
- **Test (red→green):** `GameRoot.test.tsx`: dispatching a mock `game-ready`
  role='host' renders the board labelled "You are X"; existing Two-Player and
  vs-Computer buttons remain present and a local game still completes (regression).
- **Done:** transition + regression tests green; full app `vitest run` green.

---

## Phase C — UC3 happy-path pairing (Set C, after A1+A2+A4, handler unit)

Set C may begin only once A1.x and A2.x and A4.1 are merged (they own
`join.ts`'s error branches). C1 adds the happy path to the same file —
**sequential collision, flagged above.**

### Step C1 — `join` happy path: atomic activate + game-ready to both connections
- **Claim:** Set C. **UC:** UC3. **File:** `src/lambda/ws/join.ts` (happy-path branch on top of A2/A4 branches).
- **Build:** in `join.ts`, when GSI hit is `waiting` with `guestConnectionId`
  null, run the conditional `UpdateItem` setting `guestConnectionId =
  requestContext.connectionId` + `status='active'`; write the guest Connections
  item (`role='guest'`, gameId, 2h ttl); then POST via
  `execute-api:ManageConnections` `{type:'game-ready',role:'host'}` to the host
  connection and `{type:'game-ready',role:'guest'}` to the guest connection.
- **AC:** F1, F2, F5 (backend half), T1 (game-ready both sides; payload only
  `{type,role}`), T2 (Games shape), T3 (Connections entries), T6 (guest id from
  context).
- **Test (red→green):** `join.test.ts`: on a mocked `waiting` GSI hit + successful
  conditional update, the handler posts exactly two `@connections` frames whose
  payload keys are exactly `type`+`role` (no connectionId/other game field
  leaked); Games UpdateItem sets `status='active'` + `guestConnectionId='CTX-ID'`
  (planted body ignored); guest Connections item carries `role='guest'` and 2h ttl.
- **Done:** happy-path handler test green; full `oxo-ws-fn` handler suite green.

### Step C2 — SPA connects real WS + sends register/join, receives game-ready
- **Claim:** Set C. **UC:** UC3. **File:** `src/app/src/game/**` socket seam (plugs into B4's transition seam).
- **Build:** replace the injected/mocked socket seam with a real `WebSocket`
  client: host waiting screen opens the socket on load and sends
  `{action:'register',gameId}`; join screen opens and sends
  `{action:'join',code}`; both translate the received `game-ready` into B4's
  transition. URL read from `window.OXO_CONFIG.wsUrl`.
- **AC:** F1 (live transition seam), F6 (host connects on load).
- **Test (red→green):** `GameRoot.test.tsx` with a mock `WebSocket`: on host
  waiting mount, a `register` frame is sent; on join submit, a `join` frame is
  sent; an incoming `game-ready` frame drives the B4 transition. `wsUrl` is read
  from `window.OXO_CONFIG`.
- **Done:** socket-seam tests green; full app suite green.

---

## Phase D — §30 composed synth contract test (MUST precede deploy)

### Step D1 — Composed WS contract: 4 route keys ↔ client actions, endpoint export, wsUrl source
- **Claim:** Set A (infra owner). **UC:** UC1–UC4 (§30 obligation).
- **Build:** `src/infra/test/ws-contract.test.ts` — a composed/synth contract
  test (no AWS) per delta §30. No production code unless the assertion forces a
  fix; this step pins the cross-boundary handoff.
- **AC:** T7 (full composed contract).
- **Test (red→green):** assert over the synthesised `OxoGameProd` template (and
  the SPA config-injection source string):
  1. the WS API synthesises **exactly** the four `RouteKey`s
     `$connect`/`$disconnect`/`register`/`join`, **no `$default`**;
  2. the client `action` values the SPA sends (`register`, `join`) **each equal**
     a synthesised `RouteKey` (the `$request.body.action` selector match — WS
     analogue of s004's path↔route-key check);
  3. `OxoGameProd` has a `CfnOutput` with `exportName` exactly
     `OxoGameProd-WsApiEndpoint` resolving to id+`/prod` (not a placeholder);
  4. the deploy/config-injection source the SPA reads for `wsUrl` references that
     exact export name — a rename on either side fails here at synth/CI, not in
     prod.
- **Done:** composed contract test green. **This step gates Phase E.**

---

## Phase E — Pipeline wiring + deploy (real environment; OxoGameProd → OxoOnlineProd)

### Step E1 — Manual deploy-oidc: apply the scoped WS Lambda deploy-role extension
- **Claim:** Set A. **UC:** UC1–UC4 (deploy enabler).
- **Build/operate:** `aws sso login --profile <profile-from-.claude/config/aws-profile>`
  then `make deploy-oidc` to apply the A0.6 role extension (manual operational
  step). Capture the result; emit the recovery/deploy ledger row.
- **AC:** S4 (deployed role matches synth).
- **Done:** `oxo-deploy` carries the scoped `oxo-ws-fn` Lambda actions and no
  `iam:*`; CLI `get-role-policy` confirms. Deploy ledger row emitted.

### Step E2 — Infra pipeline deploys OxoGameProd then OxoOnlineProd
- **Claim:** Set A. **UC:** UC1–UC4.
- **Build:** ensure `infra-oxo-online.yml` deploys `OxoGameProd OxoOnlineProd` in
  that order (delta: `OxoOnlineProd` should NOT change — only the WS additions in
  `OxoGameProd` land; confirm the `OxoOnlineProd` diff is empty); deploy.
- **AC:** T1/T2/T3/T5/T8/T9/T10/S1/S2 become live-verifiable; F10 (infra half).
- **Done (green):** infra workflow finishes green; WS API, Connections table,
  GSI, `oxo-ws-fn` exist in console; `OxoGameProd-WsApiEndpoint` output present;
  `OxoOnlineProd` shows no resource change. Deploy row emitted to the DORA ledger.

### Step E3 — App pipeline injects wsUrl config + deploys SPA + ws Lambda code
- **Claim:** Set A + Set C (coordinate). **UC:** UC1–UC5.
- **Build:** ensure `deploy-oxo-online.yml` writes `wsUrl` (sourced from the
  `OxoGameProd-WsApiEndpoint` output) into the SPA runtime config artifact,
  runs `aws lambda update-function-code` for `oxo-ws-fn` when `src/lambda/ws/**`
  changes, builds/uploads the SPA, and issues a CloudFront invalidation; deploy.
- **AC:** F10 (full), T7 (wsUrl present + correct in deployed config).
- **Done (green):** app workflow finishes green end-to-end (config injection +
  SPA sync + ws Lambda update + invalidation); the `wss://…/prod` URL is present
  and correct in the deployed SPA config. Deploy row emitted.

---

## Phase F — Production verification (live-only; validation framework per §35)

All specs live in the committed framework (`src/app/tests/validation/` for
CLI/policy, `src/app/tests/smoke/` for Playwright live), run + recorded via
`make validate`/`make smoke` so each emits a `validation_run` ledger row with
iteration + sha under test. Do NOT improvise ad-hoc bash — extend the framework.

### Step F1 — Live two-browser pairing smoke (Playwright multi-context)
- **Claim:** tester (engineer hands the failing-in-prod behaviour over). **UC:** UC3, UC5.
- **Build:** `src/app/tests/smoke/slice005-validation.spec.ts` — two browser
  contexts: context A creates a game (s004) and lands on the waiting screen;
  context B opens the join screen, enters A's code, submits.
- **AC:** F1, F2 (observed), F5 (observed), F6, F7, T1 (both receive game-ready
  <3s, payload keys exactly type+role).
- **Test (red→green):** within 3s both contexts show the board with correct role
  labels ("You are X"/"You are O") and the status line; clicking a square is
  inert; no console JS error.
- **Done:** multi-context pairing smoke green against prod.

### Step F2 — Live error-path smoke: 4040 + 4041 + 4500 close codes & messages
- **Claim:** tester. **UC:** UC2, UC4.
- **Build:** extend `slice005-validation.spec.ts`: join a nonexistent code →
  "Game not found…"; join an already-active game's code → "This game is no longer
  available."; forced backend fault → "Something went wrong…".
- **AC:** F3, F4, F9, T4 (4040), T5 (4041 live), S3 (only defined close codes;
  no internal leak in client payload).
- **Test (red→green):** each branch asserts the exact close code and exact UI
  message; join screen stays accessible with the code retained; no internal
  strings in the client-visible payload.
- **Done:** error-path smoke green.

### Step F3 — Live regression smoke: local + vs-AI modes unaffected
- **Claim:** tester. **UC:** UC5.
- **Build:** extend the smoke spec to play a Two-Player and a vs-Computer game to
  completion against prod.
- **AC:** F8, S5 (regression).
- **Test (red→green):** both modes complete with no missing buttons and no
  console errors.
- **Done:** regression smoke green.

### Step F4 — CLI policy checks: Games shape, Connections TTL, no-hijack diff
- **Claim:** tester. **UC:** UC1, UC3, UC4.
- **Build:** `src/app/tests/validation/slice005-aws-policy.spec.ts` — CLI checks
  via the framework: after a live join, `get-item` on Games (T2 — `status=active`,
  both connection ids non-empty); `scan` Connections filtered to the gameId (T3 —
  two items, distinct roles, ttl in 1h55m–2h5m); for T5, snapshot an active
  game's item, drive a second live join, assert close 4041, then `get-item` and
  diff — byte-for-byte unchanged.
- **AC:** T2, T3, T5 (CLI half).
- **Done:** CLI policy spec green; `validation_run` row recorded.

### Step F5 — S-policy synth+CLI checks: role scope, ManageConnections, deploy role
- **Claim:** tester. **UC:** UC1–UC4.
- **Build:** extend `slice005-aws-policy.spec.ts`: `get-role-policy` on the
  deployed `oxo-ws-fn` role (S1 — exact DynamoDB grants, no Scan/`*`/extra table;
  S2 — ManageConnections this-API-ARN only); `aws lambda get-function-concurrency`
  for `oxo-ws-fn` (T8 — reserved >0); `get-role-policy`/`list-attached-role-policies`
  on `oxo-deploy` (S4 — scoped Lambda actions, no `iam:*`).
- **AC:** S1, S2, S4 (CLI half), T8 (live half).
- **Done:** S-policy spec green; `validation_run` row recorded. Hand any failing
  in-prod behaviour to tester for the recovery loop.

---

## Independence notes
- **Set A vs Set B vs Set C run in parallel by file ownership** (table above).
  B (all of `src/app/src/game/**`) has zero infra/lambda dependency and can be
  claimed from sprint start. A's handler unit phases (A1/A2/A4) and A0 infra
  phases can pipeline within one engineer or split A0 (game-stack chain) from the
  oidc-stack step A0.6 (different file → independent).
- **A0 is a single-file mutation chain on `game-stack.ts`** (A0.1–A0.5) and is
  therefore **sequential within itself**; A0.6 (`oxo-online-oidc-stack.ts`) is
  independent and may be claimed by a second A engineer.
- **`join.ts` is the one cross-set collision**: A2 (4040), A2.2 (4500), A4 (4041)
  land the error branches; **C1 adds the happy path on top** — C1 must not start
  until A2.x+A4.1 are merged. Flag to the orchestrator if both are claimed at
  once; do NOT fork the file.
- **`GameRoot.tsx` collision**: B owns the components + mocked transition (B4);
  C2 plugs the real socket into B4's seam — sequential, B before C2.
- **Phase D (§30 composed contract) gates Phase E** — it MUST be green before any
  deploy step runs (s004 prod-404 defect class prevention).
- **Phase E deploy order is fixed:** E1 (manual deploy-oidc) → E2 (`OxoGameProd`
  then `OxoOnlineProd`; `OxoOnlineProd` should show no change per the delta) →
  E3 (config injection + SPA + ws Lambda code; depends on E2's output existing).
- **Phase F depends on a successful E2+E3 deploy** and runs through the committed
  validation framework (§35) only — no ad-hoc bash. Failing in-prod behaviour is
  handed to the tester with a recorded re-run as the recovery evidence.
- **Capability gap check:** if `make deploy-oidc`, `make validate`, or `make
  smoke` targets or the `slice005-*` spec patterns are not yet allowlist-shaped,
  that is a cicd-capability gap to be named and closed in this slice — not worked
  around with a novel one-off command shape.
