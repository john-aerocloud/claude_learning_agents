---
slice: s001
slug: read-layer
process-ref: §37 (acceptance cases pinned to use-cases)
---

# Acceptance — s001: read layer

## Case classes

- **F-cases:** operator-observable outcomes at the API level (what a user can
  now do that they could not before).
- **T-READ cases:** technical correctness conditions — schema fidelity, resilience,
  read-only enforcement, CORS, path-traversal guard.
- **S-regression:** (none applicable — this is the first slice; no prior behaviour
  to regress against).

Every case is tagged to its use case(s) and maps to a success measure (SM1–SM7
from slice.md).

---

## F-cases — operator-observable

### F1 — Project list is correct and excludes _TEMPLATE [UC1]

`GET /api/projects` returns every directory under `work/` except `_TEMPLATE`.
The operator can enumerate all projects without reading the filesystem.

SM1. Observed in: AC1.1.

### F2 — ACTIVE flag is correct; ACTIVE=none returns null [UC1]

The project named in `work/ACTIVE` has `active: true`; all others have
`active: false`. When `work/ACTIVE` contains `"none"` or is absent, `active`
is `null` — no crash.

SM1. Observed in: AC1.2, AC1.3, AC1.4.

### F3 — Queue CSVs parse to typed records; header-only returns [] [UC2]

Any queue CSV (intake, ready, deploy, rework, policy) with data rows returns a
typed record array. A header-only CSV returns `[]`. The operator never sees a
parse error or server crash from an empty queue.

SM2, SM3. Observed in: AC2.1–AC2.10.

### F4 — Missing optional files return null, not an error [UC2, UC3, UC4]

When an optional source file is absent (queue CSV, baseline.md, flow.md, .mmd,
slice artifact), the endpoint returns HTTP 200 with `null` body. The tool
tolerates partial repo state.

SM2. Observed in: AC2.8, AC2.9, AC3.4, AC3.5, AC3.6, AC4.2, AC4.4.

### F5 — DORA/flow markdown and .mmd are returned as raw strings [UC3]

`baseline.md` and `flow.md` content is returned byte-for-byte. The operator (or
a view) can render the markdown themselves; the server does not interpret it.

SM3. Observed in: AC3.1, AC3.2, AC3.3.

### F6 — SSE event arrives within 1s of a file change [UC5]

A connected client receives a `change` event within 1000ms of any file write
under the repo root. The operator does not need to reload to see updated data.

SM4. Observed in: AC5.3.

### F7 — Server is genuinely read-only [UC6]

No POST/PUT/PATCH/DELETE verb is registered. Any non-GET request returns 404 or
405. The operator cannot accidentally mutate the repo through the server.

SM5. Observed in: AC6.2, AC6.3.

### F8 — start:check exits 0 on a clean checkout [UC6]

`npm --prefix work/observatory run start:check` starts the server, confirms
`GET /api/projects` returns 200, and exits cleanly. The tool runs on a fresh
clone.

SM6. Observed in: AC6.7.

---

## T-READ cases — technical / observable

### T-READ-1 — §9 CHK-1 acceptance: lists all projects except _TEMPLATE [UC1]

Directly pins §9 CHK-1 acceptance from the requirements doc: the server lists
all `work/*` projects except `_TEMPLATE`.

Observed in: AC1.1.

### T-READ-2 — §9 CHK-1 acceptance: reads ACTIVE; handles none [UC1]

Directly pins §9 CHK-1 acceptance: server reads `work/ACTIVE`; returns null
for `"none"` and for absent file.

Observed in: AC1.2, AC1.3, AC1.4.

### T-READ-3 — §9 CHK-1 acceptance: parses each queue CSV incl header-only [UC2]

Directly pins §9 CHK-1 acceptance: each of the five queue CSVs (intake, ready,
deploy, rework, policy) is parsed; header-only returns `[]`; missing returns
`null`.

Observed in: AC2.1–AC2.9.

### T-READ-4 — §9 CHK-1 acceptance: fails soft on missing optional files [UC2, UC3, UC4]

Directly pins §9 CHK-1 acceptance: no crash, no 500 when optional source files
are absent; always HTTP 200 with null body.

Observed in: AC2.8, AC2.9, AC2.11, AC3.4, AC3.5, AC3.6, AC4.2, AC4.4.

### T-READ-5 — §9 CHK-1 acceptance: re-emits within N<1s of a file change [UC5]

Directly pins §9 CHK-1 acceptance: SSE client receives change event within
1000ms.

Observed in: AC5.3.

### T-READ-6 — Schema fidelity: items.csv columns match §4 spec [UC2]

Parsed `ItemRecord` has all required §4 columns: `id`, `type`, `parent`,
`children`, `job`, `state`, `value`, `cost`, `vc_ratio`, `created_ts`,
`done_ts`, `dora_ref`. No column silently dropped.

Observed in: AC2.1.

### T-READ-7 — Schema fidelity: queue CSV columns match §4 spec [UC2]

Parsed queue records (intake/ready/deploy/rework) have: `item_id`, `enqueued_ts`,
`value`, `cost`, `vc_ratio`, `position`, `reason`.

Observed in: AC2.2.

### T-READ-8 — Schema fidelity: policy.csv columns match §4 spec [UC2]

Parsed `PolicyRecord` has: `queue`, `param`, `value`, `unit`, `owner`,
`target_metric`, `last_tuned`, `experiment`.

Observed in: AC2.3.

### T-READ-9 — Extra unknown columns silently ignored [UC2]

A CSV with an extra column beyond the §4 schema is parsed without error; §4
columns are correct; extra column is absent from the record.

Observed in: AC2.10.

### T-READ-10 — Read-only route table [UC6]

Express app registers ZERO POST/PUT/PATCH/DELETE handlers. Confirmed by
programmatic route-table inspection (no `router.post` etc.) and by HTTP probe.

Observed in: AC6.2, AC6.3.

### T-READ-11 — CORS: only localhost:5173 allowed [UC6]

Origin `http://localhost:5173` receives CORS header. All other origins do not.

Observed in: AC6.4, AC6.5.

### T-READ-12 — Path-traversal guard on dep endpoint [UC3]

`GET /api/projects/:id/deps/../../etc/passwd` returns HTTP 400 or 404; the
`:file` parameter is validated against an allowlist.

Observed in: AC3.7.

### T-READ-13 — Artifact allowlist on slice endpoint [UC4]

`GET /api/projects/:id/slices/:slug/malicious.sh` returns HTTP 400. Only
`slice.md`, `use-cases.md`, `acceptance.md`, `route.md`, `ui-design.md`,
`test-plan.md`, `result.md` are accepted.

Observed in: AC4.3.

### T-READ-14 — SSE no broadcast on connect; ignoreInitial respected [UC5]

Connecting to `/api/events` does not immediately emit any `change` event
(chokidar `ignoreInitial: true`).

Observed in: AC5.2.

### T-READ-15 — SSE fan-out: all connected clients receive the event [UC5]

Two clients connected; one file change; both clients receive the event.

Observed in: AC5.4.

### T-READ-16 — SSE: no crash on client disconnect [UC5]

After a client disconnects, a subsequent file change causes no unhandled
rejection or server crash.

Observed in: AC5.5.

---

## Full acceptance-case index (TDD reference)

All AC-ids from use-cases.md, listed for engineer and tester.

**UC1 (5 cases):** AC1.1–AC1.5
**UC2 (11 cases):** AC2.1–AC2.11
**UC3 (7 cases):** AC3.1–AC3.7
**UC4 (4 cases):** AC4.1–AC4.4
**UC5 (6 cases):** AC5.1–AC5.6
**UC6 (7 cases):** AC6.1–AC6.7

**Total: 40 acceptance case ids.**

---

## Coverage map (F/T-READ cases → use cases)

| UC | F-cases | T-READ cases |
|----|---------|-------------|
| UC1 | F1, F2 | T-READ-1, T-READ-2 |
| UC2 | F3, F4 | T-READ-3, T-READ-4, T-READ-6, T-READ-7, T-READ-8, T-READ-9 |
| UC3 | F4, F5 | T-READ-4, T-READ-12 |
| UC4 | F4 | T-READ-4, T-READ-13 |
| UC5 | F6 | T-READ-5, T-READ-14, T-READ-15, T-READ-16 |
| UC6 | F7, F8 | T-READ-10, T-READ-11 |

**§9 CHK-1 acceptance pins:** T-READ-1 (projects excl _TEMPLATE), T-READ-2
(reads ACTIVE), T-READ-3 (parses each queue CSV incl header-only), T-READ-4
(fails soft on missing), T-READ-5 (re-emits within 1s).

---

## Open risks

- **OR-S001-a — chokidar latency on Linux CI:** chokidar uses FSEvents on macOS
  (sub-100ms typical); on Linux it uses inotify (also fast, but kernel version
  dependent). The 1000ms target is conservative; however in a GitHub Actions
  runner the test may be slower. Mitigate: the timing test uses `vi.waitFor`
  with a 1500ms outer timeout and asserts within 1000ms — this gives 500ms
  buffer for runner jitter. If flaky in CI, raise as a defect.
- **OR-S001-b — TypeScript strict mode on csv-parse types:** csv-parse's typed
  output requires explicit column-cast config; if not configured correctly the
  engine may return all values as strings. Mitigate: AC2.1 verifies field
  types; TDD will catch this before the UC is closed.
