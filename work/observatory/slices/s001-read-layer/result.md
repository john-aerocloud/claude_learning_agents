---
slice: s001
slug: read-layer
agent: engineer
item: UC-S001-1
status: UC1 DONE (scaffold + project registry); UC2-6 pending
---

# Result — UC-S001-1 (project registry + scaffold)

## What landed on trunk

| sha | content |
|-----|---------|
| 17c92bb | project-registry parser + observatory scaffold (package.json scripts, vitest.config, deps) |
| 5e856cd | package-lock for reproducible clean-checkout install |
| 425230b | HTTP adapter + base app + server bootstrap + start:check probe |

WIP stayed independent: UC-S001-1 owns the scaffold seam + the UC1 paths only.
No UC2-6 files touched. The scaffold edges (UC1→UC2/3/4/5) in use-case-deps.mmd
are now satisfied — the scaffold is committed, so UC2-5 become a maximal
independent set.

## Files created

**Scaffold seam (shared; built minimal-but-correct for UC2-6):**
- `work/observatory/package.json` — scripts `server` / `test:ci` / `start:check` (+ `test`); deps express, csv-parse, chokidar; devDeps vitest, supertest.
- `work/observatory/package-lock.json`
- `work/observatory/vitest.config.js` — node env; `vitest run` in CI (no watch hang).
- `work/observatory/src/server/repoRoot.js` — robust repo-root resolver (env override > `../../../..` from src/server/).
- `work/observatory/src/server/app.js` — base Express app: read-only posture (no body parser, GET-only) + **extensible mount seam** (`createApp({ repoRoot, extraRouters })`).
- `work/observatory/src/server/server.js` — bootstrap on :3001 (PORT override); **composition point** for UC2-5 routers; structured startup log with sha.
- `work/observatory/scripts/start-check.js` — committed deployable-surface probe (jittered retry, categorised internal-service failure log).

**UC1 feature (project registry):**
- `work/observatory/src/server/parsers/project-registry.js` — domain parser: `listProjects(root)`, `readActive(root)`. Lists `work/*` except `_TEMPLATE`/non-dirs; reads project.md frontmatter fail-soft; ACTIVE none/empty/missing/ghost → null.
- `work/observatory/src/server/routes/projects.js` — GET-only HTTP adapter (depends on parser; never the reverse).
- `work/observatory/src/server/__tests__/project-registry.test.js` — 10 specs (parser).
- `work/observatory/src/server/__tests__/projects-api.test.js` — 7 specs (HTTP + read-only posture).

## Tests: 17/17 green (vitest run)

UC1 acceptance pinned: AC1.1 (list excl _TEMPLATE/non-dirs), AC1.2 (active flag),
AC1.3 (ACTIVE=none → null, all false), AC1.4 (ACTIVE absent → null no crash),
AC1.5 (200 both endpoints). Plus fail-soft (missing project.md, missing work/),
ghost-project, and read-only POST/PUT → 404.

## Endpoints — verified behaviour (live, real work/ tree)

- `GET /api/projects` → 200; `[{id,active,status,created,stopped}]`. Real tree:
  observatory(active:true), ox, oxo-online; `_TEMPLATE`/`ACTIVE`/`README.md` excluded.
- `GET /api/active` → 200; `{"active":"observatory"}`. With ACTIVE=none → `{"active":null}`.
- `POST /api/projects` → 404 (no write verb). `X-Observatory-Sha` header present.

## Local deploy: start:check exit 0

`npm --prefix work/observatory run start:check` → server up → GET /api/projects
200 (attempt 2) → SIGTERM → exit 0. Probe uses PORT 3010 to avoid clashing a
running :3001.

## Scaffold extensibility for UC2/3/4/5 (how routers mount)

UC2-5 each: (1) add their router module under `src/server/routes/`, (2) import it
in `server.js` and append to the `extraRouters` array passed to `createApp`.
They MUST NOT edit `app.js`'s own registrations or `routes/projects.js`. The mount
seam (`createApp({ repoRoot, extraRouters })`) mounts every supplied router under
`/api`. Each router takes `{ repoRoot }` so tests inject a fixture tree (the UC1
test pattern is the template). `repoRoot.js` is shared and resolves once.

## Open items for next UCs

- **OI-1 (UC6):** read-only route-table assertion (AC6.3) and CORS for
  localhost:5173 (AC6.4/6.5, T-READ-11) are NOT yet implemented — app.js has the
  read-only posture by construction (no body parser, GET-only routers) but CORS
  middleware and the programmatic route-table inspection test are UC6's. The
  mount seam is ready for UC6 to add CORS as app-level middleware in `createApp`.
- **OI-2 (UC5):** server.js `extraRouters` is the SSE watcher's wiring point;
  chokidar watch root = the resolved repoRoot. capabilities.md AC5.6 requires SSE
  to respect CORS (not `*`) — coordinate with UC6's CORS middleware.
- **OI-3 (csv-parse, UC2):** OR-S001-b — csv-parse returns all values as strings
  unless cast config is set; §4 queue schemas treat value/cost/vc_ratio as raw
  strings (AC2.2 says "preserved as strings"), so default string output is
  correct — UC2 should NOT add numeric casts.
- **OI-4 (TS vs JS):** capabilities.md sketched TypeScript (`index.ts`,
  `tsconfig.json`); this UC built plain JS ESM per the build brief (thinner, no
  tsc gate, matches Vitest-only). UC2-6 should continue in JS ESM. If TS is
  wanted, that is a scaffold change to flag to cicd/architect — do not mix.
- **OI-5 (file naming):** use-cases.md names handler files `*.ts`; built as
  `*.js`. Seam paths are otherwise identical (`routes/projects.js`,
  `parsers/project-registry.js`).

## Allowlist

No gap. `npm --prefix work/observatory run *`, `npm --prefix * install *`, and
`node work/observatory/scripts/* *` all ran without prompt. start:check is
invoked via the npm script (allowlist-shaped).

## Tooling self-serviced

`start:check` script (committed, tested via live run, documented here) is the
deployable-surface probe per capabilities.md §4. No root Makefile target added —
the npm scripts are the committed parameterised entry points for this local-only
project (capabilities.md decided npm scripts as the run interface).
