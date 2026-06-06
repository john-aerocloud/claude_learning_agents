# Acceptance — Slice 005 join-by-code

Cases are tagged with their use case (UC1–UC5 from use-cases.md) and the
success measure from slice.md they verify (SM1–SM7). F-numbered cases are
customer-observable. T-numbered cases are technical/security-policy (section
below is left for the solution-architect to append).

---

## Functional (customer-observable)

**F1 — Both players see the game board with role labels within 3 seconds [UC3, SM1]**
Given Player A (host) is on the waiting screen and has successfully registered
their WebSocket connection,
And Player B is on the join screen and has entered a valid 6-character code for
that game,
When Player B submits the code,
Then within 3 seconds both Player A's screen and Player B's screen transition
from "waiting" / "connecting…" to a 3x3 game board,
And Player A's screen shows the label "You are X",
And Player B's screen shows the label "You are O",
And a status line reads "Game active — moves coming in the next update".

**F2 — DynamoDB Games record is active with both connection IDs populated [UC3, SM2]**
Given a successful join has just completed (F1 passing),
Then querying the `Games` table for that `gameId` (via `aws dynamodb get-item`)
returns an item where `status = "active"`, `hostConnectionId` is a non-null
non-empty string, and `guestConnectionId` is a non-null non-empty string.
No manual DynamoDB intervention was required to reach this state.

**F3 — Unknown code returns a readable error; join screen remains [UC2, SM3]**
Given Player B is on the join screen,
When they enter a 6-character code that does not correspond to any game in the
`Games` table and submit,
Then the WebSocket is closed (the SPA receives a close event),
And the join screen displays the message "Game not found. Check the code and
try again.",
And the code entered by Player B is retained in the input field (Player B does
not have to retype it),
And the join screen remains fully accessible (no page reload required),
And a subsequent `aws dynamodb scan` on the `Games` table confirms no new record
was created.

**F4 — Already-active game returns a readable error; no hijack possible [UC4, SM4]**
Given a game is already in `active` status (a previous Player B has already
joined and the game has been paired),
When a third player (or Player B trying again) enters that game's code and
submits on the join screen,
Then the WebSocket is closed,
And the join screen displays the message "This game is no longer available.",
And the `Games` record's `guestConnectionId` is unchanged — the original
Player B's connection ID is still stored,
And the `status` field is still `active`, not overwritten by the new attempt.

**F5 — Connections table contains both entries with approximately 2-hour TTL [UC3, SM5]**
Given a successful join has just completed (F1 passing),
Then the `Connections` table contains exactly two items for this game — one with
`role = "host"` and one with `role = "guest"` — each with a `ttl` attribute
whose value is between 1h 55m and 2h 5m from the time of the join (clock-skew
tolerance of 5 minutes),
Verifiable: `aws dynamodb scan --table-name <Connections>` filtered to the
relevant `gameId`.

**F6 — Host waiting screen shows connecting indicator while WebSocket establishes [UC1]**
Given Player A (host) has just been shown the waiting screen (code visible from
s004 flow),
When the SPA opens the WebSocket connection and sends the `register` message,
Then a "connecting…" or equivalent loading indicator is visible during the
establishment phase,
And the indicator resolves (disappears or changes to a "connected" state) once
the `register` acknowledgment is received or the connection is confirmed live,
And the game code remains visible throughout.

**F7 — Board squares are inert; clicking does nothing [UC5, SM1 partial]**
Given both players are on the game board screen after a successful join (F1
passing),
When either player clicks any square on the 3x3 board,
Then no move is registered, no board state changes, no WebSocket message is
sent, and no JavaScript error appears in the browser console,
And the status line continues to read "Game active — moves coming in the next
update".

**F8 — Existing local two-player and vs-AI modes are unaffected [UC5, SM6]**
Given slice s005 has been deployed to production,
When a player selects "Two Player (local)" from the mode selector and plays a
complete game (win, draw, or all squares filled),
Then the game plays to completion without error, the result is shown, and
"play again" returns to the mode selector.
And when a player selects "vs Computer" and plays a complete game,
Then the AI responds and the game plays to completion without regression.
No new breakage in either mode is attributable to the s005 changes.

**F9 — Server error on join shows a readable error without white-screening [UC2/UC3, SM3 partial]**
Given the backend (`oxo-ws-fn`) returns an internal error during a join attempt
(e.g. DynamoDB unavailable),
Then the WebSocket is closed with code 4500,
And the join screen displays a human-readable message (e.g. "Something went
wrong. Please try again."),
And the join screen remains accessible — no blank white screen or unhandled
error boundary shown,
And the entered code is retained.

**F10 — Pipeline deploys new WebSocket infrastructure cleanly [SM7]**
Given a push to the deploy branch with s005 changes,
Then the GitHub Actions pipeline succeeds end-to-end: CDK deploys `OxoGameProd`
(including new WebSocket API, Connections table, GSI, and `oxo-ws-fn`) then
`OxoOnlineProd` (SPA build with `wsUrl` config injected), followed by a
CloudFront invalidation,
And the workflow finishes green with no manual steps,
And the `wss://` URL is present and correct in the deployed SPA's runtime config.

---

## Technical (architecture/security policy)

Each case is tagged with its use case (UC1–UC5) and the security-note file it
operationalises (the note's checkable statements are the source for these policy
tests). "Check type" names the verification mechanism: **synth** (CDK assertion
over a synthesised template), **CLI** (`aws` command against the deployed
account), **unit** (handler unit/integration test), or **live** (probe against
the deployed WSS endpoint).

**T1 — `game-ready` reaches both connections within 3s of a valid join [UC3, delta cond.1]**
Given Player A (host) has registered (`hostConnectionId` set, `status='waiting'`)
and Player B sends `{ action: 'join', code: '<VALID>' }`,
Then within 3 seconds `oxo-ws-fn` posts a `{ type: 'game-ready', role: 'host' }`
frame to the host connection and a `{ type: 'game-ready', role: 'guest' }` frame
to the guest connection, each via `execute-api:ManageConnections`.
And the `game-ready` payload carries only `{ type, role }` — it does NOT disclose
the other player's `connectionId` or any other game field.
Check type: **live** (two WSS clients; assert both receive `game-ready` within 3s
and the payload keys are exactly `type` + `role`). Operationalises
`architecture/security/apigw-websocket.md` (Data classification).

**T2 — `Games` record shape after a successful join [UC3, delta cond.2]**
Given a successful join has completed (T1 passing),
Then `aws dynamodb get-item --table-name <Games> --key '{"gameId":{"S":"<id>"}}'`
returns an item where `status='active'`, `hostConnectionId` is a non-empty
string, and `guestConnectionId` is a non-empty string. No manual DynamoDB write
was needed to reach this state.
Check type: **CLI** (`aws dynamodb get-item`). Operationalises
`architecture/security/dynamodb-games.md` (s005 join write path).

**T3 — `Connections` entries exist with ~2h TTL [UC1, UC3, delta cond.3]**
Given a successful join has completed,
Then the `Connections` table holds two items for this game — one `role='host'`,
one `role='guest'` — each with a numeric `ttl` between 1h55m and 2h5m ahead of
the join time (5-minute clock-skew tolerance).
Check type: **CLI** (`aws dynamodb scan --table-name <Connections>` filtered to
the `gameId`; assert two items, distinct roles, `ttl` in range). Operationalises
`architecture/security/dynamodb-connections.md` (TTL ~2h on every item).

**T4 — Unknown code closes with 4040 and leaves `Games` unchanged [UC2, delta cond.4]**
Given Player B sends `{ action: 'join', code: '<NONEXISTENT>' }`,
Then `oxo-ws-fn` queries the `code-index` GSI, finds no item, and closes the
socket with close code 4040, and no `Connections` item is created for the failed
join.
And a `scan` of `Games` confirms no new record and no mutation of any existing
record.
Check type: **live** (assert close code 4040) + **CLI** (`scan` before/after,
unchanged). Operationalises `architecture/security/dynamodb-games.md`
(`code-index` GSI lookup) and `apigw-websocket.md` (clean close-code contract).

**T5 — Already-active game closes with 4041; no-hijack conditional write holds live [UC4, delta cond.5]**
Given a game in `status='active'` with an existing `guestConnectionId = G1`,
When a second party sends `{ action: 'join', code: '<THAT-CODE>' }`,
Then the `UpdateItem` `ConditionExpression` (`status='waiting'` AND
`attribute_not_exists(guestConnectionId)`) fails with
`ConditionalCheckFailedException`, `oxo-ws-fn` performs NO write, and closes the
socket with close code 4041.
And `aws dynamodb get-item` after the rejected attempt shows `guestConnectionId`
still equals `G1` and `status` still equals `active` — the record is byte-for-byte
unchanged.
Verifiable: seed an active game (record `G1`), drive a second `join` against its
code over the live WSS endpoint, assert close 4041, then `get-item` and diff the
item against the pre-attempt snapshot (must be identical).
Check type: **live** (close 4041) + **CLI** (`get-item` diff, unchanged).
Operationalises `architecture/security/dynamodb-games.md` (no-hijack join
conditional write) and `apigw-websocket.md` (no-hijack conditional write).

**T6 — `connectionId` is taken from request context, never the client body [UC1, UC3]**
Given a `register` or `join` message whose body additionally plants a
`connectionId` (or `hostConnectionId`/`guestConnectionId`) field,
Then the value `oxo-ws-fn` persists for `hostConnectionId`/`guestConnectionId` is
the caller's own `event.requestContext.connectionId`, and the planted body value
is never read or stored.
Verifiable: handler unit/integration test invokes the handler with a
`requestContext.connectionId = 'CTX-ID'` and a body field `connectionId='SPOOF'`;
assert the persisted item carries `CTX-ID` and `SPOOF` appears nowhere.
Check type: **unit** (handler test asserting the persisted id source).
Operationalises `architecture/security/dynamodb-games.md` (connectionId from
context) and `apigw-websocket.md` (register binds caller's own connectionId).

**T7 — Composed §30 contract: four WS route keys, action match, endpoint export, wsUrl source [UC1–UC4, delta §30]**
Given the synthesised `OxoGameProd` template (and the `OxoOnlineProd` SPA-config
source),
Then the WebSocket API synthesises exactly the four route keys `$connect`,
`$disconnect`, `register`, `join` and no `$default` catch-all,
And the client `action` values the SPA sends (`register`, `join`) each equal a
synthesised `RouteKey` (the `$request.body.action` selector value matches a
route — the WS analogue of the s004 path/route-key match),
And `OxoGameProd` synthesises a `CfnOutput` whose `exportName` is exactly
`OxoGameProd-WsApiEndpoint`, resolving to the `prod`-stage WSS invoke URL (id +
`/prod`), not a placeholder,
And the SPA `wsUrl` config is sourced from `OxoGameProd-WsApiEndpoint` (the deploy
config-injection step / SPA constant references that exact export name) — a
rename on either side fails at synth/CI, not in prod.
Check type: **synth** (CDK assertion across templates: `RouteKey` set + selector
expression + `hasOutput` on `OxoGameProd-WsApiEndpoint` + assertion that the
config-injection source string equals that export name). Operationalises
`architecture/security/apigw-websocket.md` (transport & API surface: four route
keys, no `$default`).

**T8 — Reserved concurrency and stage route throttling present on the WS path [UC1–UC4]**
Given the synthesised `OxoGameProd` template,
Then `oxo-ws-fn` has `ReservedConcurrentExecutions` set to a finite value > 0,
And the WebSocket API `prod` stage sets `DefaultRouteSettings` with
`ThrottlingRateLimit` and `ThrottlingBurstLimit` at a finite (non-default) hobby
cap.
Verifiable live: `aws lambda get-function-concurrency --function-name oxo-ws-fn`
returns `ReservedConcurrentExecutions > 0`.
Check type: **synth** (assert both properties present and finite) + **CLI**
(reserved-concurrency probe). Operationalises
`architecture/security/apigw-websocket.md` (resource-exhaustion controls) and
`lambda-execution-roles.md` (s005 reserved concurrency).

**T9 — `Connections` table is SSE-on, TTL-on-`ttl`, on-demand, no public resource policy [UC1, UC3]**
Given the synthesised `OxoGameProd` template,
Then the `Connections` `AWS::DynamoDB::Table` has partition key `connectionId`
(String, HASH) and no sort key, `SSESpecification.SSEEnabled = true`,
`TimeToLiveSpecification = { AttributeName: 'ttl', Enabled: true }`,
`BillingMode = 'PAY_PER_REQUEST'`, and no `ResourcePolicy` granting a public
principal (no `ResourcePolicy` at all is acceptable).
Check type: **synth** (`hasResourceProperties` on the Connections table +
`findResources` confirming no public `ResourcePolicy`). Operationalises
`architecture/security/dynamodb-connections.md` (table shape, SSE, TTL, billing,
no public access).

**T10 — `Games.code-index` GSI exists; base-table key schema unchanged [UC2, UC3, UC4]**
Given the synthesised `OxoGameProd` template,
Then the `Games` table declares a GSI `code-index` with partition key `code`
(String, HASH) and a minimal projection (KEYS_ONLY+INCLUDE or ALL — not wider
than the join-needed `status`/`hostConnectionId`/`guestConnectionId`),
And the `Games` base-table `KeySchema` is still exactly
`[{ AttributeName: 'gameId', KeyType: 'HASH' }]` (s004 schema unchanged — GSI is
an additive, in-place update, no table replacement).
Check type: **synth** (`hasResourceProperties` on the Games table:
`GlobalSecondaryIndexes` contains `code-index` and `KeySchema` unchanged).
Operationalises `architecture/security/dynamodb-games.md` (s005 `code-index`
GSI).

## Security policy

**S1 — `oxo-ws-fn` DynamoDB scope is exactly the delta grants — and nothing wider [UC1–UC4]**
Given the `oxo-ws-fn` execution-role policy (synth and deployed),
Then its DynamoDB statements grant ONLY:
`dynamodb:Query`/`dynamodb:GetItem` scoped to the `Games` table ARN and its
`code-index` GSI ARN; `dynamodb:UpdateItem` on the `Games` table ARN;
`dynamodb:PutItem` and `dynamodb:DeleteItem` on the `Connections` table ARN,
And it grants NO `dynamodb:Scan`, NO `dynamodb:*`, NO `PutItem`/`DeleteItem` on
`Games`, NO read/`Scan` on `Connections`, NO wildcard `Resource` (`*`), and NO
third/unrelated table on any statement.
Verifiable: **synth** assertion over the role's `AWS::IAM::Policy` statements
(enumerate actions per resource; assert the exact allowed set and the absence of
`Scan`/`*`/extra tables) and **CLI** `aws iam get-role-policy` /
`list-attached-role-policies` on the deployed role.
Check type: **synth** + **CLI**. Operationalises
`architecture/security/lambda-execution-roles.md` (s005 `oxo-ws-fn` DynamoDB
scope) and `dynamodb-games.md` / `dynamodb-connections.md` (per-table grant).

**S2 — `execute-api:ManageConnections` is scoped to this WS API ARN only — not `*`, not a second API [UC3]**
Given the `oxo-ws-fn` execution-role policy,
Then it grants `execute-api:ManageConnections` on this WebSocket API's ARN only
(`arn:aws:execute-api:<region>:<acct>:<wsApiId>/prod/POST/@connections/*`), and on
NO other resource — explicitly not `*`, not `execute-api:*`, and not any second
API id.
Verifiable: **synth** assertion that the only `execute-api:` statement's
`Resource` references this API id (no bare `*`) and the action is exactly
`ManageConnections`; **CLI** `get-role-policy` confirming the same on the deployed
role.
Check type: **synth** + **CLI**. Operationalises
`architecture/security/lambda-execution-roles.md` (ManageConnections on this API
ARN only).

**S3 — Clean error contract: only the defined close codes, no stack/internal leakage [UC2, UC3, UC4]**
Given any failing join/register attempt,
Then `oxo-ws-fn` closes the socket with one of exactly: 4040 (unknown code),
4041 (game no longer available / no-hijack rejection), or 4500 (internal error),
And no frame, close reason, or log delivered to the client contains a stack
trace, exception class name, table ARN, AWS request id, or other internal
detail; the customer-facing message is the human-readable text from the
F-cases.
Verifiable: **live** probes for each branch (nonexistent code → 4040; active game
→ 4041; forced backend fault → 4500) asserting the close code and that the
client-visible payload carries no internal strings.
Check type: **live** (close-code + payload-leakage probe) backed by **unit**
(handler maps each error class to its close code and a generic message).
Operationalises `architecture/security/apigw-websocket.md` (no `$default`; close
codes) — ties to F3/F4/F9.

**S4 — `oxo-deploy` WS extension is ARN-scoped with no `iam:*` mutation [UC1–UC4]**
Given the extended `oxo-deploy` role,
Then its s005 additions grant `lambda:UpdateFunctionCode` and `lambda:GetFunction`
scoped to the `oxo-ws-fn` function ARN only, and its effective permissions do NOT
include `iam:CreateRole`, `iam:AttachRolePolicy`, or `iam:PutRolePolicy` on any
resource (role creation stays with the CDK CloudFormation execution role under
bootstrap trust).
Verifiable: **CLI** `aws iam get-role-policy` / `list-attached-role-policies` on
`oxo-deploy` confirming the scoped Lambda actions and the absence of the three
IAM-mutation actions.
Check type: **CLI**. Operationalises
`architecture/security/lambda-execution-roles.md` (`oxo-deploy` extension,
ARN-scoped, no `iam:*`).

**S5 — Existing s004 pinned validations remain green (regression) [UC5, delta cond.8]**
Given s005 has been built,
Then the full s004 infra synth suite (`game-stack.test.ts`,
`shell-stack.test.ts`, `oidc-stack.test.ts`) and the s004 acceptance checks still
pass unchanged: `POST /api/games` route key present, `/api/*` CloudFront
behaviour `CachingDisabled`, `oxo-game-fn` PutItem-on-Games-only,
`OxoGameProd-HttpApiEndpoint` export untouched and still imported by
`OxoOnlineProd`, and the create-game S1/S3 security policies hold.
Verifiable: `npm --prefix work/oxo-online/src/infra run test` is green with all
pre-existing s004 cases passing; the `OxoGameProd-HttpApiEndpoint` export name is
unchanged in the synthesised template.
Check type: **synth** (existing suite green; export-name assertion).
Operationalises `architecture/security/dynamodb-games.md` (s004 subset unchanged)
and `lambda-execution-roles.md` (s004 `oxo-game-fn` subset unchanged).
