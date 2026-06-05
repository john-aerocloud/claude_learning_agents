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
