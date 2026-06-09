---
slice: s001
slug: read-layer
author: engineer
---

# Route — s001 read layer

Built per-use-case (§11a). UC1 is thinnest-first and ALSO establishes the shared
scaffold seam (`package.json`, `vitest.config`, base Express `app.js`, repo-root
resolver, extensible router mounting) that UC2–UC5 attach to per the
use-case-deps scaffold edges. The scaffold is built minimal-but-correct here so
later UCs add routers without touching it.

## UC-S001-1 — project registry + scaffold (this engineer)

Ordered failing tests (red → green → refactor on trunk):

1. **R1 — repo-root resolver** (`repoRoot.js`): resolves repo root from the
   server dir robustly (server runs from project root per repo conventions).
   Pin: resolved root contains `work/` and `process/`. (scaffold seam)
2. **R2 — project registry parser** (domain `parsers/project-registry.js`):
   - lists every dir under `work/` except `_TEMPLATE` and non-dir entries
     (`ACTIVE`, `README.md`). [AC1.1, T-READ-1]
   - reads `project.md` frontmatter (status, created, stopped) per project;
     project missing `project.md` does not crash — typed record with null fields. [fail-soft]
   - reads `work/ACTIVE`; `active:true` on the matching project, else false. [AC1.2]
   - ACTIVE = `none`/empty/missing/names-missing-project → active flag null target. [AC1.3, AC1.4, T-READ-2]
3. **R3 — routes** (`routes/projects.js`): GET /api/projects, GET /api/active
   wired onto an Express router; mounts onto the base app. [AC1.5]
4. **R4 — base app** (`app.js`): read-only posture (GET-only; no body parser),
   extensible `mountRouters()` seam so UC2/3/4 add routers without editing UC1's
   handlers. server.js boots on :3001 (PORT override).
5. **R5 — start:check** smoke script: server up → GET /api/projects 200 → exit 0.
6. **green** integration: supertest against the app over the REAL `work/` tree
   AND a synthetic fixture tree (resolver is parameterised by root).

The probe for this UC's deployable surface is `npm --prefix work/observatory run
start:check` (a make-target-class committed entry point per capabilities.md).

## Scaffold seam (claimed by UC-S001-1)

`work/observatory/package.json`, `vitest.config.js`, `src/server/app.js`,
`src/server/server.js`, `src/server/repoRoot.js`, `scripts/start-check.js`.
UC2–UC5 mount routers via `app.mountRouters()` — they MUST NOT edit `app.js`'s
own route registrations; they add their router module and pass it to the mount
seam in `server.js`/`app` composition.
