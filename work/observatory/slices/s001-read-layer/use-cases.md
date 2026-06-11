---
slice: s001
slug: read-layer
process-ref: §37 (use-case decomposition) + §F3 (JIT replenishment) + §F6 (seams/paths)
co-authored: product + solution-architect
---

# Use cases — s001: read layer

## Parallel / serial structure

```
PARALLEL SET A — mutually independent parsers (disjoint files, no shared state):
  UC1 — project registry parser + /api/projects + /api/active
  UC2 — CSV parsers (items + queues) + queue/item endpoints
  UC3 — DORA/flow markdown+mmd pass-through + endpoints
  UC4 — slice-artifact pass-through endpoint

SET B — depends on UC1+UC2+UC3+UC4 (needs parsers to exercise):
  UC5 — SSE file-watch channel (/api/events)

SET C — depends on UC1..UC5 (needs full route table):
  UC6 — server scaffold (Express bootstrap, CORS, read-only guard, start:check)
```

UC1–UC4 are fully independent: different source files, different parsers, different
route handlers, different test fixtures. They can be built and unit-tested in
parallel with zero file conflicts. UC5 (SSE watcher) depends on the parsers being
in place so that re-emit tests can also assert data freshness; however the watcher
module itself is structurally independent — it can be built against a stub. The
engineer may start UC5 in parallel but cannot close its done-condition until at
least UC1–UC2 parsers are present for the file-watch fixture test. UC6 is the
integration scaffold that wires all routes; it is last because it imports the
route handlers from UC1–UC5.

Value/cost estimates follow the §F6 model (penny-game sizing):
- Value: HIGH = directly advances SM1-SM7; MED = advances subset; LOW = infra-only
- Cost: in engineer-hours (S = 1–2h, M = 3–4h, L = 5–8h)

---

## UC1 — Project registry: list projects + read ACTIVE flag

**ID:** UC1
**Actor:** Engineer (building); Pipeline operator (consuming via API).
**Trigger:** `GET /api/projects` or `GET /api/active` called on the running server.
**Value:** HIGH | **Cost:** S (2h)

### Job

When the operator queries the project registry, the server lists every directory
under `work/` (excluding `_TEMPLATE`) with its name and ACTIVE flag, so consumers
have the canonical project list without reading the filesystem themselves.

### §4 sources

- `work/ACTIVE` — single line, project name or `none`
- `work/<project>/` — directory scan; exclude `_TEMPLATE`

### Endpoints

- `GET /api/projects` → `[{ id: string, active: boolean }]`
- `GET /api/active` → `{ active: string | null }` (null when ACTIVE = "none" or file missing)

### Trigger → observable outcome

1. Directory scan of `work/` returns all subdirectories.
2. `_TEMPLATE` is excluded from the list.
3. `work/ACTIVE` is read; if contents trim to `"none"` or file is absent, `active` is `null`.
4. Each project entry has `active: true` if its name matches `work/ACTIVE` content.
5. `GET /api/active` returns `{ active: null }` when ACTIVE = "none" (no crash).

### Done condition

All UC1 acceptance cases pass independently; no other UC need be present.

### Acceptance cases (UC1)

- AC1.1: `GET /api/projects` with a fixture tree containing `work/oxo-online/`,
  `work/observatory/`, `work/_TEMPLATE/` returns an array of length 2, containing
  `{id:'oxo-online'}` and `{id:'observatory'}`; `_TEMPLATE` is absent.
- AC1.2: The project whose name matches `work/ACTIVE` has `active: true`; all
  others have `active: false`.
- AC1.3: When `work/ACTIVE` contains `"none"`, `GET /api/active` returns
  `{ active: null }`; `GET /api/projects` returns all projects with `active: false`.
- AC1.4: When `work/ACTIVE` file is absent (missing optional file), `GET /api/active`
  returns `{ active: null }` with HTTP 200 — no crash, no 500.
- AC1.5: HTTP status 200 on both endpoints for a valid fixture tree.

### Dependencies

None. UC1 depends on no other UC.

### Seams / paths owned

`src/server/parsers/project-registry.ts`, `src/server/routes/projects.ts`,
`src/server/__tests__/project-registry.test.ts`.

---

## UC2 — CSV parsers: items + queues (with resilience)

**ID:** UC2
**Actor:** Engineer (building); Pipeline operator (consuming via API).
**Trigger:** `GET /api/projects/:id/items` or `GET /api/projects/:id/queues/:queue`
or `GET /api/projects/:id/queues/policy` called on the running server.
**Value:** HIGH | **Cost:** M (4h — covers 6 CSV schemas + resilience cases)

### Job

When the operator queries work items or queue state for a project, the server
parses the relevant CSV files to typed records per the §4 column schemas, so
consumers receive structured data rather than raw CSV strings.

### §4 sources

- `work/<project>/items/items.csv` — columns: `id,type,parent,children,job,state,value,cost,vc_ratio,created_ts,done_ts,dora_ref`
- `work/<project>/queues/intake.csv` — columns: `item_id,enqueued_ts,value,cost,vc_ratio,position,reason`
- `work/<project>/queues/ready.csv` — same columns as intake
- `work/<project>/queues/deploy.csv` — same columns as intake
- `work/<project>/queues/rework.csv` — same columns as intake
- `work/<project>/queues/policy.csv` — columns: `queue,param,value,unit,owner,target_metric,last_tuned,experiment`

### Endpoints

- `GET /api/projects/:id/items` → typed `ItemRecord[]`
- `GET /api/projects/:id/queues/intake` → typed `QueueRecord[]`
- `GET /api/projects/:id/queues/ready` → typed `QueueRecord[]`
- `GET /api/projects/:id/queues/deploy` → typed `QueueRecord[]`
- `GET /api/projects/:id/queues/rework` → typed `QueueRecord[]`
- `GET /api/projects/:id/queues/policy` → typed `PolicyRecord[]`

All return `[]` for header-only CSV; `null` (HTTP 200) for missing optional file.

### Trigger → observable outcome

1. CSV file with 2–3 data rows parses to an array of typed records matching the §4 schema.
2. Header-only CSV (header present, zero data rows) returns `[]` — no crash.
3. Missing optional file returns HTTP 200 with JSON body `null` — no crash.
4. Extra unknown columns in a CSV are silently ignored.
5. `type` field in items records is one of `{requirement, chunk, slice, use-case, defect}`.

### Done condition

All UC2 acceptance cases pass independently with fixture files; no other UC need be present.

### Acceptance cases (UC2)

- AC2.1: `items.csv` with 3 rows (one each of type `chunk`, `slice`, `use-case`) →
  response array length 3; each record has correct `id`, `type`, `state`, `value`,
  `cost` fields; field types match schema (strings where schema says string).
- AC2.2: `intake.csv` with 2 rows → response array length 2; `position` field is
  present; `value`, `cost`, `vc_ratio` preserved as strings (raw from CSV).
- AC2.3: `policy.csv` with rows for `ready` queue `min_items` and `wip_limit` →
  response includes both rows; `param` field matches the row values exactly.
- AC2.4: Header-only `intake.csv` (header row, no data rows) → HTTP 200, body `[]`.
  No crash, no 500.
- AC2.5: Header-only `ready.csv` → same: HTTP 200, body `[]`.
- AC2.6: Header-only `deploy.csv` → HTTP 200, body `[]`.
- AC2.7: Header-only `rework.csv` → HTTP 200, body `[]`.
- AC2.8: Missing `items.csv` (path does not exist) → HTTP 200, body `null`. No crash.
- AC2.9: Missing `policy.csv` → HTTP 200, body `null`. No crash.
- AC2.10: A CSV with an extra unknown column (e.g. `extra_col`) → extra column
  ignored; all §4 columns parsed correctly; no crash.
- AC2.11: `GET /api/projects/nonexistent/items` (project dir does not exist) →
  HTTP 200, body `null`. No crash.

### Dependencies

None. UC2 depends on no other UC (uses its own parser, own fixtures).

### Seams / paths owned

`src/server/parsers/csv.ts`, `src/server/routes/items.ts`,
`src/server/routes/queues.ts`, `src/server/__tests__/csv-parser.test.ts`,
`src/server/__tests__/fixtures/` (CSV fixture files).

---

## UC3 — DORA + flow markdown/mmd pass-through endpoints

**ID:** UC3
**Actor:** Engineer (building); Pipeline operator (consuming via API).
**Trigger:** `GET /api/dora/baseline`, `GET /api/projects/:id/dora/flow`,
`GET /api/projects/:id/dora/per-project`, or `GET /api/projects/:id/deps/:file` called.
**Value:** HIGH | **Cost:** S (2h — raw string pass-through, simpler than CSV)

### Job

When the operator (or a CHK-3/4 view) queries DORA metrics or dependency graphs,
the server returns the raw markdown or mmd string so renderers can process it,
without the server needing to parse or understand the content.

### §4 sources

- `process/dora/baseline.md` — global DORA baseline (four metrics, constraint, per-agent times)
- `work/<project>/dora/flow.md` — per-project flow view
- `work/<project>/dora/per-project.md` — expected-vs-actual per change
- `work/<project>/architecture/dependencies/use-case-deps.mmd` — dependency graph
- `work/<project>/architecture/dependencies/class-deps.mmd` — class dep graph

### Endpoints

- `GET /api/dora/baseline` → `{ content: string | null }`
- `GET /api/projects/:id/dora/flow` → `{ content: string | null }`
- `GET /api/projects/:id/dora/per-project` → `{ content: string | null }`
- `GET /api/projects/:id/deps/use-case-deps.mmd` → `{ content: string | null }`
- `GET /api/projects/:id/deps/class-deps.mmd` → `{ content: string | null }`

All return `{ content: null }` (HTTP 200) when the file is absent.

### Trigger → observable outcome

1. A present markdown file is returned as a raw string in `content`; the server
   does NOT parse, transform, or render the markdown.
2. A present `.mmd` file is returned as a raw string in `content`; no Mermaid
   processing on the server.
3. A missing file returns `{ content: null }` with HTTP 200 — no crash, no 500.

### Done condition

All UC3 acceptance cases pass independently with fixture files.

### Acceptance cases (UC3)

- AC3.1: `GET /api/dora/baseline` with a fixture `process/dora/baseline.md`
  containing known text → response `{ content: "<exact fixture text>" }`.
- AC3.2: `GET /api/projects/observatory/dora/flow` with a fixture `flow.md` →
  raw string returned; server has not altered any line.
- AC3.3: `GET /api/projects/observatory/deps/use-case-deps.mmd` with a fixture
  `.mmd` file → raw mermaid string in `content`; no parsing applied.
- AC3.4: `GET /api/dora/baseline` when `process/dora/baseline.md` does not exist →
  HTTP 200, `{ content: null }`. No crash.
- AC3.5: `GET /api/projects/observatory/dora/flow` when `flow.md` absent →
  HTTP 200, `{ content: null }`. No crash.
- AC3.6: `GET /api/projects/observatory/deps/class-deps.mmd` when file absent →
  HTTP 200, `{ content: null }`. No crash.
- AC3.7: `GET /api/projects/:id/deps/../../etc/passwd` (path traversal attempt) →
  HTTP 400 or 404; the server does NOT read outside the repo root. The `:file`
  parameter is validated to the allowlist (`use-case-deps.mmd`, `class-deps.mmd`).

### Dependencies

None. UC3 depends on no other UC.

### Seams / paths owned

`src/server/parsers/file-reader.ts`, `src/server/routes/dora.ts`,
`src/server/routes/deps.ts`, `src/server/__tests__/dora.test.ts`.

---

## UC4 — Slice-artifact raw pass-through endpoint

**ID:** UC4
**Actor:** Engineer (building); CHK-4 view (consuming).
**Trigger:** `GET /api/projects/:id/slices/:slug/:artifact` called.
**Value:** MED | **Cost:** S (1–2h — same pattern as UC3 but parameterised by artifact name)

### Job

When a CHK-4 detail pane wants to render a slice's artifact, the server returns
the raw file content so the SPA can render markdown/code without knowing the
filesystem path, with safe null returns for absent artifacts.

### §4 sources

Per slice dir `work/<project>/slices/<slug>/`:
`slice.md`, `use-cases.md`, `acceptance.md`, `route.md`, `ui-design.md`,
`test-plan.md`, `result.md` (presence varies).

### Endpoint

- `GET /api/projects/:id/slices/:slug/:artifact` → `{ content: string | null }`

Artifact allowlist: `slice.md`, `use-cases.md`, `acceptance.md`, `route.md`,
`ui-design.md`, `test-plan.md`, `result.md`. Any other artifact name → HTTP 400.

### Trigger → observable outcome

1. A present artifact file returns `{ content: "<raw text>" }`.
2. An absent artifact file returns `{ content: null }` with HTTP 200.
3. An artifact name not on the allowlist returns HTTP 400.

### Done condition

All UC4 acceptance cases pass independently with fixture files.

### Acceptance cases (UC4)

- AC4.1: `GET /api/projects/observatory/slices/s001-read-layer/slice.md` with a
  fixture `slice.md` containing known text → `{ content: "<exact fixture text>" }`.
- AC4.2: `GET /api/projects/observatory/slices/s001-read-layer/result.md` when
  `result.md` is absent → HTTP 200, `{ content: null }`. No crash.
- AC4.3: `GET /api/projects/observatory/slices/s001-read-layer/malicious.sh` →
  HTTP 400 (not on allowlist).
- AC4.4: Slice dir that does not exist → HTTP 200, `{ content: null }` for any
  valid artifact name. No crash.

### Dependencies

None. UC4 depends on no other UC (same pattern as UC3 file-reader).

### Seams / paths owned

`src/server/routes/slices.ts`, `src/server/__tests__/slices.test.ts`.
Re-uses `file-reader.ts` from UC3.

---

## UC5 — SSE file-watch live-refresh channel (/api/events)

**ID:** UC5
**Actor:** SPA client (consuming SSE stream); engineer (testing with EventSource or fetch streaming).
**Trigger:** `GET /api/events` — long-lived HTTP connection opened by client.
**Value:** HIGH | **Cost:** M (3–4h — chokidar setup + SSE frame emission + async timing test)

### Job

When a file in the repo changes, every connected SSE client receives a change
event within 1s so downstream views can re-fetch and re-render without a manual
reload.

### §4 source

All files under the repo root (`chokidar` watch with `ignoreInitial: true`).

### Endpoint

- `GET /api/events` — long-lived SSE connection; server emits:
  `data: {"type":"change","path":"<repo-root-relative path>"}\n\n`
  on every file-watch event. Heartbeat comment line `:\n\n` every 30s to keep
  the connection alive through proxies (optional but recommended).

### Trigger → observable outcome

1. Client connects to `GET /api/events`; server responds with
   `Content-Type: text/event-stream`, `Cache-Control: no-cache`.
2. When any file under the repo root is written/renamed/deleted, the server emits
   a `change` event with the relative path within 1000ms of the filesystem event.
3. Multiple connected clients all receive the event (fan-out).
4. On client disconnect (`connection close` event), the server removes the
   client from its list; no crash, no memory leak.
5. No SSE event is emitted for the initial scan (`ignoreInitial: true`).

### Done condition

All UC5 acceptance cases pass, including the timing assertion.
UC1 and UC2 must be present so the fixture file written in the timing test is a
real §4 source (otherwise the test can use any fixture file — the watcher watches
all files, not just §4 sources).

### Acceptance cases (UC5)

- AC5.1: Client connects; server sends `Content-Type: text/event-stream` header.
- AC5.2: Client connects; no `change` event is emitted immediately on connect
  (`ignoreInitial: true`).
- AC5.3: A fixture file under the watched root is written by the test (using
  `fs.writeFileSync`); the connected SSE client receives a `change` event with
  `type: "change"` and a `path` field matching the relative path of the written
  file, within 1000ms of the write. (Vitest `vi.waitFor` or `Promise.race` with
  1000ms timeout — no sleep.)
- AC5.4: Two clients are connected; a file change triggers events to BOTH clients.
- AC5.5: A client disconnects (connection closed); a subsequent file change does
  NOT cause a crash or unhandled rejection on the server.
- AC5.6: The SSE response does NOT include `Access-Control-Allow-Origin: *`; it
  respects the server's CORS policy (origin: `http://localhost:5173` only — or
  test origin in test mode).

### Dependencies

- UC5 has a structural dependency on UC1/UC2 being present for the integration
  fixture test, but the watcher module (`watcher.ts`) can be built independently.
  The engineer CAN build UC5 in parallel with UC1–UC4; UC5's done-condition cannot
  be signed off until the timing test passes, which requires a running server with
  at least one real endpoint to confirm the full integration path.
- Practically: start UC5 in parallel; close it after UC1–UC4 are green.

### Seams / paths owned

`src/server/watcher.ts`, `src/server/__tests__/sse-watch.test.ts`.

---

## UC6 — Express server scaffold: bootstrap, CORS, read-only guard, start:check

**ID:** UC6
**Actor:** Engineer (building); pipeline operator (running the tool).
**Trigger:** `npm --prefix work/observatory run server` — server starts and accepts requests.
**Value:** HIGH | **Cost:** S (2h — wiring, not net-new logic)

### Job

When the engineer wires all route handlers together, the server starts on
localhost:3001, enforces read-only and CORS constraints, and passes the start:check
smoke — so the full read layer is runnable on a clean checkout.

### §4 source

All routes from UC1–UC5 wired into `src/server/index.ts`.

### Trigger → observable outcome

1. `npm --prefix work/observatory run server` starts without error.
2. `GET /api/projects` returns HTTP 200.
3. `POST /api/projects` (or any non-GET verb to any route) returns HTTP 404 or 405.
4. `GET /api/projects` from origin `http://localhost:9999` (not the allowed SPA
   origin) receives no `Access-Control-Allow-Origin` header (CORS rejected).
5. `GET /api/projects` from origin `http://localhost:5173` receives
   `Access-Control-Allow-Origin: http://localhost:5173`.
6. Server accepts `PORT` env var to override port 3001.
7. `npm --prefix work/observatory run start:check` exits 0 on a clean checkout.

### Done condition

All UC6 acceptance cases pass AND `start:check` exits 0.
UC1–UC5 done-conditions must be met first (UC6 imports their route handlers).

### Acceptance cases (UC6)

- AC6.1: `npm --prefix work/observatory run server` starts; within 3s `GET /api/projects`
  returns HTTP 200 (server is up and routing correctly).
- AC6.2: `POST /api/events` → HTTP 404 or 405 (no write verb registered).
- AC6.3: Route-table test — the registered Express route list contains NO
  `router.post`, `router.put`, `router.patch`, `router.delete` entries; GET-only
  confirmed by inspecting the route table programmatically.
- AC6.4: CORS: `GET /api/projects` with `Origin: http://localhost:5173` →
  response includes `Access-Control-Allow-Origin: http://localhost:5173`.
- AC6.5: CORS: `GET /api/projects` with `Origin: http://evil.example.com` →
  response does NOT include `Access-Control-Allow-Origin` header.
- AC6.6: Start with `PORT=4000` env var → server listens on 4000, not 3001.
- AC6.7: `npm --prefix work/observatory run start:check` exits 0 on a clean
  checkout (start → GET /api/projects → 200 → SIGTERM → exit 0).

### Dependencies

UC6 depends on UC1, UC2, UC3, UC4, UC5 (imports all route handlers / watcher).
UC6 is the last UC in this slice.

### Seams / paths owned

`src/server/index.ts`, `package.json` (scripts), `tsconfig.json`,
`vitest.config.ts`, `src/server/__tests__/server-scaffold.test.ts`,
`scripts/start-check.js`.

---

## Dependency summary

```
UC1 (project registry)        — independent; start immediately
UC2 (CSV parsers + queues)    — independent; start immediately; parallel to UC1
UC3 (DORA/flow pass-through)  — independent; start immediately; parallel to UC1, UC2
UC4 (slice-artifact endpoint) — independent; reuses file-reader from UC3; parallel to UC1-UC3
UC5 (SSE file-watch)          — build in parallel; close done-condition after UC1-UC2 present
UC6 (server scaffold)         — depends on UC1 + UC2 + UC3 + UC4 + UC5 all green
```

**Parallel set (start together):** UC1, UC2, UC3, UC4 — fully disjoint files,
no cross-dependency, mutually independent.

**Can start in parallel, close later:** UC5 — watcher module is disjoint; timing
test needs a fixture file (any file will do); done-condition confirmed after UC1-UC2
are green.

**Serial after all others:** UC6 — integrates everything; last to close.

**Thinnest first to pull:** UC1 (simplest parser, no CSV complexity, direct §9 CHK-1
acceptance coverage for project-registry + ACTIVE=none cases).

---

## Value / cost table

| UC | One-line job | Endpoint(s) | Value | Cost (h) | Independent? |
|----|-------------|-------------|-------|----------|--------------|
| UC1 | List work/* projects + read ACTIVE flag | GET /api/projects, GET /api/active | HIGH | 2 | Yes — parallel |
| UC2 | Parse items.csv + 5 queue CSVs to typed records | GET /api/projects/:id/items, GET /api/projects/:id/queues/:queue | HIGH | 4 | Yes — parallel |
| UC3 | Pass through baseline.md + flow.md + .mmd as raw strings | GET /api/dora/baseline, GET /api/projects/:id/dora/*, GET /api/projects/:id/deps/* | HIGH | 2 | Yes — parallel |
| UC4 | Pass through slice artifact files | GET /api/projects/:id/slices/:slug/:artifact | MED | 2 | Yes — parallel |
| UC5 | Emit SSE event within 1s of any file change | GET /api/events | HIGH | 4 | Mostly — close after UC1-UC2 |
| UC6 | Wire all routes; enforce CORS + read-only; start:check green | (all routes) | HIGH | 2 | Serial last |
