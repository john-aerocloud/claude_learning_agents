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

Process-side items (project-agnostic) live in `/process/improvement-slices/`
and the §27 retro queue — currently: pipeline-N+1-planning-over-build
(operationalise §8b), §37 parallel-build scoring on s005, IMP-001/002/003
scoring, v14–v18 anticipated-vs-observed scoring (all due at s005 retro).
| OI-12 | product (job classification) | Precedent watch: C3 (secondary, AI) delivered before C4 (core, online play) — pre-§38 sequencing; confirm core-first rule prevents recurrence | process discipline | this register + s005 retro | review at s005 retro |
