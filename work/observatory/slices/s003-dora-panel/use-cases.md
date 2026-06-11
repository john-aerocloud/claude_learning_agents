---
slice: s003
slug: dora-panel
process-ref: §37 (use-case decomposition) + §F3 (JIT replenishment) + §F6 (seams/paths)
co-authored: product (pending solution-architect gate for parse-layer decision)
---

# Use cases — s003: DORA panel + stage cards + time-thief view

## Parallel / serial structure

```
SERIAL FIRST — shared parse seam:
  UC1 — baseline.md + flow.md parsers (typed records; all render UCs depend on this)

PARALLEL SET A — attach to parsers; mutually independent render surfaces:
  UC2 — DORA four-metric panel (consumes baseline parser output)
  UC3 — Stage cards: per-agent task times (consumes baseline parser output)
  UC4 — Time-thief view (consumes flow parser output)

PARALLEL SET B — cross-cutting concern; attaches to all render UCs:
  UC5 — Source-link traceability (data-source attributes on every figure)

SERIAL LAST — reuses existing SSE seam:
  UC6 — SSE live refresh for baseline.md + flow.md (re-fetch → re-parse → re-render)
```

**Parse seam note:** UC1 is the shared seam for this slice. It extends
`src/app/parsers/baseline.ts` (already exists from s002 for constraint extraction)
and adds `src/app/parsers/flow.ts`. Once UC1 is closed, UC2, UC3, UC4 can proceed
fully in parallel — they each consume typed records from UC1 and write to disjoint
component files. UC5 (traceability) attaches to the render components from UC2/UC3/UC4;
it can be built against stubs but should close after the render UCs exist. UC6
reuses `src/app/sse/` from s002 — it adds path-match rules for `baseline.md` and
`flow.md` to trigger re-fetch; no new SSE infrastructure.

**SPA scaffold:** The `src/app/` Vite scaffold already exists (s002/UC1). No new
scaffold UC is needed. This slice attaches directly.

**Architect gate:** Before UC1 build starts, confirm client-side parse OR
approve a `/api/dora/baseline/parsed` server endpoint. If server-side parse is
chosen, UC1 changes its data source (from `GET /api/dora/baseline` raw string to
a new endpoint) but its output shape and all downstream UCs are unaffected.

Value/cost estimates (§F6 penny-game sizing):
- Value: HIGH = directly visible to operator + advances SM1-SM8; MED = seam-only
- Cost: in engineer-hours (S = 1–2h, M = 3–4h)

---

## UC1 — Markdown parsers: baseline.md four-metric + per-agent tables; flow.md time-thief + queue tables

**ID:** UC1 (s003)
**Actor:** Engineer (building); all render UCs in this slice (consuming typed records).
**Trigger:** `parseBaseline(content: string | null)` and `parseFlow(content: string | null)`
called with raw markdown strings from the CHK-1 API.
**Value:** MED | **Cost:** S (2h — regex/table parse of known stable formats)

### Job

When the SPA needs to render DORA metrics and flow data, the parser functions
extract structured typed records from the raw markdown strings served by the
CHK-1 read layer, so downstream render components never handle raw markdown and
the parse contract is tested in one place.

### CHK-1 endpoints consumed

- `GET /api/dora/baseline` → `{ content: string | null }` (raw `baseline.md`)
- `GET /api/projects/:id/dora/flow` → `{ content: string | null }` (raw `flow.md`)

### Data shapes produced

```ts
// From baseline.md
type DoraMetrics = {
  grossLeadTimeMedian: { value: string; window: string } | null;
  deployFrequency: { value: string; window: string } | null;
  changeFailureRate: { value: string; window: string } | null;
  mttr: { value: string; window: string } | null;
};

type AgentTaskTime = {
  agent: string;
  n: number;
  modal: string;   // raw string — may be "—" for no data
  median: string;
  mean: string;
};

type BaselineParsed = {
  metrics: DoraMetrics;
  agentTimes: AgentTaskTime[];
  constraint: string | null;  // already exists from s002; reuse/extend
  sourceRef: string;          // "process/dora/baseline.md"
};

// From flow.md
type TimeThief = {
  name: string;     // "Queue dwell (all queues)", "Hidden-edge collisions", etc.
  value: string;    // raw value string
  source: string;   // source annotation from the table
};

type FlowParsed = {
  timeThieves: TimeThief[];
  sourceRef: string;   // "work/<project>/dora/flow.md"
};
```

### Trigger → observable outcome

1. `parseBaseline("<baseline.md content>")` returns a `BaselineParsed` with all
   four metrics populated (matching the `## Four key metrics` markdown table).
2. `parseBaseline(null)` returns `{ metrics: {all null}, agentTimes: [], constraint: null, sourceRef: "process/dora/baseline.md" }` — no crash.
3. `parseBaseline("<content with no metric table>")` returns metrics all null — no crash.
4. `parseFlow("<flow.md content>")` returns a `FlowParsed` with `timeThieves`
   matching the `## Time thieves` table rows.
5. `parseFlow(null)` returns `{ timeThieves: [], sourceRef: "work/<project>/dora/flow.md" }` — no crash.
6. Metric values are preserved as raw strings (not coerced to numbers) — the UI
   renders them as-is; fidelity requirement means no rounding or reformatting.

### Done condition

All UC1 acceptance cases pass in Vitest; no other UC need be present.

### Acceptance cases (UC1)

- AC1.1: `parseBaseline` called with the actual `process/dora/baseline.md` content
  (fixture) → `metrics.grossLeadTimeMedian.value = "3092 s"`,
  `metrics.grossLeadTimeMedian.window = "20 slice(s)"`.
- AC1.2: `parseBaseline` fixture → `metrics.deployFrequency.value = "8 /active-day"`.
- AC1.3: `parseBaseline` fixture → `metrics.changeFailureRate.value = "24 %"`.
- AC1.4: `parseBaseline` fixture → `metrics.mttr.value = "2033 s"`.
- AC1.5: `parseBaseline` fixture → `agentTimes` has 9 entries; engineer row has
  `agent: "engineer", n: 52, modal: "720", median: "699", mean: "984"`.
- AC1.6: `parseBaseline` fixture → `agentTimes` includes `flow-manager` row with
  `modal: "—"`, `median: "—"`, `mean: "—"` (no-data rows preserved, not dropped).
- AC1.7: `parseBaseline(null)` → no throw; all metrics null; agentTimes empty.
- AC1.8: `parseBaseline("# Some other markdown\nNo tables here")` → no throw;
  metrics all null; agentTimes empty.
- AC1.9: `parseFlow` called with actual `work/<project>/dora/flow.md` fixture →
  `timeThieves` has 3 entries; first entry has
  `name: "Queue dwell (all queues)"`, `value: "0 s"`.
- AC1.10: `parseFlow(null)` → no throw; `timeThieves = []`.

### Dependencies

None. UC1 depends on no other UC in this slice (extends an existing file in
`src/app/parsers/baseline.ts`; `flow.ts` is a new file).

### Seams / paths owned

`src/app/parsers/baseline.ts` (extended — adds metric + agent-time parse),
`src/app/parsers/flow.ts` (new),
`src/app/__tests__/baseline-parser.test.ts` (extended),
`src/app/__tests__/flow-parser.test.ts` (new).

---

## UC2 — DORA four-metric panel

**ID:** UC2 (s003)
**Actor:** Pipeline operator (primary user of CHK-3).
**Trigger:** Operator opens the Observatory SPA; the DORA panel section is visible
with the four metrics rendered and linked to source.
**Value:** HIGH | **Cost:** S (2h — first CORE delivery of CHK-3; straightforward render)

### Job

When the operator wants to know pipeline health at a glance, the DORA panel
shows the four key metrics (gross lead time, deployment frequency, change failure
rate, MTTR) with their computation windows and a direct link to their source,
so the operator reads numbers without opening any file.

### CHK-1 endpoints consumed (via UC1 parser)

- `GET /api/dora/baseline` → parsed by UC1's `parseBaseline()` → `DoraMetrics`

### Trigger → observable outcome

1. SPA loads; the DORA panel is visible below (or alongside) the pipeline map.
2. All four metrics are rendered with their value and window (e.g. "3092 s / 20 slices").
3. Each metric value has `data-source="process/dora/baseline.md#four-key-metrics"`.
4. When `baseline.md` is absent or metrics are null, the panel shows an empty-state
   message (e.g. "No baseline computed yet") — no crash, no blank.
5. Metric values match the source file exactly (no rounding, no reformatting).

### Done condition

All UC2 acceptance cases pass; Playwright browser test confirms panel is visible.

### Acceptance cases (UC2)

- AC2.1: (Vitest/jsdom) Render DoraPanel with fixture `DoraMetrics` (all four
  metrics set) → DOM contains all four metric labels and their exact value strings.
- AC2.2: (Vitest/jsdom) Render with all metrics null → empty-state element present;
  no crash; no metric value elements present.
- AC2.3: (Vitest/jsdom) Each rendered metric element has `data-source` attribute
  containing `"process/dora/baseline.md"`.
- AC2.4: (Playwright) With servers running and real `baseline.md` in place → the
  DORA panel is visible on the page; all four metric labels are present in the DOM.
- AC2.5: (Playwright) The rendered `grossLeadTimeMedian` value matches the value
  string read directly from `process/dora/baseline.md` via the API — no invented number.

### Dependencies

Depends on UC1 (parsers — consumes `DoraMetrics` type and `parseBaseline()`).
Independent of UC3, UC4, UC5.

### Seams / paths owned

`src/app/components/DoraPanel.ts`,
`src/app/__tests__/DoraPanel.test.ts`,
`src/app/e2e/dora-panel.spec.ts` (Playwright smoke).

---

## UC3 — Stage cards: per-agent task times with constraint highlight

**ID:** UC3 (s003)
**Actor:** Pipeline operator.
**Trigger:** Operator views the Observatory SPA; per-agent stage cards are visible
showing modal/median/mean task times; the constraint agent's card is highlighted.
**Value:** HIGH | **Cost:** S (2h — card list render; constraint highlight reuses s002 logic)

### Job

When the operator wants to know which agent is the bottleneck and what each
agent's task-time profile is, the stage cards show per-agent modal/median/mean
times with the constraint highlighted, so the operator acts on data rather than
intuition about where to focus improvement effort.

### CHK-1 endpoints consumed (via UC1 parser)

- `GET /api/dora/baseline` → parsed by UC1's `parseBaseline()` → `AgentTaskTime[]` + `constraint`

### Trigger → observable outcome

1. Stage cards section renders a card per agent row from `baseline.md` per-agent table.
2. Each card shows: agent name, n (task count), modal, median, mean.
3. The agent whose name matches the constraint (from `parseBaseline().constraint`) has
   a visible "constraint" highlight — distinct visual treatment, not colour-only.
4. Agents with `"—"` values (no data, e.g. `flow-manager`) render the dash as-is.
5. Each card has `data-source="process/dora/baseline.md#per-agent-task-completion"`.
6. When `agentTimes` is empty, an empty-state message renders; no crash.

### Done condition

All UC3 acceptance cases pass.

### Acceptance cases (UC3)

- AC3.1: (Vitest/jsdom) Render StageCards with fixture `AgentTaskTime[]` (9 agents)
  → 9 card elements present; each shows the correct agent name.
- AC3.2: (Vitest/jsdom) The engineer card shows `modal: "720"`, `median: "699"`,
  `mean: "984"` — matching the fixture values exactly.
- AC3.3: (Vitest/jsdom) With `constraint: "tester"`, the tester card has
  `data-constraint="true"` AND a visible constraint text/badge; all other cards
  have `data-constraint="false"`.
- AC3.4: (Vitest/jsdom) The `flow-manager` card (n=0, all "—") renders the dashes
  as text "—"; no crash; card still present.
- AC3.5: (Vitest/jsdom) Each card element has `data-source` attribute containing
  `"process/dora/baseline.md"`.
- AC3.6: (Vitest/jsdom) Render with empty `agentTimes` → empty-state present; no crash.
- AC3.7: (Playwright) With real `baseline.md` in place, the stage cards section
  is visible; the agent named as constraint has a visually distinct card.

### Dependencies

Depends on UC1 (parsers). Independent of UC2, UC4, UC5.

### Seams / paths owned

`src/app/components/StageCards.ts`,
`src/app/__tests__/StageCards.test.ts`,
`src/app/e2e/dora-panel.spec.ts` (extended — same Playwright file as UC2).

---

## UC4 — Time-thief view: ranked list from flow.md

**ID:** UC4 (s003)
**Actor:** Pipeline operator.
**Trigger:** Operator views the Observatory SPA; the time-thief section shows the
ranked list of lead-time contributors, each linking to its source.
**Value:** HIGH | **Cost:** S (2h — table render; flow parser from UC1)

### Job

When the operator wants to know what is eating the gross lead time, the time-thief
view shows the top contributors ranked from `flow.md` with their values, so the
operator knows where to apply the Theory of Constraints — not just WHO the
constraint agent is, but WHAT activities are consuming the most clock.

### CHK-1 endpoints consumed (via UC1 parser)

- `GET /api/projects/:id/dora/flow` → parsed by UC1's `parseFlow()` → `TimeThief[]`

### Trigger → observable outcome

1. Time-thief section renders a row per entry from the `## Time thieves` table
   in `flow.md`.
2. Each row shows the thief name and value as-is from the source.
3. Each row has `data-source` pointing to `work/<project>/dora/flow.md#time-thieves`.
4. Rows appear in source order (ranked by the `dora.py flow` script).
5. When `flow.md` is absent or `timeThieves` is empty, an empty-state renders; no crash.

### Done condition

All UC4 acceptance cases pass.

### Acceptance cases (UC4)

- AC4.1: (Vitest/jsdom) Render TimeThiefView with fixture `TimeThief[]` (3 entries
  matching real `flow.md` data) → 3 row elements present; first row name =
  `"Queue dwell (all queues)"`, value = `"0 s"`.
- AC4.2: (Vitest/jsdom) Second row name = `"Hidden-edge collisions"`, value = `"1"`.
- AC4.3: (Vitest/jsdom) Each row has `data-source` attribute containing
  `"dora/flow.md"`.
- AC4.4: (Vitest/jsdom) Render with empty `timeThieves` → empty-state present; no crash.
- AC4.5: (Playwright) With real `flow.md` in place, the time-thief section is
  visible; at least one thief row is rendered.
- AC4.6: (Playwright) Each rendered thief row has a non-empty `data-source` attribute.

### Dependencies

Depends on UC1 (flow parser). Independent of UC2, UC3, UC5.

### Seams / paths owned

`src/app/components/TimeThiefView.ts`,
`src/app/__tests__/TimeThiefView.test.ts`,
`src/app/e2e/dora-panel.spec.ts` (extended).

---

## UC5 — Source-link traceability: data-source on every rendered figure

**ID:** UC5 (s003)
**Actor:** Pipeline operator (drilling to source); tester (verifying §8 NFR).
**Trigger:** Any metric, stage card value, or time-thief row is visible on screen.
**Value:** HIGH | **Cost:** S (1h — cross-cutting `data-source` attributes; mostly already in UC2/UC3/UC4 acceptance cases)
**Note:** UC5's acceptance cases are largely already pinned in UC2/UC3/UC4
(each has a `data-source` assertion). UC5 exists as a named UC to make the §8
fidelity + traceability NFR explicitly ownable and independently auditable.

### Job

When the operator or tester wants to verify that a rendered figure is not invented
(§8 NFR: "numbers shown must match the computed artifacts; every figure links to
its source file"), every figure on the DORA panel, stage cards, and time-thief
view has a machine-readable `data-source` attribute pointing to the source file +
section, so traceability is 100% and can be automatically asserted.

### Trigger → observable outcome

1. Every rendered DORA metric value element has a `data-source` attribute.
2. Every rendered stage-card time value (modal/median/mean) has `data-source`.
3. Every rendered time-thief row has `data-source`.
4. `data-source` values use a stable, human-readable format:
   `"<file-path>#<section-anchor>"` (e.g.
   `"process/dora/baseline.md#four-key-metrics"`).
5. No rendered number in the CHK-3 panel lacks a `data-source` attribute.

### Done condition

A DOM traversal test finds zero numeric metric, time, or thief elements
without a `data-source` attribute. UC2, UC3, UC4 acceptance cases for
`data-source` all pass.

### Acceptance cases (UC5)

- AC5.1: (Vitest/jsdom) Render the full CHK-3 panel surface (DoraPanel +
  StageCards + TimeThiefView) with fixture data → every element matching
  `[data-metric], [data-agent-time], [data-thief]` has a non-empty `data-source`
  attribute. Assert count-of-missing = 0.
- AC5.2: (Vitest/jsdom) `data-source` for DORA metrics contains
  `"process/dora/baseline.md"`.
- AC5.3: (Vitest/jsdom) `data-source` for time-thief rows contains
  `"dora/flow.md"` (project-relative path is acceptable; absolute path also acceptable).
- AC5.4: (Playwright) DOM scan on live page: querySelectorAll of all rendered
  metric/card/thief values confirms each has a non-empty `data-source`. Zero missing.

### Dependencies

Depends on UC2, UC3, UC4 (the render components that carry `data-source`).
UC5 does not add new component logic; it asserts a property of UC2–UC4 outputs.

### Seams / paths owned

`src/app/__tests__/traceability.test.ts` (new — cross-component DOM traversal test).
`src/app/e2e/dora-panel.spec.ts` (Playwright DOM-scan assertion added).

---

## UC6 — SSE live refresh: re-fetch baseline.md + flow.md on change

**ID:** UC6 (s003)
**Actor:** Pipeline operator (seeing panels update without reload).
**Trigger:** A `change` SSE event arrives with `path` matching
`process/dora/baseline.md` or `work/<project>/dora/flow.md` → the relevant panel
re-fetches and re-renders.
**Value:** HIGH | **Cost:** S (1–2h — extends existing SSE path-match rules; no new infrastructure)

### Job

When the pipeline agent updates `baseline.md` or `flow.md` after a run, the
operator sees the DORA panel and time-thief view update automatically within 2s,
so stale numbers are never acted on.

### CHK-1 endpoints consumed

- `GET /api/events` — existing SSE channel (no change)
- `GET /api/dora/baseline` — re-fetched on baseline change
- `GET /api/projects/:id/dora/flow` — re-fetched on flow change

### Trigger → observable outcome

1. SSE `change` event with `path: "process/dora/baseline.md"` → `fetchBaseline()`
   called; `parseBaseline()` re-run; DoraPanel + StageCards re-render.
2. SSE `change` event with `path: "work/observatory/dora/flow.md"` → `fetchFlow()`
   called; `parseFlow()` re-run; TimeThiefView re-renders.
3. SSE `change` event for an unrelated path → no re-fetch of baseline or flow.
4. Re-render completes within 2000ms of the file change on localhost.

### Done condition

All UC6 acceptance cases pass. UC2, UC3, UC4 must be green (re-rendered panels
must exist). Reuses the existing SSE client (`src/app/sse/`) from s002.

### Acceptance cases (UC6)

- AC6.1: (Vitest/jsdom) SSE client mock receives `change` event with
  `path: "process/dora/baseline.md"` → baseline re-fetch triggered exactly once;
  no flow re-fetch triggered.
- AC6.2: (Vitest/jsdom) SSE client mock receives `change` event with
  `path: "work/observatory/dora/flow.md"` → flow re-fetch triggered exactly once;
  no baseline re-fetch.
- AC6.3: (Vitest/jsdom) SSE `change` event for unrelated path
  (`path: "work/observatory/slices/s003-dora-panel/slice.md"`) → no baseline or
  flow re-fetch triggered.
- AC6.4: (Playwright end-to-end) With servers running: note the current
  `grossLeadTimeMedian` value; write a modified `baseline.md` fixture (different
  GLT value) to the watched path; assert the DoraPanel's GLT value updates within
  2000ms — without reloading the page.
- AC6.5: (Playwright) SSE connection lost (server restart); panels show last-known
  values; on reconnect, correct values re-appear.

### Dependencies

Depends on UC1 (parsers — re-run on change), UC2 + UC3 (DoraPanel + StageCards
re-render), UC4 (TimeThiefView re-renders). Extends the existing
`src/app/sse/refresh.ts` from s002 — adds path-match rules only.

### Seams / paths owned

`src/app/sse/refresh.ts` (extended — adds baseline + flow path-match rules),
`src/app/__tests__/sse-client.test.ts` (extended — adds AC6.1–AC6.3),
`src/app/e2e/dora-panel.spec.ts` (extended — live refresh Playwright test).

---

## Dependency summary

```
UC1 (parsers: baseline + flow)   — no UC deps; MUST close first (shared parse seam)
UC2 (DORA four-metric panel)     — depends on UC1; parallel with UC3, UC4
UC3 (stage cards)                — depends on UC1; parallel with UC2, UC4
UC4 (time-thief view)            — depends on UC1; parallel with UC2, UC3
UC5 (traceability audit)         — depends on UC2, UC3, UC4; close after render UCs
UC6 (SSE live refresh)           — depends on UC1, UC2, UC3, UC4; serial last
```

**Thinnest first for CORE value:** UC1 (parse seam) → UC2 (four-metric panel,
the first CORE "DORA metrics at a glance" outcome) → UC3 (stage cards, completes
agent-time view) → UC4 (time thieves) → UC5 (traceability assertion) → UC6 (live).

**UC2 delivers the CORE "DORA at a glance" outcome soonest.** If the slice must
ship incrementally, UC1+UC2 together meet the primary CHK-3 acceptance condition
(four metrics visible + linked to source). UC3 and UC4 complete the chunk done-condition.

---

## Value / cost table

| UC | One-line job | Endpoint(s) consumed | Value | Cost (h) | Dependency |
|----|-------------|----------------------|-------|----------|------------|
| UC1 | Parse baseline.md (4-metric + per-agent tables) + flow.md (time-thief table) to typed records | GET /api/dora/baseline, GET /api/projects/:id/dora/flow | MED | 2 | None — serial first (shared parse seam) |
| UC2 | Render four DORA metrics with windows + source links | parseBaseline() → DoraMetrics | HIGH | 2 | UC1 |
| UC3 | Render per-agent stage cards with constraint highlight + source links | parseBaseline() → AgentTaskTime[] | HIGH | 2 | UC1 |
| UC4 | Render time-thief ranked list + source links | parseFlow() → TimeThief[] | HIGH | 2 | UC1 |
| UC5 | Assert 100% data-source traceability across all CHK-3 render surfaces | DOM traversal test | HIGH | 1 | UC2, UC3, UC4 |
| UC6 | SSE live refresh: re-fetch + re-parse + re-render on baseline/flow file change | GET /api/events + both parse endpoints | HIGH | 2 | UC1–UC4 |
