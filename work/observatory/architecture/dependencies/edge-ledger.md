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

## Hidden edges discovered (false independence — a collision happened)
| date | items | shared seam | edge added | collision ledger ref |
|------|-------|-------------|-----------|----------------------|
_(none yet — scaffold edge caught pre-build at scheduling time, classified as §39 scheduling edge, not a post-collision hidden edge)_

## False-edge null-hypothesis trials (false dependency — needless serialisation)
| edge | trial start | opportunities run | result (reinstated/retired) | evidence |
|------|-------------|-------------------|-----------------------------|----------|
_(none yet)_

## Notes
- The scaffold edges UC1→UC2/3/4/5 are **scheduling edges** (§39), not product-logic dependencies.
  They serialise only the first-cycle parallel set; once UC1's scaffold is committed,
  UC2/3/4/5 become a maximal independent set (no logic cross-dependency, disjoint seams).
- These edges were flagged by the orchestrator BEFORE build (pre-build detection, §F7).
  No collision occurred; no rework was incurred. This is the intended path.
- False-edge trial candidate: if the team ever prepares the scaffold as a separate
  pre-commit (e.g. a project-init step), the UC1→UC2/3/4/5 scaffold edges could be
  retired. Track as a future trial opportunity.
