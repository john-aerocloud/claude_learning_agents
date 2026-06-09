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

## Realised composition edges (UC6 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| UC6 → UC1..UC5 | `src/server/compose.js` (NOT `index.ts`) | engineer/UC-S001-6 2026-06-09 | The declared `index.ts` mount point was realised as `compose.js` (`buildServerApp`) called by `server.js`. compose.js constructs the watcher + UC2-UC5 routers and passes them via createApp's `extraRouters`; UC1 is mounted inside createApp (not double-mounted). CORS + read-only guard live in `app.js` so they apply to every router. Declared `index.ts` edges in the table above are satisfied by this seam. |

## Realised SPA→read-layer runtime edges (s002 build)
| edge (from → to) | seam | realised by | note |
|------------------|------|-------------|------|
| S2-UC1 SPA client → CHK-1 read layer (:3001) | `src/app/src/api/client.js` → `routes/{projects,items-queues,dora,events}.js` over HTTP | engineer/S2-UC1 2026-06-09 | The SPA↔server boundary is the NETWORK, not an import. `client.js` is the single SPA-side adapter that knows the `:3001` base URL + endpoint shapes; it calls GET `/api/active`, `/api/projects`, `/api/projects/:id/queues/:q`, `/api/dora/baseline`, and opens an EventSource on `/api/events`. UC2-UC6 import this client, never fetch directly. Drawn as a dashed runtime call edge in `class-deps.mmd` (SPA_CLIENT ⇢ R_PROJ/R_ITEMS/R_DORA/R_EVENTS). Fail-soft contract: any net/HTTP/parse failure → `null`. |

## Hidden edges discovered (false independence — a collision happened)
| date | items | shared seam | edge added | collision ledger ref |
|------|-------|-------------|-----------|----------------------|
_(none yet — scaffold edge caught pre-build at scheduling time, classified as §39 scheduling edge, not a post-collision hidden edge)_

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
