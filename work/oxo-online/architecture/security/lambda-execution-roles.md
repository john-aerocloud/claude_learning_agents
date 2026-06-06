# Security controls — Lambda execution roles (game / leaderboard / ws-authorizer)

Introduced: Chunk 4 (game, ws-authorizer), Chunk 5 (leaderboard).
Data class: **service compute identities**.

Checkable controls:
- [ ] Each function has its own execution role (no shared "god" role).
- [ ] `oxo-game-fn`: RW on Games+Connections tables only;
      `execute-api:ManageConnections` on the WS API ARN only; emit to leaderboard
      via a scoped target; CloudWatch Logs. No other permissions.
- [ ] `oxo-board-fn`: RW Leaderboard, read Games, CloudWatch Logs. No WS, no
      bucket access.
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
