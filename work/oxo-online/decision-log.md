# Decision log (append-only)

Every gate decision and notable autonomous default. Anchors are referenced from
the DORA ledger `ref` column.

| ts (UTC) | gate | decision | by | rationale | anchor |
|----------|------|----------|----|-----------|--------|
| 2026-06-05T09:30:00Z | kickoff | Project oxo-online created; requirement workflow started | orchestrator | React/AWS multiplayer noughts and crosses with leaderboard | KICKOFF-OXO |
| 2026-06-05T09:32:00Z | gate-1 | Product vision approved | human | 5 jobs, 7 chunks: shell → local game → AI → online match → leaderboard → identity → chat | GATE-1-OXO |
| 2026-06-05T09:45:00Z | gate-2 | Architecture + security approved | human | Lambda+APIGW WS+DynamoDB+CloudFront; CDK TypeScript; server-authoritative; OIDC; no VPC C1-C7 | GATE-2-OXO |
| 2026-06-05T11:40:00Z | gate-2b | Slice 001 (deployable-shell) approved | human | 7 ACs; CDK+S3+CloudFront+OIDC+GitHub Actions; proceed to build | GATE-2B-OXO |
| 2026-06-05T13:33:00Z | build-complete | Engineer build complete; 4/4 unit tests pass | engineer | React shell + Playwright smoke tests; workflow path fixes applied; awaiting go/no-go | GATE-2B-OXO |
| 2026-06-05T17:50:00Z | delivered | Slice 001 deployed and live | orchestrator | https://d3pf3kcvzpau1x.cloudfront.net — GitHub Actions pipeline green; OIDC auth, S3 sync, CloudFront invalidation all working | SLICE-001-DELIVERED |
| 2026-06-05T09:33:00Z | arch | Target architecture produced (serverless) | solution-architect | Lambda over Fargate (scale-to-zero, spiky low-volume); API Gateway WebSocket over ECS long-lived (managed conns, no warm server); DynamoDB over RDS (ephemeral game TTL + simple leaderboard aggregates); C1 shell = static SPA, no backend; server-authoritative game = move-forgery defence; prod-only + OIDC | GATE-1-OXO |
| 2026-06-05T18:00:00Z | gate-2 | Slice 002 (local-game) approved | human | React-only local two-player game: board, turn alternation, win/draw detection, result + play-again; no backend; proceed to architecture delta | GATE-2-S002 |
| 2026-06-05T18:05:00Z | process | Process updated to v10 | human | Security review auto-accepted when conclusion = no new attack surface/data flow/trust boundary; process-current.md v9→v10 | PROCESS-V10 |
| 2026-06-05T18:05:00Z | gate-3 | Slice 002 arch delta + security auto-accepted | orchestrator | Delta = pure frontend, zero infra change; security conclusion = no new attack surface/data flow/trust boundary — auto-accept per v10 §8a | GATE-3-S002 |
