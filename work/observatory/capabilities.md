# Functional capabilities — observatory

Owned by the CICD agent. Lists only what the *current* chunk needs — nothing
ahead of need. Revised each chunk.

---

## CHK-1 — Read layer & project registry

### 1. Tech choices

**Runtime:** Node.js (LTS, currently v22). Continuity with oxo-online (same
toolchain: Node/Vite/Vitest); no reason to deviate.

**Server structure:** A single thin Express (or Node `http`) server,
`work/observatory/src/server/`, that:
- Accepts the repo root as a configuration parameter (default: `../../..`
  relative to its own location, resolving to the project root on a standard
  checkout).
- Exposes a read-only HTTP API on `localhost:3001` (SPA dev server will use a
  different port, conventionally `localhost:5173`). Default port is `3001`.
- Has NO write endpoints — the route table must never register POST/PUT/PATCH/DELETE.
- Serves CORS headers for `http://localhost:5173` only (the Vite dev server
  origin; CHK-2+ SPA half). All other origins are rejected.

**Directory layout:**
```
work/observatory/
  src/
    server/           ← CHK-1: the read layer (this chunk)
      index.ts        ← entry point; starts server + watcher
      routes/         ← per-source route handlers
      parsers/        ← CSV, markdown, .mmd parsers
      watcher.ts      ← file-watch + SSE broadcast
    app/              ← CHK-2+ SPA (deferred; Vite project rooted here later)
  package.json        ← shared devDependencies for server+app; scripts for each
  tsconfig.json
  vitest.config.ts
```

**CSV/markdown/.mmd parsing:**
- CSV: `csv-parse` (sync/stream; typed schema per §4 column list; tolerates
  header-only files and missing optional columns — parse returns empty array, not
  an error).
- Markdown: raw string returned as-is for `baseline.md`, `flow.md`,
  `per-project.md`, and slice artifact files. Rendering to HTML is a SPA
  concern (CHK-4). CHK-1 exposes the raw markdown string.
- `.mmd`: raw string returned as-is. Mermaid rendering is a SPA concern (CHK-4).

**File-watch mechanism:** `chokidar` watching the entire repo root with
`ignoreInitial: true`. `chokidar` is reliable across macOS/Linux, handles
FSEvents on macOS (sub-second latency), and has no dependency on `fs.watch`
quirks on macOS (which can miss renames on some node versions).

**Push channel: Server-Sent Events (SSE).**

Rationale for SSE over WebSocket:
- The channel is one-way: server pushes change notifications to the browser.
  SSE is the correct primitive for a unidirectional server-to-client push.
- SSE is native HTTP — no protocol upgrade, no handshake overhead, no library
  required in the browser (`EventSource` API).
- Reconnect and retry are built into the EventSource spec.
- No framing, no keep-alive complexity beyond `comment: ""` heartbeats.
- Matches §2 read-only constraint by construction: SSE has no client-to-server
  message path in the EventSource API.
- WebSocket was considered and rejected: bidirectional protocol for a
  unidirectional use-case is over-engineering. Reserve for CHK-5+ if the steer
  engine needs two-way messaging (deferred).

SSE endpoint: `GET /api/events` — long-lived connection; server sends a
`data: {"type":"change","path":"<rel-path>"}` event on every file-watch event.
The SPA client reconnects on disconnect (EventSource does this natively).

**Live-refresh latency target:** N < 1s from file-write to SSE event delivery.
Chokidar on macOS (FSEvents) typically delivers in < 200ms. The 1s target is
conservative and easily achievable.

---

### 2. Environments

**Local only.** Per §2 (local-first) and §10 (no hosting), there is no cloud
environment, no GitHub Actions deploy pipeline, and no hosting concern for
observatory. "Deploy" means: the run command works on a clean checkout.

**CONSOLIDATED TOPOLOGY (post CHK-2 simplification):**

ONE server, ONE port, NO CORS, Vite HMR in dev.

```
# Install dependencies (once — observatory package only):
npm --prefix work/observatory install

# Start the single consolidated server (API + SPA + HMR):
npm --prefix work/observatory run dev

# Runs on: http://localhost:3001
# API:    GET /api/projects, GET /api/active, GET /api/dora, etc.
# SPA:    GET /          → Vite-transformed Preact SPA (dev: HMR; prod: static dist/)
# Watch:  GET /api/events (SSE)
# CORS:   NONE — SPA and API share origin
# HMR:    Vite middleware WS upgrade on :3001 (same port, no second process)
```

**Dev vs production serve:**

- Dev (`NODE_ENV` != `production`): Vite `createServer({ middlewareMode: true })`
  is mounted into Express AFTER `/api/*`. Edits to `.jsx`/`.css` hot-reload.
  Entry: `src/server/dev.js`.
- Production (`NODE_ENV=production`): Express serves the pre-built
  `src/app/dist/` statically with index.html fallback.

**The two-server setup (CHK-1/CHK-2 design) is retired.** The old separate
`npm --prefix work/observatory/src/app run dev` (:5173) + `npm run server`
(:3001) with CORS is replaced by one command.

**Default port:** `3001`. Configurable via `PORT` env var.

**No GitHub Actions pipeline is created for this project** — there is nothing to
deploy to a remote target. The CI check (if any) is a local `npm test` assertion
run in a workflow on push to verify the read layer stays green. This is not a
§F5 infra-bearing deploy gate.

Optional: a minimal `.github/workflows/ci-observatory.yml` that runs
`npm --prefix work/observatory ci` and `npm --prefix work/observatory run test:ci`
on pull requests to guard against regressions. This is a test-only workflow —
no deployment step, no OIDC, no AWS credentials.

---

### 3. Test approach — always TDD

**Test runner:** Vitest (matches oxo-online toolchain; runs with `--run` flag in
CI to prevent watch-mode hang).

**Test location:** `work/observatory/src/server/__tests__/`

**What acceptance tests for CHK-1 cover:**

| Test group | What is asserted | Fixture |
|---|---|---|
| Project registry | Lists all `work/*` dirs except `_TEMPLATE`; reads `work/ACTIVE`; returns `none` when ACTIVE = `none` | Fixture dir tree with 2 projects + `_TEMPLATE` |
| CSV parser — normal | Parses `items.csv`, `intake.csv`, `ready.csv`, `deploy.csv`, `rework.csv`, `policy.csv` to typed records; column types match schema | Small valid CSVs with 2-3 rows |
| CSV parser — resilience | Header-only CSV returns `[]` (no crash); missing optional file returns `null` (no crash); extra unknown column is ignored | Header-only fixture files; missing-file paths |
| ACTIVE=none | `GET /api/active` returns `{ active: null }` when `work/ACTIVE` = `none`; no crash | Fixture ACTIVE file containing `none` |
| Markdown sources | `baseline.md`, `flow.md` returned as raw strings; missing file returns `null` | Fixture markdown files |
| .mmd sources | `use-case-deps.mmd`, `class-deps.mmd` returned as raw strings; missing returns `null` | Fixture .mmd file |
| HTTP API shape | Each endpoint returns the documented JSON shape with correct status codes | Integration tests against a test server instance |
| File-watch re-emit | Mutating a fixture CSV triggers an SSE event delivery within 1000ms | Vitest + SSE client (`EventSource` or `fetch` streaming) against test server; assert event arrives before 1s timeout |

**File-watch test approach:** start a test server instance pointing at a temp
fixture directory; connect an SSE client; write a change to a fixture file
(using `fs.writeFileSync`); assert the SSE event arrives within 1000ms. Vitest's
async `vi.waitFor` / `Promise.race` with a timeout covers this without sleep.

**No Playwright for CHK-1** — the read layer has no browser surface. Playwright
is deferred to CHK-2+ when the SPA exists.

---

### 4. Continuous deployment (local)

"Deploy" for a local-first tool = `npm install && npm run server` works on a
clean checkout. The pipeline for this is:

```
Lint → Test (Vitest --run) → Start check (server starts and /api/projects
responds 200 within 5s, then exits)
```

This is captured in two scripts in `package.json`:

```json
"test:ci": "vitest run",
"start:check": "node scripts/start-check.js"
```

`start:check` is a lightweight smoke: starts the server, polls `GET /api/projects`
once, asserts 200, then `SIGTERM`s the server and exits 0. Verifies the run
command works on a clean checkout.

If a CI workflow is added (optional, light):

```yaml
# .github/workflows/ci-observatory.yml
on:
  push:
    paths:
      - work/observatory/**
      - .github/workflows/ci-observatory.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - name: Install
        run: npm --prefix work/observatory install
      - name: Lint
        run: npm --prefix work/observatory run lint
      - name: Test
        run: npm --prefix work/observatory run test:ci
      - name: Start check
        run: npm --prefix work/observatory run start:check
```

No secrets, no OIDC, no AWS. The `environment: production` gate is intentionally
absent — no approval queue is wanted for a local-only tool.

**This is NOT an infra-bearing pipeline** — the §F5 infra deploy gate does not
apply. No two-pipeline structure needed; no CDK.

---

### 5. Rollback assets

No cloud infrastructure = no rollback procedure for infra. The repo is the
rollback asset. If a change to the read layer breaks parsing:

- `git revert <sha>` restores the prior server code.
- No database, no migration, nothing irreversible.

The server is stateless (reads files; writes nothing). There is no rollback
distinction between forward-fix and revert — both are equally safe.

---

### 6. Feature flag infrastructure for CHK-1

No feature flags are needed in CHK-1. The read layer is unconditional. Flag
infrastructure (if any) will be introduced when a CHK-2+ use-case requires
phased behaviour. Nothing ahead of need.

---

### 7. Allowlist command classes needed

The following command forms must be present in `.claude/settings.json` before
the engineer begins CHK-1. Checked against the current allowlist:

| Pattern | Status | Rationale |
|---|---|---|
| `Bash(npm --prefix work/observatory run *)` | **ADD** | Run any observatory npm script (lint, test:ci, server, start:check) |
| `Bash(npm --prefix work/observatory install)` | **ADD** | Install dependencies on clean checkout |
| `Bash(npm --prefix work/observatory ci)` | CHECK — `npm --prefix * ci *` already covers this | Covered by existing wildcard pattern if `*` matches `work/observatory ci`; confirm pattern includes zero-arg forms |
| `Bash(npx vitest run --prefix work/observatory *)` | NOT NEEDED — invoked via npm script, not directly | `npm --prefix work/observatory run test:ci` is the CI form |
| `Bash(node work/observatory/scripts/*)` | **ADD** | `start:check` script + any future utility scripts |

Existing patterns that already cover observatory needs:
- `Bash(npm --prefix * run *)` — covers `npm --prefix work/observatory run <script>`.
- `Bash(npm --prefix * ci *)` — covers `npm --prefix work/observatory ci` (zero-arg `ci` should match `*`; confirm `*` matches empty string in the shell-glob sense used by the allowlist engine).
- `Bash(npm --prefix * install *)` — covers `npm --prefix work/observatory install`.
- `Bash(python3 *)` — covers DORA ledger writes.
- `Bash(git add *)`, `Bash(git commit *)` — covered.

**New pattern required (not yet in allowlist):**
- `Bash(node work/observatory/scripts/* *)` — for `start:check` and future scripts.

This follows the existing `Bash(node work/oxo-online/scripts/* *)` pattern
already in the allowlist. The narrowest form: exact project path, wildcard only
on script name and args.

---

### Deferred (not CHK-1)

- SPA Vite dev server setup (`work/observatory/src/app/`, port 5173) — CHK-2.
- Mermaid rendering — CHK-4.
- Playwright end-to-end tests — CHK-2+.
- Prompt composition / steer engine — CHK-5.
- GitHub Actions CI workflow — optional; only add when there is a regression to
  guard. Not needed to start CHK-1.
- Two-pipeline structure (app + infra) — not applicable; no cloud.
- WebSocket upgrade — not applicable; SSE is the chosen channel.
- Per-user feature flags — not applicable; single local operator.

---

## CHK-2 — Pipeline map SPA

### 1. SPA toolchain

**Build tool:** Vite (LTS, currently v5). Continuity with oxo-online; no new
toolchain to learn.

**Component layer: Preact** (`preact` + `@preact/signals`).

Rationale — requirement is "lightweight component layer"; options considered:

| Option | Why accepted / rejected |
|---|---|
| Preact | ~3 kB runtime, full JSX, hooks API, first-class Vite plugin. Signals give fine-grained reactivity for live SSE updates without virtual-DOM full-tree diffs. The accessibility requirements (keyboard-nav, aria, state not colour-only) are standard DOM concerns — no framework heaviness needed. ACCEPTED. |
| Lit | Better for isolated web-components; more boilerplate for SPA-level routing and shared state. Rejected for a single-page composition. |
| Vanilla + htm | Viable but adds manual wiring for SSE-driven reactivity and keyed lists. Preact signals give this for free at 3 kB cost. Rejected as net-more-code for the same runtime size. |
| React | ~140 kB runtime. Rejected — no feature of CHK-2 justifies the weight. |

**SPA root:** `work/observatory/src/app/` (Vite project; `package.json` owned
here for Vitest + Playwright devDependencies).

**Directory layout:**
```
work/observatory/src/app/
  index.html
  package.json          ← SPA devDependencies: preact, vitest, jsdom,
                            @playwright/test (NOT vite — owned by parent pkg)
  vite.config.js        ← used for SPA-only builds; dev server runs from parent
  vitest.config.js
  playwright.config.js  ← webServer: single `npm run dev` on :3001
  src/
    main.jsx            ← Preact entry
    components/         ← PipelineMap, QueueNode, StageCard, ValueStreamMap, …
    api/
      client.js         ← fetch wrappers (API_BASE='', relative same-origin)
  e2e/                  ← Playwright browser specs
```

**Dev/serve:** `npm --prefix work/observatory run dev` (from the observatory
package root, NOT the src/app directory). This starts the consolidated server
(Express API + Vite HMR on :3001). The old separate `npm --prefix
work/observatory/src/app run dev` is retired.

**Build:** `npm --prefix work/observatory/src/app run build` — emits `dist/` in
the `src/app/` directory. In production, Express serves this statically.

**API calls:** Relative `fetch` to `/api/…` (same-origin; no CORS). SSE via
`EventSource('/api/events')`.

---

### 2. Test approach — always TDD

**Unit / component tests — Vitest + jsdom**

Runner: `vitest run` (never bare `vitest`; `--run` prevents watch-mode hang in
CI and in the `test:ci` npm script).

What they cover:

| Test group | Assertion |
|---|---|
| `derive.ts` — queue-state derivation | Given `policy.csv` rows (min_items, wip_limit) and a queue length, derive: NORMAL / STARVING / OVER_WIP state. Pure function; no DOM. |
| `derive.ts` — constraint detection | Given `baseline.md` parsed output, return the constraint agent name. Pure function. |
| `api.ts` — response shape | Mock-fetch returns documented JSON; typed records match schema. |
| PipelineMap component | Render with fixture data; assert aria-label on queue nodes; assert `data-state` attribute = "starving" / "over-wip" / "normal" (not colour-only); assert constraint node has `aria-label` containing "constraint". |
| SSE integration | `sse.ts` unit: stub EventSource; assert callback fires on message; assert reconnect on error. |

**Browser / Playwright tests**

Runner: `npx playwright test` (chromium only for CHK-2 — cross-browser is CHK-3+
scope; local dev needs only one browser).

What they cover (DOM geometry + aria; never colour-only assertions):

| Spec | Assertion |
|---|---|
| `pipeline-map.spec.ts` — queue nodes present | Each queue (Intake, Ready, Deploy, Rework) has a labelled DOM node; `aria-label` includes queue name and length. |
| `pipeline-map.spec.ts` — starving flag | When a fixture queue has `len < min_items`, the node has `data-state="starving"` AND a visible text label ("Starving") — not just a colour. |
| `pipeline-map.spec.ts` — over-WIP flag | When `len >= wip_limit`, `data-state="over-wip"` AND visible text label. |
| `pipeline-map.spec.ts` — constraint highlight | The constraint node has `data-constraint="true"` AND `aria-label` includes "Constraint". |
| `pipeline-map.spec.ts` — keyboard navigation | Tab key reaches each queue node; Enter opens detail; Escape closes. Aria roles correct. |
| `pipeline-map.spec.ts` — live update | Trigger a file-change event stub; assert the queue length DOM node updates without page reload. |

Playwright config: `work/observatory/src/app/playwright.config.js` — `webServer`
starts the SINGLE consolidated server (`npm run dev` from the observatory
package root) and waits for port 3001. Tests run against `http://localhost:3001`.
No second webServer block needed (API and SPA share one process).

**Accessibility note:** Every visual-state signal (starving, over-WIP,
constraint) MUST carry both a `data-state` attribute AND a visible text label or
`aria-label`. Playwright specs assert the non-colour signal — this is the
test-level enforcement of "state never colour-only".

---

### 3. Validation entrypoint fix

**Problem:** `make validate` resolves `APP := work/$(PROJECT)/src/app` and calls
`npm --prefix $(APP) run test:validation`. For observatory, `src/app` does not
exist in CHK-1, so any invocation of `make validate PROJECT=observatory` fails.
The tester also needs a single target that runs BOTH the server tests AND the SPA
tests.

**Fix: project-level `test:ci` script in `work/observatory/package.json` + a new
root Makefile target `test-observatory`.**

Step 1 — extend `work/observatory/package.json` with a composite script:

```json
"test:all": "vitest run && npm --prefix work/observatory/src/app run test:ci"
```

This runs server Vitest first, then SPA Vitest. Both use `vitest run` (no
watch-mode hang). Fails fast on first failure.

Step 2 — add a `test-observatory` target to the root `Makefile`:

```makefile
# Observatory: run server tests + SPA unit/component tests (no browser)
# Used by the tester for CHK-2 build-phase validation.
# make test-observatory
test-observatory:
	npm --prefix work/observatory run test:ci && \
	npm --prefix work/observatory/src/app run test:ci
```

This is the target the tester calls. It does NOT go through the `APP` variable
(which assumes an oxo-online-style layout). It directly addresses each package
by its real prefix path.

Step 3 — for Playwright (browser tests), a separate `browser-observatory` target:

```makefile
# Observatory: run Playwright browser specs (requires :3001 + :5173 running,
# or Playwright webServer config starts them).
# make browser-observatory
browser-observatory:
	npx playwright test --config work/observatory/src/app/playwright.config.ts
```

Step 4 — `make validate PROJECT=observatory` is NOT the correct entry point for
a local-only project (it calls `test:validation` which is a Playwright suite on
a deployed PROD_URL; observatory has no cloud deploy). The tester's per-slice
gate is:

```
make test-observatory    ← unit + component (Vitest)
make browser-observatory ← map render + keyboard nav (Playwright, local)
```

This is documented in the tester capability gap resolution: the tester should
call `test-observatory` and `browser-observatory`, not `make validate`.

Both targets are added to the root Makefile `.PHONY` list and the allowlist in
this capability step.

---

### 4. Local deploy

"Deployed" = running on a clean checkout:

```
# Install (once — observatory package only; src/app install optional for Playwright):
npm --prefix work/observatory install

# Start EVERYTHING — one command:
npm --prefix work/observatory run dev
# => http://localhost:3001  (API + SPA + HMR on one port; no CORS)
```

For a build check (verifies the Vite bundle compiles without errors):

```
npm --prefix work/observatory/src/app run build
# => work/observatory/src/app/dist/  (local static assets; no upload)
```

No infra deploy gate. No cloud target. No two-pipeline structure. Local-only per
§2 (local-first) and the CHK-1 capability decision.

---

### 5. Feature flags

No feature flags needed for CHK-2. The pipeline map is unconditional. Flag
infrastructure will be introduced only if a future chunk requires phased
behaviour.

---

### 6. Allowlist additions for CHK-2

The following patterns are added to `.claude/settings.json` in this capability
step. All follow the narrowest exact-path form per process §33.

| Pattern | Rationale |
|---|---|
| `Bash(npm --prefix work/observatory/src/app run *)` | Run any SPA npm script: dev, build, test:ci, test:browser, etc. |
| `Bash(npm --prefix work/observatory/src/app install *)` | Install SPA dependencies on clean checkout. |
| `Bash(npx playwright test --config work/observatory/src/app/playwright.config.ts *)` | Run observatory Playwright browser specs. The existing `Bash(npx playwright test *)` wildcard covers this, but explicit form is listed for clarity; no new entry needed if the wildcard matches. |
| `Bash(make test-observatory)` | New root Makefile target; must be in allowlist. |
| `Bash(make browser-observatory)` | New root Makefile target; must be in allowlist. |

Existing patterns that already cover CHK-2 needs without a new entry:
- `Bash(npm --prefix * run *)` — covers `npm --prefix work/observatory/src/app run <script>`.
- `Bash(npm --prefix * install *)` — covers the SPA install.
- `Bash(npx playwright test *)` — covers Playwright with a `--config` flag.
- `Bash(make validate *)` — already in allowlist; not the CHK-2 entry point but pattern exists.

**Net-new allowlist entries required (patterns not already matched):**
- `Bash(make test-observatory)` — new target, no wildcard covers exact-name targets without args.
- `Bash(make browser-observatory)` — same reason.

These are added to `.claude/settings.json` in this capability step below.

---

### Deferred (not CHK-2)

- Mermaid rendering for `.mmd` files — CHK-4.
- Work-item tree (REQ→CHK→SLC→UC) — CHK-4.
- DORA panel + stage cards + time-thief view — CHK-3.
- Prompt-handoff steer engine — CHK-5.
- Cross-browser Playwright (Firefox, WebKit) — CHK-3+.
- Detail pane drill-down (slice artifact markdown) — CHK-4.
- Per-user feature flags — not applicable; single local operator.
