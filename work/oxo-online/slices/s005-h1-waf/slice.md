---
slice: s005-h1
slug: waf-rate-limiting
status: planning
iteration: 7
sequence: after s005, before s006
---

# s005-h1 — WAF / rate-limiting on public endpoints

## Job served

**Risk-reduction job (enabling the CORE job):** When the product is live with
unauthenticated public endpoints (HTTP API POST /api/games via CloudFront, and
WebSocket API wss direct), I want exhaustion/flood attacks to be bounded at the
infrastructure layer, so that legitimate players can always create and join games
and AWS costs cannot be driven up unboundedly by a single abusive source.

This is a hardening slice. It does not add user-visible features. Its success is
observable as: controls demonstrably in place (checkable via AWS APIs), rate
limits trigger under a synthetic burst, and the normal create-game + join-game
flow continues to work unaffected.

## Control decisions — which endpoint, which control

### Endpoint 1: HTTP API POST /api/games (via CloudFront)

Control: **WAF WebACL attached to the CloudFront distribution** with an
IP-based rate-based rule (AWS managed `AWSManagedRulesAmazonIpReputationList`
+ a custom rate rule).

Rationale: The HTTP API is already behind CloudFront (`/api/*` behaviour in
`OxoOnlineProd`). Attaching a WAF WebACL at CloudFront is the natural
enforcement point — it inspects the request before it ever reaches the HTTP API
or Lambda. One WAF WebACL on the distribution covers all CloudFront-served
routes, including the current `POST /api/games` and any future HTTP routes
(e.g. leaderboard read in s010), at no marginal per-route cost. CloudFront WAF
is a GLOBAL scope WebACL (us-east-1 required).

### Endpoint 2: WebSocket API wss (direct — NOT behind CloudFront)

Control: **WAF WebACL attached to the API Gateway WebSocket API stage** with a
rate-based rule.

Rationale: The WS API connects directly (`wss://…/prod`) — not via CloudFront.
A CloudFront WAF does not cover it. A separate REGIONAL scope WebACL is required
and attached to the API Gateway stage via `wafv2:AssociateWebACL`. This is the
correct tool: API Gateway HTTP and WebSocket stages are valid WAFv2 association
targets. The in-slice controls (reserved concurrency + stage throttling) remain
as a defence-in-depth floor; WAF adds the IP-rate layer on top.

### WAF not at the HTTP API stage

The HTTP API is intentionally left without a separate REGIONAL WebACL on the
stage. The CloudFront WAF covers all traffic to `/api/*`. A duplicated
stage-level WebACL would add cost without covering additional attack paths,
because the HTTP API stage is not directly internet-reachable (the CloudFront
origin is an internal DNS name; direct API GW URLs remain the back channel
already accepted as residual risk). Accepted: do not add a WAF to the HTTP API
stage in this slice.

### Rate rule calibration

Hobby-volume numbers (low, revisable at next gate):
- CloudFront WebACL rate rule: 100 requests per 5-minute window per IP.
  Rationale: a real user creating games is unlikely to exceed 5/minute; 100 is a
  10x buffer for normal use while still blocking a script-driven flood.
- WS API rate rule: 20 connection attempts per 5-minute window per IP.
  Rationale: legitimate play requires at most 1–2 WS connections per session.

Both numbers are explicitly low for hobby volume and must be revisited before
any public launch. The architect may adjust in the delta; this slice's slice.md
names the design intent, not a hard number commitment.

## OI-6 decision — Lambda versioning: NOT folded in

OI-6 (Lambda versioning not enabled — rollback is roll-forward only) is a valid
risk-reduction item but is NOT folded into this slice. Justification:

1. Lambda versioning changes the deployment mechanism (the app pipeline's
   `update-function-code` step would need to publish a version and manage
   aliases). That is an engineering and CICD concern, not a pure WAF attach.
2. This slice is deliberately thin: infrastructure-only, no Lambda code changes,
   no pipeline changes. Folding in OI-6 would require touching the Lambda CDK
   definition, the CICD pipeline Lambda update step, and rollback procedure — a
   materially different scope that mixes two separate change risks.
3. OI-6 is a lower urgency than the WAF controls (which need to be in place
   before s006 widens the write surface). Lambda versioning improves MTTR but
   does not block s006 safety.

OI-6 remains unscheduled in open-items.md. It is a candidate for the first
pipeline-touching slice that modifies Lambda configuration (likely alongside
OI-17/18 hexagonal refactor, or as a standalone cicd slice before s006).

## Scope (what IS in this slice)

- Create a WAF WebACL (GLOBAL, us-east-1) with a rate-based rule and attach it
  to the existing CloudFront distribution (`OxoOnlineProd` stack).
- Create a WAF WebACL (REGIONAL) with a rate-based rule and attach it to the
  WebSocket API `prod` stage (`OxoGameProd` stack).
- Both WebACLs: AWS IP Reputation List managed rule group + custom rate-based
  rule. Default action: allow (block only on rule match — rate exceeded or bad
  IP reputation).
- No Lambda code changes. No new routes. No pipeline changes. No new DynamoDB
  tables. No functional change to the create-game or join-game flow.

## What is explicitly NOT in scope

- h2: Join-token / `$connect` Lambda authorizer — deferred to s005-h2.
- h3: Game-code uniqueness enforcement — deferred to s005-h3.
- s006: Move relay, server-authoritative board.
- WAF on the HTTP API stage (rationale above — not needed; CloudFront WAF covers
  the path).
- CloudFront WebSocket proxying (still not in scope; WS stays direct).
- Any change to the join or create-game Lambda code.
- Any pipeline, deployment role, or CICD change (OI-6, OI-20, etc.).
- OI-17/18 hexagonal refactor and structured logging.

## Success measures (observable in production)

1. **SM-1 — WAF on CloudFront:** `aws wafv2 list-web-acls --scope CLOUDFRONT
   --region us-east-1` returns a WebACL whose ARN is listed in the CloudFront
   distribution's `WebAclId` field (`aws cloudfront get-distribution-config`).
2. **SM-2 — WAF on WS API stage:** `aws wafv2 list-resources-for-web-acl
   --resource-type API_GATEWAY --region <deploy-region>` returns the WS API
   stage ARN.
3. **SM-3 — Rate-limit triggers under synthetic burst:** a test script making
   repeated rapid `POST /api/games` requests from a single IP receives HTTP 403
   (WAF block) before reaching the Lambda; a matching WS connect burst test
   receives a WAF rejection. Both validated by the tester's validation spec.
4. **SM-4 — Normal flow unaffected:** the existing smoke test (create game, join
   game, board visible) passes green post-deploy. No legitimate request is
   blocked by the rate rule under normal usage patterns.
5. **SM-5 — Existing modes unaffected:** local game and vs-AI remain functional
   (client-only; no backend impact).

## Killick test

A user doing anything legitimate — creating a game, joining a game — can still
do it after this slice. And a user trying to abuse the endpoints via rapid
repeated connections from one IP is blocked before hitting Lambda. The second
capability (blocking abuse) is something impossible to guarantee before this
slice: the WAF controls are now demonstrably in place.

## Risk classification

Hardening slice — SECONDARY job (Reliable, always-on availability) supporting
the CORE job (Playing against a real human). This slice exists to protect the
availability and cost floor of the CORE job's public endpoints.

## Dependencies

- s005 must be delivered first (this slice attaches to the WS API stage created
  in s005).
- s005-h2 follows this slice (join-token auth builds on a WAF-protected
  endpoint).
- No dependency on s005-h3 (can be parallel).
