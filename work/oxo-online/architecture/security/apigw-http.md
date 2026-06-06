# Security controls — API Gateway HTTP (create game / read leaderboard)

Introduced: Chunk 4 (create/join), Chunk 5 (leaderboard read).
Data class: **public game metadata + leaderboard aggregates** (display name from
C6 is the only quasi-PII; user-supplied, not verified).

Checkable controls:
- [ ] HTTPS only; TLS 1.2+.
- [ ] Reached same-origin via CloudFront (/api/*); CORS, if direct, restricted
      to the production origin only.
- [ ] `create game` returns a high-entropy, unguessable game code (not
      sequential) and a per-game join token (capability for the WS connect).
- [ ] WAF rate-based rule throttles create-game and leaderboard-read per IP.
- [ ] Leaderboard read is read-only; no client can write leaderboard records via
      any HTTP route — writes happen only on server-computed game-end.
- [ ] Lambda integration; no compute is publicly reachable except through these
      named routes.

## s004 subset (POST /api/games only)
- [ ] Only `POST /games` exists; reached same-origin via the CloudFront `/api/*`
      behaviour (origin HTTPS-only, `CachingDisabled`).
- [ ] No client-supplied field is persisted; server generates `gameId`, `code`,
      `status`, `ttl`. Non-POST methods and unexpected/oversized bodies rejected.
- [ ] **WAF deferred** for s004: cost/abuse floor is the Lambda reserved
      concurrency cap + 24h DynamoDB TTL. WAF rate-based rule to be attached in
      C4/C5 against observed traffic — tracked open risk.
