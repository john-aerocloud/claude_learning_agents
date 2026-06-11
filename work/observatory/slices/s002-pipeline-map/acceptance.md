---
slice: s002
slug: pipeline-map
process-ref: §37 acceptance + EXP-016 (visual-structural browser testing)
test-stack: Vitest (jsdom) for unit/component logic; Playwright for browser/rendered checks
---

# Acceptance cases — s002: pipeline map

All cases are tagged to their use case. Test strategy follows the repo practice:

- **Vitest (jsdom/browser mode):** logic, state computation, component render
  assertions (DOM shape, text content, aria attributes). Fast; no browser binary.
- **Playwright:** visual-structural checks (actual browser render, layout,
  keyboard navigation, end-to-end live-refresh timing). Applied where a jsdom
  check is insufficient — rendered geometry, real EventSource behaviour, actual
  CSS class visibility.

Accessibility conditions are set by the ui-designer in `ui-design.md` and pinned
here as acceptance cases (AC3.5, AC4.4–AC4.5, etc.). The engineer must not
narrow them without the ui-designer's sign-off.

---

## UC1 — Vite SPA scaffold

| ID | Test type | Given | When | Then |
|----|-----------|-------|------|------|
| AC1.1 | Playwright smoke | Clean checkout; `npm --prefix work/observatory run dev` started | `http://localhost:5173` is opened | HTTP 200 within 5s; no build error in terminal |
| AC1.2 | Playwright | Page loaded as above | Page is inspected for console errors | Zero console errors on initial load |
| AC1.3 | Vitest/jsdom | `fetchQueues` called with mock fetch returning fixture `QueueRecord[]` | Function resolves | Returns a typed `QueueRecord[]` matching §4 schema; no extra properties |
| AC1.4 | Vitest/jsdom | `fetchPolicy` called with mock fetch returning fixture `PolicyRecord[]` | Function resolves | Returns typed `PolicyRecord[]` |
| AC1.5 | Vitest/jsdom | `fetchBaseline` called with mock fetch returning fixture raw string | Function resolves | Returns the string unmodified |
| AC1.6 | Vitest/jsdom | Any API client function called; mock fetch throws `TypeError: Failed to fetch` | Promise settles | Returns `null`; no unhandled rejection |

---

## UC2 — Queue data fetch + state layer

| ID | Test type | Given | When | Then |
|----|-----------|-------|------|------|
| AC2.1 | Vitest/jsdom | `ready` queue has 1 item; `policy.csv` has `ready,min_items,3` | `initQueueState` resolves | `QueueState` for ready: `length: 1`, `min_items: 3`, `status: 'starving'` |
| AC2.2 | Vitest/jsdom | `intake` queue has 5 items; `policy.csv` has `intake,wip_limit,5` | `initQueueState` resolves | intake `QueueState`: `length: 5`, `wip_limit: 5`, `status: 'over-wip'` |
| AC2.3 | Vitest/jsdom | `deploy` queue has 2 items; policy has `deploy,min_items,1` and `deploy,wip_limit,4` | `initQueueState` resolves | deploy `QueueState`: `status: 'ok'` |
| AC2.4 | Vitest/jsdom | `policy.csv` API returns `null` (missing file) | `initQueueState` resolves | All queues have `status: 'ok'`; no crash |
| AC2.5 | Vitest/jsdom | `rework.csv` API returns `null` (missing file) | `initQueueState` resolves | rework `QueueState`: `length: 0`, `status: 'ok'`; no crash |
| AC2.6 | Vitest/jsdom | `GET /api/active` returns `{ active: null }` | `initQueueState` resolves | Returns 4 queues with `length: 0` or empty array; no crash |

---

## UC3 — Pipeline map render

| ID | Test type | Given | When | Then |
|----|-----------|-------|------|------|
| AC3.1 | Vitest/jsdom | PipelineMap rendered with mocked `QueueState[]` (intake:3, ready:1, deploy:0, rework:2) | Component mounts | DOM contains all four queue labels; each shows the correct count |
| AC3.2 | Playwright | Live servers running (`:3001` + `:5173`); real queue CSVs present | `http://localhost:5173` opened | All four queue box labels visible; counts are numeric strings |
| AC3.3 | Vitest/jsdom | PipelineMap rendered with all queues at `length: 0` | Component mounts | All four counts show "0"; no crash; no blank render |
| AC3.4 | Vitest/jsdom | PipelineMap rendered with empty `QueueState[]` (no active project) | Component mounts | Graceful empty state rendered (text such as "no active project"); no crash |
| AC3.5 | Playwright | Page loaded | Tab key pressed repeatedly from page start | All four queue boxes are reachable via Tab; each has an accessible name matching its queue label (aria-label or visible text) |

---

## UC4 — Buffer-state flags

| ID | Test type | Given | When | Then |
|----|-----------|-------|------|------|
| AC4.1 | Vitest/jsdom | PipelineMap rendered; ready queue `status: 'starving'` | Component mounts | Ready queue box DOM contains a starving-indicator element with accessible text (aria-label or visible label containing "starving") |
| AC4.2 | Vitest/jsdom | PipelineMap rendered; intake queue `status: 'over-wip'` | Component mounts | Intake box contains over-WIP indicator with accessible text |
| AC4.3 | Vitest/jsdom | PipelineMap rendered; deploy queue `status: 'ok'` | Component mounts | Deploy box contains NO starving or over-WIP indicator element |
| AC4.4 | Playwright | Live servers; ready queue CSV has 0 items; policy has ready `min_items: 3` | Page rendered | Ready box shows starving indicator (visible on screen, not colour-only) |
| AC4.5 | Playwright | Keyboard + assistive-tech check | Focus placed on a queue box with `status: 'starving'` | Screen-reader role query returns a label that includes the word "starving" or equivalent meaning |

---

## UC5 — ToC constraint highlight

| ID | Test type | Given | When | Then |
|----|-----------|-------|------|------|
| AC5.1 | Vitest unit | `parseConstraint("Some text\nConstraint: ready\nMore text")` | Function called | Returns `"ready"` |
| AC5.2 | Vitest unit | `parseConstraint("Some text\nToC: Deploy\nMore text")` | Function called | Returns `"deploy"` |
| AC5.3 | Vitest unit | `parseConstraint(null)` | Function called | Returns `null`; no crash |
| AC5.4 | Vitest unit | `parseConstraint("no constraint line here")` | Function called | Returns `null` |
| AC5.5 | Vitest/jsdom | PipelineMap rendered with `constraintQueue: 'ready'` | Component mounts | Ready box has a "constraint" CSS class or aria attribute; no other box does |
| AC5.6 | Vitest/jsdom | PipelineMap rendered with `constraintQueue: null` | Component mounts | No box has a "constraint" class or aria attribute |
| AC5.7 | Playwright | `baseline.md` served via CHK-1 API; content contains `Constraint: ready` | Page rendered | Ready box shows visible constraint marker distinct from starving/over-WIP |

---

## UC6 — SSE live refresh

| ID | Test type | Given | When | Then |
|----|-----------|-------|------|------|
| AC6.1 | Vitest/jsdom | SSE client module; mock EventSource fires `change` event with `path: "work/observatory/queues/ready.csv"` | Event received | `ready` queue re-fetch triggered exactly once; no other queue re-fetched |
| AC6.2 | Vitest/jsdom | Same as above but `path: "work/observatory/slices/s001-read-layer/slice.md"` | Event received | No queue re-fetch triggered |
| AC6.3 | Vitest/jsdom | Mock EventSource fires `change` event with `path: "process/dora/baseline.md"` | Event received | Baseline re-fetch triggered |
| AC6.4 | Playwright e2e | Both servers running; page loaded; Ready queue CSV has 2 items | A row is appended to `ready.csv` (via test script `fs.writeFileSync`) | Ready box count updates to 3 within 2000ms — without page reload |
| AC6.5 | Playwright | Both servers running; page loaded | Server is stopped and restarted | Page does not crash or go blank; after restart, EventSource reconnects; next file change updates the map |
| AC6.6 | Vitest/jsdom | SSE EventSource mock fires `onerror` | Error event fires | No unhandled promise rejection; state remains at last-known values |

---

## Accessibility & geometry conditions (ui-designer — SPECIFIED; source: ui-design.md §4)

Specified by ui-designer in `ui-design.md`. Pinned here as acceptance cases; the
engineer MUST NOT weaken them without ui-designer sign-off. Each asserts
**geometry / aria / text**, not colour (per EXP-016 visual-structural practice).

| ID | Test type | Given | When | Then |
|----|-----------|-------|------|------|
| A11Y-1 | Vitest/jsdom | PipelineMap rendered | Queried by role | `getByRole('region', { name: /pipeline map/i })` resolves (root has `role="region"`, `aria-label="Pipeline map"`) |
| A11Y-2 | Vitest/jsdom | Ready queue `status:'starving'`, length 1 | Component mounts | Ready box is `role="group"`; accessible name matches `/ready queue, 1 item.*starving/i` (name carries count AND state) |
| A11Y-3 | Playwright | Page loaded | Tab pressed from page start | All four boxes reachable in order intake→ready→deploy→rework; each receives visible focus |
| A11Y-4 | Playwright | A queue box | `:focus-visible` | Focus indicator present, contrast ≥ 3:1, thickness ≥ 2px (computed `outline`/`box-shadow`) |
| A11Y-5 | Vitest/jsdom | starving box; over-wip box; ok box | Component mounts | starving box has `data-testid="state-badge"` w/ visible text `/starving/i` + `aria-hidden` icon; over-wip likewise `/over-?wip/i`; ok box has NO state-badge element |
| A11Y-6 | Vitest/jsdom | `constraintQueue:'ready'` | Component mounts | Ready box `data-constraint="true"` + `data-testid="constraint-badge"` w/ text `/constraint/i` + `aria-hidden` ◆; other boxes `data-constraint="false"`, no badge |
| A11Y-7 | Vitest/jsdom | Ready box is BOTH constraint AND starving | Component mounts | Both `state-badge` and `constraint-badge` present on the Ready box; distinct `data-testid`; neither masks the other |
| A11Y-8 | Playwright (axe) | Page rendered | axe contrast scan + token check | Name/count ≥ 4.5:1 on surface; meta ≥ 4.5:1; state/constraint borders ≥ 3:1 vs surface (WCAG 1.4.11); zero axe contrast violations |
| A11Y-9 | Playwright | Page rendered | Bounding box of each focusable box measured | Each QueueBox ≥ 24×24px (WCAG 2.2 §2.5.8) |
| A11Y-10 | Playwright | `prefers-reduced-motion: reduce` emulated | Live update (UC6) fires | Computed `transition-duration: 0s`; count changes with no animation |
| GEO-1 | Playwright | Page rendered, all four boxes present | Bounding boxes measured | Box `x` strictly increasing intake→ready→deploy AND `y` ranges overlap (one forward row) — map is a FLOW, not a stacked list |
| GEO-2 | Playwright | Page rendered | Bounding boxes measured | Rework box `y` is below the forward row (return-loop topology, not a 5th inline box) |
| GEO-3 | Playwright | starving + constraint box | Bounding boxes measured | state-badge and constraint-badge bounding boxes are contained within their owning QueueBox |

> Tokens, colour values, and the redundant icon+text+colour state encoding are in
> `work/observatory/design/design-system.md`. Run axe via `make a11y` (root Makefile).

---

## §11.2 render-mechanism gate (flags for ui-designer + solution-architect)

The acceptance cases above are written to be render-mechanism-agnostic (DOM
assertions on text content and aria attributes, not on SVG vs CSS specifics).

The ui-designer and solution-architect must resolve before UC3 starts:

- **Option A (recommended for this slice):** HTML+CSS flex layout for the 4
  boxes; inline SVG `<line>` or `<path>` elements for the flow arrows.
  Rationale: no external dependency; full control over accessibility markup;
  4-box static topology does not benefit from Mermaid's graph-layout engine.
  
- **Option B:** Mermaid `flowchart` diagram rendered in the browser.
  Rationale: consistent with CHK-4 dependency graph rendering. Risk: Mermaid
  adds ~300KB bundle weight; accessibility of Mermaid-rendered SVG is harder to
  control; overkill for a 4-box static layout.

- **Option C:** A small CSS grid with `position: absolute` arrows (pure CSS,
  no SVG). Lightest; slightly less flexible for dynamic arrow colours.

Product recommendation: Option A. Final call: **ui-designer + architect.**
