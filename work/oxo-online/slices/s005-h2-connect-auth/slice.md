---
slice: s005-h2
slug: connect-auth
status: planning
iteration: 8
sequence: after s005-h1, before s006
gate: GATE-2-H2 (standing approval)
---

# s005-h2 — Join-token / $connect authorisation + per-IP rate-limiting

## Job served

**Risk-reduction job (protecting the CORE job):** When the WebSocket API is
publicly reachable without authentication, I want only legitimate game
participants to hold active connections, and no single IP to exhaust the
connection pool, so that game sessions are protected from connection-injection
and flood abuse before move relay (s006) widens the write surface further.

This is a hardening slice. It does not add user-visible features. Its success
is observable as: unauthorised `$connect` attempts are rejected before reaching
any game-logic Lambda; valid host+guest flows continue to work unchanged; no
single IP can burst beyond the per-IP threshold.

---

## Context: residuals this slice closes

From `architecture/security/apigw-websocket.md`:
- **OI-2 (unauthenticated WS endpoint):** no per-game capability token on
  `$connect` — anyone who learns a `gameId` or is prepared to try codes could
  open a WS connection and send arbitrary actions. Closed here.
- **h1 residual (per-IP WS exhaustion):** WAFv2 cannot associate with API
  Gateway v2 (WebSocket) APIs; the platform constraint means per-IP WS
  rate-limiting cannot live in WAF. The `$connect` Lambda authorizer is the
  honest home — it has access to `event.requestContext.identity.sourceIp` and
  can enforce a per-IP connection budget. Closed here.

---

## Token model decision

### The choice: code-as-credential for guests; signed wsToken for host

**Host path:** `POST /api/games` already returns `{ gameId, code }`. This
slice extends the response to also include `wsToken` — a short-lived HMAC-SHA256
signed token encoding `{ gameId, role: "host", exp }`. The host SPA passes
`?wsToken=<token>` in the WebSocket URL at `$connect`. The authorizer verifies
the HMAC signature and the expiry. No new HTTP endpoint.

**Guest path:** The guest's only pre-existing shared secret is the 6-char code.
Rather than introducing a new HTTP exchange endpoint (`POST /api/games/tokens`
or similar), the `$connect` authorizer accepts `?code=<CODE>` for guests. It
does a DynamoDB GSI lookup on the code to confirm the game exists and is in
`waiting` status, then allows the connection. No new HTTP endpoint.

**Why not a separate join-exchange endpoint for guests?**
A new `POST /api/games/tokens` would be the cleanest separation of concerns but
adds new surface (a new route on the HTTP API, a new Lambda path, a new
acceptance scope, new deploy-role grants). The guest's code is already the
capability credential — the server minted it with enough entropy for its
purpose. Reusing it in the authorizer avoids new surface at the cost of a
DynamoDB read inside the authorizer. That read is bounded (a single GSI
`GetItem` keyed on the code), and the authorizer already needs IAM
`dynamodb:GetItem` on the Games GSI to validate host tokens (verifying gameId
exists). The marginal cost of the guest code-lookup path is low.

**Honest trade-off logged:** the code-as-credential guest path means a guest
who has a valid code but has not yet "joined" (i.e. the game is still
`waiting`) can open a WS connection without declaring intent to join. This is
acceptable: (a) opening a WS with a valid code is not more powerful than the
current unauthenticated state, (b) the existing conditional-write join handler
still enforces the one-guest-per-game invariant, (c) C6 identity (future)
closes the remaining gap. This is a deliberate under-sell of the guest token
approach, not a missed risk.

**Token details (implementation guidance for architect):**
- HMAC-SHA256 with a 32-byte secret stored in the `$connect` authorizer's
  Lambda environment (or SSM SecureString — architect decides, noting SSM adds
  latency to cold start; env var is faster but requires key-rotation discipline).
- Payload: `base64url(JSON({ gameId, role, exp }))` + `.` + `base64url(sig)`.
  No PII, no accounts. exp = now + 60 seconds (short — the host opens WS
  immediately after getting the token; a longer window is not needed).
- The authorizer is a REQUEST-type Lambda authorizer on the `$connect` route
  (not a TOKEN-type — we need access to the query string, which REQUEST-type
  provides).

**Per-IP rate-limiting in the authorizer:**
The authorizer checks `event.requestContext.identity.sourceIp`. A
DynamoDB counter table (`ConnectAttempts`, keyed on `sourceIp`, with a 5-min
TTL) is the thinnest stateful per-IP store. Increment on each authorizer
invocation; if counter > threshold (e.g. 20/5-min, matching the interim stage
throttle), DENY.

Honest limitation: Lambda authorizer results are **cached** (default TTL 300s
per `(token, methodArn)` key). Per-IP counting in a DynamoDB counter will
count unique-token invocations, not every connection attempt from an IP. This
is **best-effort**: a determined attacker cycling tokens can avoid the counter.
The control is explicitly documented as a best-effort deterrent, not a hard
guarantee. Combined with the stage throttle (20/40 account-level) this is
a layered floor. If the authorizer cache is set to `ttl=0` (disable caching),
per-IP counting becomes accurate but adds DynamoDB cost per connection. Architect
decides the cache TTL; this file names the honesty tradeoff.

Alternative considered: in-memory per-container counter. Simpler (no DynamoDB),
but Lambda containers are not pinned — a burst across containers gives no
cross-container visibility. DynamoDB counter is marginally more reliable. Both
are best-effort; DynamoDB is chosen as the less-incorrect option.

---

## Scope (what IS in this slice)

- Add a `$connect` **REQUEST-type Lambda authorizer** to the WebSocket API.
  The authorizer: (1) validates `?wsToken` (host path) or `?code` (guest path);
  (2) enforces a per-IP connect budget via a DynamoDB counter; (3) returns
  Allow/Deny IAM policy.
- Extend `POST /api/games` response: add `wsToken` field (signed HMAC, 60s
  expiry). Host SPA appends `?wsToken=<token>` to the `wss://` URL.
- Guest SPA: append `?code=<code>` to the `wss://` URL at connect time.
- New DynamoDB table `ConnectAttempts`: `sourceIp` (PK), `count` (N), `ttl`
  (TTL). On-demand, SSE, 5-min TTL on items.
- IAM: `$connect` authorizer Lambda gets `dynamodb:GetItem` on Games (GSI read
  for code-lookup), `dynamodb:UpdateItem` + `dynamodb:PutItem` on
  `ConnectAttempts`.
- Deploy-role grant additions: `lambda:CreateFunction`, `lambda:UpdateFunctionCode`,
  `lambda:AddPermission` for the new authorizer function (architect to confirm
  scope in delta — likely covered by existing Lambda grants).

## What is explicitly NOT in scope

- **Identity / accounts (C6):** no user authentication, no session tokens, no
  passwords, no JWTs with user identity. This is a capability token only —
  it proves "I have a legitimate game context", not "I am a specific user".
- **Reconnect to same game:** if a player reloads, they lose the wsToken. They
  must create/join again. Reconnect is out of scope (s007+ or not planned).
- **Move relay** (s006): the `$connect` authorizer gates connection only. What
  happens after connect (sending moves, relay) is unchanged — deferred to s006.
- **$disconnect handling:** stub only, unchanged from s005.
- **Share-link UX** (s008): no URL pre-fill, no public join flow change.
- **CloudFront WebSocket proxying:** WS stays direct.
- **Hard-guarantee per-IP blocking:** the best-effort nature of the DynamoDB
  counter (authorizer caching, Lambda container spread) is logged honestly; a
  hard per-IP guarantee is not a goal of this slice.
- **Token rotation / key management tooling:** the HMAC secret is set once at
  deploy; key rotation discipline is an operational note, not a built feature
  here.
- **s005-h3 (code uniqueness enforcement):** independent, can be parallel.

---

## Success measures (observable in production)

1. **SM-1 — Unauthenticated $connect rejected:** a `wss://` connect attempt
   with no `wsToken` or `code` parameter is rejected at the authorizer (HTTP 403
   on upgrade, before any `$connect` Lambda game-logic invocation). Verifiable
   via CloudWatch Lambda invocation count on the game-logic handler (zero
   invocations on bad-token attempts) and authorizer deny logs.

2. **SM-2 — Garbage token rejected:** a `$connect` with a syntactically valid
   but tampered/expired `wsToken` is rejected by the authorizer. No game-logic
   invocation occurs.

3. **SM-3 — Valid host flow unchanged:** a host completes `POST /api/games` →
   receives `wsToken` → opens WS with `?wsToken=` → registers → joins flow
   completes; both players see the board within 3 seconds. Regression smoke.

4. **SM-4 — Valid guest flow unchanged:** a guest enters a valid code → SPA
   opens WS with `?code=<CODE>` → joins → both players see the board. Pairing
   still completes within 3 seconds. Regression smoke.

5. **SM-5 — Per-IP burst rejected:** from a single IP, N rapid WS connect
   attempts (N > per-IP threshold, within the 5-min window) result in DENY
   responses. The DynamoDB `ConnectAttempts` item for the source IP shows a count
   >= threshold. (Best-effort: test may observe slightly fewer denies than
   expected due to authorizer caching — the test accepts this and documents it
   honestly.)

6. **SM-6 — Existing modes unaffected:** local two-player and vs-AI complete a
   full game without regression.

7. **SM-7 — Pipeline deploys cleanly:** GitHub Actions infra + deploy pipelines
   succeed end-to-end; no manual steps; new authorizer Lambda and ConnectAttempts
   table are live.

---

## Killick test

Before this slice: any client can open a WebSocket connection to the API with no
credential whatsoever and send any message. After this slice: only a client
holding a valid host wsToken or a valid guest code can reach the `$connect`
handler at all — the authorizer is the gatekeeper. This is something no user
(legitimate or malicious) could experience before: a rejected unauthenticated
connection attempt.

---

## Risk classification

Hardening slice — risk-reduction job supporting the CORE job (Playing against a
real human). Closes the highest-risk open surface before s006 widens the write
surface.

---

## Dependencies

- s005-h1 must be delivered first (its Option A rationale documents the re-homing
  of per-IP WS control into this slice's authorizer; the WS API stage it attaches
  to must exist).
- No dependency on s005-h3 (can be parallel).
- s006 should follow this slice (per the stated sequencing intent: close auth
  gap before widening the write surface with move relay).
