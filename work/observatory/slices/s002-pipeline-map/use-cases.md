---
slice: s002
slug: pipeline-map
process-ref: §37 (use-case decomposition) + §F3 (JIT replenishment) + §F6 (seams/paths)
co-authored: product (pending solution-architect gate for §11.2 render decision)
---

# Use cases — s002: pipeline map

## Parallel / serial structure

```
SERIAL FIRST — shared seam (scaffold lesson from s001):
  UC1 — Vite SPA scaffold (src/app/ shell, Vite config, API client bootstrap)

PARALLEL SET A — attach to scaffold; mutually independent:
  UC2 — Queue data fetch + state layer (fetch + policy parse; no UI)
  UC3 — Pipeline map render (4 boxes, live counts; depends on UC2 data shape)

PARALLEL SET B — attach to rendered map; mutually independent:
  UC4 — Buffer-state flags (starving / over-WIP on queue boxes; depends on UC2+UC3)
  UC5 — ToC constraint highlight (parse baseline.md; depends on UC3 for the target element)

SERIAL LAST — requires live data path end-to-end:
  UC6 — SSE live refresh (EventSource → re-fetch → re-render; depends on UC2+UC3+UC4+UC5)
```

**Scaffold-seam note:** UC1 establishes `src/app/`, `vite.config.ts`, the base
entry HTML, the API client module (`src/app/api/client.ts`), and the Vitest
(jsdom/browser) config. Every subsequent UC owns files inside `src/app/` that
import from the API client or the component base. UC1 MUST be closed before
UC2–UC6 begin, because they all write into the scaffold tree. This is the same
shared-seam serialisation pattern as UC1 (server scaffold) in s001 — it is a
scheduling edge, not a logic dependency; once UC1 exists, UC2–UC5 can proceed
fully in parallel.

**§11.2 render-mechanism decision gate:** The rendering technology for UC3 (HTML+CSS+SVG
vs Mermaid) is an open question assigned to ui-designer + solution-architect.
This decision must be made BEFORE the engineer starts UC3. The ui-designer will
produce `ui-design.md` (covering UC3 and UC4 layout) as the first design
deliverable; the architect confirms the component approach. UC1 (scaffold) and
UC2 (data layer) can proceed before this decision lands; UC3 is gated on it.

Value/cost estimates (§F6 penny-game sizing):
- Value: HIGH = directly visible to operator + advances SM1-SM8; MED = internal plumbing
- Cost: in engineer-hours (S = 1–2h, M = 3–4h, L = 5–8h)

---

## UC1 — Vite SPA scaffold: src/app/ shell + API client

**ID:** UC1 (s002)
**Actor:** Engineer (building; all subsequent UCs depend on this).
**Trigger:** `npm --prefix work/observatory run dev` starts the Vite dev server;
`http://localhost:5173` loads a blank (or placeholder) page without error.
**Value:** MED | **Cost:** S (2h)

### Job

When the engineer needs to attach UI components, the SPA scaffold provides the
`src/app/` Vite project with TypeScript config, API client module (fetches from
`:3001`), Vitest (jsdom) test config, and an empty entry point — so all
subsequent UCs have a stable, tested attachment point with no competing writes
to the same files.

### CHK-1 endpoints consumed

None directly — UC1 sets up the client module that wraps them; no data is
fetched yet.

### Trigger → observable outcome

1. `npm --prefix work/observatory run dev` starts without error; Vite serves on
   `http://localhost:5173`.
2. `http://localhost:5173` loads; no console errors; placeholder content visible.
3. The API client module (`src/app/api/client.ts`) exposes typed fetch wrappers
   for all CHK-1 endpoints used by this slice; each wrapper returns typed
   records (matching the §4 schemas) or `null` on missing.
4. `npm --prefix work/observatory run test:ci` (extended to include SPA tests)
   runs Vitest in jsdom mode and exits 0 with at least the scaffold tests passing.

### Done condition

UC1 acceptance cases pass; `npm --prefix work/observatory run dev` starts clean;
no other UC is required.

### Acceptance cases (UC1)

- AC1.1: `npm --prefix work/observatory run dev` exits cleanly (no build error);
  `http://localhost:5173` returns HTTP 200 within 5s.
- AC1.2: The page loads without any console errors in a headless browser check
  (Playwright smoke; see acceptance.md).
- AC1.3: `src/app/api/client.ts` unit test: `fetchQueues('observatory')` called
  with a mock fetch returning a fixture JSON array → returns a typed `QueueRecord[]`
  matching the §4 schema. (Vitest/jsdom, no real server needed.)
- AC1.4: `fetchPolicy('observatory')` with a mock fetch returning a fixture
  `PolicyRecord[]` → returns typed records. (Vitest/jsdom.)
- AC1.5: `fetchBaseline()` with a mock fetch returning a fixture raw string →
  returns the string unmodified. (Vitest/jsdom.)
- AC1.6: Any API client call where the mock fetch throws a network error →
  returns `null`; no unhandled promise rejection. (Vitest/jsdom — fail-soft.)

### Dependencies

None. UC1 is the scaffold; all other UCs in this slice depend on it.

### Seams / paths owned

`src/app/` (directory creation), `src/app/index.html`, `src/app/main.ts`,
`src/app/api/client.ts`, `vite.config.ts`, `src/app/__tests__/api-client.test.ts`.
Extends `package.json` with `"dev": "vite src/app"` and `"test:ci"` to include
`src/app/__tests__/**`.

---

## UC2 — Queue data fetch + in-memory state layer

**ID:** UC2 (s002)
**Actor:** Engineer (building); the render UCs (UC3, UC4) consume this state.
**Trigger:** SPA load calls `initQueueState('observatory')` → populates an
observable state object with queue lengths and buffer-status for all 4 queues.
**Value:** MED | **Cost:** S (2h)

### Job

When the SPA needs to render queue state, the data layer fetches all four queue
CSVs and the policy CSV for the active project and produces a typed state object
per queue — `{name, length, min_items, wip_limit, status: 'ok'|'starving'|'over-wip'}`
— so the render UCs never touch raw CSV data and buffer-state logic lives in one
tested place.

### CHK-1 endpoints consumed

- `GET /api/active` → active project id
- `GET /api/projects/:id/queues/intake` → `QueueRecord[]`
- `GET /api/projects/:id/queues/ready` → `QueueRecord[]`
- `GET /api/projects/:id/queues/deploy` → `QueueRecord[]`
- `GET /api/projects/:id/queues/rework` → `QueueRecord[]`
- `GET /api/projects/:id/queues/policy` → `PolicyRecord[]`

### Trigger → observable outcome

1. `initQueueState('observatory')` calls the API client for all 5 endpoints.
2. Returns an array of 4 `QueueState` objects, one per queue.
3. `status` field: `'starving'` if `length < min_items`; `'over-wip'` if
   `length >= wip_limit`; `'ok'` otherwise.
4. If `policy.csv` is absent (returns `null`), `min_items` and `wip_limit`
   default to `undefined`; `status` defaults to `'ok'` — no crash.
5. If any queue CSV is absent (returns `null`), that queue's `length` = 0.

### Done condition

All UC2 acceptance cases pass in Vitest/jsdom with mocked API client; no other
UC is required.

### Acceptance cases (UC2)

- AC2.1: Fixture with `ready` queue = 1 item, `policy.csv` has `ready,min_items,3`
  → `QueueState` for ready has `length: 1, min_items: 3, status: 'starving'`.
- AC2.2: Fixture with `intake` queue = 5 items, `policy.csv` has `intake,wip_limit,5`
  → `QueueState` for intake has `length: 5, wip_limit: 5, status: 'over-wip'`.
- AC2.3: Fixture with `deploy` queue = 2 items, policy has `deploy,min_items,1,
  deploy,wip_limit,4` → status `'ok'`.
- AC2.4: `policy.csv` absent (API returns `null`) → no crash; all queues have
  `status: 'ok'`, `min_items: undefined`, `wip_limit: undefined`.
- AC2.5: `rework.csv` absent (API returns `null`) → `rework` queue has `length: 0`,
  `status: 'ok'`. No crash.
- AC2.6: `GET /api/active` returns `{ active: null }` (no active project) →
  `initQueueState` returns an empty array (or 4 queues with length 0); no crash.

### Dependencies

Depends on UC1 (scaffold — imports API client from `src/app/api/client.ts`).
Independent of UC3, UC4, UC5, UC6.

### Seams / paths owned

`src/app/state/queues.ts`, `src/app/__tests__/queues.test.ts`.

---

## UC3 — Pipeline map render: 4-queue flow diagram with live counts

**ID:** UC3 (s002)
**Actor:** Pipeline operator (the visible screen begins here).
**Trigger:** SPA loads; the operator sees the 4-queue pull system drawn with
live item counts for each queue.
**Value:** HIGH | **Cost:** M (3–4h — first visible render; includes ui-designer
design input and §11.2 render-mechanism decision)
**Gate:** §11.2 render-mechanism decision (ui-designer + solution-architect) must
be resolved before the engineer starts this UC.

### Job

When the operator opens the Observatory URL, the pipeline map draws the four
queues (Intake → Ready → [dev loop] → Deploy; Rework as return path) with live
item counts, so the operator sees flow state immediately without opening any file.

### CHK-1 endpoints consumed

- Consumes the `QueueState[]` produced by UC2 (no direct API call; state layer
  is the boundary).

### Trigger → observable outcome

1. SPA loads `http://localhost:5173`; within 2s the pipeline map is visible.
2. All four queue boxes (Intake, Ready, Deploy, Rework) are rendered with their
   names and current item counts.
3. The flow topology (arrows Intake→Ready, Ready→Deploy, Deploy→Rework loop) is
   static; only counts are dynamic.
4. Counts update when UC2's state updates (reactive binding).
5. If `QueueState[]` is empty or all lengths are 0, the map renders with 0 counts
   (not a blank/crashed page).

### Done condition

All UC3 acceptance cases pass; Playwright browser test confirms map is visible
and counts match the fixture state.

### Acceptance cases (UC3)

- AC3.1: (Vitest/jsdom) Render the pipeline map component with a mocked
  `QueueState[]` (intake:3, ready:1, deploy:0, rework:2) → the DOM contains all
  four queue names and the correct counts (3, 1, 0, 2).
- AC3.2: (Playwright) `http://localhost:5173` loads; all four queue box labels
  are present in the DOM; counts are numeric strings.
- AC3.3: (Vitest/jsdom) Render with all queues at length 0 → counts show "0";
  no crash; no blank page.
- AC3.4: (Vitest/jsdom) Render with `QueueState[]` empty (no active project) →
  map renders a graceful empty state (e.g. "no active project"); no crash.
- AC3.5: (Playwright) Keyboard navigation: all four queue boxes are reachable
  via Tab key; each has an accessible label matching its queue name.

### Dependencies

Depends on UC1 (scaffold) and UC2 (data state shape). §11.2 render decision
must precede engineer start of this UC.

### Seams / paths owned

`src/app/components/PipelineMap.ts` (or `.tsx` if Preact), `src/app/main.ts`
(mounts PipelineMap), `src/app/__tests__/PipelineMap.test.ts`,
`src/app/e2e/pipeline-map.spec.ts` (Playwright).

---

## UC4 — Buffer-state flags: starving / over-WIP indicators on queue boxes

**ID:** UC4 (s002)
**Actor:** Pipeline operator (observing constraint signals).
**Trigger:** A queue box has `status: 'starving'` or `status: 'over-wip'` in the
state layer → the queue box shows a visual indicator.
**Value:** HIGH | **Cost:** S (1–2h — state already computed in UC2; this is render-only)

### Job

When a queue's length falls outside its policy bounds, the operator sees a clear
visual indicator (not colour-only) on that queue box so they know where flow is
breaking without reading the CSV files.

### CHK-1 endpoints consumed

None directly — consumes `QueueState.status` from UC2; no new API calls.

### Trigger → observable outcome

1. A queue box with `status: 'starving'` shows a starving indicator (label,
   icon, or both — per ui-designer spec); colour change MAY accompany but is not
   the sole signal.
2. A queue box with `status: 'over-wip'` shows an over-WIP indicator similarly.
3. A queue box with `status: 'ok'` shows no indicator (clean state).
4. All indicators include accessible text (aria-label or visible label).

### Done condition

All UC4 acceptance cases pass; accessibility check included.

### Acceptance cases (UC4)

- AC4.1: (Vitest/jsdom) PipelineMap rendered with ready queue `status: 'starving'`
  → the ready queue box's DOM contains a starving-indicator element with
  accessible text (e.g. aria-label or text "starving").
- AC4.2: (Vitest/jsdom) PipelineMap rendered with intake queue `status: 'over-wip'`
  → intake box contains over-WIP indicator with accessible text.
- AC4.3: (Vitest/jsdom) PipelineMap rendered with deploy queue `status: 'ok'` →
  deploy box contains NO starving or over-WIP indicator element.
- AC4.4: (Playwright) With a live server and fixture queue state (ready = 0
  items, policy min_items = 3), the rendered page shows the starving indicator
  on the Ready box.
- AC4.5: (Playwright) Keyboard: the starving/over-WIP indicator text is readable
  by a screen reader (aria-label or visible text; confirmed by role query).

### Dependencies

Depends on UC1 (scaffold), UC2 (status field), UC3 (rendered queue boxes to
attach indicators to). Independent of UC5, UC6.

### Seams / paths owned

Extends `src/app/components/PipelineMap.ts` (indicator sub-component or
conditional render). `src/app/__tests__/PipelineMap.test.ts` extended.
`src/app/e2e/pipeline-map.spec.ts` extended.

---

## UC5 — ToC constraint highlight: parse baseline.md + mark matching queue

**ID:** UC5 (s002)
**Actor:** Pipeline operator (identifying the system constraint).
**Trigger:** SPA fetches `GET /api/dora/baseline`; parses the "Constraint:" line;
highlights the named stage/queue on the map.
**Value:** HIGH | **Cost:** S (2h — parsing is the risk; highlight is a CSS class)

### Job

When the operator looks at the pipeline map, the stage or queue named as the
Theory-of-Constraints constraint in `baseline.md` is visually highlighted, so
the operator immediately knows where to focus improvement energy.

### CHK-1 endpoints consumed

- `GET /api/dora/baseline` → `{ content: string | null }` — raw `baseline.md`

### Parsing contract

The parser extracts the constraint name from the raw `baseline.md` string.
Accepted patterns (case-insensitive):
- `Constraint: <name>` (any line)
- `ToC: <name>` (any line)
- `Constraint (ToC): <name>` (any line)

The extracted name is matched (case-insensitive, trimmed) against the known
queue names (`intake`, `ready`, `deploy`, `rework`) and any stage label used in
the map. If no match is found or `baseline.md` is absent, no highlight is
applied — fail soft, no crash.

### Trigger → observable outcome

1. `baseline.md` contains `Constraint: ready` → the Ready box on the pipeline
   map renders with a "constraint" highlight (distinct from starving/over-WIP).
2. `baseline.md` absent or contains no parseable constraint line → no highlight;
   no crash; map renders normally.
3. Constraint name in `baseline.md` does not match any queue/stage name → same
   as absent; no crash.

### Done condition

All UC5 acceptance cases pass.

### Acceptance cases (UC5)

- AC5.1: (Vitest unit) `parseConstraint("...Constraint: ready...")` →
  returns `"ready"` (trimmed, lowercased).
- AC5.2: (Vitest unit) `parseConstraint("...ToC: Deploy...")` → returns
  `"deploy"`.
- AC5.3: (Vitest unit) `parseConstraint(null)` → returns `null`. No crash.
- AC5.4: (Vitest unit) `parseConstraint("no constraint line here")` → returns
  `null`.
- AC5.5: (Vitest/jsdom) PipelineMap rendered with `constraintQueue: 'ready'` →
  the Ready box DOM has a "constraint" class or aria attribute; other boxes do
  not.
- AC5.6: (Vitest/jsdom) PipelineMap rendered with `constraintQueue: null` →
  no box has the "constraint" class.
- AC5.7: (Playwright) With a fixture `baseline.md` whose content is served by
  the CHK-1 API and contains `Constraint: ready`, the Ready box on the rendered
  page has a visible constraint marker.

### Dependencies

Depends on UC1 (scaffold), UC3 (rendered map boxes to target). Independent of
UC2, UC4, UC6.

### Seams / paths owned

`src/app/parsers/baseline.ts` (constraint extractor), `src/app/state/constraint.ts`,
`src/app/__tests__/baseline-parser.test.ts`.
Extends `src/app/components/PipelineMap.ts` (constraint prop + class).

---

## UC6 — SSE live refresh: EventSource → re-fetch → re-render

**ID:** UC6 (s002)
**Actor:** Pipeline operator (seeing the map update without manual reload).
**Trigger:** A `change` event arrives on the `GET /api/events` SSE channel →
the SPA re-fetches affected queue state and re-renders the map.
**Value:** HIGH | **Cost:** M (3h — async integration; timing assertion)

### Job

When a file in the repo changes (e.g. a queue CSV is updated by the flow
manager), the operator sees the pipeline map update automatically within a
configurable N seconds, so they never need to reload the page to see current
flow state.

### CHK-1 endpoints consumed

- `GET /api/events` — SSE channel (EventSource)
- All queue + policy endpoints (re-fetched on change event)

### Trigger → observable outcome

1. SPA opens an `EventSource` on `GET /api/events` on load.
2. When a `change` event arrives with `path` matching a queue CSV or policy CSV
   for the active project, the SPA re-fetches that resource and updates the
   relevant `QueueState` entries.
3. The pipeline map re-renders with the updated counts/flags within N seconds of
   the file change (N = configurable; target < 2s end-to-end on localhost).
4. No change to unrelated files triggers a re-render (path filtering).
5. If the SSE connection drops, `EventSource` reconnects automatically (native
   EventSource behaviour). During disconnect, the map remains on last-known state
   (no crash; no blank).
6. A `change` event for `baseline.md` triggers a re-fetch of the baseline and
   re-evaluation of the constraint highlight.

### Done condition

All UC6 acceptance cases pass; the end-to-end timing test (Playwright +
file-write) passes. UC2, UC3, UC4, UC5 must be green first.

### Acceptance cases (UC6)

- AC6.1: (Vitest/jsdom) SSE client module receives a mock `change` event with
  `path: "work/observatory/queues/ready.csv"` → calls the queue re-fetch
  function exactly once for the `ready` queue. No re-fetch for unrelated queues.
- AC6.2: (Vitest/jsdom) SSE client receives a `change` event for an unrelated
  file (`path: "work/observatory/slices/s001-read-layer/slice.md"`) → no queue
  re-fetch triggered.
- AC6.3: (Vitest/jsdom) SSE client receives `change` event for `baseline.md`
  (`path: "process/dora/baseline.md"`) → baseline re-fetch triggered.
- AC6.4: (Playwright end-to-end) With both servers running (`:3001` + `:5173`):
  observe the map; write a change to a fixture queue CSV (e.g. add a row to
  `ready.csv`); assert the Ready box count updates within 2000ms — without
  reloading the page. (Uses `fs.writeFileSync` in the test script or a dedicated
  fixture endpoint.)
- AC6.5: (Playwright) SSE connection drops (server restart simulated); page does
  NOT crash or blank; when server comes back, EventSource reconnects and the map
  updates on the next change.
- AC6.6: (Vitest/jsdom) SSE EventSource mock fires `onerror` → no unhandled
  rejection; state stays at last-known values.

### Dependencies

Depends on UC1 (scaffold), UC2 (queue state layer — re-fetch target), UC3
(rendered map — what re-renders), UC4 (flags re-rendered on update), UC5
(constraint re-evaluated on baseline change). UC6 is the last UC in this slice.

### Seams / paths owned

`src/app/sse/events-client.ts`, `src/app/sse/refresh.ts`,
`src/app/__tests__/sse-client.test.ts`,
`src/app/e2e/live-refresh.spec.ts` (Playwright).

---

## Dependency summary

```
UC1 (Vite SPA scaffold)           — independent; MUST close first (shared seam)
UC2 (queue data + state layer)    — depends on UC1; parallel with UC3, UC4, UC5
UC3 (pipeline map render)         — depends on UC1, UC2; gated on §11.2 decision
UC4 (buffer-state flags)          — depends on UC1, UC2, UC3; parallel with UC5
UC5 (ToC constraint highlight)    — depends on UC1, UC3; parallel with UC2, UC4
UC6 (SSE live refresh)            — depends on UC1, UC2, UC3, UC4, UC5; serial last
```

**§11.2 gate:** ui-designer + solution-architect must resolve the Mermaid vs
HTML+CSS/SVG question before the engineer starts UC3. UC1 and UC2 can proceed
in parallel while the design decision is in flight.

**Thinnest first to pull:** UC1 (scaffold — no logic, no render; pure setup) →
UC2 (data layer — logic only, no browser) → UC3 (first visible output, design-gated).

## Value / cost table

| UC | One-line job | CHK-1 endpoints consumed | Value | Cost (h) | Dependency |
|----|-------------|--------------------------|-------|----------|------------|
| UC1 | Vite SPA scaffold + API client module | none (wraps all) | MED | 2 | None — serial first (shared seam) |
| UC2 | Fetch 4 queues + policy → typed QueueState[] with starving/over-WIP status | /api/active, /api/projects/:id/queues/* | MED | 2 | UC1 |
| UC3 | Render 4-box pipeline flow with live counts | QueueState[] from UC2 | HIGH | 3–4 | UC1, UC2; §11.2 decision gate |
| UC4 | Show starving/over-WIP indicator on queue boxes | QueueState.status from UC2 | HIGH | 1–2 | UC1, UC2, UC3 |
| UC5 | Parse constraint from baseline.md; highlight matching box | GET /api/dora/baseline | HIGH | 2 | UC1, UC3 |
| UC6 | SSE EventSource → re-fetch → live map update | GET /api/events + queue endpoints | HIGH | 3 | UC1–UC5 |
