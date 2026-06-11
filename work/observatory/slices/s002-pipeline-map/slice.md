---
slice: s002
slug: pipeline-map
status: ready
chunk: CHK-2
created: 2026-06-09
infra-deploy-gate: NO   # local-only SPA; no cloud infra; §F5 gate does not apply
process-ref: §F3 (JIT replenishment) + §37 (use-case decomposition) + §F6 (seams/paths)
ui-slice: YES           # ui-designer designs structure before engineer builds
---

# s002 — CHK-2 pipeline map: SPA scaffold + queue render + buffer flags + constraint mark + SSE live refresh

## Job served

**[CORE] Observe DORA and flow metrics (J1)**

When I want flow state at a glance, a pipeline operator wants the pull system
drawn with live queue lengths against their buffers and the constraint
highlighted, so they can see where flow is breaking without opening any file.

This slice delivers the first user-visible screen. Where s001 gave a trustworthy
data layer readable only via `curl`, s002 lets the operator open a browser and
see the pipeline. Killick test: YES — the operator can observe queue state (live,
with starving/over-WIP flags and the ToC constraint marked) in one browser tab,
a task that previously required reading four CSV files and `baseline.md`.

## Architecture

**Local SPA only.** Vite dev server at `http://localhost:5173` (pre-existing
CORS target in the CHK-1 server). Talks exclusively to the CHK-1 localhost read
API on `http://localhost:3001`. No cloud dependency; no write endpoint.

Consume the following CHK-1 endpoints (all delivered in s001):
- `GET /api/active` — identify the active project
- `GET /api/projects/:id/queues/intake` — Intake queue records
- `GET /api/projects/:id/queues/ready` — Ready queue records
- `GET /api/projects/:id/queues/deploy` — Deploy queue records
- `GET /api/projects/:id/queues/rework` — Rework queue records
- `GET /api/projects/:id/queues/policy` — buffer policy (min_items, wip_limit per queue)
- `GET /api/dora/baseline` — raw baseline.md string (for ToC constraint parsing)
- `GET /api/events` — SSE channel for live refresh (no manual reload)

**Open question §11.2 — Mermaid vs custom SVG/HTML+CSS for the pipeline map.**
For four boxes with arrows (Intake → Ready → Deploy → Rework loop), custom
HTML+CSS flex-boxes with SVG arrows is likely lighter and more controllable than
pulling in the full Mermaid library for a static topology. Recommendation: use
HTML+CSS+SVG for this 4-box static layout; reserve Mermaid for CHK-4 where
the dependency `.mmd` graphs are already Mermaid-native. Final call belongs to
**ui-designer + solution-architect** before UC3 (pipeline render) begins.

**SPA scaffold note (shared seam — see s001 lesson):** UC1 establishes the Vite
app scaffold (`src/app/`, `vite.config.ts`, base HTML entry, Vitest browser or
jsdom config, ESLint). All subsequent UCs in this slice attach to that scaffold.
UC1 is a scheduling serialisation prerequisite for UC2–UC5; however, the
acceptance-test logic for each UC is independently exercisable once the scaffold
exists. The engineer MUST close UC1 before starting UC2–UC5.

## Scope: what IS in this slice

1. **Vite SPA scaffold** — `src/app/` (Vite project with TypeScript, minimal
   component framework — lightweight vanilla TS components or Preact, TBD with
   ui-designer/architect), `vite.config.ts`, entry HTML, base CSS reset, dev
   script, and connection to CHK-1 API. No render logic yet; just the shell.

2. **Queue data fetch + state layer** — fetch the four queue CSVs and policy CSV
   for the active project; parse into an in-memory state object: `{queue, items[],
   length, min_items, wip_limit, status: 'ok'|'starving'|'over-wip'}` for each
   of Intake/Ready/Deploy/Rework. No UI yet; this is the data layer.

3. **Pipeline map render** — the 4-queue pull-system drawn as a flow: Intake →
   Ready → (dev loop implied) → Deploy; Rework as a return path. Each box shows
   queue name and live item count. Topology is static; only counts are dynamic.
   Decision on rendering mechanism (HTML+CSS vs Mermaid) must be resolved by
   ui-designer before this UC begins.

4. **Buffer-state flags** — starving (`len < min_items`) and over-WIP (`len >=
   wip_limit`) shown visually on the relevant queue box. State is never
   communicated by colour alone (accessibility: §8 NFR); label or icon used
   alongside colour. Values sourced from `policy.csv` via CHK-1 API.

5. **ToC constraint highlight** — parse the constraint name from the raw
   `baseline.md` string (the "Constraint:" or "ToC:" line); highlight the
   matching stage/queue on the map. If no constraint line is parseable, render
   nothing (fail soft; no crash).

6. **SSE live refresh** — SPA connects to `GET /api/events` via `EventSource`;
   on each `change` event the SPA re-fetches only the changed queue(s) and
   re-renders the affected boxes. No manual reload needed. Falls back gracefully
   if SSE is unavailable (manual poll or static render — ui-designer to decide
   fallback UX).

## Scope: what is explicitly NOT in this slice

- **Work-item tree** (REQ→CHK→SLC→UC) — CHK-4 / s004+.
- **DORA panel or stage cards** — CHK-3 / s003.
- **Drill-down into queue items** — clicking a queue box opens nothing yet; CHK-4.
- **Multi-project switching** — the SPA reads `work/ACTIVE` and shows that
  project; switching is not in scope here.
- **Time-thief view** — CHK-3.
- **Prompt-composition / steer affordances** — CHK-5+. Phase-1 is strictly read-only.
- **Mermaid rendering of .mmd dependency graphs** — CHK-4.
- **Mobile/responsive optimisation** — out of scope for v1 (§12 project.md).
- **`ledger.csv` item-history** — CHK-4.
- **Per-agent throughput/dwell metrics on the map** — CHK-3 concern.
- **Deploy gate approval flow** — the Deploy queue is shown (length + flags) but
  the gate interaction is a CHK-5 steer affordance.

## Non-infra confirmation

Runs on `localhost:5173` (Vite dev server). No cloud environment, no GitHub
Actions deploy, no AWS credentials, no database. The §F5 infra-bearing deploy
gate does NOT apply. "Running it" means:
```
npm --prefix work/observatory run server   # port 3001 (already from s001)
npm --prefix work/observatory run dev      # Vite SPA on port 5173
```
Open `http://localhost:5173` — pipeline map is visible and live.

## Success measures

| # | Measure | Observable signal |
|---|---------|-------------------|
| SM1 | 4-queue map renders | All four queues (Intake/Ready/Deploy/Rework) visible in browser with live item counts |
| SM2 | Starving flag | When `len < min_items` for a queue, that box shows a starving indicator (not colour-only) |
| SM3 | Over-WIP flag | When `len >= wip_limit` for a queue, that box shows an over-WIP indicator (not colour-only) |
| SM4 | ToC constraint marked | The stage/queue named as the constraint in `baseline.md` is visually highlighted |
| SM5 | Live refresh | A file change triggers map update within a configurable N seconds; no manual reload |
| SM6 | Fail soft | Missing `policy.csv` or unparseable `baseline.md` constraint line → no crash; map renders without flags |
| SM7 | Accessibility | All state indicators pass keyboard navigation check; state is not communicated by colour alone |
| SM8 | No writes | SPA makes zero POST/PUT/PATCH/DELETE requests; confirmed by network tab inspection |
