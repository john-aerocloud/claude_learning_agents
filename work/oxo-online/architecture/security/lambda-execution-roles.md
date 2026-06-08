# Security controls — Lambda execution roles (game / leaderboard / ws-authorizer)

Introduced: Chunk 4 (game, ws-authorizer), Chunk 5 (leaderboard).
Data class: **service compute identities**.

Checkable controls:
- [ ] Each function has its own execution role (no shared "god" role).
- [ ] `oxo-game-fn`: RW on Games+Connections tables only;
      `execute-api:ManageConnections` on the WS API ARN only; emit to leaderboard
      via a scoped target; CloudWatch Logs. No other permissions.
- [ ] `oxo-board-fn`: see the s009 section below — the C5-target "RW Leaderboard,
      read Games" is NARROWED in s009 to stream-read + `UpdateItem` only.
- [ ] `oxo-ws-authorizer`: validates connect token; CloudWatch Logs only, no
      data access.
- [ ] No role has `dynamodb:*` or `*:*`; all actions enumerated, all resources
      ARN-scoped.
- [ ] No function has a public function URL; invocation is only via the named
      API Gateway integrations.
- [ ] Env vars contain no secrets in plaintext (tokens/keys via SSM/Secrets
      Manager if any are needed).

## s004 subset (create-game only)
For slice 004 the `oxo-game-fn` policy is narrowed to the minimum for create:
- [ ] `dynamodb:PutItem` on the `Games` table ARN **only** — no read/query, no
      `Connections` table (deferred s005), no `execute-api:ManageConnections`
      (deferred s005). CloudWatch Logs on its own log group.
- [ ] Reserved concurrency cap set (bounds unauthenticated-write cost/abuse).
- [ ] `TABLE_NAME` is the only env var; not a secret.
The full RW + ManageConnections set above is added in s005 when join/relay land.

## s005 — `oxo-ws-fn` execution role (new principal)
A NEW Lambda execution role for the WebSocket join/register handler. It holds
write access to two tables plus `ManageConnections`, so it is the most-privileged
principal in the project so far — scope it exactly. Checkable controls (become
policy tests):
- [ ] `oxo-ws-fn` has its OWN execution role (not shared with `oxo-game-fn`).
- [ ] `dynamodb:Query`/`GetItem` scoped to the `Games` table ARN **and its
      `code-index` GSI ARN** only — no `Scan`.
- [ ] `dynamodb:UpdateItem` on the `Games` table ARN only (used with the no-hijack
      `ConditionExpression`). NO `PutItem`/`DeleteItem` on `Games`.
- [ ] `dynamodb:PutItem` and `dynamodb:DeleteItem` on the `Connections` table ARN
      only. NO read/`Scan` on `Connections` in s005.
- [ ] `execute-api:ManageConnections` scoped to **this WebSocket API's ARN**
      (`arn:aws:execute-api:<region>:<acct>:<wsApiId>/prod/POST/@connections/*`) —
      explicitly **NOT** `*` and not another API.
- [ ] `logs:CreateLogGroup`/`CreateLogStream`/`PutLogEvents` on its own log group
      only.
- [ ] NO `dynamodb:*`, NO `execute-api:*`, NO `iam:*`, NO second/unrelated table,
      NO bucket access, NO `*:*`.
- [ ] `ReservedConcurrentExecutions` set (> 0, small cap) — bounds cost/abuse on
      the unauthenticated WS endpoint.
- [ ] No public function URL; invoked only via the named WebSocket API
      integrations (`$connect`/`$disconnect`/`register`/`join`).
- [ ] Env vars (`GAMES_TABLE`, `GAMES_CODE_INDEX`, `CONNECTIONS_TABLE`,
      `WS_API_ENDPOINT`) contain no secrets.
- [ ] `oxo-deploy` gains `lambda:UpdateFunctionCode`/`GetFunction` scoped to the
      `oxo-ws-fn` ARN only; still NO `iam:CreateRole`/`AttachRolePolicy`/
      `PutRolePolicy`.

## s009 (delta 010) — `oxo-board-fn` execution role (NEW principal) + game-fn read grant
NEW stream-consumer principal + a narrow read grant on the existing game-fn.
Checkable controls (become policy tests — T-LB-9 IAM no-widening pin):
- [ ] `oxo-board-fn` has its OWN execution role (not shared with `oxo-ws-fn` or
      `oxo-game-fn`).
- [ ] `oxo-board-fn`: `dynamodb:GetRecords`/`GetShardIterator`/`DescribeStream`/
      `ListStreams` scoped to the **`Games` table STREAM ARN only** (stream
      consume) + `dynamodb:UpdateItem` on the **`Leaderboard` table ARN only** +
      its own CloudWatch Logs group. **NOTHING else.**
- [ ] `oxo-board-fn` has **NO Games TABLE grant** (it reads OLD+NEW images from
      the stream RECORD, not the table); **NO** `Scan`/`Query`/`GetItem`/
      `DeleteItem`/`PutItem` on `Leaderboard`; **NO** `execute-api`, **NO**
      bucket, **NO** secret, **NO** `dynamodb:*`/`iam:*`/`*:*`.
- [ ] `oxo-board-fn` `ReservedConcurrentExecutions` set (small cap) — bounds the
      stream-consumer cost.
- [ ] No public function URL; invoked only by the `Games`-stream event-source
      mapping.
- [ ] `oxo-game-fn` gains **exactly** `dynamodb:Scan` on the **`Leaderboard`
      table ARN only** (the `GET /api/leaderboard` read). **NO** `Query`/
      `UpdateItem`/`DeleteItem`/`GetItem` on `Leaderboard`. Its existing Games/
      Codes/secret grants are unchanged. The name-write rides the EXISTING
      `PutItem` on `Games` — NOT a new grant.
- [ ] `oxo-ws-fn` gains **NO new grant** in s009 (the `guestName` write rides the
      existing conditional `UpdateItem` on `Games`). Confirm unchanged from s007.
- [ ] `oxo-deploy` gains `lambda:UpdateFunctionCode`/`GetFunction` scoped to the
      **`oxo-board-fn` ARN only**; still NO `iam:CreateRole`/`AttachRolePolicy`/
      `PutRolePolicy` (the board-fn role + stream + table are CDK-synthesised
      under existing bootstrap trust, not created by the deploy role at runtime).
