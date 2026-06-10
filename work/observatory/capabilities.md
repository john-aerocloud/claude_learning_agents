# Functional capabilities — observatory

Owned by the CICD agent. Lists only what the *current* chunk needs — nothing
ahead of need. Revised each chunk.

---

## Topology (current — post CHK-2 consolidation)

**ONE server, ONE port, ONE package.json.**

The old two-process topology (Express on :3001 + Vite SPA on :5173) has been
replaced. `work/observatory/src/server/` has been deleted. All domain logic
lives in `work/observatory/src/app/` which is a single Vite project that serves
both the SPA (with HMR) and all `/api/*` routes via a Vite plugin.

```
# Start EVERYTHING (SPA + API + HMR + SSE on :5173):
npm --prefix work/observatory/src/app run dev

# Run all tests (domain unit + SPA component, one suite):
make test-observatory

# Run browser tests (Playwright / chromium):
make browser-observatory
```

**Environments:** local only. No cloud infrastructure, no GitHub Actions deploy
pipeline, no OIDC, no AWS.

---

## CHK-1 — Read layer & project registry

### 1. Tech choices

**Runtime:** Node.js (LTS, v22). Continuity with oxo-online.

**Server structure (current):** A Vite plugin (`observatoryApiPlugin`) wired
into `work/observatory/src/app/vite.config.js`. The plugin mounts a connect
middleware (`createApiMiddleware`) on `configureServer` (dev) and
`configurePreviewServer` (preview) — both prepend before Vite's SPA fallback so
API routes take priority.

No Express dependency. Vite's `server.middlewares` is a plain connect instance;
the middleware uses `(req, res, next) => void`.

**Directory layout:**
```
work/observatory/src/app/
  server/
    apiMiddleware.js      ← ALL /api/* routes, connect-compatible, no Express
    viteApiPlugin.js      ← Vite plugin: watcher + middleware, installs on dev+preview
    repoRoot.js           ← resolves repo root (env var or 5 levels up)
    watcher.js            ← chokidar file-watch + SSE broadcast
    parsers/
      file-reader.js      ← readRaw()
      csv.js              ← parseCsv(), readItems(), readQueue()
      project-registry.js ← listProjects(), readActive()
    lib/
      ledgerAggregator.js ← parseLedger(), aggregateStageFlow(), CANONICAL_STAGES
    __tests__/            ← server-side Vitest specs (node environment)
      helpers.js          ← createTestServer() wraps middleware in http.Server
      *.test.js           ← 14 server test files using supertest
  src/
    components/           ← Preact components (StageNode, InFlightBadge, etc.)
    api/                  ← fetch wrappers (same-origin /api/…)
    state/                ← Preact signals state
    __tests__/            ← SPA component tests (jsdom environment)
  e2e/
    fixtures/repo/        ← committed deterministic fixture repo for Playwright
    *.spec.js             ← Playwright browser specs
  vite.config.js          ← plugins: [preact(), observatoryApiPlugin()]
  vitest.config.js        ← environmentMatchGlobs: server/**→node, src/**→jsdom
  playwright.config.js    ← webServer: npm run dev on :5173, OBSERVATORY_REPO_ROOT=fixture
  package.json            ← chokidar + csv-parse in deps; supertest in devDeps
```

**CSV parsing:**
- `parseCsv`: shared for items.csv, queue CSVs — strict RFC-4180 via csv-parse.
- `parseLedger`: tolerant line-oriented parser for `process/dora/ledger.csv`
  (real ledger has unescaped commas in `note` field; strict parser silently drops
  rows with stray quotes; line-oriented is fidelity-correct per §8).

**File-watch mechanism:** `chokidar` watching the entire repo root with
`ignoreInitial: true`. FSEvents on macOS gives sub-second latency.

**Server-side auto-restart (OI-SERVER-RESTART — fixed):** `viteApiPlugin.js`
adds `SERVER_DIR` (the `server/` source directory) to Vite's existing chokidar
watcher. Any `.js` change under `server/` (excluding `__tests__/`) triggers
`server.restart()` after a 300ms debounce. Vite re-runs config + plugins, which
re-imports the API middleware modules fresh. Client files under `src/` continue
to HMR without a full restart (they are never under `server/`). No restart loop
— server/ files are not in the Vite HMR module graph. Verified: `apiMiddleware.js`
edit auto-restarted in under 1s (no manual restart); client `App.jsx` edit
produced HMR only (no full restart in log).

**Push channel: SSE.** `GET /api/events` — long-lived, heartbeat every 30s,
clean teardown on `req.close`. Rationale: one-way server-to-client push; SSE is
the correct primitive; no WebSocket needed.

**Read-only posture:** Only GET/HEAD/OPTIONS served. Non-read methods return 405.

---

### 2. Environments

**Local only.** No cloud environment, no deploy pipeline.

"Deployed" = working on a clean checkout:

```
npm --prefix work/observatory/src/app install
npm --prefix work/observatory/src/app run dev
# => http://localhost:5173  (SPA + API + HMR, same-origin, no CORS)
```

---

### 3. Test approach

**Test runner:** Vitest (single suite, two environments).

| Glob | Environment | Coverage |
|---|---|---|
| `server/__tests__/**/*.test.js` | `node` | Domain: parsers, ledgerAggregator, watcher, all 12 API routes, SSE, integration |
| `src/**/__tests__/**/*.test.{js,jsx}` | `jsdom` | SPA components, state, API client |

**Test counts (passing):** 322 unit/component tests across 30 test files.

**Browser tests:** Playwright/chromium only. 26 tests passing covering:
- `value-stream-map.spec.js` — DEFECT-001 fix (real non-zero throughput),
  in-flight badge (wip>0), GEO geometry, A11Y accessible names, tab order.
- `work-item-tree.spec.js` — REQ→CHK→UC tree render, indentation geometry,
  keyboard navigation, state badges.
- `a11y-contrast.spec.js` — axe zero colour-contrast violations.
- `value-stream-live.spec.js` — LiveStatusDot shows "Live" (DEFECT-003 fix),
  reduced-motion transition.

**Fixture repo:** `e2e/fixtures/repo/` is a committed deterministic fixture.
- `process/dora/ledger.csv` — demo project: engineer throughput=3, wip=1 (CHK-4
  in-flight), intake=2, validate=1, deploy=1.
- `work/demo/items/items.csv` — 6 items (REQ-DEMO → CHK-1 → UC-D1-1/UC-D1-2,
  CHK-4 → UC-D4-1). DEFECT-002 reconciliation uses this: CHK-4 is `in-progress`
  so it IS counted as in-flight; UC-D1-1/UC-D1-2 are `done` so they are NOT.

---

### 4. Validation entrypoints

```
make test-observatory      # 322 unit + component tests (Vitest --run)
make browser-observatory   # 26 Playwright browser tests (chromium)
```

`make validate PROJECT=observatory` is NOT the entry point (it assumes a cloud
deploy target; observatory is local-only).

---

### 5. Rollback assets

No cloud infrastructure → no infra rollback procedure. The repo is the rollback
asset. The server is stateless (reads files; writes nothing). `git revert` is
always safe.

---

### 6. Feature flags

No feature flags needed. The read layer is unconditional. Flag infrastructure
will be introduced only when a future chunk requires phased behaviour.

---

### 7. Allowlist command classes

All patterns in `.claude/settings.json`:

| Pattern | Rationale |
|---|---|
| `npm --prefix work/observatory/src/app run *` | All app scripts (dev, build, test:ci, test:browser) |
| `npm --prefix work/observatory/src/app install *` | Install SPA dependencies |
| `make test-observatory` | Single vitest suite |
| `make browser-observatory` | Playwright browser specs |
| `make a11y-observatory` | A11Y subset via --grep @a11y |

---

## CHK-2 — Pipeline map SPA + single-server consolidation

### Status: COMPLETE

CHK-2 delivered:
- Single-server topology (Vite plugin — `observatoryApiPlugin`).
- ValueStreamMap SPA component with 10 canonical stage nodes in a banded layout
  (queue / build / release lanes; left→right within build lane).
- InFlightBadge (wip>0 nodes get a prominent non-colour-only badge).
- GateMarker on intake and deploy nodes.
- ReworkLoopConnector (SVG arc with visible "Rework" text outside aria-hidden SVG).
- LiveStatusDot (DEFECT-003: shows "Live" / "Disconnected" based on SSE state;
  onOpen self-heals; onError sets stale=true; stuck-on-Disconnected bug fixed).
- DEFECT-001: real non-zero throughput figures (ledger parser fidelity fix).
- DEFECT-002: WIP reconciliation against items.csv (open enter for absent/terminal
  items not counted as in-flight).
- DEFECT-003: stale-on-real-disconnect (covered above).
- MetricSource traceability reveal (UC-S004-5): focus+Enter/hover reveals ledger
  row refs for each figure; aria-describedby wired per AC5.3/A11Y-10.
- WorkItemTree (UC-S005-2): REQ→CHK→UC hierarchy, roving tabindex, indented
  geometry, space-tag badges.
- WorkItemTreeContainer (UC-S005-3): selected-item drill seam.
- All server tests migrated into single vitest suite with node/jsdom split.
- Old `work/observatory/src/server/` directory deleted.

### Deferred

- Mermaid rendering for `.mmd` files.
- DORA panel + stage cards + time-thief view.
- Prompt-handoff steer engine.
- Cross-browser Playwright (Firefox, WebKit).
- Detail pane drill-down (slice artifact markdown viewer).
- Per-user feature flags — not applicable; single local operator.
