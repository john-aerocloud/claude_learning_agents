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
- [x] **WAF attached (s005-h1-waf — risk closing).** A CloudFront-scope WAFv2
      WebACL (rate-based rule 100/5-min/IP + `AWSManagedRulesAmazonIpReputationList`)
      now fronts all `/api/*` traffic, so `POST /api/games` is rate-bounded per
      IP before reaching the HTTP API or Lambda. The Lambda reserved-concurrency
      cap + 24h TTL remain as the defence-in-depth floor. No separate WebACL on
      the HTTP API stage (Gate-2 decision — CloudFront ACL covers the path). See
      `architecture/security/wafv2.md` and `deltas/s005-h1-waf.md`.

## s009 (delta 010) — `GET /api/leaderboard` (NEW read route)
NEW read-only route on the EXISTING HTTP API v2, backed by `oxo-game-fn`
(Scan-only). Checkable controls:
- [ ] `GET /api/leaderboard` is **read-only**: it `Scan`s Leaderboard and returns
      top-20 JSON; NO client can write a leaderboard record via any HTTP route
      (writes happen ONLY on the server-computed game-end stream → `oxo-board-fn`).
- [ ] The route is reached same-origin via the CloudFront `/api/leaderboard`
      behaviour (TTL=5s; see `cloudfront-distribution.md`); `POST /api/games`
      stays `CachingDisabled`. The existing CloudFront WAF rate rule fronts it
      (per-IP rate-bounded before reaching the HTTP API/Lambda).
- [ ] The response carries `buildSha` (version-identifiable surface, principles/01).
- [ ] Names in the response are server-normalised (≤10/charset-bounded) and the
      SPA renders them as ESCAPED text — stored-XSS control (delta 010 §8 / T-LB-8).
- [ ] No client-supplied field controls the Scan beyond the fixed top-N; oversized/
      unexpected query params ignored.
