# Delta 007a — GATE-AMEND: authorizer per-IP runner exemption (DEFECT-S007-001)

Amends delta 007 and the s005-h2 security pins. Triggered by a correct §5a STOP:
removing the WAF-layer throttle (IMP-008) for the CI runner IP unmasked the
**next-tighter** control — the `$connect` authorizer's per-IP DDB budget
(`CONNECT_RATE_THRESHOLD=20/5min`, `oxo-connect-attempts`). A 50-test serial
smoke + `retries:2` cannot fit one 20-connect/5-min window, so once `count=20`
the runner is denied for the rest of the window and `pairBrowsers` times out.
The fix is to **continue the IMP-008 human-directed runner exemption one layer
deeper** — into the authorizer's per-IP budget — using the SAME
transient-by-protocol, self-cleaning pattern.

## RULING: APPROVED, with the design below (bounded amendment, NOT a new boundary)

The engineer's §5a analysis is sound; I do not re-litigate the rejected
alternatives (deploy-time CIDR = standing bypass for ephemeral runner IPs;
global threshold raise = weakens prod control dishonestly; harder serialisation
= already EXP-009-serialised and still exhausts). The only durable, honest fix is
a per-run, self-cleaning exemption item. Approved with the placement, TTL,
table-choice and grant-scoping decisions below — each chosen for least surface.

---

## The five considerations, ruled explicitly

### 1. Attack surface — who can WRITE the exemption item
Only the **deploy/runner principal** (`oxo-deploy` OIDC role, assumed by the
GitHub Actions deploy job via `OXO_ONLINE_DEPLOY_ROLE_ARN`), and only via the
`scripts/waf-runner-ip.js` add/remove path — the SAME principal and SAME tool
that already mutates the WAF `oxo-test-runner-ips` IP set. No human, no app
principal (`oxo-ws-fn`, `oxo-game-fn`), and **not** the authorizer itself may
write it.

This IS a **NEW write grant** on the deploy role: today `oxo-deploy` carries
`WafRunnerIpExclusion` (`wafv2:GetIPSet`/`UpdateIPSet`/`ListIPSets` on the named
IP-set ARN). It does **not** today hold any data-plane write to
`oxo-connect-attempts`. **New grant to add to the deploy role
(`ConnectExemptionWrite`):** `dynamodb:PutItem` + `dynamodb:DeleteItem` on the
`oxo-connect-attempts` **table ARN only**, with a request-key condition pinning
it to the exemption PK namespace (see §item shape). **No** `UpdateItem` (the
deploy role never increments a counter), **no** `GetItem`/`Query`/`Scan`, **no**
second table, **no** `*`. This grant lands in the same place the WAF grant does
(deploy-oidc role policy), is a cicd capability step, and is the only new
deploy-side permission.

### 2. Failure modes — exemption left behind (runner crash before remove)
Bound it with a **TTL on the exemption item**, tighter than the WAF 24h drain
posture: **`ttl = now + 3600` (1h)**. Rationale: a smoke run is minutes, not
hours; 1h covers a slow/retried run with generous margin while bounding a leaked
exemption to one hour for one specific server-derived runner IP. The `if:always()`
`remove` step is the primary cleanup (mirrors the WAF trap); the 1h TTL is the
backstop for a runner crash that skips the trap.

**Lazy-deletion is the known strike class (DEFECT-H2-003) — state it explicitly:**
DynamoDB TTL deletion is LAZY; an expired exemption item may remain readable for
up to ~48h after `ttl` passes. Therefore the authorizer MUST treat the item as
exempt **only if `ttl > now`** — it evaluates expiry itself and never trusts the
lazy delete. A stale, un-reaped exemption item with `ttl <= now` is NOT an
exemption. This is the same defensive read the connect-counter already uses for
the window (`#ttl > :now`); we apply it identically to the exemption check.

### 3. Read cost/latency on every `$connect` — PREFERRED: post-threshold check
**Zero extra reads on the happy path.** The authorizer checks the exemption
**only AFTER the per-IP count has reached the threshold** — i.e. on the path that
would otherwise `Deny RATE_LIMIT`. For every connect under budget (the
overwhelming majority, all prod traffic, every non-exhausted runner connect)
there is **no** `GetItem` — the increment runs exactly as today and Allows. The
extra `GetItem` fires only on the would-be-denied connects of an IP that has
already burned its window. This is sound: an exempt runner only needs the
exemption to take effect once it is over budget; a non-exempt/attacker IP over
budget pays one extra read and is STILL denied (the exemption GetItem returns
no-live-item → Deny stands). Net: prod and attacker happy/flood paths are
byte-for-byte unchanged; only an over-budget IP incurs the read, and only an
over-budget IP for which a LIVE exemption exists flips to Allow.

### 4. OR-H2-a best-effort posture — UNCHANGED
This parameterises an exemption for one known, server-derived IP; it does **not**
change the best-effort per-IP control for any non-exempt IP. The read-less ADD
race, the IP-rotation evasion, and the layered-deterrent framing are all intact.
An attacker IP is never in the exemption namespace (only the deploy role writes
it, keyed by the runner's own detected IP), so an attacker sees the identical
Deny-at-threshold behaviour as before. **OR-H2-a stands as written.**

### 5. Table choice — REUSE `oxo-connect-attempts`, special PK (least surface)
A new item in the existing `oxo-connect-attempts` table under a reserved PK
namespace (`EXEMPT#<ip>`), **not** a separate table. Consequences:
- **Least infra surface:** no new `AWS::DynamoDB::Table`, no new SSE/TTL/PITR
  config to get right, no new resource ARN to scope four grants against.
- **Grant scoping consequence (the cost of co-locating):** the authorizer's read
  and the deploy role's write both target the SAME table ARN that already holds
  the counter. We pin the namespace by **request-key condition on the write**
  (`dynamodb:LeadingKeys` = `EXEMPT#*`) so the deploy role can write ONLY
  exemption items, never counter items; and by **key shape on the read** (the
  authorizer GetItems `sourceIp = EXEMPT#<ip>` — a distinct key from the counter's
  `sourceIp = <ip>`). The counter PK (`<ip>`) and the exemption PK (`EXEMPT#<ip>`)
  never collide. TTL attribute (`ttl`) is shared — both honour `ttl > now`.
- A separate tiny table would give a cleaner ARN boundary but adds a whole
  resource (table + SSE + TTL + four grants) for one transient item. Rejected on
  economy; the request-key condition gives equivalent write-isolation.

---

## Design (what the engineer builds)

### Item shape (`oxo-connect-attempts`, exemption namespace)
| attr | value | notes |
|---|---|---|
| `sourceIp` (PK) | `EXEMPT#<runnerIp>` | reserved namespace; distinct from counter key `<runnerIp>` |
| `ttl` (N) | `now + 3600` (1h, epoch s) | TTL-enabled attr; authorizer checks `ttl > now` (lazy-delete defence) |
| (no `count`) | — | exemption items carry no counter |

Written by: `oxo-deploy` via `waf-runner-ip.js` add (`PutItem`); removed by the
`if:always()` remove step (`DeleteItem`). Idempotent both ways (mirror the WAF
append/filter discipline).

### Authorizer check placement (post-threshold — domain-pure)
In `authorize()` the rate gate becomes: increment as today; if `decideRateLimit`
says `Deny`, **then** consult a new `ExemptionPort.isExempt(sourceIp, now)`; if it
returns true (a LIVE exemption item exists with `ttl > now`), **skip the
RATE_LIMIT Deny** and fall through to credential validation. If no live exemption
→ Deny stands exactly as today. The exemption NEVER bypasses token/code
validation — an exempt-IP connect with a bad token still Denies VALIDATION. The
`ttl > now` evaluation lives in the adapter (it has `now`); the domain stays pure.

### Grants — BOTH sides (the exact statements)
- **Authorizer (`oxo-ws-auth-fn`) — NEW read:** `dynamodb:GetItem` on the
  `oxo-connect-attempts` table ARN **only**. This is the grant the s005-h2 pin
  forbade ("No GetItem beyond what the increment needs"); the pin is **amended**
  (below) to permit exactly this one GetItem for the exemption check, scoped to
  this one table, no `Query`/`Scan`, no second table, no `*`.
- **Deploy role (`oxo-deploy`) — NEW write (`ConnectExemptionWrite`):**
  `dynamodb:PutItem` + `dynamodb:DeleteItem` on the `oxo-connect-attempts` table
  ARN, conditioned `dynamodb:LeadingKeys` = `["EXEMPT#*"]` (write only the
  exemption namespace, never counter items). No `UpdateItem`, no read, no `*`.

## New-mechanism flag
**NO new platform integration mechanism.** `dynamodb:GetItem` against a DynamoDB
table is already exercised by this very authorizer (`code-index` guest lookup)
and by `oxo-ws-fn`. The deploy role already does runtime AWS data mutation via
`waf-runner-ip.js`. No walking-skeleton probe required; the in-slice proof is the
smoke-ci run itself going green (47/50 → 50/50) plus the negative policy test.

## Local vs cloud-only gap (principles/02)
- **Stands locally:** the `ExemptionPort` + post-threshold check logic (pure
  decision over `(count, threshold, exemption?)`); local in-memory/DynamoDB-Local
  adapter reproduces the `ttl > now` live/stale branch and the exempt/non-exempt
  branch. The negative (non-exempt IP at threshold still Denies) runs locally.
- **Cloud-only:** the IAM grants (authorizer GetItem; deploy-role
  Put/Delete + LeadingKeys condition) — covered by **policy tests** (S-AUTH-EXEMPT
  positive+negative below). The real lazy-delete timing — covered by the
  `ttl > now` code-policy pin + the steady-state self-heal already proven for the
  counter.

## Retry/backoff posture per call
- **Authorizer exemption `GetItem`:** SDK default retry (standard mode, exp
  backoff + jitter, max 3). On exhaustion → treat as NO live exemption → the
  RATE_LIMIT Deny **stands** (fail-closed: an unavailable exemption store never
  weakens the control). Within the Lambda timeout budget; fires only on the
  already-over-budget path so adds no happy-path latency.
- **Deploy-role Put/Delete:** reuse the `waf-runner-ip.js` posture — add fails
  closed (non-zero exit aborts smoke before it runs a doomed throttled suite);
  remove runs under `if:always()`, best-effort, with the 1h TTL as backstop.

## Version identity (principles/01)
No new deployable surface. The authorizer's existing `buildSha` log field carries
build identity; the exemption-applied path emits a structured log line
(`{ effect:'Allow', reason:'rate-exempt', sourceIp, count }`) so an exemption that
fires is attributable to a build and visible in CloudWatch (and is the carrier for
the negative-test assertion that prod traffic never logs `rate-exempt`).

## Region policy
No exception. `oxo-connect-attempts` is in the home region (eu-west-2); the
exemption item is the same table. (The WAF IP set's us-east-1 placement is the
pre-existing, documented CLOUDFRONT-scope exception and is unchanged.)

---

## Security conclusion (gates §9a auto-accept vs human re-gate) — VERBATIM

**Is there a new attack surface / data flow / trust boundary? This is a BOUNDED
AMENDMENT to an existing control, NOT a new boundary: it adds one scoped
`dynamodb:GetItem` to the authorizer (on the table it already writes) and one
scoped `dynamodb:PutItem`/`DeleteItem` (namespace-conditioned to `EXEMPT#*`) to
the SAME deploy/runner principal that already mutates the WAF runner-IP set —
introducing NO new principal, NO new table, NO new public surface, NO new region,
and NO new mechanism; the only entity that can create an exemption is the
deploy-role keyed to its own server-derived runner IP, the authorizer consults it
ONLY on the already-over-budget path and ONLY honours `ttl > now` (lazy-delete
defence, DEFECT-H2-003), it NEVER bypasses token/code validation, and it changes
NOTHING for any non-exempt or attacker IP (which still Denies at threshold) — so
the per-IP best-effort posture (OR-H2-a) is unchanged and the blast radius is
bounded to one transient, self-expiring, TTL-bounded exemption item for one known
runner IP.**

This conclusion is a **bounded amendment to an existing control surface** —
within the §9a auto-accept envelope (no new attack surface/flow/boundary). The
gated review consists of the two amended security notes whose checkable controls
become policy tests.

## Open risks (carried)
- **OR-S007a-a — exemption item co-located in the counter table:** isolation
  rests on the `EXEMPT#*` LeadingKeys write-condition + distinct key shape, not a
  separate ARN. Accepted on economy; reversal = move to a dedicated tiny table if
  the namespace condition ever proves insufficient.
- **OR-S007a-b — 1h leaked exemption on a trap-skipping runner crash:** bounded to
  one server-derived runner IP for ≤1h (TTL); the prod control is unaffected for
  every other IP. Accepted (mirrors the WAF drain posture, tighter).
