# Open items — oxo-online (process §38 register)

Owned by the orchestrator; appended by any agent whose return flags something
unaddressed. Every "what next" decision chooses over this register plus
`/process/improvement-slices/`. Nothing flagged may silently evaporate.

Selection rule: (1) DORA-helping process improvements first; (2) user value by
job served — core jobs beat secondary (see project.md classification);
(3) risk items before the slice that widens the surface they guard.

| id | source | item | job/risk served | tracked where | scheduled |
|----|--------|------|-----------------|---------------|-----------|
| OI-1 | security (gate-3 s005) | No WAF/rate-limit on WS endpoint — exhaustion risk | risk: availability/cost | chunk-plan s005-h1 | before s006 widens write surface |
| OI-2 | security (gate-3 s005) | No join-token / $connect auth on WS | risk: unauthenticated surface | chunk-plan s005-h2 | before s006 |
| OI-3 | security (gate-3 s005) | Game-code uniqueness not hard-guaranteed | risk: integrity (low at current volume) | chunk-plan s005-h3 | after h1/h2 (may parallel h2) |
| OI-4 | security/product (s004) | $disconnect stub — no abandoned status, stale conns reaped by TTL only | core job: play a human online (session integrity) | chunk-plan s007 | s007 |
| OI-5 | architecture (s005 delta) | CloudFront WS proxying decision revisit — single-origin URL if share-link UX demands it | secondary: share/join friction | delta 005 revisit-note | revisit at s008 |
| OI-6 | architecture (s004) | Lambda versioning not enabled — rollback is roll-forward only | risk: MTTR if a bad Lambda ships | DEPLOY_ROLE_EXTENSIONS.md rollback note | unscheduled — candidate for h-block |
| OI-7 | engineering (cicd s004) | Infra CI uses `npm install` not `npm ci` (mac-generated lock lacks linux optional deps) — lock should be regenerated on linux for deterministic CI | risk: build reproducibility | cicd s004 return | unscheduled |
| OI-8 | engineering (s004 fix) | Local mac infra vitest needs @rolldown binding installed --no-save (non-persistent dev-env state) | dev friction | engineer DEFECT-004-001 return | unscheduled — low |
| OI-9 | documentation (s004) | 24h game TTL with no UI notification — games vanish silently | secondary: UX polish on core job | docs/usage.md known limitations | unscheduled — consider with s007 |
| OI-10 | product (s005 slice) | Reconnect-after-reload explicitly unresolved ("s007+ or out of scope entirely") — needs a product decision | core job: play a human online (resilience) | slice 005 NOT-in-scope list | decide at s007 slice-next |
| OI-11 | tester (IMP-002) | Validation-spec relevancy review due — first review cycle of pinned s004 specs | process/quality hygiene | tests/validation/README.md lifecycle | at s005 retro |
| OI-12 | product (job classification) | Precedent watch: C3 (secondary, AI) delivered before C4 (core, online play) — pre-§38 sequencing; confirm core-first rule prevents recurrence | process discipline | this register + s005 retro | review at s005 retro |
| OI-17 | engineering (v22 §41) | Existing src/lambda code (games + ws) predates the hexagonal standard — domain/port/adapter refactor needed (handlers currently import DDB/APIGW shapes directly) | quality/maintainability of core-job code | §41 + this register | schedule via §38 — candidate alongside h-block or s006 (s006 touches the same handlers) |
| OI-18 | engineering+cicd (v22 §41) | No failure taxonomy in shipped code: no structured category logging (internal/external, data/availability), no tested logging, no metric filters | MTTR — support can't attribute failures | §41 | with OI-17; metrics in same slice as logging |
| OI-19 | documenter (v22 §41) | No docs/runbook.md — support team has no operational guide for the live product (2 Lambdas, 2 tables, 2 APIs, CloudFront) | MTTR | §41 documenter duty | first runbook at s005 documentation step (document what IS, including absence of categorised logging until OI-18) |

| OI-13 | cicd (s005) | Tester will need to send WS messages to the WSS endpoint — wscat or a node script is the natural tool; wscat is not in the allowlist. Proposed pattern: `Bash(npx wscat --connect wss://* --execute *)` or a root-relative node test script via `Bash(node work/oxo-online/scripts/ws-probe.js *)`. Recommend: node script (deterministic, no extra tool install friction, already allowed via `node` via npm scripts). Add `Bash(node work/oxo-online/scripts/* *)` to allowlist. | risk: tester blocked | allowlist + tester | before s005 tester |
| OI-14 | cicd (s005) | `aws apigatewayv2 get-stages` not in allowlist — needed to verify WS API stage is `prod` and AutoDeploy=true. Proposed: `Bash(aws apigatewayv2 get-stages *)`. Add to allowlist. | risk: tester blocked | allowlist | before s005 tester |
| OI-15 | cicd (s005) | `aws dynamodb query` not in allowlist — tester will need to query the Connections table by connectionId and Games table by code GSI to verify items. Proposed: `Bash(aws dynamodb query *)`. Add to allowlist. | risk: tester blocked | allowlist | before s005 tester |
| OI-16 | cicd (s005) | `/config.js` is a new file on S3/CloudFront with `no-cache` headers — the smoke test should assert it is reachable (HTTP 200) and contains `OXO_CONFIG`. No action for CICD (engineer wires the script tag in index.html; tester validates via curl). `Bash(curl https://d3pf3kcvzpau1x.cloudfront.net/config.js*)` may need to be added to the allowlist. | risk: tester blocked | allowlist | before s005 tester |

Process-side items (project-agnostic) live in `/process/improvement-slices/`
and the §27 retro queue — currently: pipeline-N+1-planning-over-build
(operationalise §8b), §37 parallel-build scoring on s005, IMP-001/002/003
scoring, v14–v18 anticipated-vs-observed scoring (all due at s005 retro).
