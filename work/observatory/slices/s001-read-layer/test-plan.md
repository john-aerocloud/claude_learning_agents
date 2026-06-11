---
slice: s001
slug: read-layer
agent: tester
sha-under-test: dev (local HEAD, pre-release)
validation-date: 2026-06-09
relevancy: pinned
---

# Test plan — s001: read layer (tester, final integrated validation)

## Scope derivation

Changed nodes from UC1 through UC6 (the full slice, now integrated).
All endpoints and acceptance cases in acceptance.md are in scope.

## Impacted specs (all covering specs)

| Spec file | Acceptance cases covered |
|-----------|--------------------------|
| src/server/__tests__/project-registry.test.js | AC1.1–AC1.5 |
| src/server/__tests__/projects-api.test.js | AC1.1–AC1.5, AC6.2–AC6.5 |
| src/server/__tests__/csv-parser.test.js | AC2.1–AC2.11 |
| src/server/__tests__/items-queues-api.test.js | AC2.1–AC2.11 |
| src/server/__tests__/dora-api.test.js | AC3.1–AC3.7 |
| src/server/__tests__/file-reader.test.js | AC3.4–AC3.6, AC4.2, AC4.4 |
| src/server/__tests__/slices-api.test.js | AC4.1–AC4.4 |
| src/server/__tests__/sse-watch.test.js | AC5.1–AC5.6 |
| src/server/__tests__/watcher.test.js | AC5.3 |
| src/server/__tests__/integration-server.test.js | AC6.1–AC6.7 |

## Test plan tick-off (7 live checks + suite)

| # | Check | Status |
|---|-------|--------|
| 1 | Every endpoint family answers (UC1–UC4 + dora + slices) | PASS |
| 2 | Live SSE event within 1s of file write | PASS (31ms observed) |
| 3 | CORS: localhost:5173 allowed; localhost:9999 / evil.example.com blocked; no wildcard | PASS |
| 4 | Read-only guard: POST/PUT/DELETE/PATCH all return 405 | PASS |
| 5 | Clean shutdown: SIGTERM exits process 0 | PASS |
| 6 | PORT override: PORT=4000 binds 4000 | PASS |
| 7 | Full suite: npm run test:ci exits 0, 92/92 | PASS |

## Uncovered changed nodes

None. All 40 acceptance cases are covered by committed specs.
