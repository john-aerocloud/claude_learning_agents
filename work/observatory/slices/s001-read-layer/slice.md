---
slice: s001
slug: read-layer
status: ready
chunk: CHK-1
created: 2026-06-09
infra-deploy-gate: NO   # local-only; no cloud infra; §F5 gate does not apply
process-ref: §F3 (JIT replenishment) + §37 (use-case decomposition)
---

# s001 — CHK-1 read layer: parse §4 sources + serve localhost API + SSE live-refresh

## Job served

**[CORE] Observe DORA and flow metrics (J1) + Navigate and interrogate the flow (J2)**

When I open the Observatory tool, a pipeline operator wants all §4 repo sources
parsed to typed records and served locally read-only, so they can build
trustworthy views over project + flow state without reading raw files themselves.

This slice is the data foundation. Without it, no CHK-2/3/4 view can render.
It is CORE because the entire Phase-1 (Observe) value proposition depends on it.
It produces no user-facing view itself — the value it unlocks is in the views
that will build on top of it.

## Killick test

Could a user do something valuable they could not do before?

YES, narrowly: after s001 a pipeline operator can `curl localhost:3001/api/projects`
and get a typed JSON list of every project with its ACTIVE flag — something that
previously required manual directory listing + file reading. More importantly, the
server provides the trustworthy data layer that makes CHK-2/3/4 (the visible,
valuable views) buildable in the next slices. The operator can validate data
correctness at the API level before any UI exists. That is thin but real.

## Scope: what IS in this slice

1. **Project registry parser + endpoint** — list `work/*` dirs (exclude
   `_TEMPLATE`), read `work/ACTIVE`, return typed project records with active flag.
   `GET /api/projects` and `GET /api/active`.

2. **Queue + work-item CSV parser + endpoints** — parse `items.csv`, `intake.csv`,
   `ready.csv`, `deploy.csv`, `rework.csv`, `policy.csv` per the §4 column schemas,
   to typed records. Header-only CSV returns `[]`; missing optional file returns
   `null`. Endpoints: `GET /api/projects/:id/items`,
   `GET /api/projects/:id/queues/:queue`, `GET /api/projects/:id/queues/policy`.

3. **DORA + flow markdown/mmd pass-through + endpoints** — read
   `process/dora/baseline.md`, `work/<project>/dora/flow.md`,
   `work/<project>/dora/per-project.md`, and
   `work/<project>/architecture/dependencies/use-case-deps.mmd`,
   `work/<project>/architecture/dependencies/class-deps.mmd`
   as raw strings (rendering is a CHK-4 SPA concern). Missing file returns `null`.
   Endpoints: `GET /api/dora/baseline`, `GET /api/projects/:id/dora/flow`,
   `GET /api/projects/:id/dora/per-project`,
   `GET /api/projects/:id/deps/:file`.

4. **Slice-artifact raw pass-through endpoint** — for a given project + slice dir,
   return the raw contents of present artifact files (`slice.md`, `use-cases.md`,
   `acceptance.md`, `result.md`, `test-plan.md`). Missing file returns `null`.
   Endpoint: `GET /api/projects/:id/slices/:slug/:artifact`.

5. **SSE file-watch live-refresh channel** — `GET /api/events` (long-lived
   connection); `chokidar` watches repo root; server emits
   `data: {"type":"change","path":"<rel-path>"}` on every file change.
   Latency target: event delivered within 1s of file write.

6. **Express server scaffold** — `src/server/index.ts`, read-only route table
   (GET only; no POST/PUT/PATCH/DELETE registered), CORS restricted to
   `http://localhost:5173`, configurable `PORT` env var (default 3001), repo-root
   config parameter.

7. **Vitest test suite** — TDD: parsers and routes built test-first against
   fixture files in `src/server/__tests__/fixtures/`. All §9 CHK-1 acceptance
   conditions pinned.

8. **npm scripts** — `server` (start), `test:ci` (vitest run), `start:check`
   (smoke: start → GET /api/projects → 200 → SIGTERM → exit 0).

## Scope: what is explicitly NOT in this slice

- **SPA / frontend** — `src/app/` (Vite, React, any rendering). CHK-2+.
- **Mermaid rendering** — raw `.mmd` string returned as-is; rendering is CHK-4.
- **Markdown → HTML rendering** — raw string only; CHK-4 concern.
- **Playwright E2E tests** — no browser surface in CHK-1; deferred to CHK-2+.
- **GitHub Actions CI workflow** — deferred; add only when a regression needs
  guarding. Not needed to start CHK-1.
- **`decision-log.md`, `open-items.md`, `chunks.md` endpoints** — not listed in
  §4's authoritative data contract; defer to need-driven addition.
- **`process/` self-state views** — `process-current.md`, `process-history/`,
  `experiments.md`, `improvement-slices/`, `principle-failures/` are §4.6 sources
  but CHK-1 focuses on the per-project and DORA data that the Phase-1 views need
  first. Process self-state endpoints can be added in CHK-3/4 when the views
  consuming them are defined.
- **WebSocket / bidirectional channel** — SSE is the decided push channel; WS
  deferred to CHK-5+ if needed.
- **Feature flags** — none needed; the read layer is unconditional.
- **`ledger.csv` filtering endpoint** — ledger is a CHK-4 concern (item-history
  drill-down needs item_id filtering); defer.

## Non-infra confirmation

This slice runs entirely on `localhost`. There is no cloud environment, no
GitHub Actions deploy pipeline, no AWS credentials, no OIDC, no database
migration, no irreversible state change. The §F5 infra-bearing deploy gate does
NOT apply. "Deploy" means `npm --prefix work/observatory install &&
npm --prefix work/observatory run server` works on a clean checkout.

## Success measures

| # | Measure | Observable signal |
|---|---------|-------------------|
| SM1 | Project registry correct | `GET /api/projects` returns all `work/*` dirs except `_TEMPLATE`; includes ACTIVE flag; no crash on `ACTIVE=none` |
| SM2 | CSV resilience | Header-only CSV → `[]`; missing optional file → `null`; no server crash |
| SM3 | Typed records | Parsed records match §4 column schemas; types correct (no raw strings for numeric fields where schema specifies number) |
| SM4 | Live refresh | A file change triggers an SSE event at the connected client within 1000ms |
| SM5 | Read-only | No POST/PUT/PATCH/DELETE route registered; attempting one returns 404 or 405; confirmed by route-table test |
| SM6 | Start-check green | `npm --prefix work/observatory run start:check` exits 0 on a clean checkout |
| SM7 | Test suite green | `npm --prefix work/observatory run test:ci` exits 0; all acceptance cases in acceptance.md pass |
