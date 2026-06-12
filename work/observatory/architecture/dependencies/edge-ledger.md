# Dependency-edge ledger (§13 — dependency-tree learning)

Records declared edges between use-cases/seams and what we learned about them.
Two error classes are tracked here; the goal is to drive both toward zero.

## Declared edges
| edge (from → to) | seam | declared by | reason |
|------------------|------|-------------|--------|
| UC1 → UC6 | `src/server/index.ts` (imports UC1 route handler) | product/s001 use-cases.md | UC6 wires all route handlers; must import UC1 routes |
| UC2 → UC6 | `src/server/index.ts` (imports UC2 route handlers) | product/s001 use-cases.md | UC6 wires all route handlers; must import UC2 routes |
| UC3 → UC6 | `src/server/index.ts` (imports UC3 route handlers) | product/s001 use-cases.md | UC6 wires all route handlers; must import UC3 routes |
| UC4 → UC6 | `src/server/index.ts` (imports UC4 route handlers) | product/s001 use-cases.md | UC6 wires all route handlers; must import UC4 routes |
| UC5 → UC6 | `src/server/index.ts` (imports UC5 watcher) | product/s001 use-cases.md | UC6 wires all route handlers; must import UC5 watcher |
| UC1 →(scaffold)→ UC2 | `package.json`, `src/server/` bootstrap, `vitest.config.ts`, base Express app | orchestrator §F7 pre-build flag / flow-manager 2026-06-09 | **Scheduling edge (§39):** UC1 is thinnest-first; it creates the project scaffold that UC2-5 all need. If UC2-5 start concurrently on an empty project dir, multiple engineers write `package.json`/`src/server/index.ts` at the same time — a collision on the scaffold seam. Caught pre-build; serialised by scheduling, not compensating logic. |
| UC1 →(scaffold)→ UC3 | same scaffold seam as above | orchestrator §F7 pre-build flag / flow-manager 2026-06-09 | Same rationale as UC1→UC2 scaffold edge |
| UC1 →(scaffold)→ UC4 | same scaffold seam as above | orchestrator §F7 pre-build flag / flow-manager 2026-06-09 | Same rationale as UC1→UC2 scaffold edge |
| UC1 →(scaffold)→ UC5 | same scaffold seam as above | orchestrator §F7 pre-build flag / flow-manager 2026-06-09 | Same rationale as UC1→UC2 scaffold edge |
| S2-UC1 →(scaffold)→ S2-UC2 | `src/app/` (directory), `src/app/api/client.ts`, `vite.config.ts`, `src/app/main.ts`, `src/app/index.html`, extended `package.json` (dev + test:ci scripts) | product/s002 use-cases.md / flow-manager 2026-06-09 | **Scheduling edge (§39) — same pattern as s001:** S2-UC1 creates the Vite SPA scaffold that all subsequent SPA UCs attach to. If S2-UC2..5 start concurrently on an empty `src/app/`, they collide writing `vite.config.ts` / the entry point. Caught pre-scheduling; serialised by scheduling, not compensating logic. |
| S2-UC1 →(scaffold)→ S2-UC3 | same `src/app/` scaffold seam | product/s002 use-cases.md / flow-manager 2026-06-09 | Same rationale as S2-UC1→S2-UC2 scaffold edge |
| S2-UC1 →(scaffold)→ S2-UC4 | same `src/app/` scaffold seam | product/s002 use-cases.md / flow-manager 2026-06-09 | Same rationale as S2-UC1→S2-UC2 scaffold edge |
| S2-UC1 →(scaffold)→ S2-UC5 | same `src/app/` scaffold seam | product/s002 use-cases.md / flow-manager 2026-06-09 | Same rationale as S2-UC1→S2-UC2 scaffold edge |
| S2-UC1 →(scaffold)→ S2-UC6 | same `src/app/` scaffold seam | product/s002 use-cases.md / flow-manager 2026-06-09 | Same rationale; S2-UC6 also serial-last for additional logic reasons (needs full live-data path) |
| S2-UC2 → S2-UC3 | `src/app/state/queues.ts` (QueueState[] type exported by UC2; UC3 imports to render counts) | product/s002 use-cases.md | UC3 render depends on the QueueState shape UC2 defines; logic dependency |
| S2-UC2 → S2-UC4 | `src/app/state/queues.ts` (QueueState.status field) | product/s002 use-cases.md | UC4 indicator render reads status from UC2's state layer |
| S2-UC3 → S2-UC4 | `src/app/components/PipelineMap.ts` (UC4 extends UC3's rendered boxes) | product/s002 use-cases.md | UC4 attaches indicators to queue box elements UC3 renders |
| S2-UC3 → S2-UC5 | `src/app/components/PipelineMap.ts` (UC5 adds constraint prop + class to UC3's map) | product/s002 use-cases.md | UC5 targets the rendered map boxes UC3 creates |
| S2-UC2 → S2-UC6 | `src/app/state/queues.ts` (SSE re-fetch updates the state layer UC2 owns) | product/s002 use-cases.md | UC6 triggers re-fetch of the queue state layer UC2 defines |
| S2-UC3 → S2-UC6 | `src/app/components/PipelineMap.ts` (SSE refresh re-renders the map UC3 owns) | product/s002 use-cases.md | UC6 triggers re-render of the pipeline map UC3 owns |
| S2-UC4 → S2-UC6 | `src/app/components/PipelineMap.ts` (UC4 indicators must re-render on live update) | product/s002 use-cases.md | UC6 must trigger flag re-render; UC4 must exist first |
| S2-UC5 → S2-UC6 | `src/app/state/constraint.ts` (baseline re-fetch on `change` event for baseline.md) | product/s002 use-cases.md | UC6 triggers constraint re-evaluation; UC5 must define that path first |
| UC-S005-2 → UC-S005-3 | `src/app/src/components/WorkItemTreeContainer.jsx` (`onSelect`/`selectedId`/`onItemsLoaded` controlled-selection props) + `DetailPane.jsx` shared seam | engineer/s005 UC-S005-3 build 2026-06-10 | **Logic edge:** UC-S005-3 lifts the tree's selection into `ObservatoryView` and feeds the resolved record to the detail pane. Tree (UC-S005-2) must render + expose `onSelect` first. Satisfied — tree was delivered before this build. |
| UC-S005-3 → UC-S005-4 | `src/app/src/components/DetailPane.jsx` (`data-testid="artifact-view"` slot — UC-S005-4 swaps the raw `<pre>` for ArtifactView) | engineer/s005 | DetailPane shell + artifact-view slot must exist before the markdown/mmd renderer composes in. Slot left clearly marked. |
| UC-S005-3 → UC-S005-5 | `src/app/src/components/DetailPane.jsx` (`data-testid="item-history-slot"` labelled empty region — UC-S005-5 mounts ItemHistoryPanel) | engineer/s005 | DetailPane shell + history slot must exist before the history panel composes in. Slot left clearly marked. |
| DEF-012 fix → flow-manager staging contract | `work/<project>/queues/staging.csv` (header `item_id,parent,job,value,cost,produced_ts,producer_ref`; policy rows in `queues/policy.csv`) | engineer/DEFECT-012 2026-06-11 | **Data-contract edge:** the new `server/routes/staging.js` route + `StagingQueueBox.jsx` (inserted in `ValueStreamMap.jsx`'s queue lane between Decompose and Ready, loaded by `VsmContainer.jsx`) read the staging CSV the flow-manager owns; product appends at decompose completion, flow-manager drains at every sweep. Seams disjoint from in-flight UC-S014-2 (SteerPanel/ObservatoryView) and UC-S015-1 (ViewSwitch/WipPanel wrap the main column; the board region stays inside the Pipeline view). |

## Realised composition edges (UC6 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| UC6 → UC1..UC5 | `src/server/compose.js` (NOT `index.ts`) | engineer/UC-S001-6 2026-06-09 | The declared `index.ts` mount point was realised as `compose.js` (`buildServerApp`) called by `server.js`. compose.js constructs the watcher + UC2-UC5 routers and passes them via createApp's `extraRouters`; UC1 is mounted inside createApp (not double-mounted). CORS + read-only guard live in `app.js` so they apply to every router. Declared `index.ts` edges in the table above are satisfied by this seam. |

## Realised SPA→read-layer runtime edges (s002 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| S2-UC1 SPA client → CHK-1 read layer (:3001) | `src/app/src/api/client.js` → `routes/{projects,items-queues,dora,events}.js` over HTTP | engineer/S2-UC1 2026-06-09 | The SPA↔server boundary is the NETWORK, not an import. `client.js` is the single SPA-side adapter that knows the `:3001` base URL + endpoint shapes; it calls GET `/api/active`, `/api/projects`, `/api/projects/:id/queues/:q`, `/api/dora/baseline`, and opens an EventSource on `/api/events`. UC2-UC6 import this client, never fetch directly. Drawn as a dashed runtime call edge in `class-deps.mmd` (SPA_CLIENT ⇢ R_PROJ/R_ITEMS/R_DORA/R_EVENTS). Fail-soft contract: any net/HTTP/parse failure → `null`. |

## Realised SPA render edges (S2-UC3 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| S2-UC3 render → S2-UC2 state | `MapContainer.jsx` imports `state/queues.js` (`initQueueState`) | engineer/S2-UC3 2026-06-09 | The declared `S2-UC2 → S2-UC3` logic edge was realised via a thin `MapContainer` seam: `main.jsx` mounts `<MapContainer/>` as the App child (its one allowed edit), `MapContainer` calls `initQueueState()` on mount and hands the `QueueState[]` to the **pure** `PipelineMap`. PipelineMap is a pure fn of props — touches no fetch/state — so UC4 (badge on `data-status`) and UC5 (constraint prop) extend it without re-touching the data path. Tokens stylesheet seeded at `styles/tokens.css` (design-system.md source-of-truth). |
| S2-UC3 browser path → CHK-1 read layer (:3001) | `playwright.config.js webServer` boots `npm run server` (OBSERVATORY_REPO_ROOT=e2e/fixtures/repo) + `npm run dev`; real chromium drives :5173 → client → :3001 | engineer/S2-UC3 2026-06-09 | The render is proven END-TO-END through a REAL browser against the full deployed path (not a node probe) — GEO-1/GEO-2 geometry + A11Y region/group-name/tab-order/focus specs. Read layer pointed at a committed deterministic fixture repo so counts never flap. |

## Realised s005 detail-pane render edges (UC-S005-4 / UC-S005-5 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| UC-S005-3 → UC-S005-4 (declared) | `DetailPane.jsx` `data-testid="artifact-view"` slot → mounts `ArtifactView.jsx` | engineer/UC-S005-4 2026-06-10 | The declared slot edge was realised by replacing the raw `<pre>` branch with `<ArtifactView kind text source/>`. ArtifactView renders markdown via `marked` (semantic HTML — h1/ul/table/code, no top-level `<pre>`; AC-S005-4-1/2, AC-S005-3-2) and renders fenced ```mermaid blocks / `.mmd` artifacts through the `renderMmd` PORT. NEW node `SPA_ARTVIEW` + dashed SDK edge `SPA_ARTVIEW ⇢ MARKED_SDK`. Fail-soft: null/empty → "not yet available"; mermaid render failure → readable-text fallback (AC-S005-4-3/4). |
| ArtifactView → Mermaid adapter | `ArtifactView.jsx` `renderMmd` port default = `lib/mermaidRender.js renderMermaidToSvg` | engineer/UC-S005-4 2026-06-10 | HEXAGONAL: the concrete `mermaid` SDK is isolated behind the `renderMmd` port. `lib/mermaidRender.js` (NEW node `SPA_MMDADAPTER`) is the ONLY importer of `mermaid` (dynamic import, `securityLevel=strict`). Unit specs inject a port FAKE (jsdom cannot lay out an SVG); the real adapter is proven live in a real browser on :5199. Dashed edge `SPA_MMDADAPTER ⇢ MERMAID_SDK`. svg gets `role="img"` + aria-label (A11Y-S005-10). |
| UC-S005-3 → UC-S005-5 (declared) | `DetailPane.jsx` `data-testid="item-history-slot"` → mounts `ItemHistoryPanel.jsx`; `DetailPaneContainer.jsx` fetches via `getItemLedger` | engineer/UC-S005-5 2026-06-10 | The declared history-slot edge was realised by mounting `<ItemHistoryPanel rows itemId/>` into the slot. NEW node `SPA_HISTORY`. DetailPaneContainer gained a `getItemLedger(project, itemId)` fetch on select (NEW client helper) → new dashed runtime edge `SPA_CLIENT ⇢ R_LEDGER` (GET `/api/projects/:id/ledger?item_id=<id>`, the UC-S005-1 endpoint — NO server change). Rows render newest-first in the DEFECT-005 readable style (`HH:MM·agent·event·outcome`, never `row:N`); empty → "no history" (AC-S005-5-4); GEO-S005-2 vertical stack. |

## Realised SPA buffer-state badge edge (S2-UC4 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| S2-UC3 → S2-UC4 (declared) | `PipelineMap.jsx` QueueBox mounts `BufferStateIndicator.jsx` (`SPA_PIPELINE → SPA_BADGE` in class-deps.mmd) | engineer/S2-UC4 2026-06-09 | The declared `S2-UC3 → S2-UC4` edge ("UC4 attaches indicators to the boxes UC3 renders") was realised by mounting a NEW pure component `BufferStateIndicator(status)` inside QueueBox where it reads the existing `data-status`/`queue.status`. No new data path: the badge is a pure fn of the domain status UC2 already computed. A11Y-5 redundant cue (▽/△ aria-hidden icon + visible "starving"/"over-WIP" text + the `--c-state-*` colour token — never colour-only). `ok` → renders null (no badge). The `data-constraint="false"` hook on QueueBox was left UNTOUCHED for UC5's ConstraintBadge. Verified end-to-end in a REAL browser (live A11Y-5 on the fixture's starving Ready box + GEO-3 containment) and by an axe contrast scan (A11Y-8, zero violations incl. the new state tokens) via `make a11y-observatory`. |
| S2-UC2 → S2-UC4 (declared) | `BufferStateIndicator` consumes `QueueState.status` (via QueueBox prop) | engineer/S2-UC4 2026-06-09 | Satisfied transitively: status flows UC2 state layer → MapContainer → PipelineMap/QueueBox → BufferStateIndicator. The badge never imports the state layer directly (pure-prop boundary), so the UC2→UC4 logic edge is honoured without a new import edge. |

## Realised SPA live-refresh edges (S2-UC6 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| S2-UC2/3/4/5 → S2-UC6 (declared) | `MapContainer.jsx` subscribes `subscribeEvents` and re-runs BOTH loaders on a relevant change frame (`SPA_CONTAINER → SPA_CLIENT` subscribe edge in class-deps.mmd) | engineer/S2-UC6 2026-06-09 | The declared UC2/3/4/5→UC6 edges were realised at the SAME MapContainer seam UC3/UC5 already own — NOT in the separate `sse/events-client.ts`+`state/constraint.ts` modules the use-cases.md sketched. Rationale: the live path is one re-run of the SAME injected loaders (`load`=initQueueState, `loadConstraint`=getBaseline→parse→match) the one-shot mount already calls, so counts (UC3), badges (UC4, pure fn of status) and the constraint highlight (UC5) all refresh through the existing pure-prop render with NO new data path or duplicated derivation. `subscribeEvents` (the API adapter, EventSource over `/api/events`) is injected so jsdom drives it with a fake; the real EventSource path is proven by the Playwright live spec. PATH FILTER: only `…/queues/{intake,ready,deploy,rework,policy}.csv` or `…baseline.md` re-load (AC6.2); a burst DEBOUNCE-coalesces into one re-run; unsubscribe on unmount (no leak). New pure indicator `LiveStatusDot.jsx` reflects connection state (A11Y-10 reduced-motion). |
| S2-UC6 SSE → CHK-1 read layer (:3001) | `client.js subscribeEvents` → EventSource `/api/events` → `routes/events.js` (watcher port) | engineer/S2-UC6 2026-06-09 | Reuses the existing dashed runtime edge `SPA_CLIENT ⇢ R_EVENTS`. The change-frame `path` is repo-relative + OS-separated (watcher uses `path.join`); the SPA filter normalises `\`→`/` so it holds on any host. Proven end-to-end in a REAL browser (Playwright live spec): mutate a watched fixture CSV → Ready count updates <~1s with no reload. |

## Realised SPA DORA/flow parse-seam edges (s003-UC1 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| s003-UC1 parsers → SPA_CLIENT (getFlow) | `client.js` adds `getFlow(project)` → HTTP GET `/api/projects/:id/dora/flow` ({content} envelope, fail-soft null); `fetchFlow` alias | engineer/s003-UC1 2026-06-09 | The flow read endpoint already existed on the :3001 read layer (`routes/dora.js` `/projects/:id/dora/:artifact`); s003-UC1 added the missing SPA-side adapter helper. Same fail-soft + URL-encode contract as `getBaseline`. New dashed runtime edge `SPA_CLIENT ⇢ R_DORA` (flow) in class-deps.mmd. UC4 (TimeThiefView) + UC6 (live re-fetch) consume it; not yet built. |
| s003-UC1 parseBaseline / parseFlow → SPA_MDTABLE | `baseline.js` + `flow.js` import `markdown-table.js` (`tableRows`) | engineer/s003-UC1 2026-06-09 | New shared pure helper `markdown-table.js` (GFM cell extractor) factored so both parsers reuse one table-parse, no duplication. `parseBaseline` extends the existing `baseline.js` (composes `parseConstraint`, no duplication); `parseFlow` is the new `flow.js`. Both pure domain, raw-string fidelity (§8), fail-soft → empty arrays/nulls. Nodes `SPA_MDTABLE`, `SPA_FLOWPARSER` added + `SPA_PARSER`/`SPA_CLIENT` marked `:::s003changed` in class-deps.mmd. These are the shared seam UC2 (DoraPanel), UC3 (StageCards), UC4 (TimeThiefView) bind to — none built yet. |

## Hidden edges discovered (false independence — a collision happened)
| date | items | shared seam | edge added | collision ledger ref |
|------|-------|-------------|-----------|----------------------|
| 2026-06-11 | UC-S013-2, UC-S015-2 | `ObservatoryView.jsx` (third tab wiring vs SteerMenu threading) | UC-S013-2 → UC-S015-2 (scheduling edge; ObservatoryView is the composition root that gains both the new defects tabpanel AND the onSteer threading from WipRow; concurrent edits would collide at the tablist/tabpanel wiring block) | UC-S015-2 build note: "serialized behind ae7aa28 on shared ObservatoryView (collision handled by commit order, no choreography)" — post-integration discovery, classified §39 scheduling edge but was undeclared in use-case-deps.mmd; edge to add S13UC2 → S15UC2 or joint serialisation via ObservatoryView ownership |
| 2026-06-11 | UC-S014-3, UC-S015-2 | `component-map.mmd` (both UCs annotated delta in same delta wave; no logic collision but adjacency conflict) | commit-granularity only — UC-S014-3 build note: "ObservatoryView untouched (collision avoided); component-map delta reached main via a273b02 adjacency" — the component-map.mmd file is a metadata file, not a runtime seam; the engineer avoided the actual ObservatoryView touch; classified commit-granularity / ordering concern, NOT a product-logic hidden edge; no use-case-deps.mmd change required |

## False-edge null-hypothesis trials (false dependency — needless serialisation)
| edge | trial start | opportunities run | result (reinstated/retired) | evidence |
|------|-------------|-------------------|-----------------------------|----------|
_(none yet)_

## Notes
- The scaffold edges UC1→UC2/3/4/5 (s001) are **scheduling edges** (§39), not product-logic
  dependencies. They serialise only the first-cycle parallel set; once UC1's scaffold is
  committed, UC2/3/4/5 become a maximal independent set (no logic cross-dependency, disjoint seams).
  s001 DELIVERED 2026-06-09 — all scaffold edges satisfied and closed.
- The scaffold edges S2-UC1→S2-UC2/3/4/5/6 (s002) follow the same §39 scheduling pattern.
  S2-UC1 must close first; then S2-UC2, S2-UC4, S2-UC5 form the maximal independent set
  (cycle-2); S2-UC3 is additionally gated on the §11.2 render-mechanism decision.
  S2-UC6 is serial-last (full live-data path required).
- These edges were flagged BEFORE build (pre-build detection, §F7). No collision occurred;
  no rework was incurred. This is the intended path.
- False-edge trial candidate: if the team ever prepares the scaffold as a separate
  pre-commit (e.g. a project-init step), the UC1→UC2/3/4/5 scaffold edges could be
  retired. Track as a future trial opportunity.
